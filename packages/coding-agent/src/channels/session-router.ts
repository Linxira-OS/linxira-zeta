/**
 * SessionRouter — multi-workspace session registry for the coordinator agent.
 *
 * The coordinator session (default workspace, alias `main`, created by
 * `zetacode serve`) receives every inbound channel message unless that chat is
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
import { type ChannelInstanceId, ReplyCorrelator } from "@linxiraos/pi-channels";
import { isEnoent, logger, Snowflake } from "@linxiraos/pi-utils";
import { getAgentDir } from "@linxiraos/pi-utils/dirs";
import type { BotSessionEntry, WebConfig } from "../config/web-config";
import { resolveTeamDbPath, TeamDb } from "../team/db";
import { Settings, type SettingProvenance } from "../config/settings";
import { hasWorkspacePersona } from "../default-workspace";
import { cfgChannelsReportPolicy } from "../tools/settings";
import { cfgMemoryBackend } from "../memory-backend/settings";
import type { IrcMessage } from "@linxiraos/pi-tui/tools/hub";
import { IrcBus } from "../irc/bus";
import { getMeshNode } from "../mesh/global";
import { AgentRegistry, MAIN_AGENT_ID } from "../registry/agent-registry";
import type { WorkspaceRef } from "../registry/agent-directory";
import { createAgentSession } from "../sdk";
import type { AgentSession } from "../session/agent-session";
import type { AgentSessionEvent } from "../session/agent-session-events";
import { SessionManager } from "../session/session-manager";
import { isImSession, sameSessionOrigin, type SessionOrigin } from "../session/session-origin";
import type { ImControlParams, ImControlResult } from "./im-control";
import { type ImBinding, type ImTarget, targetKey, targetScopedBindingId } from "./im-config";
import {
	buildImUserMessageMetadata,
	normalizeImSwitchControlMetadata,
	type ImRouteSnapshot,
	type ImSwitchControlMetadata,
} from "../session/session-im";
import { buildImSessionList, createImSessionSelectorState, type ImSessionListSnapshot } from "./im-session-selector";
import { type AgentProfileOptions, loadImAgentProfilePersona, resolveImAgentProfileRuntime } from "../agent-profile";

let imSessionCandidateReader: (() => Promise<ImSessionListSnapshot>) | null = null;

/** Register the live router's candidate reader for the Team IM page/gateway. */
export function registerImSessionCandidateReader(reader: (() => Promise<ImSessionListSnapshot>) | null): void {
	imSessionCandidateReader = reader;
}

/** The same typed candidates `!session list` uses; null before a router starts. */
export async function readImSessionCandidates(): Promise<ImSessionListSnapshot | null> {
	return imSessionCandidateReader ? await imSessionCandidateReader() : null;
}

/** Upper bound for a delegated `workspace_run` turn (no reply → timeout error). */
const RUN_TIMEOUT_MS = 10 * 60_000;

/** A staged switch stays confirmable this long, including across a restart. */
const WORKSPACE_SWITCH_TTL_MS = 10 * 60_000;

/** Reserved alias of the relay coordinator (default workspace). */
export const COORDINATOR_ALIAS = "main";

/** Project a bot session (PM/secretary) is bound to. */
export interface BotSessionProject {
	/** Registered workspace alias; `main` is the default workspace. */
	alias?: string;
	/** Absolute project directory; must be a registered workspace. */
	dir?: string;
}

/** Context carried from one platform inbound message into its transcript entry. */
export interface ImDeliveryContext {
	threadId?: string;
	userId?: string;
	/** Platform message id used for provenance and dedupe. */
	messageId?: string;
	senderName?: string;
	sentAt?: number | string;
	attachments?: readonly { name?: string; mimeType?: string; mime?: string; size?: number }[];
}

/** One persisted `im_control` request behind a pending switch. */
export interface ImSwitchControlRecord {
	id: string;
	metadata: ImSwitchControlMetadata;
}

/** Read-only current target for a chat/thread/sender. */
export interface ImSwitchCurrentView {
	workspaceAlias?: string;
	agentId?: string;
	bindingId?: string;
	targetKey: string;
}

/** Read-only pending handshake the Team IM page can confirm or cancel. */
export interface ImSwitchStatus {
	current: ImSwitchCurrentView;
	pending?: {
		requestId: string;
		operation: "target" | "unbind";
		from: ImRouteSnapshot;
		to: ImRouteSnapshot;
		requestedAt: string;
		controlRecord?: ImSwitchControlRecord;
	};
}

/** Live controller registered by the server for the web gateway. */
export interface ImSwitchGateway {
	status(
		instanceId: ChannelInstanceId,
		chatId: string,
		context?: { threadId?: string; userId?: string },
	): Promise<ImSwitchStatus>;
	confirm(
		instanceId: ChannelInstanceId,
		chatId: string,
		context: { threadId?: string; userId?: string },
		requestId: string,
	): Promise<{ ok: true; target: ImTarget } | { ok: false; error: string }>;
	cancel(
		instanceId: ChannelInstanceId,
		chatId: string,
		context: { threadId?: string; userId?: string },
		requestId: string,
	): Promise<boolean>;
}

let imSwitchGateway: ImSwitchGateway | null = null;

/** Register the live router's handshake controller for the Team IM page. */
export function registerImSwitchGateway(gateway: ImSwitchGateway | null): void {
	imSwitchGateway = gateway;
}

/** The live handshake controller; null when no relay host is running. */
export function readImSwitchGateway(): ImSwitchGateway | null {
	return imSwitchGateway;
}

/**
 * The live session invoking a channel tool. A bot session is bound to one
 * project, so `workspace_run` and `channel_send` must not let it reach another
 * project or an unauthorized peer; the relay coordinator keeps its documented
 * cross-repo delegation role.
 */
export interface ChannelToolContext {
	/** "coordinator" for the relay coordinator, otherwise the bot-session id. */
	sessionKey: string;
	/** Absolute project directory of the invoking session. */
	projectDir?: string;
	/** Workspace alias of the invoking session, when known. */
	workspaceAlias?: string;
	/** The relay coordinator may delegate to any registered workspace. */
	relay?: boolean;
}

interface ActiveRun {
	resolve: (text: string) => void;
	timer: ReturnType<typeof setTimeout>;
}

/** The chat a bot session most recently answered (channel_send/im_control target). */
interface BotChatTarget {
	channelId: ChannelInstanceId;
	peer: string;
}

interface SessionHandle {
	session: AgentSession;
	unsubscribe: () => void;
}

/** A registered default-space bot session plus its live runtime. */
interface BotSessionHandle extends SessionHandle {
	entry: BotSessionEntry;
}

/** Everything `@status` answers about the current chat's landing point. */
export interface ChatStatusSnapshot {
	/** `relay` = coordinator (default workspace); `direct` = bound workspace. */
	route: "direct" | "relay";
	/** Bound workspace alias, null for the relay coordinator. */
	workspaceAlias: string | null;
	/** Effective workspace directory for this chat. */
	workspaceDir: string;
	/** Whether the default-workspace persona applies to that directory. */
	personaActive: boolean;
	/** Effective memory backend for the workspace (`off` when nothing enables it). */
	memoryBackend: string;
	/** Layer that supplied {@link memoryBackend}: `project`, `global`, `overlay`, `runtime`, `env`, or `default`. */
	memoryBackendSource: SettingProvenance;
	/** Relay report policy for delegated work. */
	reportPolicy: string;
}

/** One addressable agent as the IM bridge sees it (local or another workspace's). */
export interface AgentTargetInfo {
	/** Address accepted by `@agent use` (`<workspaceId>/<agentId>`, or a bare local id). */
	address: string;
	id: string;
	role: string;
	status: string;
	workspaceAlias?: string;
	local: boolean;
}

/** Where one chat's next message should go. */
export type ChatRouteTarget =
	| { kind: "agent"; target: string; local: boolean }
	| { kind: "workspace"; alias: string }
	/** A project-bound (or default-space) bot session selected by this chat. */
	| { kind: "bot"; id: string }
	/** A binding exists but its workspace cannot be opened; never fall back to the default workspace. */
	| { kind: "unavailable"; alias: string; error: string }
	| { kind: "relay" };

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

/** Whether two paths name the same directory (case-insensitive on Windows). */
function samePath(a: string | undefined, b: string | undefined): boolean {
	if (!a || !b) return false;
	const normalize = (value: string) => {
		const absolute = path.resolve(value);
		return process.platform === "win32" ? absolute.toLowerCase() : absolute;
	};
	return normalize(a) === normalize(b);
}

export class SessionRouter {
	readonly #coordinator: AgentSession;
	readonly #webConfig: WebConfig;
	readonly #getLastInbound: () => { channelId: ChannelInstanceId; peer: string } | null;
	readonly #sendText: (channelId: ChannelInstanceId, to: string, text: string) => Promise<void>;
	/** IM channel tool sinks forwarded to bot sessions (undefined in CLI mode). */
	readonly #channelSend?: (
		opts: { text: string; to?: string; channel?: string },
		caller?: ChannelToolContext,
	) => Promise<void>;
	readonly #workspaceRun?: (
		opts: { workspace: string; task: string },
		caller?: ChannelToolContext,
	) => Promise<{ reply: string }>;
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
	/** Reply correlation per live target session (workspace dir or bot id). */
	readonly #bridges = new Map<string, ReplyCorrelator>();
	/** Bridge keys whose session exposes the IRC wake-turn observer we installed. */
	readonly #observedBridges = new Set<string>();
	/** Latest chat each bot session answers (channel_send/im_control resolution). */
	readonly #botLastChat = new Map<string, BotChatTarget>();
	/** Workspace alias → absolute directory (mirror of web.yml entries). */
	readonly #aliases = new Map<string, string>();
	#activeRun: ActiveRun | null = null;
	/** `channels.reportPolicy: summary` buffers progress reports per chat until the stage ends. */
	readonly #pendingReports = new Map<string, string[]>();
	/** Runtime (non-persisted) per-chat route override: "channel:peer" → alias. */
	readonly #runtimeBindings = new Map<string, string>();
	/** Runtime per-chat agent override from `@agent use` / `@team` (highest precedence). */
	readonly #agentBindings = new Map<string, string>();
	/** Pending workspace switch, keyed by instance+chat+thread+user. */
	#sessionListSnapshot: ImSessionListSnapshot | null = null;
	readonly #sessionSelectorState = createImSessionSelectorState();
	readonly #pendingWorkspaceSwitch = new Map<
		string,
		| { action: "target"; target: ImTarget; at: number; requestId: string; control?: ImSwitchControlRecord }
		| { action: "unbind"; at: number; requestId: string; control?: ImSwitchControlRecord }
	>();
	/** Cross-process agent roster; defaults to the mesh node plus this process's registry. */
	readonly #listAgentTargets?: () => Promise<AgentTargetInfo[]> | AgentTargetInfo[];
	/** Team plugin seam: team name → the address of its host agent. */
	readonly #resolveTeamHost?: (name: string) => string | undefined;
	/** Team plugin seam: names usable with `@team`. */
	readonly #teamNames?: () => string[];
	#stopping = false;

	constructor(options: {
		coordinator: AgentSession;
		webConfig: WebConfig;
		getLastInbound: () =>
			| ({ channelId: ChannelInstanceId; peer: string } | { instanceId: string; peer: string })
			| null;
		sendText: (channelId: ChannelInstanceId, to: string, text: string) => Promise<void>;
		/** Default cwd for newly created bot sessions (defaults to process.cwd()). */
		defaultCwd?: string;
		/** channel_send sink for bot sessions (defaults to the coordinator's pattern). */
		channelSend?: (
			opts: { text: string; to?: string; channel?: string },
			caller?: ChannelToolContext,
		) => Promise<void>;
		/** workspace_run sink for bot sessions. */
		workspaceRun?: (
			opts: { workspace: string; task: string },
			caller?: ChannelToolContext,
		) => Promise<{ reply: string }>;
		/** Factory for a bot session's live runtime (see {@link #createBotSessionRuntime}). */
		createBotSessionRuntime?: (entry: BotSessionEntry) => Promise<AgentSession>;
		/** Natural-language IM control sink forwarded to bot sessions. */
		imControl?: (sessionKey: string, params: ImControlParams) => Promise<ImControlResult>;
		/** Cross-process agent roster for `@agent list` / `@agent use`. */
		listAgentTargets?: () => Promise<AgentTargetInfo[]> | AgentTargetInfo[];
		/** Team plugin seam: team name → host agent address (see `@team`). */
		resolveTeamHost?: (name: string) => string | undefined;
		/** Team plugin seam: available team names. */
		listTeams?: () => string[];
	}) {
		this.#coordinator = options.coordinator;
		this.#webConfig = options.webConfig;
		this.#getLastInbound = () => {
			const last = options.getLastInbound();
			if (!last) return null;
			return "channelId" in last
				? { channelId: last.channelId, peer: last.peer }
				: { channelId: last.instanceId as ChannelInstanceId, peer: last.peer };
		};
		this.#sendText = options.sendText;
		this.#defaultCwd = options.defaultCwd ?? process.cwd();
		this.#channelSend = options.channelSend;
		this.#workspaceRun = options.workspaceRun;
		this.#createBotSessionRuntime = options.createBotSessionRuntime;
		this.#imControl = options.imControl;
		this.#listAgentTargets = options.listAgentTargets;
		this.#resolveTeamHost = options.resolveTeamHost;
		this.#teamNames = options.listTeams;
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

	/** Registered workspaces as session-free references (read-only snapshot). */
	listWorkspaces(): WorkspaceRef[] {
		return this.list().map(entry => ({ dir: entry.path, alias: entry.alias }));
	}

	/**
	 * Resolve an alias, an absolute directory, or a partial reference to its
	 * canonical {@link WorkspaceRef}. Unknown aliases return `undefined`; an
	 * absolute directory is accepted as-is, matching {@link resolveDir}. This
	 * is a pure lookup and never touches a live session.
	 */
	resolveWorkspace(ref: WorkspaceRef | string): WorkspaceRef | undefined {
		if (typeof ref === "string") {
			const dir = this.resolveDir(ref);
			if (!dir) return undefined;
			const alias = path.isAbsolute(ref) ? this.#aliasForDir(dir) : ref;
			return alias === undefined ? { dir } : { dir, alias };
		}
		const dir = this.resolveDir(ref.alias ?? ref.dir);
		if (!dir) return undefined;
		const alias = ref.alias ?? this.#aliasForDir(dir);
		return alias === undefined ? { dir } : { dir, alias };
	}

	/** Alias registered for an exact directory, if any. */
	#aliasForDir(dir: string): string | undefined {
		for (const [alias, registered] of this.#aliases) {
			if (registered === dir) return alias;
		}
		return undefined;
	}

	/**
	 * Reply correlator for one live target session. It installs the session's
	 * IRC wake-turn observer so a turn is attributed to the messages it actually
	 * answers; without the observer it falls back to ordered consumption.
	 */
	#bridgeFor(key: string, session: AgentSession): ReplyCorrelator {
		const existing = this.#bridges.get(key);
		if (existing) return existing;
		const correlator = new ReplyCorrelator({
			sendText: async (target, text) => {
				// Origin is delivery metadata. Ordinary answers stay byte-for-byte
				// unchanged; only a late answer after a switch needs a separate notice.
				const current = this.#webConfig.findImBinding(target.instanceId, target.peer, target.context ?? {});
				const currentLabel = current ? `${targetKey(current.target)} · ${current.agentProfileId}` : undefined;
				if (target.originLabel && currentLabel && currentLabel !== target.originLabel) {
					await this.#sendText(target.instanceId, target.peer, `原目标回复：${target.originLabel}`);
				}
				await this.#sendText(target.instanceId, target.peer, text);
			},
		});
		this.#bridges.set(key, correlator);
		const observer = session.setIrcWakeTurnObserver;
		if (typeof observer === "function") {
			try {
				observer.call(session, records => correlator.observe(records));
				this.#observedBridges.add(key);
			} catch (error) {
				logger.warn("Reply correlation observer unavailable", {
					key,
					error: error instanceof Error ? error.message : String(error),
				});
				correlator.enableFallback();
			}
		} else {
			correlator.enableFallback();
		}
		return correlator;
	}

	/** Drop one bridge (and the observer it installed) when its session goes away. */
	#detachBridge(key: string, session?: AgentSession): void {
		const correlator = this.#bridges.get(key);
		if (!correlator) return;
		correlator.clear();
		this.#bridges.delete(key);
		if (this.#observedBridges.delete(key)) session?.setIrcWakeTurnObserver?.(undefined);
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
				this.#bridgeFor(resolved, session);
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
	 * The route one inbound message takes, resolved once: the runtime override
	 * (`@workspace use` / `*alias`) wins, then the persisted chat mapping, then
	 * the channel default `workspaceRoot`, else the relay coordinator.
	 * `mode: "relay"` on the persisted mapping outranks the alias it carries:
	 * the row means "this chat belongs to the coordinator", even when an earlier
	 * direct binding left an alias behind.
	 */
	async resolveRoute(channelId: ChannelInstanceId, peer: string): Promise<"direct" | "relay"> {
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

	// ------------------------------------------------------------------
	// Agent targets (`@agent list`, `@agent use`, `@team`)
	// ------------------------------------------------------------------

	/**
	 * Agents this router can address: this process's roster plus every live
	 * mesh peer. Local entries keep their bare id; remote entries carry the
	 * `<workspaceId>/<agentId>` address.
	 */
	async listAgentTargets(): Promise<AgentTargetInfo[]> {
		if (this.#listAgentTargets) return await this.#listAgentTargets();
		const mesh = getMeshNode();
		if (mesh) {
			return (await mesh.agents()).map(agent => ({
				address: agent.address,
				id: agent.id,
				role: agent.role,
				status: agent.status,
				...(agent.workspaceAlias !== undefined && { workspaceAlias: agent.workspaceAlias }),
				local: agent.local,
			}));
		}
		return AgentRegistry.global()
			.list()
			.filter(ref => ref.kind !== "advisor")
			.map(ref => ({
				address: ref.id,
				id: ref.id,
				role: ref.kind,
				status: ref.status,
				local: true,
			}));
	}

	/**
	 * Set (or clear, with no selector) the runtime agent override for one chat.
	 * An unknown selector reports the candidates; an ambiguous one (several
	 * workspaces own the same bare id) is an explicit error, never a guess.
	 */
	async setAgentTarget(
		channelId: ChannelInstanceId,
		peer: string,
		selector?: string,
	): Promise<{ ok: true; target: string } | { ok: false; error: string }> {
		const key = `${channelId}:${peer}`;
		const cleaned = selector?.trim();
		if (!cleaned) {
			this.#agentBindings.delete(key);
			return { ok: true, target: "" };
		}
		const normalized = cleaned.startsWith("agent://") ? cleaned.slice("agent://".length) : cleaned;
		const candidates = await this.listAgentTargets();
		// A full address is unambiguous by construction — and an unprefixed id
		// matching exactly one candidate keeps today's in-process behavior.
		const exact = candidates.find(candidate => candidate.address === normalized);
		if (exact) {
			this.#agentBindings.set(key, exact.address);
			return { ok: true, target: exact.address };
		}
		// Bare ids and alias-qualified ids both resolve here; several owners is
		// an explicit ambiguity, never an arbitrary pick.
		const matches = candidates.filter(
			candidate => candidate.id === normalized || candidate.address.endsWith(`/${normalized}`),
		);
		if (matches.length === 1) {
			this.#agentBindings.set(key, matches[0]!.address);
			return { ok: true, target: matches[0]!.address };
		}
		if (matches.length > 1) {
			return {
				ok: false,
				error: `Ambiguous agent "${cleaned}": ${matches.map(candidate => candidate.address).join(", ")}. Use a workspace-qualified id.`,
			};
		}
		const available = candidates.map(candidate => candidate.address);
		return {
			ok: false,
			error:
				available.length > 0
					? `Unknown agent "${cleaned}". Available: ${available.join(", ")}.`
					: `Unknown agent "${cleaned}". No agents are visible.`,
		};
	}

	/** Runtime agent override for one chat, if any. */
	agentTargetFor(channelId: ChannelInstanceId, peer: string): string | undefined {
		return this.#agentBindings.get(`${channelId}:${peer}`);
	}

	/** Team names the plugin exposed (empty until the team plugin lands). */
	listTeams(): string[] {
		return this.#teamNames?.() ?? [];
	}

	/** Address of a team's host agent, or undefined when the team is unknown. */
	resolveTeamHost(name: string): string | undefined {
		return this.#resolveTeamHost?.(name);
	}

	/**
	 * One resolution for the inbound bridge: the `@agent use` override wins,
	 * then {@link resolveRoute} — the documented decision point, which also
	 * materializes a direct workspace session — then the relay coordinator.
	 */
	/**
	 * Resolve an agent profile target to a real working directory. Team targets
	 * come from TeamDb: a PM runs in `team_pms.workspace_path`, an engineer in
	 * its home worktree (an explicit repo disambiguates several). Missing rows
	 * are errors, never a fallback to the default workspace.
	 */
	async resolveImTargetCwd(
		target: ImTarget,
	): Promise<{ ok: true; cwd: string; alias?: string } | { ok: false; error: string }> {
		if (target.kind === "workspace") {
			if (target.workspace === COORDINATOR_ALIAS)
				return { ok: true, cwd: this.#defaultCwd, alias: COORDINATOR_ALIAS };
			const dir = this.resolveDir(target.workspace);
			if (!dir) return { ok: false, error: `Unknown workspace "${target.workspace}"` };
			const stat = await fs.stat(dir).catch(() => null);
			if (!stat?.isDirectory()) return { ok: false, error: `Workspace directory does not exist: ${dir}` };
			return { ok: true, cwd: dir, alias: target.workspace };
		}
		let db: TeamDb | null = null;
		try {
			db = new TeamDb(resolveTeamDbPath());
			const team = db.listTeams().find(candidate => candidate.name === target.team || candidate.id === target.team);
			if (!team) return { ok: false, error: `Unknown Team "${target.team}"` };
			const pm = db.listPms(team.id).find(candidate => candidate.name === target.pm || candidate.id === target.pm);
			if (!pm) return { ok: false, error: `Unknown PM "${target.pm}" in Team "${team.name}"` };
			if (target.kind === "team-pm") return { ok: true, cwd: pm.workspacePath };
			const engineer = db
				.listEngineers(team.id)
				.find(
					candidate =>
						candidate.pmId === pm.id && (candidate.name === target.engineer || candidate.id === target.engineer),
				);
			if (!engineer) return { ok: false, error: `Unknown engineer "${target.engineer}" under PM "${pm.name}"` };
			let worktrees = db
				.listWorktrees(team.id)
				.filter(candidate => candidate.engineerId === engineer.id && candidate.kind === "home");
			if (target.repo !== undefined) {
				const repo = db.getRepo(team.id, target.repo) ?? db.getRepoById(target.repo);
				if (!repo) return { ok: false, error: `Unknown repo "${target.repo}" in Team "${team.name}"` };
				worktrees = worktrees.filter(candidate => candidate.repoId === repo.id);
			}
			if (worktrees.length === 0) return { ok: false, error: `Engineer "${engineer.name}" has no home worktree` };
			if (worktrees.length > 1) {
				return {
					ok: false,
					error: `Engineer "${engineer.name}" has several home worktrees; set target.repo explicitly`,
				};
			}
			return { ok: true, cwd: worktrees[0]!.path };
		} catch (error) {
			return {
				ok: false,
				error: `Team target lookup failed: ${error instanceof Error ? error.message : String(error)}`,
			};
		} finally {
			db?.close();
		}
	}

	/**
	 * Materialize the BotSessionEntry that owns one binding. The binding id is
	 * the stable identity; the entry records the profile/target snapshot and
	 * lives under the target cwd so a Team PM/engineer never shares a
	 * transcript or memory home with another binding.
	 */
	async ensureImBindingSession(binding: ImBinding): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
		if (binding.sessionId === "relay") return { ok: true, id: "relay" };
		const resolved = await this.resolveImTargetCwd(binding.target);
		if (!resolved.ok) return resolved;
		// One deterministic transcript per binding+target: switching away and
		// back resumes the same conversation, while a different workspace never
		// inherits another target's history or memory.
		const current = this.#webConfig.getBotSession(binding.sessionId);
		if (
			current &&
			current.cwd === resolved.cwd &&
			(!current.target || targetKey(current.target) === targetKey(binding.target)) &&
			(!current.agentProfileId || current.agentProfileId === binding.agentProfileId)
		) {
			return { ok: true, id: current.id };
		}
		const targetSessionId = `im-${targetScopedBindingId(binding).replace(/[^a-z0-9-]+/gi, "-")}`;
		const existing = this.#webConfig.getBotSession(targetSessionId);
		if (existing) {
			if (binding.sessionId !== targetSessionId) {
				await this.#webConfig.patchImBinding(
					binding.instanceId,
					binding.chatId,
					{ sessionId: targetSessionId },
					{
						...(binding.threadId ? { threadId: binding.threadId } : {}),
						...(binding.userId ? { userId: binding.userId } : {}),
					},
				);
			}
			return { ok: true, id: existing.id };
		}
		if (binding.sessionId !== targetSessionId) {
			await this.#webConfig.patchImBinding(
				binding.instanceId,
				binding.chatId,
				{ sessionId: targetSessionId },
				{
					...(binding.threadId ? { threadId: binding.threadId } : {}),
					...(binding.userId ? { userId: binding.userId } : {}),
				},
			);
			binding = { ...binding, sessionId: targetSessionId };
		}
		const profile = this.#webConfig.getImAgent(binding.agentProfileId);
		if (!profile) return { ok: false, error: `Unknown agent profile "${binding.agentProfileId}"` };
		const safeName = `${profile.label}-${targetScopedBindingId(binding)}`.replace(/[^\w\u4e00-\u9fff-]+/g, "-");
		const entry: BotSessionEntry = {
			id: targetSessionId,
			name: `${profile.label} · ${binding.chatId}`,
			tag: "bot",
			sessionFile: path.join(SessionManager.getDefaultSessionDir(resolved.cwd), `${safeName}.jsonl`),
			cwd: resolved.cwd,
			...(resolved.alias !== undefined ? { workspaceAlias: resolved.alias } : {}),
			instanceId: binding.instanceId,
			bindingId: targetScopedBindingId(binding),
			agentProfileId: binding.agentProfileId,
			target: binding.target,
			...(binding.model ? { model: binding.model } : {}),
			platform: binding.platform,
			chatId: binding.chatId,
			...(binding.lang ? { lang: binding.lang } : {}),
			createdAt: new Date().toISOString(),
		};
		await this.#webConfig.upsertBotSession(entry);
		return { ok: true, id: entry.id };
	}

	/** Refresh and pin the short-selector snapshot for this entry. */
	async listSessionCandidates(
		options: { includePm?: boolean; now?: number; maxAgeMs?: number } = {},
	): Promise<ImSessionListSnapshot> {
		this.#sessionListSnapshot = await buildImSessionList(this, this.#webConfig, this.#sessionSelectorState, options);
		return this.#sessionListSnapshot;
	}

	/** Resolve a short selector against the list the user saw; never renumber mid-use. */
	resolveSessionSelector(selector: string): string | null {
		const cleaned = selector
			.trim()
			.replace(/^\{|\}$/g, "")
			.replace(/^\[|\]$/g, "");
		if (!cleaned) return null;
		const fromSnapshot = this.#sessionListSnapshot?.bySelector.get(cleaned)?.canonicalSessionId;
		if (fromSnapshot) return fromSnapshot;
		// Explicit registry ids remain valid for scripts and legacy commands.
		return this.#webConfig.getBotSession(cleaned)?.id ?? null;
	}

	sessionSelectorSnapshot(): ImSessionListSnapshot | null {
		return this.#sessionListSnapshot;
	}

	#workspaceSwitchKey(
		instanceId: ChannelInstanceId,
		peer: string,
		context: { threadId?: string; userId?: string },
	): string {
		return [instanceId, peer, context.threadId ?? "", context.userId ?? ""].join("\u0000");
	}

	/** Stage a workspace change; nothing persists until confirm from the same entry. */
	async requestWorkspaceSwitch(
		instanceId: ChannelInstanceId,
		peer: string,
		target: ImTarget,
		context: { threadId?: string; userId?: string } = {},
	): Promise<{ current: string; next: string; same: boolean }> {
		const key = this.#workspaceSwitchKey(instanceId, peer, context);
		const binding = this.#webConfig.findImBinding(instanceId, peer, context);
		const currentTarget =
			binding?.target ??
			this.#webConfig.getImAgent(this.#webConfig.getChannelInstance(instanceId)?.agentProfile ?? "")?.location;
		// A chat pointed at a bot session is not already on that session's project
		// target: relay must still be able to clear the pointer.
		const botPointer = binding?.sessionId;
		const current =
			this.agentTargetFor(instanceId, peer) ??
			(botPointer && botPointer !== "relay"
				? `bot:${botPointer}`
				: currentTarget
					? targetKey(currentTarget)
					: "unbound");
		const next = targetKey(target);
		if (current === next) {
			// "Already there" also supersedes an earlier staged target, otherwise
			// a restart could resurrect a preview the user replaced.
			const replaced = this.#pendingWorkspaceSwitch.get(key);
			this.#pendingWorkspaceSwitch.delete(key);
			if (replaced) {
				await this.#recordImControl(
					instanceId,
					peer,
					context,
					"switch_cancel",
					replaced.requestId,
					replaced.action === "target" ? replaced.target : { kind: "workspace", workspace: COORDINATOR_ALIAS },
					replaced.action,
				);
			}
			return { current, next, same: true };
		}
		// One pending request per entry; a new request replaces the old one and
		// terminates it in the durable handshake so a restart cannot restore it.
		const replaced = this.#pendingWorkspaceSwitch.get(key);
		if (replaced) {
			await this.#recordImControl(
				instanceId,
				peer,
				context,
				"switch_cancel",
				replaced.requestId,
				replaced.action === "target" ? replaced.target : { kind: "workspace", workspace: COORDINATOR_ALIAS },
				replaced.action,
			);
		}
		const requestId = randomUUID().slice(0, 8);
		const control = await this.#recordImControl(
			instanceId,
			peer,
			context,
			"switch_request",
			requestId,
			target,
			"target",
		);
		this.#pendingWorkspaceSwitch.set(key, {
			action: "target",
			target,
			at: Date.now(),
			requestId,
			...(control ? { control } : {}),
		});
		return { current, next, same: false };
	}

	/** Apply the pending workspace change atomically; only the same entry may confirm. */
	async confirmWorkspaceSwitch(
		instanceId: ChannelInstanceId,
		peer: string,
		context: { threadId?: string; userId?: string } = {},
		expectedRequestId?: string,
	): Promise<{ ok: true; target: ImTarget } | { ok: false; error: string }> {
		const key = this.#workspaceSwitchKey(instanceId, peer, context);
		let pending = this.#pendingWorkspaceSwitch.get(key);
		if (!pending) {
			// A preview issued before a restart is still confirmable: rebuild it
			// from the durable im_control request in the same chat/thread scope.
			pending = await this.#restorePendingWorkspaceSwitch(instanceId, peer, context);
			if (pending) this.#pendingWorkspaceSwitch.set(key, pending);
		}
		if (!pending) return { ok: false, error: "No pending workspace change for this chat/thread/user." };
		// The gateway confirms by request id: a preview the UI read must still be
		// the live pending one, checked atomically before any state changes.
		if (expectedRequestId !== undefined && pending.requestId !== expectedRequestId) {
			return { ok: false, error: "stale-request" };
		}
		if (Date.now() - pending.at > WORKSPACE_SWITCH_TTL_MS) {
			this.#pendingWorkspaceSwitch.delete(key);
			return { ok: false, error: "The pending workspace change expired; send the switch command again." };
		}
		this.#pendingWorkspaceSwitch.delete(key);
		await this.#recordImControl(
			instanceId,
			peer,
			context,
			"switch_confirm",
			pending.requestId,
			pending.action === "target" ? pending.target : { kind: "workspace", workspace: COORDINATOR_ALIAS },
			pending.action,
		);
		try {
			if (pending.action === "unbind") {
				// Remove exactly this chat/thread/sender binding, never a sibling
				// thread's binding on the same chat.
				const current = this.#webConfig.findImBinding(instanceId, peer, context);
				if (current) await this.#webConfig.removeImBinding(current.id);
				this.#agentBindings.delete(`${instanceId}:${peer}`);
				this.#runtimeBindings.delete(`${instanceId}:${peer}`);
				return { ok: true, target: { kind: "workspace", workspace: COORDINATOR_ALIAS } };
			}
			const current = this.#webConfig.findImBinding(instanceId, peer, context);
			// Choose the target's existing session before the single atomic binding
			// write. In particular, leaving relay must not retain its sentinel id.
			const previous =
				current &&
				this.#webConfig
					.getBotSessions()
					.find(
						entry =>
							entry.instanceId === instanceId &&
							entry.chatId === peer &&
							entry.agentProfileId === current.agentProfileId &&
							entry.target &&
							targetKey(entry.target) === targetKey(pending.target) &&
							entry.bindingId === targetScopedBindingId({ id: current.id, target: pending.target }),
					);
			const relayTarget =
				pending.action === "target" &&
				pending.target.kind === "workspace" &&
				pending.target.workspace === COORDINATOR_ALIAS;
			await this.#webConfig.patchImBinding(
				instanceId,
				peer,
				{
					target: pending.target,
					...(relayTarget
						? { sessionId: "relay" }
						: previous
							? { sessionId: previous.id }
							: current
								? {
										sessionId: `im-${targetScopedBindingId({ id: current.id, target: pending.target }).replace(/[^a-z0-9-]+/gi, "-")}`,
									}
								: {}),
				},
				context,
			);
			this.#agentBindings.delete(`${instanceId}:${peer}`);
			this.#runtimeBindings.delete(`${instanceId}:${peer}`);
			return { ok: true, target: pending.target };
		} catch (error) {
			return { ok: false, error: error instanceof Error ? error.message : String(error) };
		}
	}

	/** Stage removal of this entry's binding (confirm-gated). */
	async requestWorkspaceUnbind(
		instanceId: ChannelInstanceId,
		peer: string,
		context: { threadId?: string; userId?: string } = {},
	): Promise<boolean> {
		const key = this.#workspaceSwitchKey(instanceId, peer, context);
		const replaced = this.#pendingWorkspaceSwitch.get(key);
		if (replaced) {
			await this.#recordImControl(
				instanceId,
				peer,
				context,
				"switch_cancel",
				replaced.requestId,
				replaced.action === "target" ? replaced.target : { kind: "workspace", workspace: COORDINATOR_ALIAS },
				replaced.action,
			);
		}
		const requestId = randomUUID().slice(0, 8);
		const control = await this.#recordImControl(
			instanceId,
			peer,
			context,
			"switch_request",
			requestId,
			{ kind: "workspace", workspace: COORDINATOR_ALIAS },
			"unbind",
		);
		this.#pendingWorkspaceSwitch.set(key, {
			action: "unbind",
			at: Date.now(),
			requestId,
			...(control ? { control } : {}),
		});
		return true;
	}

	async cancelWorkspaceSwitch(
		instanceId: ChannelInstanceId,
		peer: string,
		context: { threadId?: string; userId?: string } = {},
		expectedRequestId?: string,
	): Promise<boolean> {
		const key = this.#workspaceSwitchKey(instanceId, peer, context);
		const pending = this.#pendingWorkspaceSwitch.get(key);
		if (!pending) return false;
		if (expectedRequestId !== undefined && pending.requestId !== expectedRequestId) return false;
		this.#pendingWorkspaceSwitch.delete(key);
		await this.#recordImControl(
			instanceId,
			peer,
			context,
			"switch_cancel",
			pending.requestId,
			pending.action === "target" ? pending.target : { kind: "workspace", workspace: COORDINATOR_ALIAS },
			pending.action,
		);
		return true;
	}

	/** Read-only current target and pending handshake for the Team IM page. */
	async workspaceSwitchStatus(
		instanceId: ChannelInstanceId,
		peer: string,
		context: { threadId?: string; userId?: string } = {},
	): Promise<ImSwitchStatus> {
		const key = this.#workspaceSwitchKey(instanceId, peer, context);
		let pending = this.#pendingWorkspaceSwitch.get(key);
		if (!pending) {
			pending = await this.#restorePendingWorkspaceSwitch(instanceId, peer, context);
			if (pending) this.#pendingWorkspaceSwitch.set(key, pending);
		}
		if (pending && Date.now() - pending.at > WORKSPACE_SWITCH_TTL_MS) {
			this.#pendingWorkspaceSwitch.delete(key);
			pending = undefined;
		}
		const binding = this.#webConfig.findImBinding(instanceId, peer, context);
		const current: ImSwitchCurrentView = {
			...(binding?.target.kind === "workspace" ? { workspaceAlias: binding.target.workspace } : {}),
			...(binding?.agentProfileId ? { agentId: binding.agentProfileId } : {}),
			...(binding?.id ? { bindingId: binding.id } : {}),
			targetKey: binding ? targetKey(binding.target) : `workspace:${COORDINATOR_ALIAS}`,
		};
		if (!pending) return { current };
		const metadata = pending.control?.metadata;
		const from: ImRouteSnapshot = metadata?.from ?? {
			...(binding?.target.kind === "workspace" ? { workspaceAlias: binding.target.workspace } : {}),
			...(binding?.agentProfileId ? { agentId: binding.agentProfileId } : {}),
			...(binding?.sessionId ? { sessionId: binding.sessionId, botSessionId: binding.sessionId } : {}),
			...(binding?.id ? { bindingId: binding.id } : {}),
		};
		const to: ImRouteSnapshot =
			metadata?.to ??
			(pending.action === "target" && pending.target.kind === "workspace"
				? { workspaceAlias: pending.target.workspace }
				: { workspaceAlias: COORDINATOR_ALIAS });
		return {
			current,
			pending: {
				requestId: pending.requestId,
				operation: pending.action,
				from,
				to,
				requestedAt: new Date(pending.at).toISOString(),
				...(pending.control ? { controlRecord: pending.control } : {}),
			},
		};
	}

	/**
	 * Rebuild one chat/thread/sender's pending switch from persisted `im_control`
	 * rows. A later request supersedes an earlier one; confirm/cancel terminates
	 * the request. Only handshakes younger than {@link WORKSPACE_SWITCH_TTL_MS}
	 * are resumed, so an old preview cannot surprise the user days later.
	 */
	async #restorePendingWorkspaceSwitch(
		instanceId: ChannelInstanceId,
		peer: string,
		context: { threadId?: string; userId?: string },
	): Promise<
		| { action: "target"; target: ImTarget; at: number; requestId: string; control?: ImSwitchControlRecord }
		| { action: "unbind"; at: number; requestId: string; control?: ImSwitchControlRecord }
		| undefined
	> {
		const binding = this.#webConfig.findImBinding(instanceId, peer, context);
		const managers: SessionManager[] = [];
		const live = binding ? this.#botSessions.get(binding.sessionId)?.session.sessionManager : undefined;
		if (live) managers.push(live);
		if (this.#coordinator.sessionManager && !managers.includes(this.#coordinator.sessionManager)) {
			managers.push(this.#coordinator.sessionManager);
		}
		const entry = binding ? this.#webConfig.getBotSession(binding.sessionId) : undefined;
		if (!live && entry?.sessionFile) {
			try {
				const manager = await SessionManager.open(entry.sessionFile, undefined, undefined, {
					throwIfMissing: false,
				});
				managers.push(manager);
			} catch {
				// A missing/unreadable transcript leaves no resumable handshake.
			}
		}
		const requests = new Map<string, { metadata: ImSwitchControlMetadata; at: number; id: string }>();
		const terminated = new Set<string>();
		for (const manager of managers) {
			for (const item of manager.getEntries()) {
				if (item.type !== "im_control") continue;
				const metadata = normalizeImSwitchControlMetadata(item.metadata);
				if (!metadata) continue;
				if (metadata.instance !== instanceId || metadata.chatId !== peer) continue;
				if ((metadata.threadId ?? "") !== (context.threadId ?? "")) continue;
				if ((metadata.senderId ?? "") !== (context.userId ?? "")) continue;
				if (metadata.action !== "switch_request") {
					terminated.add(metadata.requestId);
					continue;
				}
				const at = Date.parse(metadata.sentAt);
				const previous = requests.get(metadata.requestId);
				if (!previous || at >= previous.at) requests.set(metadata.requestId, { metadata, at, id: item.id });
			}
		}
		let latest: { metadata: ImSwitchControlMetadata; at: number; id: string } | undefined;
		for (const candidate of requests.values()) {
			if (terminated.has(candidate.metadata.requestId)) continue;
			if (!Number.isFinite(candidate.at) || Date.now() - candidate.at > WORKSPACE_SWITCH_TTL_MS) continue;
			if (!latest || candidate.at > latest.at) latest = candidate;
		}
		if (!latest) return undefined;
		const control = { id: latest.id, metadata: latest.metadata };
		if ((latest.metadata.operation ?? "target") === "unbind") {
			return { action: "unbind", at: latest.at, requestId: latest.metadata.requestId, control };
		}
		const alias = latest.metadata.to.workspaceAlias;
		if (!alias) return undefined;
		return {
			action: "target",
			target: { kind: "workspace", workspace: alias },
			at: latest.at,
			requestId: latest.metadata.requestId,
			control,
		};
	}

	/** Persist an im_control handshake on the target session (never an LLM prompt). */
	async #recordImControl(
		instanceId: ChannelInstanceId,
		peer: string,
		context: { threadId?: string; userId?: string },
		action: "switch_request" | "switch_confirm" | "switch_cancel",
		requestId: string,
		to: ImTarget,
		operation: "target" | "unbind" = "target",
	): Promise<ImSwitchControlRecord | undefined> {
		const instance = this.#webConfig.getChannelInstance(instanceId);
		const binding = this.#webConfig.findImBinding(instanceId, peer, context);
		const manager =
			(binding ? this.#botSessions.get(binding.sessionId)?.session.sessionManager : undefined) ??
			this.#coordinator.sessionManager;
		if (!manager) return undefined;
		const fromTarget = binding?.target;
		const route = (target: ImTarget | undefined) => ({
			...(target?.kind === "workspace" ? { workspaceAlias: target.workspace } : {}),
			...(binding?.agentProfileId ? { agentId: binding.agentProfileId } : {}),
			...(binding?.sessionId ? { sessionId: binding.sessionId, botSessionId: binding.sessionId } : {}),
			...(binding?.id ? { bindingId: binding.id } : {}),
		});
		const metadata: ImSwitchControlMetadata = {
			source: "im_control",
			platform: instance?.platform ?? "unknown",
			instance: instanceId,
			chatId: peer,
			...(context.threadId ? { threadId: context.threadId } : {}),
			...(context.userId ? { senderId: context.userId } : {}),
			messageId: `control-${requestId}`,
			sentAt: new Date().toISOString(),
			action,
			requestId,
			operation,
			from: route(fromTarget),
			to: route(to),
		};
		const id = manager.appendImControl(metadata);
		return { id, metadata };
	}

	async resolveChatTarget(
		channelId: ChannelInstanceId,
		peer: string,
		context: { threadId?: string; userId?: string } = {},
	): Promise<ChatRouteTarget> {
		const agent = this.agentTargetFor(channelId, peer);
		if (agent) return { kind: "agent", target: agent, local: !agent.includes("/") };
		// A manual `@workspace use` wins: the operator explicitly switched this
		// chat off its session/project for now.
		const runtime = this.#runtimeBindings.get(`${channelId}:${peer}`);
		if (runtime === COORDINATOR_ALIAS) return { kind: "relay" };
		if (runtime) return this.#workspaceTarget(runtime);
		// Every instance has a default profile; the first message creates the
		// persistent binding, so a chat never borrows another chat's session.
		let imBinding = this.#webConfig.findImBinding(channelId, peer, context);
		if (!imBinding) {
			// No configured instance means there is no per-chat profile to
			// materialize; the default-workspace relay coordinator is the only
			// safe target. Never invent a repository agent for an unknown entry.
			const instance = this.#webConfig.getChannelInstance(channelId);
			if (!instance) return { kind: "relay" };
			try {
				const hasAnswer = this.#webConfig
					.getImBindings()
					.some(
						binding =>
							binding.platform === instance.platform && binding.chatId === peer && binding.role === "answer",
					);
				imBinding = await this.#webConfig.patchImBinding(
					channelId,
					peer,
					{ role: hasAnswer ? "mention" : "answer" },
					context,
				);
			} catch (error) {
				return {
					kind: "unavailable",
					alias: channelId,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		}
		if (imBinding.sessionId === "relay") return { kind: "relay" };
		if (imBinding.target?.kind === "workspace" && imBinding.target.workspace === COORDINATOR_ALIAS) {
			return { kind: "relay" };
		}
		// A workspace binding is the chat's repository target; a sessionId left by
		// an older bot selection must not override it unless that session exists.
		if (
			imBinding.target?.kind === "workspace" &&
			imBinding.target.workspace !== COORDINATOR_ALIAS &&
			!(imBinding.sessionId && this.#webConfig.getBotSession(imBinding.sessionId))
		) {
			return this.#workspaceTarget(imBinding.target.workspace);
		}
		const ensured = await this.ensureImBindingSession(imBinding);
		if (!ensured.ok) return { kind: "unavailable", alias: imBinding.agentProfileId, error: ensured.error };
		return { kind: "bot", id: ensured.id };
	}

	/**
	 * Resolve one alias to a workspace route, materializing its session. A
	 * workspace that cannot be opened is reported as `unavailable`, never as a
	 * silent relay fallback (the default workspace must not answer for another
	 * repository).
	 */
	async #workspaceTarget(alias: string): Promise<ChatRouteTarget> {
		const dir = this.resolveDir(alias);
		if (!dir) return { kind: "unavailable", alias, error: `Unknown workspace "${alias}"` };
		if (!this.#sessions.has(dir)) {
			const opened = await this.open(dir, alias);
			if (!opened.ok) return { kind: "unavailable", alias, error: opened.error };
		}
		return { kind: "workspace", alias };
	}

	/**
	 * Deliver one IM message to an agent target. The sender is this process's
	 * main agent, so replies surface in the relay conversation; a local target
	 * is injected directly, a remote one goes through the mesh.
	 */
	async deliverToAgent(
		target: string,
		channelId: ChannelInstanceId,
		peer: string,
		body: string,
	): Promise<{ ok: boolean; error?: string }> {
		const coordinatorId = this.#coordinator.getAgentId?.() ?? MAIN_AGENT_ID;
		// `@agent use main` (any case) names this process's workspace main, which
		// may be the coordinator itself; normalize before the direct branch so it
		// is not routed through the bus as a self-send.
		const resolvedTarget = AgentRegistry.global().resolveMainAlias(target, coordinatorId) ?? target;
		try {
			if (resolvedTarget === coordinatorId) {
				await this.#coordinator.deliverIrcMessage({
					id: `${channelId}:${peer}:${Date.now()}`,
					from: "user",
					to: resolvedTarget,
					body,
					ts: Date.now(),
				});
				return { ok: true };
			}
			const receipt = await IrcBus.global().send({ from: coordinatorId, to: resolvedTarget, body });
			return receipt.outcome === "failed" ? { ok: false, error: receipt.error } : { ok: true };
		} catch (error) {
			return { ok: false, error: error instanceof Error ? error.message : String(error) };
		}
	}

	/** Resolve the effective workspace alias for one chat ("" = relay coordinator). */
	async bindingFor(channelId: ChannelInstanceId, peer: string): Promise<string | null> {
		const runtime = this.#runtimeBindings.get(`${channelId}:${peer}`);
		if (runtime) return runtime;
		const binding = this.#webConfig.findImBinding(channelId, peer);
		if (!binding) return null;
		if (binding.target.kind === "workspace") return binding.target.workspace;
		return null;
	}

	/** `channels.reportPolicy` — how delegated work reaches the IM user (D4). */
	#reportPolicy(): "all" | "summary" | "silent" {
		return this.#coordinator.settings ? cfgChannelsReportPolicy.get(this.#coordinator.settings) : "summary";
	}

	/**
	 * Report one delegated-work event to the IM user, honoring
	 * `channels.reportPolicy`:
	 * - `all` forwards every report as it arrives;
	 * - `summary` (default) buffers progress and forwards one merged message on
	 *   the stage's completion or failure;
	 * - `silent` forwards nothing — the report stays in the coordinator's
	 *   transcript until the user asks.
	 *
	 * Reports that cannot be attributed to a chat are never pushed anywhere.
	 */
	async reportDelegation(
		channelId: ChannelInstanceId,
		peer: string,
		stage: "progress" | "completion" | "failure",
		text: string,
	): Promise<"sent" | "buffered" | "suppressed"> {
		const key = `${channelId}:${peer}`;
		const policy = this.#reportPolicy();
		if (policy === "silent") {
			this.#pendingReports.delete(key);
			return "suppressed";
		}
		if (policy === "all") {
			this.#pendingReports.delete(key);
			await this.#sendText(channelId, peer, text);
			return "sent";
		}
		const buffered = this.#pendingReports.get(key) ?? [];
		if (stage === "progress") {
			buffered.push(text);
			this.#pendingReports.set(key, buffered);
			return "buffered";
		}
		this.#pendingReports.delete(key);
		await this.#sendText(channelId, peer, buffered.length > 0 ? [...buffered, text].join("\n\n") : text);
		return "sent";
	}

	/**
	 * Forward one report to the chat that triggered the delegation. A report
	 * that cannot be delivered is logged, never fatal: the delegation itself
	 * already succeeded and its reply still reaches the coordinator.
	 */
	async #forwardReport(
		chat: { channelId: ChannelInstanceId; peer: string } | null,
		stage: "progress" | "completion" | "failure",
		text: string,
	): Promise<"sent" | "buffered" | "suppressed"> {
		if (!chat) return "suppressed";
		try {
			return await this.reportDelegation(chat.channelId, chat.peer, stage, text);
		} catch (error) {
			logger.warn("Delegated report forwarding failed", {
				channel: chat.channelId,
				error: error instanceof Error ? error.message : String(error),
			});
			return "suppressed";
		}
	}

	/**
	 * Everything the IM status surface reports for one chat: landing workspace,
	 * direct/relay route, persona activation, project-layer memory backend, and
	 * the relay report policy.
	 */
	async statusSnapshot(channelId: ChannelInstanceId, peer: string): Promise<ChatStatusSnapshot> {
		// A selected bot session owns the chat's project; otherwise the persisted
		// binding (then the channel default) decides the landing workspace.
		const botId = await this.activeBotSessionIdFor(channelId, peer);
		const botEntry = botId ? this.#webConfig.getBotSession(botId) : undefined;
		const binding = await this.bindingFor(channelId, peer);
		const boundDir = binding && binding !== COORDINATOR_ALIAS ? this.resolveDir(binding) : undefined;
		const directDir = botEntry?.cwd ?? boundDir;
		const workspaceAlias = botEntry?.workspaceAlias ?? (boundDir ? binding : null);
		const workspaceDir = directDir ?? this.#defaultCwd;
		// Resolve through the settings layers, exactly like a session would: the
		// process singleton (global + --config + runtime) re-scoped to this
		// workspace, or a read-only load when the router runs without one. The
		// project layer's own file order is the discovery provider's, never a
		// hand-rolled `settings.json`-before-`config.yml` probe.
		let memoryBackend = "off";
		let memoryBackendSource: SettingProvenance = "default";
		try {
			const global = await Settings.current?.catch(() => null);
			const settings = global
				? await global.sessionForCwd(workspaceDir)
				: await Settings.loadReadOnly({ cwd: workspaceDir });
			memoryBackend = cfgMemoryBackend.get(settings);
			memoryBackendSource = settings.getProvenance(cfgMemoryBackend);
		} catch (error) {
			logger.warn("Could not resolve the workspace memory setting", {
				workspaceDir,
				error: error instanceof Error ? error.message : String(error),
			});
		}
		return {
			route: directDir ? "direct" : "relay",
			workspaceAlias,
			workspaceDir,
			personaActive: await hasWorkspacePersona(workspaceDir),
			memoryBackend,
			memoryBackendSource,
			reportPolicy: this.#reportPolicy(),
		};
	}

	/** Set a runtime (non-persisted) route override for one chat. */
	async setRuntimeBinding(
		channelId: ChannelInstanceId,
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
		channelId: ChannelInstanceId,
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
		// One merge keeps a chat's language and drops any bot-session pointer: a
		// workspace binding supersedes both. `mode: direct` is the explicit
		// project selection that outranks the channel default.
		await this.#webConfig.patchImBinding(channelId, peer, {
			target: { kind: "workspace", workspace: alias },
		});
		return { ok: true, alias };
	}

	/** Remove a chat's persisted + runtime binding. */
	async unbindChat(channelId: ChannelInstanceId, peer: string): Promise<boolean> {
		// An explicit unbind is a relay decision, not a gap the next lookup fills
		// with a fresh default bot session.
		this.#runtimeBindings.set(`${channelId}:${peer}`, COORDINATOR_ALIAS);
		this.#agentBindings.delete(`${channelId}:${peer}`);
		return this.#webConfig.removeImBindingByChat(channelId, peer);
	}

	/** List every persisted binding for one platform. */
	bindingsForPlatform(channelId: ChannelInstanceId): { chatId: string; workspaceAlias?: string; mode?: string }[] {
		return this.#webConfig
			.getImBindings()
			.filter(binding => binding.instanceId === channelId)
			.map(binding => ({
				chatId: binding.chatId,
				...(binding.target.kind === "workspace" ? { workspaceAlias: binding.target.workspace } : {}),
				role: binding.role,
			}));
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

	/** The origin stamp for one registry entry. */
	#botOrigin(entry: BotSessionEntry, chat?: { channelId: ChannelInstanceId; peer: string }): SessionOrigin {
		const channel = chat?.channelId ?? entry.platform;
		const chatId = chat?.peer ?? entry.chatId;
		return {
			kind: "im",
			botSessionId: entry.id,
			...(channel ? { channel } : {}),
			...(chatId ? { chatId } : {}),
			...(entry.workspaceAlias ? { workspaceAlias: entry.workspaceAlias } : {}),
		};
	}

	/**
	 * Make the transcript's header agree with the registry: an IM origin stamp,
	 * and the registry display name only when the transcript has none yet. A
	 * title the operator set (in Studio or via `rename_session`) is never
	 * overwritten by a later runtime start.
	 */
	async #syncBotSessionMetadata(entry: BotSessionEntry, session: AgentSession): Promise<void> {
		const manager = session.sessionManager;
		// An injected runtime factory (tests, alternate hosts) may expose only the
		// AgentSession surface. Metadata is an enhancement, never a start failure.
		if (!manager) return;
		const desired = this.#botOrigin(entry);
		if (!isImSession(manager.getOrigin())) await manager.setOrigin(desired);
		if (!manager.getSessionName()) await manager.setSessionName(entry.name, "user");
	}

	/**
	 * Record the chat a bot session answers in the registry and on its
	 * transcript when either changed. A no-op for repeat deliveries from the
	 * same chat, so the hot path never rewrites web.yml.
	 */
	async #rememberBotChat(id: string, channelId: ChannelInstanceId, peer: string): Promise<void> {
		const entry = this.#webConfig.getBotSession(id);
		if (!entry) return;
		const changed = entry.platform !== channelId || entry.chatId !== peer;
		const updated: BotSessionEntry = { ...entry, platform: channelId, chatId: peer };
		if (changed) {
			await this.#webConfig.upsertBotSession(updated);
			const handle = this.#botSessions.get(id);
			if (handle) handle.entry = { ...handle.entry, platform: channelId, chatId: peer };
		}
		const handle = this.#botSessions.get(id);
		const manager = handle?.session.sessionManager;
		if (!handle || !manager) return;
		const desired = this.#botOrigin(updated);
		if (!sameSessionOrigin(manager.getOrigin(), desired)) {
			await manager.setOrigin(desired).catch(() => {});
		}
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
		project?: BotSessionProject,
	): Promise<{ ok: true; entry: BotSessionEntry } | { ok: false; error: string }> {
		const cleanName = name.trim();
		if (!cleanName) return { ok: false, error: "Session name must not be empty" };
		const resolved = await this.#resolveProject(project);
		if (!resolved.ok) return resolved;
		const id = randomUUID().slice(0, 8);
		const safeName = cleanName.replace(/[^\w\u4e00-\u9fff-]+/g, "-").slice(0, 40) || "bot";
		// The transcript lives under the project's session dir, so reopening it
		// resumes with that project's cwd (never the process/default cwd).
		const sessionFile = path.join(SessionManager.getDefaultSessionDir(resolved.cwd), `${safeName}-${id}.jsonl`);
		const entry: BotSessionEntry = {
			id,
			name: cleanName,
			tag,
			sessionFile,
			cwd: resolved.cwd,
			...(resolved.alias !== undefined && { workspaceAlias: resolved.alias }),
			createdAt: new Date().toISOString(),
		};
		await this.#webConfig.upsertBotSession(entry);
		const ensured = await this.ensureBotSession(entry);
		if (!ensured.ok) return ensured;
		// Name the fresh transcript after the registry entry now, so Studio and
		// History show the requested name before the first message arrives.
		const manager = ensured.session.sessionManager;
		if (manager && manager.getSessionName() !== cleanName) {
			await manager.setSessionName(cleanName, "user").catch(() => {});
		}
		return { ok: true, entry };
	}

	/**
	 * Resolve an explicit project binding. Only registered workspaces (or the
	 * default workspace) are accepted: a PM may not silently point a bot at an
	 * arbitrary directory.
	 */
	async #resolveProject(
		project?: BotSessionProject,
	): Promise<{ ok: true; cwd: string; alias?: string } | { ok: false; error: string }> {
		if (!project) return { ok: true, cwd: this.#defaultCwd };
		if (project.alias) {
			if (project.alias === COORDINATOR_ALIAS) return { ok: true, cwd: this.#defaultCwd };
			const dir = this.resolveDir(project.alias);
			if (!dir) return { ok: false, error: `Unknown workspace "${project.alias}"` };
			const stat = await fs.stat(dir).catch(() => null);
			if (!stat?.isDirectory()) return { ok: false, error: `Project directory does not exist: ${dir}` };
			return { ok: true, cwd: dir, alias: project.alias };
		}
		if (!project.dir) return { ok: false, error: "A project needs a workspace alias or directory" };
		const dir = path.resolve(project.dir);
		if (dir === path.resolve(this.#defaultCwd)) return { ok: true, cwd: dir };
		const alias = this.#aliasForDir(dir);
		if (alias === undefined) {
			return { ok: false, error: `Project "${dir}" is not a registered workspace; run @workspace open first` };
		}
		const stat = await fs.stat(dir).catch(() => null);
		if (!stat?.isDirectory()) return { ok: false, error: `Project directory does not exist: ${dir}` };
		return { ok: true, cwd: dir, alias };
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
		// The transcript title is what Studio, History and the resume picker
		// display; the web.yml name alone left the old title on every list.
		if (handle) handle.entry = updated;
		if (handle?.session.sessionManager) {
			await handle.session.sessionManager.setSessionName(cleanName, "user").catch(error => {
				logger.warn("Bot session title sync failed", {
					id,
					error: error instanceof Error ? error.message : String(error),
				});
			});
		} else {
			await SessionManager.renameSessionTitle(entry.sessionFile, cleanName, { cwd: entry.cwd }).catch(error => {
				logger.warn("Bot session title rename failed", {
					id,
					error: error instanceof Error ? error.message : String(error),
				});
			});
		}
		return { ok: true, name: cleanName };
	}

	/**
	 * Bind (or re-bind) an existing bot session to a project. The live runtime
	 * keeps its original cwd, so it is disposed and lazily recreated on the new
	 * project; `main` points the session back at the default workspace.
	 */
	async bindBotSessionProject(
		id: string,
		alias: string,
	): Promise<{ ok: true; alias?: string; cwd: string } | { ok: false; error: string }> {
		const entry = this.#webConfig.getBotSession(id);
		if (!entry) return { ok: false, error: `Unknown bot session "${id}"` };
		if (entry.tag === "relay") return { ok: false, error: "relay 会话固定在默认工作区，不能改绑项目" };
		const resolved = await this.#resolveProject({ alias });
		if (!resolved.ok) return resolved;
		const handle = this.#botSessions.get(id);
		if (handle) {
			handle.unsubscribe();
			this.#botSessions.delete(id);
			this.#detachBridge(id, handle.session);
			try {
				await handle.session.dispose();
			} catch (error) {
				logger.warn("Bot session dispose failed", {
					id,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
		// Move the transcript with its session: `moveTo` rewrites the header cwd
		// and relocates the file, so a resume cannot reopen in the old repo. The
		// runtime is disposed above, so this process holds the only writer claim.
		let sessionFile = entry.sessionFile;
		try {
			const manager = await SessionManager.open(entry.sessionFile, undefined, undefined, {
				initialCwd: entry.cwd ?? this.#defaultCwd,
			});
			try {
				await manager.moveTo(resolved.cwd);
				sessionFile = manager.getSessionFile() ?? entry.sessionFile;
			} finally {
				await manager.close();
			}
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			logger.warn("Bot session project relocation failed", { id, error: detail });
			return { ok: false, error: `无法将会话迁移到项目 ${resolved.cwd}：${detail}` };
		}
		const updated: BotSessionEntry = { ...entry, cwd: resolved.cwd, sessionFile };
		if (resolved.alias === undefined) delete updated.workspaceAlias;
		else updated.workspaceAlias = resolved.alias;
		await this.#webConfig.upsertBotSession(updated);
		logger.info("Bot session project bound", { id, alias: resolved.alias, cwd: resolved.cwd });
		return { ok: true, ...(resolved.alias !== undefined && { alias: resolved.alias }), cwd: resolved.cwd };
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
			this.#detachBridge(id, handle.session);
			this.#botLastChat.delete(id);
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

	/**
	 * Compile the entry's agent profile into the SDK admission policy. Every
	 * binding owns its runtime id/memory namespace/home; a profile is only a
	 * template. A missing profile or persona is an explicit error.
	 */
	async agentProfileForEntry(entry: BotSessionEntry): Promise<AgentProfileOptions | undefined> {
		// Studio/legacy bot sessions predate profiles; they keep the product
		// default. An IM binding always carries the full identity.
		if (!entry.agentProfileId || !entry.bindingId || !entry.instanceId) return undefined;
		const profile = this.#webConfig.getImAgent(entry.agentProfileId);
		if (!profile) throw new Error(`Unknown agent profile "${entry.agentProfileId}"`);
		const cwd = entry.cwd ?? this.#defaultCwd;
		const personaText = await loadImAgentProfilePersona(profile, { cwd });
		const options = resolveImAgentProfileRuntime(profile, {
			instanceId: entry.instanceId,
			profileId: entry.agentProfileId,
			bindingId: entry.bindingId,
			agentDir: getAgentDir(),
			cwd,
			...(personaText === undefined ? {} : { personaText }),
		});
		return entry.model ? { ...options, model: `${entry.model.provider}/${entry.model.model}` } : options;
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
			this.#bridgeFor(entry.id, session);
			// The registry owns the name and IM stamp; a transcript created before
			// the stamp existed is corrected here (one rewrite, then a no-op).
			await this.#syncBotSessionMetadata(entry, session);
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
		const cwd = entry.cwd ?? this.#defaultCwd;
		// `initialCwd` is what a headerless/fresh transcript records as its
		// project; without it the manager falls back to the process cwd and the
		// bot silently answers for the wrong repository.
		const manager = await SessionManager.open(entry.sessionFile, undefined, undefined, {
			initialCwd: cwd,
			// A fresh/headerless transcript records its IM origin on first write,
			// so it never appears as a personal session even before the runtime
			// sync below runs.
			origin: this.#botOrigin(entry),
		});
		const caller = this.#contextForBot(entry);
		const agentProfile = await this.agentProfileForEntry(entry);
		const { session } = await createAgentSession({
			cwd: manager.getCwd(),
			sessionManager: manager,
			...(agentProfile === undefined ? {} : { agentProfile }),
			channelSend: this.#channelSend ? opts => this.#channelSend!(opts, caller) : undefined,
			workspaceRun: this.#workspaceRun ? opts => this.#workspaceRun!(opts, caller) : undefined,
			imControl: this.#imControl ? params => this.#imControl!(entry.id, params) : undefined,
		});
		return session;
	}

	/** Tool-call context for one bot session (its project and chat). */
	#contextForBot(entry: BotSessionEntry): ChannelToolContext {
		return {
			sessionKey: entry.id,
			projectDir: entry.cwd ?? this.#defaultCwd,
			...(entry.workspaceAlias !== undefined && { workspaceAlias: entry.workspaceAlias }),
		};
	}

	/** The bot session id this chat currently uses ("" / null → relay). */
	async activeBotSessionIdFor(channelId: ChannelInstanceId, peer: string): Promise<string | null> {
		// `relay` is the explicit sentinel; a removed field is the implicit default.
		return this.#webConfig.findImBinding(channelId, peer)?.sessionId ?? null;
	}

	/** Point one chat at a bot session (clears direct workspace mode). Relay is
	 *  the implicit default: `use relay` drops the pointer back to it. */
	async setActiveBotSession(
		channelId: ChannelInstanceId,
		peer: string,
		id: string,
	): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
		if (id === "relay") {
			// Relay means the coordinator: drop the chat's row entirely so the
			// active-session pointer reads null, and pin the runtime route to relay
			// until a later switch writes a new binding.
			await this.#webConfig.removeImBindingByChat(channelId, peer);
			this.#runtimeBindings.set(`${channelId}:${peer}`, COORDINATOR_ALIAS);
			return { ok: true, id: "relay" };
		}
		const entry = this.#webConfig.getBotSession(id);
		if (!entry) return { ok: false, error: `Unknown bot session "${id}"` };
		if (entry.tag === "relay") {
			return this.setActiveBotSession(channelId, peer, "relay");
		}
		const ensured = await this.ensureBotSession(entry);
		if (!ensured.ok) return ensured;
		// The selected session owns its project: a stale workspace binding must
		// not keep routing this chat to a different repository.
		await this.#webConfig.patchImBinding(channelId, peer, {
			sessionId: id,
			...(entry.agentProfileId ? { agentProfileId: entry.agentProfileId } : {}),
			...(entry.target
				? { target: entry.target }
				: entry.workspaceAlias
					? { target: { kind: "workspace" as const, workspace: entry.workspaceAlias } }
					: {}),
		});
		this.#runtimeBindings.delete(`${channelId}:${peer}`);
		await this.#rememberBotChat(id, channelId, peer);
		const lang = (await this.languageFor(channelId, peer)) ?? entry.lang;
		if (lang) this.#applyLanguageToSession(ensured.session, lang);
		return { ok: true, id };
	}

	/** Resolve the live session a chat's messages should target (bot session or relay). */
	async resolveChatTargetSession(
		channelId: ChannelInstanceId,
		peer: string,
		context: { threadId?: string; userId?: string } = {},
	): Promise<{ ok: true; session: AgentSession; id: string } | { ok: false; error: string }> {
		// Same precedence as inbound routing: the chat's bot session or bound
		// workspace, never a silent jump to the default workspace.
		const target = await this.resolveChatTarget(channelId, peer, context);
		if (target.kind === "bot") {
			const entry = this.#webConfig.getBotSession(target.id);
			if (entry) {
				const ensured = await this.ensureBotSession(entry);
				if (ensured.ok) return { ok: true, session: ensured.session, id: target.id };
				return { ok: false, error: ensured.error };
			}
		}
		if (target.kind === "workspace") {
			const dir = this.resolveDir(target.alias);
			const handle = dir ? this.#sessions.get(dir) : undefined;
			if (handle) return { ok: true, session: handle.session, id: target.alias };
		}
		if (target.kind === "unavailable") return { ok: false, error: target.error };
		return { ok: true, session: this.#coordinator, id: "relay" };
	}

	/**
	 * Resolve the chat that invoked an `im_control` call from a sessionKey bound
	 * at hook time. "coordinator" → the relay's most recent inbound; a bot
	 * session id → the chat it is currently replying to (else its bound chat,
	 * else the relay's last inbound). Never guesses a wrong chat.
	 */
	resolveImControlChat(sessionKey: string): { channelId: ChannelInstanceId; peer: string } | null {
		if (sessionKey === "coordinator") return this.#getLastInbound();
		const reply = this.#botLastChat.get(sessionKey);
		if (reply) return { channelId: reply.channelId, peer: reply.peer };
		const entry = this.#webConfig.getBotSession(sessionKey);
		if (entry?.platform && entry.chatId)
			return { channelId: entry.platform as ChannelInstanceId, peer: entry.chatId };
		return this.#getLastInbound();
	}

	/** Drop a chat's bot-session pointer (falls back to the relay). */
	async clearActiveBotSession(channelId: ChannelInstanceId, peer: string): Promise<void> {
		await this.#webConfig.patchImBinding(channelId, peer, {
			sessionId: "relay",
			target: { kind: "workspace", workspace: COORDINATOR_ALIAS },
		});
	}

	/** Persist the chat's model so a restarted binding resumes the same model. */
	async setChatModel(
		channelId: ChannelInstanceId,
		peer: string,
		model: { provider: string; model: string },
	): Promise<void> {
		await this.#webConfig.patchImBinding(channelId, peer, { model });
		const binding = this.#webConfig.findImBinding(channelId, peer);
		const entry = binding ? this.#webConfig.getBotSession(binding.sessionId) : undefined;
		if (entry) await this.#webConfig.upsertBotSession({ ...entry, model });
	}

	/** The reply language configured for one chat ("" → unset). */
	async languageFor(
		channelId: ChannelInstanceId,
		peer: string,
		context: { threadId?: string; userId?: string } = {},
	): Promise<"zh" | "en" | undefined> {
		return this.#webConfig.findImBinding(channelId, peer, context)?.lang;
	}

	/** Set a chat's reply language and apply it to its active bot session. */
	async setLanguage(channelId: ChannelInstanceId, peer: string, lang: "zh" | "en"): Promise<void> {
		await this.#webConfig.patchImBinding(channelId, peer, { lang });
		const activeId = await this.activeBotSessionIdFor(channelId, peer);
		if (!activeId) return;
		const handle = this.#botSessions.get(activeId);
		if (!handle) return;
		handle.entry = { ...handle.entry, lang };
		await this.#webConfig.upsertBotSession(handle.entry);
		this.#applyLanguageToSession(handle.session, lang);
	}

	/**
	 * Entry-level provenance for one real IM user turn. Uses the actual binding
	 * snapshot captured at delivery, so a later switch cannot rewrite it.
	 */
	#imUserMetadata(
		channelId: ChannelInstanceId,
		peer: string,
		context: ImDeliveryContext,
		route: Record<string, string | undefined>,
		fallbackMessageId: string,
		fallbackTs: number,
	): Record<string, unknown> {
		const platform = this.#webConfig.getChannelInstance(channelId)?.platform ?? "unknown";
		return buildImUserMessageMetadata({
			platform,
			instance: channelId,
			chatId: peer,
			...(context.threadId ? { threadId: context.threadId } : {}),
			...(context.userId ? { senderId: context.userId } : {}),
			...(context.senderName ? { senderName: context.senderName } : {}),
			messageId: context.messageId ?? fallbackMessageId,
			sentAt: context.sentAt ?? fallbackTs,
			...(context.attachments ? { attachments: context.attachments } : {}),
			route: {
				workspaceAlias: route.workspaceAlias,
				agentId: route.agentId,
				sessionId: route.sessionId,
				botSessionId: route.botSessionId,
				bindingId: route.bindingId,
			},
		}) as unknown as Record<string, unknown>;
	}

	/**
	 * Deliver an inbound message into a bot session and bind the chat so the
	 * session's final reply returns to that chat. The reply is correlated by
	 * the delivered message (see {@link ReplyCorrelator}), so two chats sharing
	 * one bot session never receive each other's answer.
	 */
	async deliverToBotSession(
		id: string,
		channelId: ChannelInstanceId,
		peer: string,
		body: string,
		context: ImDeliveryContext = {},
	): Promise<{ ok: true } | { ok: false; error: string }> {
		let handle = this.#botSessions.get(id);
		if (!handle) {
			const entry = this.#webConfig.getBotSession(id);
			if (!entry) return { ok: false, error: `Bot session "${id}" is not registered` };
			const ensured = await this.ensureBotSession(entry);
			if (!ensured.ok) return ensured;
			handle = this.#botSessions.get(id);
			if (!handle) return { ok: false, error: `Bot session "${id}" did not start` };
		}
		const binding = this.#webConfig.findImBinding(channelId, peer, context);
		const lang = (await this.languageFor(channelId, peer, context)) ?? handle.entry.lang;
		if (lang) this.#applyLanguageToSession(handle.session, lang);
		this.#botLastChat.set(id, { channelId, peer });
		await this.#rememberBotChat(id, channelId, peer);
		const bridge = this.#bridgeFor(id, handle.session);
		const messageId = Snowflake.next();
		const target = binding?.target ?? handle.entry.target;
		const msg: IrcMessage = {
			id: messageId,
			from: this.#coordinator.getAgentId() ?? "coordinator",
			to: handle.session.getAgentId() ?? id,
			body,
			ts: Date.now(),
			metadata: this.#imUserMetadata(
				channelId,
				peer,
				context,
				{
					...(target?.kind === "workspace" ? { workspaceAlias: target.workspace } : {}),
					agentId: binding?.agentProfileId ?? handle.entry.agentProfileId,
					sessionId: binding?.sessionId,
					botSessionId: binding?.sessionId,
					bindingId: binding?.id,
				},
				messageId,
				Date.now(),
			),
		};
		// `observe` consumes the conversation for memory/context but never sends:
		// its turn is correlated to a sink that drops the reply.
		bridge.expect(
			msg.id,
			binding?.role === "observe"
				? { kind: "sink", deliver: () => {} }
				: {
						kind: "chat",
						instanceId: channelId,
						peer,
						originLabel: binding
							? `${targetKey(binding.target)} · ${binding.agentProfileId}`
							: handle.entry.target
								? `${targetKey(handle.entry.target)} · ${handle.entry.agentProfileId ?? "default"}`
								: undefined,
						...(context.threadId || context.userId
							? {
									context: {
										...(context.threadId ? { threadId: context.threadId } : {}),
										...(context.userId ? { userId: context.userId } : {}),
									},
								}
							: {}),
					},
		);
		try {
			await handle.session.deliverIrcMessage(msg);
		} catch (error) {
			// Forget exactly this delivery; older pending replies from other
			// chats keep their own correlation.
			bridge.forget(msg.id);
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
		// Correlated: only a turn that answers a delivered message replies to a
		// chat; a Studio/attach turn on the same session consumes nothing.
		this.#bridges.get(id)?.onTurnText(assistantText(event.message));
	}

	/**
	 * Inject an inbound message directly into a bound workspace session and
	 * bind the chat so the session's final reply returns to that chat.
	 * `workspace` is the mapping alias.
	 */
	async deliverDirect(
		workspaceAlias: string,
		channelId: ChannelInstanceId,
		peer: string,
		body: string,
		context: ImDeliveryContext = {},
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
		const bridge = this.#bridgeFor(dir, handle.session);
		const messageId = Snowflake.next();
		const msg: IrcMessage = {
			id: messageId,
			from: this.#coordinator.getAgentId() ?? "coordinator",
			to: handle.session.getAgentId() ?? "workspace",
			body,
			ts: Date.now(),
			metadata: this.#imUserMetadata(channelId, peer, context, { workspaceAlias }, messageId, Date.now()),
		};
		bridge.expect(msg.id, { kind: "chat", instanceId: channelId, peer });
		try {
			await handle.session.deliverIrcMessage(msg);
		} catch (error) {
			bridge.forget(msg.id);
			const detail = error instanceof Error ? error.message : String(error);
			return { ok: false, error: `Direct delivery to "${workspaceAlias}" failed: ${detail}` };
		}
		return { ok: true };
	}

	/**
	 * Deliver a subtask to a workspace session and wait for its final reply.
	 * `workspace` is an absolute path, a registered alias, or the coordinator.
	 *
	 * The delegation's start and outcome are reports to the IM user, forwarded
	 * according to `channels.reportPolicy` (see {@link reportDelegation}); the
	 * reply is still returned to the coordinator as the tool result.
	 */
	async run(workspace: string, task: string, caller?: ChannelToolContext): Promise<{ reply: string }> {
		// Coordinating alias: delegate to the coordinator itself.
		if (workspace === COORDINATOR_ALIAS) {
			return { reply: `workspace_run: "${COORDINATOR_ALIAS}" is the coordinator; it already has this message.` };
		}
		// Only registered workspaces are valid targets: an arbitrary absolute
		// path must never open a directory nobody explicitly bound.
		const resolved = this.resolveWorkspace(workspace);
		if (!resolved) return { reply: `workspace_run: unknown workspace "${workspace}"` };
		const dir = resolved.dir;
		const alias = this.#aliasForDir(dir) ?? resolved.alias;
		if (alias === undefined && !samePath(dir, caller?.projectDir)) {
			return { reply: `workspace_run: workspace "${workspace}" is not registered; run @workspace open first` };
		}
		// A session explicitly bound to a project may only reach that project.
		// The relay coordinator — and a project-less default-space session —
		// keeps the documented cross-repo delegation role.
		const callerProjectBound = caller !== undefined && !caller.relay && caller.workspaceAlias !== undefined;
		if (caller && callerProjectBound && caller.projectDir && !samePath(caller.projectDir, dir)) {
			return {
				reply: `workspace_run: cross-project access denied: this session is bound to ${caller.projectDir}`,
			};
		}
		let handle = this.#sessions.get(dir);
		if (!handle && alias !== undefined) {
			const opened = await this.open(dir, alias);
			if (!opened.ok) return { reply: `workspace_run: ${opened.error}` };
			handle = this.#sessions.get(dir);
		}
		if (!handle) {
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

		// The delegation reports to the chat that invoked the tool through this
		// session; a CLI/web-ui delegation has none and is never pushed anywhere.
		const chat = this.#chatForContext(caller) ?? this.#getLastInbound();
		await this.#forwardReport(chat, "progress", `[${path.basename(dir)}] delegated: ${task}`);

		const msg: IrcMessage = {
			id: Snowflake.next(),
			from: coordinatorId,
			to: agentId,
			body: task,
			ts: Date.now(),
		};

		let timedOut = false;
		const { promise, resolve } = Promise.withResolvers<string>();
		const bridge = this.#bridgeFor(dir, handle.session);
		const run: ActiveRun = {
			resolve,
			timer: setTimeout(() => {
				if (this.#activeRun !== run) return;
				this.#activeRun = null;
				timedOut = true;
				bridge.forget(msg.id);
				resolve(`[${path.basename(dir)}] (no reply within ${RUN_TIMEOUT_MS / 60_000} minutes)`);
			}, RUN_TIMEOUT_MS),
		};
		this.#activeRun = run;
		// The delegation's own wake turn answers this message; only that turn may
		// resolve the run (a chat message delivered to the same workspace has its
		// own correlation and must not be mistaken for the subtask result).
		bridge.expect(msg.id, {
			kind: "sink",
			allowEmpty: true,
			deliver: text => {
				if (this.#activeRun !== run) return;
				this.#activeRun = null;
				clearTimeout(run.timer);
				resolve(text || "(no text reply)");
			},
		});

		try {
			await handle.session.deliverIrcMessage(msg);
		} catch (error) {
			clearTimeout(run.timer);
			if (this.#activeRun === run) this.#activeRun = null;
			bridge.forget(msg.id);
			const detail = error instanceof Error ? error.message : String(error);
			const reply = `workspace_run: delegation to "${workspace}" failed: ${detail}`;
			await this.#forwardReport(chat, "failure", reply);
			return { reply };
		}

		const text = await promise;
		const reply = `[${path.basename(dir)}] ${text}`;
		await this.#forwardReport(chat, timedOut ? "failure" : "completion", reply);
		return { reply };
	}

	/**
	 * Resolve `channel_send` opts to a concrete channel + peer. A bot session
	 * defaults to the chat it is answering; the relay uses the most recent
	 * inbound. Callers that name a target must stay inside the peer allowlist
	 * (checked by {@link push}).
	 */
	resolvePush(
		opts: { to?: string; channel?: string },
		caller?: ChannelToolContext,
	): { channelId: ChannelInstanceId; to: string } | null {
		const inbound = this.#getLastInbound();
		const scoped = this.#chatForContext(caller);
		const channelId =
			(opts.channel as ChannelInstanceId | undefined) ?? scoped?.channelId ?? inbound?.channelId ?? null;
		const to =
			opts.to ??
			(channelId !== null && scoped?.channelId === channelId ? scoped.peer : undefined) ??
			(channelId !== null && inbound?.channelId === channelId ? inbound.peer : undefined) ??
			null;
		if (!channelId || !to) return null;
		return { channelId, to };
	}

	/**
	 * Push text through the channel runtime (channel_send tool sink). Outbound
	 * targets are checked against the target instance's peer allowlist: an
	 * agent cannot use the tool to message a peer the operator never authorized.
	 */
	async push(opts: { text: string; to?: string; channel?: string }, caller?: ChannelToolContext): Promise<void> {
		const target = this.resolvePush(opts, caller);
		if (!target) throw new Error("No channel or peer bound to this session");
		const instance = this.#webConfig.getChannelInstance(target.channelId);
		if (!instance || !instance.allow.peers.includes(target.to)) {
			throw new Error(`channel_send: peer "${target.to}" is not in the ${target.channelId} instance allowlist`);
		}
		await this.#sendText(target.channelId, target.to, opts.text);
	}

	/** The chat that invoked a channel tool through `caller`'s session. */
	#chatForContext(caller?: ChannelToolContext): { channelId: ChannelInstanceId; peer: string } | null {
		if (!caller) return null;
		if (caller.sessionKey === "coordinator") return this.#getLastInbound();
		const last = this.#botLastChat.get(caller.sessionKey);
		if (last) return { channelId: last.channelId, peer: last.peer };
		const entry = this.#webConfig.getBotSession(caller.sessionKey);
		if (entry?.platform && entry.chatId)
			return { channelId: entry.platform as ChannelInstanceId, peer: entry.chatId };
		return null;
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
		this.#pendingReports.clear();
		for (const [id, handle] of [...this.#botSessions.entries()]) {
			handle.unsubscribe();
			this.#detachBridge(id, handle.session);
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
		this.#botLastChat.clear();
		this.#bridges.clear();
		this.#observedBridges.clear();
	}

	async #closeDir(dir: string): Promise<void> {
		const handle = this.#sessions.get(dir);
		if (!handle) return;
		handle.unsubscribe();
		this.#sessions.delete(dir);
		this.#detachBridge(dir, handle.session);
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
		// Correlated per delivered message: the delegation sink and the chat
		// reply are both keyed by the record the wake turn answers, so two chats
		// on one workspace never swap answers and a Studio/attach turn on the
		// same session consumes no IM reply slot.
		this.#bridges.get(dir)?.onTurnText(assistantText(event.message));
	}
}
