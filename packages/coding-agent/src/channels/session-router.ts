/**
 * SessionRouter — multi-workspace session registry for the coordinator agent.
 *
 * The coordinator session (default workspace, alias `main`, created by
 * `zeta serve`) receives every inbound channel message unless that chat is
 * bound to a workspace. When it calls `workspace_run`, the router delivers a
 * subtask to the target workspace's session via `deliverIrcMessage` and waits
 * for that session's final `turn_end` reply. Target sessions never message
 * the user directly — only the coordinator pushes via `channel_send`, so a
 * delegated task produces exactly one reply path back to the user.
 *
 * Routing: each inbound chat is resolved by `resolveRoute` — a persisted
 * `sessionMapping` (platform + chat) bound to a workspace routes **direct**
 * (talk to that workspace, reply back through its own turn); everything else
 * goes **relay** (coordinator). Workspaces are registered with user-facing
 * aliases (`@workspace open <path> [alias]`, `*<alias>` shortcuts); the
 * coordinator's alias is reserved as `main`.
 *
 * Only used in web/desktop mode. CLI sessions have no router and `workspace_run`
 * stays unavailable (isToolAllowed rejects it).
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isEnoent, logger, Snowflake } from "@linxiraos/pi-utils";
import type { BotSessionEntry, WebConfig } from "../config/web-config";
import type { IrcMessage } from "../irc/bus";
import { createAgentSession } from "../sdk";
import type { AgentSession } from "../session/agent-session";
import type { AgentSessionEvent } from "../session/agent-session-events";
import { SessionManager } from "../session/session-manager";
import type { ChannelId } from "./channel";
import type { ImControlParams, ImControlResult } from "./im-control";

/** Upper bound for a delegated `workspace_run` turn (no reply → timeout error). */
const RUN_TIMEOUT_MS = 10 * 60_000;

/** Reserved alias of the relay coordinator (default workspace). */
export const COORDINATOR_ALIAS = "main";

interface ActiveRun {
	resolve: (text: string) => void;
	timer: ReturnType<typeof setTimeout>;
	/** Absolute directory of the workspace this delegation targets — only that
	 *  workspace's `turn_end` may resolve the run (a direct-mode reply from a
	 *  different workspace must not be mistaken for the subtask result). */
	dir: string;
}

/** A chat waiting for a direct-mode reply from a workspace or bot session. */
interface DirectReply {
	channelId: ChannelId;
	peer: string;
	/** Expiry timestamp — a stale pending reply is dropped after DIRECT_REPLY_TTL_MS. */
	expiresAt: number;
}

/** Upper bound for a pending direct reply; guards against a lost turn_end. */
const DIRECT_REPLY_TTL_MS = 10 * 60_000;

interface SessionHandle {
	session: AgentSession;
	unsubscribe: () => void;
}

/** A registered default-space bot session plus its live runtime. */
interface BotSessionHandle extends SessionHandle {
	entry: BotSessionEntry;
}

/** Map a reply language to the system-prompt / message directive line. */
export function languageDirectiveLine(lang: "zh" | "en"): string {
	return lang === "en" ? "Reply in English." : "Reply in Simplified Chinese.";
}

function assistantText(message: unknown): string {
	if (!message || typeof message !== "object" || (message as { role?: string }).role !== "assistant") return "";
	const content = (message as { content?: unknown }).content;
	if (!Array.isArray(content)) return "";
	return content
		.filter(
			(c): c is { type: "text"; text: string } =>
				c !== null && typeof c === "object" && (c as { type?: string }).type === "text",
		)
		.map(c => c.text)
		.join("")
		.trim();
}

export class SessionRouter {
	readonly #coordinator: AgentSession;
	readonly #webConfig: WebConfig;
	readonly #getLastInbound: () => { channelId: ChannelId; peer: string } | null;
	readonly #sendText: (channelId: ChannelId, to: string, text: string) => Promise<void>;
	/** IM channel tool sinks forwarded to bot sessions (undefined in CLI mode). */
	readonly #channelSend?: (opts: { text: string; to?: string; channel?: string }) => Promise<void>;
	readonly #workspaceRun?: (opts: { workspace: string; task: string }) => Promise<{ reply: string }>;
	/** Cwd for freshly created default-space bot sessions. */
	readonly #defaultCwd: string;
	/**
	 * Factory for a bot session's live runtime. zeta-server routes bot sessions
	 * through `startRpcSession` so they register in the web gateway (web-UI
	 * plan approval works) without spawning a duplicate session on the same
	 * file; the default falls back to `createAgentSession` (tests / CLI).
	 */
	readonly #createBotSessionRuntime?: (entry: BotSessionEntry) => Promise<AgentSession>;
	/** Natural-language IM control sink forwarded to bot sessions. */
	readonly #imControl?: (sessionKey: string, params: ImControlParams) => Promise<ImControlResult>;

	/** Keyed by absolute directory. */
	readonly #sessions = new Map<string, SessionHandle>();
	/** Default-space bot sessions, keyed by registry id. */
	readonly #botSessions = new Map<string, BotSessionHandle>();
	/** Bot-session reply bindings: bot session id → FIFO of waiting chats. A
	 *  shared bot session (multiple chats bound to one entry) must reply to
	 *  each pending chat in order, so this is a queue, not a single slot. */
	readonly #botDirectReplies = new Map<string, DirectReply[]>();
	/** Workspace alias → absolute directory (mirror of web.yml entries). */
	readonly #aliases = new Map<string, string>();
	#activeRun: ActiveRun | null = null;
	/** Direct-mode reply bindings: workspace dir → waiting chat. */
	readonly #directReplies = new Map<string, DirectReply>();
	/** Runtime (non-persisted) per-chat route override: "channel:peer" → alias. */
	readonly #runtimeBindings = new Map<string, string>();
	#stopping = false;

	constructor(options: {
		coordinator: AgentSession;
		webConfig: WebConfig;
		getLastInbound: () => { channelId: ChannelId; peer: string } | null;
		sendText: (channelId: ChannelId, to: string, text: string) => Promise<void>;
		/** Default cwd for newly created bot sessions (defaults to process.cwd()). */
		defaultCwd?: string;
		/** channel_send sink for bot sessions (defaults to the coordinator's pattern). */
		channelSend?: (opts: { text: string; to?: string; channel?: string }) => Promise<void>;
		/** workspace_run sink for bot sessions. */
		workspaceRun?: (opts: { workspace: string; task: string }) => Promise<{ reply: string }>;
		/** Factory for a bot session's live runtime (see {@link #createBotSessionRuntime}). */
		createBotSessionRuntime?: (entry: BotSessionEntry) => Promise<AgentSession>;
		/** Natural-language IM control sink forwarded to bot sessions. */
		imControl?: (sessionKey: string, params: ImControlParams) => Promise<ImControlResult>;
	}) {
		this.#coordinator = options.coordinator;
		this.#webConfig = options.webConfig;
		this.#getLastInbound = options.getLastInbound;
		this.#sendText = options.sendText;
		this.#defaultCwd = options.defaultCwd ?? process.cwd();
		this.#channelSend = options.channelSend;
		this.#workspaceRun = options.workspaceRun;
		this.#createBotSessionRuntime = options.createBotSessionRuntime;
		this.#imControl = options.imControl;
		// Load persisted aliases into the in-memory index.
		for (const entry of this.#webConfig.getWorkspaces()) {
			this.#aliases.set(entry.alias, entry.path);
		}
	}

	/** Registered workspace entries (alias + path), excluding the coordinator. */
	list(): { alias: string; path: string }[] {
		return [...this.#aliases.entries()].map(([alias, p]) => ({ alias, path: p }));
	}

	/** Enumerate every session file under one workspace's session dir (title + id). */
	async listWorkspaceSessions(aliasOrPath: string): Promise<{ id: string; title: string; path: string }[]> {
		const dir = this.resolveDir(aliasOrPath);
		if (!dir) return [];
		try {
			const sessions = await SessionManager.list(dir);
			return sessions.map(s => ({ id: s.id, title: s.title ?? s.id, path: s.path }));
		} catch (error) {
			logger.warn("Failed to list workspace sessions", {
				dir,
				error: error instanceof Error ? error.message : String(error),
			});
			return [];
		}
	}

	/** Resolve an alias (or absolute path) to a directory. */
	resolveDir(workspace: string): string | undefined {
		if (path.isAbsolute(workspace)) return workspace;
		return this.#aliases.get(workspace);
	}

	/** Open (or re-open) a directory as a workspace session; persists alias + path. */
	async open(dir: string, alias?: string): Promise<{ ok: true; alias: string } | { ok: false; error: string }> {
		const resolved = path.resolve(dir);
		const cleanAlias = alias?.trim() || path.basename(resolved);
		if (cleanAlias === COORDINATOR_ALIAS) {
			return { ok: false, error: `"${COORDINATOR_ALIAS}" is the reserved relay coordinator` };
		}
		const existing = this.#aliases.get(cleanAlias);
		if (existing && existing !== resolved) {
			return { ok: false, error: `Alias "${cleanAlias}" is already bound to ${existing}` };
		}
		if (!this.#sessions.has(resolved)) {
			try {
				const { session } = await createAgentSession({
					cwd: resolved,
					disableExtensionDiscovery: true,
				});
				const unsubscribe = session.subscribe(event => this.#onTargetEvent(resolved, event));
				this.#sessions.set(resolved, { session, unsubscribe });
			} catch (error) {
				logger.error("Failed to open workspace session", {
					dir: resolved,
					error: error instanceof Error ? error.message : String(error),
				});
				return { ok: false, error: error instanceof Error ? error.message : String(error) };
			}
		}
		this.#aliases.set(cleanAlias, resolved);
		const result = await this.#webConfig.setWorkspaceEntry(cleanAlias, resolved);
		if (!result.ok) return result;
		logger.info("Workspace session opened", { dir: resolved, alias: cleanAlias });
		return { ok: true, alias: cleanAlias };
	}

	/** Stop and remove a workspace session by alias. */
	async close(alias: string): Promise<{ ok: true } | { ok: false; error: string }> {
		const dir = this.#aliases.get(alias);
		if (!dir) return { ok: false, error: `Unknown workspace "${alias}"` };
		await this.#closeDir(dir);
		this.#aliases.delete(alias);
		await this.#webConfig.removeWorkspaceEntry(alias);
		logger.info("Workspace session closed", { dir, alias });
		return { ok: true };
	}

	/** Rename a workspace alias. */
	async rename(
		oldAlias: string,
		newAlias: string,
	): Promise<{ ok: true; alias: string } | { ok: false; error: string }> {
		const dir = this.#aliases.get(oldAlias);
		if (!dir) return { ok: false, error: `Unknown workspace "${oldAlias}"` };
		if (newAlias === COORDINATOR_ALIAS) {
			return { ok: false, error: `"${COORDINATOR_ALIAS}" is the reserved relay coordinator` };
		}
		if (this.#aliases.has(newAlias)) {
			return { ok: false, error: `Alias "${newAlias}" is already taken` };
		}
		this.#aliases.delete(oldAlias);
		this.#aliases.set(newAlias, dir);
		// Persist as a new entry (setWorkspaceEntry replaces by alias).
		await this.#webConfig.setWorkspaceEntry(newAlias, dir);
		await this.#webConfig.removeWorkspaceEntry(oldAlias);
		logger.info("Workspace alias renamed", { oldAlias, newAlias, dir });
		return { ok: true, alias: newAlias };
	}

	/**
	 * Resolve where one inbound chat message should go.
	 * Precedence: runtime override (from `@workspace use` / `*alias`) → persisted
	 * session mapping → channel default `workspaceRoot` → relay coordinator.
	 */
	async resolveRoute(channelId: ChannelId, peer: string): Promise<"direct" | "relay"> {
		const binding = await this.bindingFor(channelId, peer);
		if (!binding) return "relay";
		if (binding === COORDINATOR_ALIAS) return "relay";
		const dir = this.resolveDir(binding);
		if (!dir) return "relay";
		if (!this.#sessions.has(dir)) {
			const opened = await this.open(dir);
			if (!opened.ok) return "relay";
		}
		return "direct";
	}

	/** Resolve the effective workspace alias for one chat ("" = relay coordinator). */
	async bindingFor(channelId: ChannelId, peer: string): Promise<string | null> {
		const runtime = this.#runtimeBindings.get(`${channelId}:${peer}`);
		if (runtime) return runtime;
		const mapping = this.#webConfig.findSessionMapping(channelId, peer);
		// A mapping may carry only lang/sessionId (from !lang / !session use) with
		// no workspaceAlias — those must NOT shadow the channel-default
		// workspaceRoot fallback below.
		if (mapping?.workspaceAlias) return mapping.workspaceAlias;
		// Channel default workspace (`channels.<id>.workspaceRoot`): messages on
		// this channel go direct to that repo unless overridden above.
		const channelDefault = this.#webConfig.getData().channels[channelId]?.workspaceRoot;
		if (channelDefault) {
			const entry = this.#webConfig.findWorkspace(channelDefault);
			if (entry) return entry.alias;
			// Register the configured default on first use so direct routing works
			// without a manual `@workspace open`.
			const opened = await this.open(channelDefault, path.basename(channelDefault));
			if (opened.ok) return opened.alias;
		}
		return null;
	}

	/** Set a runtime (non-persisted) route override for one chat. */
	async setRuntimeBinding(
		channelId: ChannelId,
		peer: string,
		alias: string,
	): Promise<{ ok: true } | { ok: false; error: string }> {
		if (alias !== COORDINATOR_ALIAS && !this.resolveDir(alias)) {
			return { ok: false, error: `Unknown workspace "${alias}"` };
		}
		this.#runtimeBindings.set(`${channelId}:${peer}`, alias);
		return { ok: true };
	}

	/** Persist a chat → workspace binding (direct mode). */
	async bindChat(
		channelId: ChannelId,
		peer: string,
		alias: string,
	): Promise<{ ok: true; alias: string } | { ok: false; error: string }> {
		if (alias === COORDINATOR_ALIAS) {
			await this.unbindChat(channelId, peer);
			return { ok: true, alias };
		}
		const dir = this.resolveDir(alias);
		if (!dir) return { ok: false, error: `Unknown workspace "${alias}"` };
		if (!this.#sessions.has(dir)) {
			const opened = await this.open(dir);
			if (!opened.ok) return opened;
		}
		await this.#webConfig.setSessionMapping({
			platform: channelId,
			chatId: peer,
			workspaceAlias: alias,
			mode: "direct",
		});
		// A workspace binding supersedes any default-space bot session pointer.
		await this.#webConfig.updateChatMapping(channelId, peer, { sessionId: null });
		return { ok: true, alias };
	}

	/** Remove a chat's persisted + runtime binding. */
	async unbindChat(channelId: ChannelId, peer: string): Promise<boolean> {
		this.#runtimeBindings.delete(`${channelId}:${peer}`);
		return this.#webConfig.removeSessionMapping(channelId, peer);
	}

	/** List every persisted binding for one platform. */
	bindingsForPlatform(channelId: ChannelId): { chatId: string; workspaceAlias: string; mode?: string }[] {
		return this.#webConfig
			.getSessionMappings()
			.filter(mapping => mapping.platform === channelId)
			.map(mapping => ({ chatId: mapping.chatId, workspaceAlias: mapping.workspaceAlias, mode: mapping.mode }));
	}

	// ------------------------------------------------------------------
	// Default-space bot sessions (`!session`, `!lang`)
	// ------------------------------------------------------------------

	/** Registered default-space bot sessions (relay + bot/draft entries). */
	listBotSessions(): BotSessionEntry[] {
		return this.#webConfig.getBotSessions();
	}

	/** One registered bot session by id. */
	botSession(id: string): BotSessionEntry | undefined {
		return this.#webConfig.getBotSession(id);
	}

	/** Ensure the relay registry entry exists (points at the coordinator transcript). */
	async ensureRelaySession(sessionFile: string): Promise<void> {
		if (this.#webConfig.getBotSession("relay")) return;
		await this.#webConfig.upsertBotSession({
			id: "relay",
			name: "Zeta Bot (Relay)",
			tag: "relay",
			sessionFile,
			createdAt: new Date().toISOString(),
		});
	}

	/**
	 * Create a new default-space bot session (registry entry + materialized
	 * transcript on first use). Returns the registry entry.
	 */
	async createBotSession(
		name: string,
		tag: "bot" | "draft" = "draft",
	): Promise<{ ok: true; entry: BotSessionEntry } | { ok: false; error: string }> {
		const cleanName = name.trim();
		if (!cleanName) return { ok: false, error: "Session name must not be empty" };
		const id = randomUUID().slice(0, 8);
		const safeName = cleanName.replace(/[^\w\u4e00-\u9fff-]+/g, "-").slice(0, 40) || "bot";
		const sessionFile = path.join(SessionManager.getDefaultSessionDir(this.#defaultCwd), `${safeName}-${id}.jsonl`);
		const entry: BotSessionEntry = {
			id,
			name: cleanName,
			tag,
			sessionFile,
			createdAt: new Date().toISOString(),
		};
		await this.#webConfig.upsertBotSession(entry);
		const ensured = await this.ensureBotSession(entry);
		if (!ensured.ok) return ensured;
		return { ok: true, entry };
	}

	/** Rename a registered bot session (relay keeps its canonical name). */
	async renameBotSession(
		id: string,
		name: string,
	): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
		const entry = this.#webConfig.getBotSession(id);
		if (!entry) return { ok: false, error: `Unknown bot session "${id}"` };
		const cleanName = name.trim();
		if (!cleanName) return { ok: false, error: "Session name must not be empty" };
		const updated = { ...entry, name: cleanName };
		await this.#webConfig.upsertBotSession(updated);
		const handle = this.#botSessions.get(id);
		if (handle) handle.entry = updated;
		return { ok: true, name: cleanName };
	}

	/** Delete a bot session (relay is protected) — disposes the runtime, removes
	 *  the registry entry, deletes the transcript, and re-points any chat that
	 *  referenced it back to the relay. */
	async deleteBotSession(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
		const entry = this.#webConfig.getBotSession(id);
		if (!entry) return { ok: false, error: `Unknown bot session "${id}"` };
		if (entry.tag === "relay") return { ok: false, error: "relay 会话不可删除" };
		const handle = this.#botSessions.get(id);
		if (handle) {
			handle.unsubscribe();
			this.#botSessions.delete(id);
			this.#botDirectReplies.delete(id);
			try {
				await handle.session.dispose();
			} catch (error) {
				logger.warn("Bot session dispose failed", {
					id,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
		try {
			await fs.rm(entry.sessionFile, { force: true });
		} catch (error) {
			if (!isEnoent(error)) {
				logger.warn("Bot session file removal failed", {
					id,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
		await this.#webConfig.removeBotSession(id);
		await this.#webConfig.clearChatSessionReferences(id);
		logger.info("Bot session deleted", { id, sessionFile: entry.sessionFile });
		return { ok: true };
	}

	/** Get (or lazily create) the live session for a registered bot session. */
	async ensureBotSession(
		entry: BotSessionEntry,
	): Promise<{ ok: true; session: AgentSession } | { ok: false; error: string }> {
		const existing = this.#botSessions.get(entry.id);
		if (existing) return { ok: true, session: existing.session };
		try {
			const session = this.#createBotSessionRuntime
				? await this.#createBotSessionRuntime(entry)
				: await this.#defaultBotSessionRuntime(entry);
			const unsubscribe = session.subscribe(event => this.#onBotSessionEvent(entry.id, event));
			this.#botSessions.set(entry.id, { entry, session, unsubscribe });
			if (entry.lang) this.#applyLanguageToSession(session, entry.lang);
			return { ok: true, session };
		} catch (error) {
			logger.error("Failed to open bot session", {
				id: entry.id,
				error: error instanceof Error ? error.message : String(error),
			});
			return { ok: false, error: error instanceof Error ? error.message : String(error) };
		}
	}

	/** Default bot-session runtime: raw `createAgentSession` on the entry's transcript. */
	async #defaultBotSessionRuntime(entry: BotSessionEntry): Promise<AgentSession> {
		const manager = await SessionManager.open(entry.sessionFile);
		const { session } = await createAgentSession({
			cwd: manager.getCwd(),
			sessionManager: manager,
			channelSend: this.#channelSend,
			workspaceRun: this.#workspaceRun,
			imControl: this.#imControl ? params => this.#imControl!(entry.id, params) : undefined,
		});
		return session;
	}

	/** The bot session id this chat currently uses ("" / null → relay). */
	async activeBotSessionIdFor(channelId: ChannelId, peer: string): Promise<string | null> {
		const mapping = this.#webConfig.findSessionMapping(channelId, peer);
		return mapping?.sessionId ?? null;
	}

	/** Point one chat at a bot session (clears direct workspace mode). Relay is
	 *  the implicit default: `use relay` drops the pointer back to it. */
	async setActiveBotSession(
		channelId: ChannelId,
		peer: string,
		id: string,
	): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
		if (id === "relay") {
			await this.#webConfig.updateChatMapping(channelId, peer, { sessionId: null });
			this.#runtimeBindings.delete(`${channelId}:${peer}`);
			return { ok: true, id: "relay" };
		}
		const entry = this.#webConfig.getBotSession(id);
		if (!entry) return { ok: false, error: `Unknown bot session "${id}"` };
		if (entry.tag === "relay") {
			return this.setActiveBotSession(channelId, peer, "relay");
		}
		const ensured = await this.ensureBotSession(entry);
		if (!ensured.ok) return ensured;
		await this.#webConfig.updateChatMapping(channelId, peer, { sessionId: id });
		this.#runtimeBindings.delete(`${channelId}:${peer}`);
		const lang = (await this.languageFor(channelId, peer)) ?? entry.lang;
		if (lang) this.#applyLanguageToSession(ensured.session, lang);
		return { ok: true, id };
	}

	/** Resolve the live session a chat's messages should target (bot session or relay). */
	async resolveChatTargetSession(
		channelId: ChannelId,
		peer: string,
	): Promise<{ ok: true; session: AgentSession; id: string } | { ok: false; error: string }> {
		const activeId = await this.activeBotSessionIdFor(channelId, peer);
		if (activeId && activeId !== "relay") {
			const entry = this.#webConfig.getBotSession(activeId);
			if (entry) {
				const ensured = await this.ensureBotSession(entry);
				if (ensured.ok) return { ok: true, session: ensured.session, id: activeId };
				return { ok: false, error: ensured.error };
			}
		}
		return { ok: true, session: this.#coordinator, id: "relay" };
	}

	/**
	 * Resolve the chat that invoked an `im_control` call from a sessionKey bound
	 * at hook time. "coordinator" → the relay's most recent inbound; a bot
	 * session id → the chat it is currently replying to (else its bound chat,
	 * else the relay's last inbound). Never guesses a wrong chat.
	 */
	resolveImControlChat(sessionKey: string): { channelId: ChannelId; peer: string } | null {
		if (sessionKey === "coordinator") return this.#getLastInbound();
		const reply = this.#peekBotReply(sessionKey);
		if (reply) return { channelId: reply.channelId, peer: reply.peer };
		const entry = this.#webConfig.getBotSession(sessionKey);
		if (entry?.platform && entry.chatId) return { channelId: entry.platform as ChannelId, peer: entry.chatId };
		return this.#getLastInbound();
	}

	/** Drop a chat's bot-session pointer (falls back to the relay). */
	async clearActiveBotSession(channelId: ChannelId, peer: string): Promise<void> {
		await this.#webConfig.updateChatMapping(channelId, peer, { sessionId: null });
	}

	/** The reply language configured for one chat ("" → unset). */
	async languageFor(channelId: ChannelId, peer: string): Promise<"zh" | "en" | undefined> {
		return this.#webConfig.findSessionMapping(channelId, peer)?.lang;
	}

	/** Set a chat's reply language and apply it to its active bot session. */
	async setLanguage(channelId: ChannelId, peer: string, lang: "zh" | "en"): Promise<void> {
		await this.#webConfig.updateChatMapping(channelId, peer, { lang });
		const activeId = await this.activeBotSessionIdFor(channelId, peer);
		if (!activeId) return;
		const handle = this.#botSessions.get(activeId);
		if (!handle) return;
		handle.entry = { ...handle.entry, lang };
		await this.#webConfig.upsertBotSession(handle.entry);
		this.#applyLanguageToSession(handle.session, lang);
	}

	/** Pop the next live reply target for a bot session, dropping expired slots. */
	#dequeueBotReply(id: string): DirectReply | null {
		const queue = this.#botDirectReplies.get(id);
		if (!queue) return null;
		const now = Date.now();
		while (queue.length > 0 && queue[0].expiresAt <= now) queue.shift();
		if (queue.length === 0) {
			this.#botDirectReplies.delete(id);
			return null;
		}
		const next = queue.shift();
		if (queue.length === 0) this.#botDirectReplies.delete(id);
		return next ?? null;
	}

	/** Peek the next live reply target without consuming it (for im_control). */
	#peekBotReply(id: string): DirectReply | null {
		const queue = this.#botDirectReplies.get(id);
		if (!queue) return null;
		const now = Date.now();
		while (queue.length > 0 && queue[0].expiresAt <= now) queue.shift();
		if (queue.length === 0) {
			this.#botDirectReplies.delete(id);
			return null;
		}
		return queue[0];
	}

	/**
	 * Deliver an inbound message into a bot session and bind the chat so the
	 * session's final reply returns to that chat. Replies queue FIFO per bot
	 * session, so multiple chats sharing one session each get their turn.
	 */
	async deliverToBotSession(
		id: string,
		channelId: ChannelId,
		peer: string,
		body: string,
	): Promise<{ ok: true } | { ok: false; error: string }> {
		const handle = this.#botSessions.get(id);
		if (!handle) return { ok: false, error: `Bot session "${id}" has no runtime session` };
		const lang = (await this.languageFor(channelId, peer)) ?? handle.entry.lang;
		if (lang) this.#applyLanguageToSession(handle.session, lang);
		const pending: DirectReply = { channelId, peer, expiresAt: Date.now() + DIRECT_REPLY_TTL_MS };
		const queue = this.#botDirectReplies.get(id) ?? [];
		queue.push(pending);
		this.#botDirectReplies.set(id, queue);
		const msg: IrcMessage = {
			id: Snowflake.next(),
			from: this.#coordinator.getAgentId() ?? "coordinator",
			to: handle.session.getAgentId() ?? id,
			body,
			ts: Date.now(),
		};
		try {
			await handle.session.deliverIrcMessage(msg, { expectsReply: true });
		} catch (error) {
			// Remove exactly the slot we pushed; the session may still hold
			// older pending replies from other chats.
			const q = this.#botDirectReplies.get(id);
			const idx = q?.indexOf(pending) ?? -1;
			if (q && idx >= 0) q.splice(idx, 1);
			if (q && q.length === 0) this.#botDirectReplies.delete(id);
			const detail = error instanceof Error ? error.message : String(error);
			return { ok: false, error: `Bot session "${id}" delivery failed: ${detail}` };
		}
		return { ok: true };
	}

	/**
	 * Idempotently apply a chat language to a session's system prompt. The IRC
	 * wake path (agent.prompt) does not rebuild the base prompt, so the appended
	 * line survives until the next explicit base rebuild — re-applied at every
	 * delivery to stay robust across model switches.
	 */
	#applyLanguageToSession(session: AgentSession, lang: "zh" | "en"): void {
		const line = languageDirectiveLine(lang);
		const prompt = session.agent.state.systemPrompt;
		if (prompt[prompt.length - 1] === line) return;
		const filtered = prompt.filter(
			part => part !== languageDirectiveLine("en") && part !== languageDirectiveLine("zh"),
		);
		session.agent.setSystemPrompt([...filtered, line]);
	}

	#onBotSessionEvent(id: string, event: AgentSessionEvent): void {
		if (event.type !== "turn_end") return;
		const reply = this.#dequeueBotReply(id);
		if (!reply) return;
		const text = assistantText(event.message);
		if (!text) return;
		void this.#sendText(reply.channelId, reply.peer, text).catch(error => {
			logger.warn("Bot session reply send failed", {
				id,
				error: error instanceof Error ? error.message : String(error),
			});
		});
	}

	/**
	 * Inject an inbound message directly into a bound workspace session and
	 * bind the chat so the session's final reply returns to that chat.
	 * `workspace` is the mapping alias.
	 */
	async deliverDirect(
		workspaceAlias: string,
		channelId: ChannelId,
		peer: string,
		body: string,
	): Promise<{ ok: true } | { ok: false; error: string }> {
		const dir = this.resolveDir(workspaceAlias);
		if (!dir) return { ok: false, error: `Unknown workspace "${workspaceAlias}"` };
		let handle = this.#sessions.get(dir);
		if (!handle) {
			// Lazily materialize the session so `!work workspace:<alias>` works
			// even when the chat never triggered the lazy-open path before.
			const opened = await this.open(dir, workspaceAlias);
			if (!opened.ok) return opened;
			handle = this.#sessions.get(dir);
			if (!handle) return { ok: false, error: `Workspace "${workspaceAlias}" has no session` };
		}
		this.#directReplies.set(dir, { channelId, peer, expiresAt: Date.now() + DIRECT_REPLY_TTL_MS });
		const msg: IrcMessage = {
			id: Snowflake.next(),
			from: this.#coordinator.getAgentId() ?? "coordinator",
			to: handle.session.getAgentId() ?? "workspace",
			body,
			ts: Date.now(),
		};
		try {
			await handle.session.deliverIrcMessage(msg, { expectsReply: true });
		} catch (error) {
			this.#directReplies.delete(dir);
			const detail = error instanceof Error ? error.message : String(error);
			return { ok: false, error: `Direct delivery to "${workspaceAlias}" failed: ${detail}` };
		}
		return { ok: true };
	}

	/**
	 * Deliver a subtask to a workspace session and wait for its final reply.
	 * `workspace` is an absolute path, a registered alias, or the coordinator.
	 */
	async run(workspace: string, task: string): Promise<{ reply: string }> {
		// Coordinating alias: delegate to the coordinator itself.
		if (workspace === COORDINATOR_ALIAS) {
			return { reply: `workspace_run: "${COORDINATOR_ALIAS}" is the coordinator; it already has this message.` };
		}
		const dir = this.resolveDir(workspace);
		const handle = dir ? this.#sessions.get(dir) : undefined;
		if (!handle || !dir) {
			return { reply: `workspace_run: unknown workspace "${workspace}"` };
		}
		const agentId = handle.session.getAgentId();
		const coordinatorId = this.#coordinator.getAgentId() ?? "coordinator";
		if (!agentId) {
			return { reply: `workspace_run: target session "${workspace}" has no agent id` };
		}
		if (this.#activeRun) {
			return { reply: "workspace_run: another delegation is already in flight; wait for it to finish" };
		}

		const msg: IrcMessage = {
			id: Snowflake.next(),
			from: coordinatorId,
			to: agentId,
			body: task,
			ts: Date.now(),
		};

		const { promise, resolve } = Promise.withResolvers<string>();
		const timer = setTimeout(() => {
			if (this.#activeRun?.resolve === resolve) {
				this.#activeRun = null;
				resolve(`[${path.basename(dir)}] (no reply within ${RUN_TIMEOUT_MS / 60_000} minutes)`);
			}
		}, RUN_TIMEOUT_MS);
		this.#activeRun = { resolve, timer, dir };

		try {
			await handle.session.deliverIrcMessage(msg, { expectsReply: true });
		} catch (error) {
			clearTimeout(timer);
			this.#activeRun = null;
			const detail = error instanceof Error ? error.message : String(error);
			return { reply: `workspace_run: delegation to "${workspace}" failed: ${detail}` };
		}

		const text = await promise;
		return { reply: `[${path.basename(dir)}] ${text}` };
	}

	/** Resolve `channel_send` opts to a concrete channel + peer; null when unavailable. */
	resolvePush(opts: { to?: string; channel?: string }): { channelId: ChannelId; to: string } | null {
		const inbound = this.#getLastInbound();
		const channelId = (opts.channel as ChannelId | undefined) ?? inbound?.channelId ?? null;
		const to = opts.to ?? inbound?.peer ?? null;
		if (!channelId || !to) return null;
		return { channelId, to };
	}

	/** Push text through the channel runtime (channel_send tool sink). */
	async push(opts: { text: string; to?: string; channel?: string }): Promise<void> {
		const target = this.resolvePush(opts);
		if (!target) throw new Error("No channel or peer bound to this session");
		await this.#sendText(target.channelId, target.to, opts.text);
	}

	/** Dispose every target session and drop listeners. */
	async stopAll(): Promise<void> {
		if (this.#stopping) return;
		this.#stopping = true;
		if (this.#activeRun) {
			clearTimeout(this.#activeRun.timer);
			this.#activeRun = null;
		}
		for (const dir of [...this.#sessions.keys()]) {
			await this.#closeDir(dir);
		}
		this.#sessions.clear();
		this.#aliases.clear();
		this.#directReplies.clear();
		for (const [id, handle] of [...this.#botSessions.entries()]) {
			handle.unsubscribe();
			this.#botDirectReplies.delete(id);
			try {
				await handle.session.dispose();
			} catch (error) {
				logger.warn("Bot session dispose failed", {
					id,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
		this.#botSessions.clear();
		this.#botDirectReplies.clear();
	}

	async #closeDir(dir: string): Promise<void> {
		const handle = this.#sessions.get(dir);
		if (!handle) return;
		handle.unsubscribe();
		this.#sessions.delete(dir);
		this.#directReplies.delete(dir);
		try {
			await handle.session.dispose();
		} catch (error) {
			logger.warn("Workspace session dispose failed", {
				dir,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	#onTargetEvent(dir: string, event: AgentSessionEvent): void {
		if (event.type !== "turn_end") return;
		const run = this.#activeRun;
		if (run && run.dir === dir) {
			this.#activeRun = null;
			clearTimeout(run.timer);
			run.resolve(assistantText(event.message) || "(no text reply)");
			return;
		}
		// Direct-mode reply: the bound chat is waiting for this session's reply.
		const reply = this.#directReplies.get(dir);
		if (reply) {
			this.#directReplies.delete(dir);
			const text = assistantText(event.message);
			if (text) {
				void this.#sendText(reply.channelId, reply.peer, text).catch(error => {
					logger.warn("Direct-mode reply send failed", {
						dir,
						error: error instanceof Error ? error.message : String(error),
					});
				});
			}
		}
	}
}
