/**
 * WebConfig — standalone configuration for the Zeta web/desktop layer
 * (`~/.zeta/agent/web.yml`).
 *
 * Deliberately independent from the CLI `Settings` singleton: this file holds
 * tray/autostart behavior, IM channel credentials, and remote-access state
 * that only the web/desktop runtime consumes. `zeta serve` and the desktop
 * shell read and write it; CLI-only sessions never touch it. Not shipped in
 * the npm package.
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir, isEnoent, logger } from "@linxiraos/pi-utils";
import { YAML } from "bun";

export const WEB_CONFIG_FILENAME = "web.yml";

export interface WebConfigChannelBase {
	enabled: boolean;
	/** Default workspace root (absolute path) for messages on this channel. */
	workspaceRoot?: string;
}

export interface WeChatChannelConfig extends WebConfigChannelBase {
	botToken?: string;
	ilinkBotId?: string;
	ilinkUserId?: string;
	baseUrl?: string;
	/** New `/api/v1/wechat` API host (defaults to the shared ilink host). */
	endpoint?: string;
	/** Persisted peer → context_token map so bindings survive restarts. */
	peerTokens?: Record<string, string>;
}

export interface FeishuChannelConfig extends WebConfigChannelBase {
	appId?: string;
	appSecret?: string;
	domain?: "feishu" | "lark";
}

export interface TelegramChannelConfig extends WebConfigChannelBase {
	botToken?: string;
}

/** A registered remote workspace with a user-facing alias. */
export interface RemoteWorkspace {
	/** Unique alias used in IM commands (`@workspace use <alias>`, `*<alias>`). */
	alias: string;
	/** Absolute directory of the workspace session. */
	path: string;
}

/** Per-chat binding: route one remote chat directly to a workspace. */
export interface SessionMapping {
	platform: "wechat" | "feishu" | "telegram";
	/** Optional connection id (separates multiple bots on one platform). */
	connectionId?: string;
	/** Optional chat type (dm | group | …). Empty matches any. */
	chatType?: string;
	chatId: string;
	/** Optional user id; empty matches any user in the chat. */
	userId?: string;
	/** The workspace alias this chat is bound to. */
	workspaceAlias: string;
	/** "direct" = talk to the bound workspace directly; "relay" = go through the coordinator. */
	mode?: "direct" | "relay";
	/** Default-space bot session this chat is currently using (see `remote.botSessions`). */
	sessionId?: string;
	/** Reply language for this chat (`!lang zh|en`). */
	lang?: "zh" | "en";
}

/**
 * A default-space (non-workspace) bot session registered in the remote
 * registry. One entry per session; the `relay` entry is the coordinator's
 * default relay session and can never be deleted.
 */
export interface BotSessionEntry {
	/** Stable id (`relay` or a short random id). */
	id: string;
	/** Display name (default "Zeta Bot (Relay)"). */
	name: string;
	/** relay = default relay session; bot = chat-bound session; draft = scratch session. */
	tag: "relay" | "bot" | "draft";
	/** Absolute path of the session transcript (`~/.zeta/agent/sessions/<cwd>/<name>-<id>.jsonl`). */
	sessionFile: string;
	/** Bound channel chat id (bot sessions only). */
	chatId?: string;
	/** Bound platform (bot sessions only). */
	platform?: string;
	/** Reply language for this session (`!lang`). */
	lang?: "zh" | "en";
	createdAt: string;
}

export interface WebConfigData {
	/**
	 * Which UI bundle the serve process hosts at the web root:
	 * "web" = legacy Next.js web-ui, "next" = web-ui-next (Vite). The other
	 * bundle stays available under its own prefix (/next for web-ui-next).
	 */
	uiVersion?: "web" | "next";
	tray: {
		minimizeToTray: boolean;
		autostart: boolean;
	};
	channels: {
		wechat: WeChatChannelConfig;
		feishu: FeishuChannelConfig;
		telegram: TelegramChannelConfig;
		/** Optional allowlist of peers (channel-agnostic ids) allowed to talk to
		 *  the agent; empty = everyone (default, unchanged behavior). */
		allowedPeers?: string[];
	};
	remote: {
		host?: string;
		token?: string;
		/** Registered remote workspaces — legacy entries are bare paths,
		 *  current entries are `{ alias, path }` objects. */
		workspaces?: Array<string | RemoteWorkspace>;
		/** Persistent per-chat → workspace bindings. */
		sessionMappings?: SessionMapping[];
		/** Default-space bot session registry (see `BotSessionEntry`). */
		botSessions?: BotSessionEntry[];
		/** Show relay/bot sessions in the web-ui sidebar (default false = hidden). */
		showBotSessions?: boolean;
	};
}

const DEFAULT_DATA: WebConfigData = {
	tray: { minimizeToTray: true, autostart: false },
	channels: {
		wechat: { enabled: false },
		feishu: { enabled: false },
		telegram: { enabled: false },
	},
	remote: {},
};

/** Paths that must never be revealed through the gateway; masked as "••••". */
const SECRET_PATHS: Record<string, true> = {
	"channels.wechat.botToken": true,
	"channels.wechat.peerTokens": true,
	"channels.feishu.appSecret": true,
	"channels.telegram.botToken": true,
	"remote.token": true,
};

type LeafType = "boolean" | "string" | "domain" | "strings" | "record";

/** Known dot paths → expected leaf type (for PUT validation). */
const KNOWN_PATHS: Record<string, LeafType> = {
	uiVersion: "string",
	"tray.minimizeToTray": "boolean",
	"tray.autostart": "boolean",
	"channels.wechat.enabled": "boolean",
	"channels.wechat.workspaceRoot": "string",
	"channels.wechat.botToken": "string",
	"channels.wechat.ilinkBotId": "string",
	"channels.wechat.ilinkUserId": "string",
	"channels.wechat.baseUrl": "string",
	"channels.wechat.endpoint": "string",
	"channels.wechat.peerTokens": "record",
	"channels.allowedPeers": "strings",
	"channels.feishu.enabled": "boolean",
	"channels.feishu.workspaceRoot": "string",
	"channels.feishu.appId": "string",
	"channels.feishu.appSecret": "string",
	"channels.feishu.domain": "domain",
	"channels.telegram.enabled": "boolean",
	"channels.telegram.workspaceRoot": "string",
	"channels.telegram.botToken": "string",
	"remote.host": "string",
	"remote.token": "string",
	"remote.workspaces": "strings",
	"remote.showBotSessions": "boolean",
};

export function isKnownWebConfigPath(value: unknown): value is string {
	return typeof value === "string" && value in KNOWN_PATHS;
}

function validateValue(leafType: LeafType, value: unknown): void {
	switch (leafType) {
		case "boolean":
			if (typeof value !== "boolean") throw new Error("Expected a boolean value");
			return;
		case "string":
			if (typeof value !== "string") throw new Error("Expected a string value");
			return;
		case "domain":
			if (value !== "feishu" && value !== "lark") throw new Error('Expected "feishu" or "lark"');
			return;
		case "strings":
			if (!Array.isArray(value) || value.some(item => typeof item !== "string")) {
				throw new Error("Expected an array of strings");
			}
			return;
		case "record":
			if (
				typeof value !== "object" ||
				value === null ||
				Array.isArray(value) ||
				Object.values(value).some(item => typeof item !== "string")
			) {
				throw new Error("Expected a record of strings");
			}
			return;
	}
}

function setByPath(obj: Record<string, unknown>, segments: readonly string[], value: unknown): void {
	let current: Record<string, unknown> = obj;
	for (let i = 0; i < segments.length - 1; i++) {
		const segment = segments[i];
		const next = current[segment];
		if (typeof next !== "object" || next === null || Array.isArray(next)) {
			current[segment] = {};
		}
		current = current[segment] as Record<string, unknown>;
	}
	current[segments[segments.length - 1]] = value;
}

function deepMerge(base: WebConfigData, overlay: unknown): WebConfigData {
	if (typeof overlay !== "object" || overlay === null || Array.isArray(overlay)) return base;
	const result = structuredClone(base);
	const source = overlay as Record<string, unknown>;
	for (const [key, value] of Object.entries(source)) {
		if (value === undefined) continue;
		const target = (result as unknown as Record<string, unknown>)[key];
		if (
			typeof target === "object" &&
			target !== null &&
			typeof value === "object" &&
			value !== null &&
			!Array.isArray(value)
		) {
			(result as unknown as Record<string, unknown>)[key] = deepMerge(target as unknown as WebConfigData, value);
		} else {
			(result as unknown as Record<string, unknown>)[key] = value;
		}
	}
	return result;
}

/**
 * Loads and persists `~/.zeta/agent/web.yml`. A fresh instance per request —
 * like `Settings.loadIsolated` — so concurrent gateway callers never share a
 * stale in-memory copy.
 */
export class WebConfig {
	readonly #filePath: string;
	#data: WebConfigData;

	private constructor(filePath: string, data: WebConfigData) {
		this.#filePath = filePath;
		this.#data = data;
	}

	/** Default file location: `~/.zeta/agent/web.yml`. */
	static defaultPath(): string {
		return path.join(getAgentDir(), WEB_CONFIG_FILENAME);
	}

	/** Load from disk, deep-merging defaults; a missing/corrupt file falls back to defaults. */
	static async load(filePath = WebConfig.defaultPath()): Promise<WebConfig> {
		let raw: unknown = {};
		try {
			const content = await Bun.file(filePath).text();
			const parsed = YAML.parse(content) as unknown;
			if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
				raw = parsed;
			} else {
				logger.warn("Ignoring non-object web.yml", { filePath });
			}
		} catch (err) {
			if (!isEnoent(err)) {
				logger.warn("Failed to read web.yml; using defaults", {
					filePath,
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}
		return new WebConfig(filePath, deepMerge(DEFAULT_DATA, raw));
	}

	get path(): string {
		return this.#filePath;
	}

	/** Deep copy of the merged data (safe for callers that mutate the result). */
	getData(): WebConfigData {
		return structuredClone(this.#data);
	}

	/** Merged data with every secret path masked. */
	getMasked(): WebConfigData {
		const masked = this.getData();
		for (const secretPath of Object.keys(SECRET_PATHS)) {
			const segments = secretPath.split(".");
			let current: Record<string, unknown> = masked as unknown as Record<string, unknown>;
			let reached = true;
			for (let i = 0; i < segments.length - 1; i++) {
				const segment = segments[i];
				if (typeof current[segment] !== "object" || current[segment] === null) {
					reached = false;
					break;
				}
				current = current[segment] as Record<string, unknown>;
			}
			if (reached) {
				const leaf = segments[segments.length - 1];
				const value = current[leaf];
				if (typeof value === "string" && value !== "") {
					current[leaf] = "••••";
				} else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
					// Record leaves (e.g. wechat peerTokens) mask every value.
					for (const key of Object.keys(value as Record<string, unknown>)) {
						if (typeof (value as Record<string, unknown>)[key] === "string") {
							(value as Record<string, unknown>)[key] = "••••";
						}
					}
				}
			}
		}
		return masked;
	}

	/** Set one known dot path (e.g. `channels.wechat.enabled`) and persist. */
	async set(pathToSet: string, value: unknown): Promise<void> {
		const leafType = KNOWN_PATHS[pathToSet];
		if (leafType === undefined) throw new Error(`Unknown web config path: ${pathToSet}`);
		validateValue(leafType, value);
		setByPath(this.#data as unknown as Record<string, unknown>, pathToSet.split("."), value);
		await this.#write();
	}

	/** Replace the whole workspace list and persist. */
	async setWorkspaces(workspaces: string[]): Promise<void> {
		if (workspaces.some(item => typeof item !== "string")) throw new Error("Expected an array of strings");
		this.#data.remote.workspaces = [...workspaces];
		await this.#write();
	}

	/** Normalized workspace entries (legacy bare-path entries get alias = basename). */
	getWorkspaces(): RemoteWorkspace[] {
		const entries = this.#data.remote.workspaces ?? [];
		return entries.map(entry => {
			if (typeof entry === "string") {
				return { alias: path.basename(entry), path: entry };
			}
			return { alias: entry.alias, path: entry.path };
		});
	}

	/** Resolve an alias or absolute path to a workspace entry. */
	findWorkspace(aliasOrPath: string): RemoteWorkspace | undefined {
		const entries = this.getWorkspaces();
		if (path.isAbsolute(aliasOrPath)) {
			return entries.find(entry => entry.path === aliasOrPath);
		}
		return entries.find(entry => entry.alias === aliasOrPath);
	}

	/** Register (or update) a workspace entry and persist. Returns the alias. */
	async setWorkspaceEntry(
		alias: string,
		dir: string,
	): Promise<{ ok: true; alias: string } | { ok: false; error: string }> {
		const cleanAlias = alias.trim();
		if (!cleanAlias) return { ok: false, error: "Workspace alias must not be empty" };
		if (cleanAlias === "main") return { ok: false, error: '"main" is the reserved alias of the relay coordinator' };
		if (!path.isAbsolute(dir)) return { ok: false, error: "Workspace path must be absolute" };
		const entries = this.getWorkspaces();
		const existing = entries.find(entry => entry.alias === cleanAlias);
		if (existing && existing.path !== dir) {
			return { ok: false, error: `Alias "${cleanAlias}" is already bound to ${existing.path}` };
		}
		const next = entries.filter(entry => entry.alias !== cleanAlias);
		next.push({ alias: cleanAlias, path: dir });
		this.#data.remote.workspaces = next;
		await this.#write();
		return { ok: true, alias: cleanAlias };
	}

	/** Remove a workspace entry by alias and persist. */
	async removeWorkspaceEntry(alias: string): Promise<boolean> {
		const entries = this.getWorkspaces();
		const next = entries.filter(entry => entry.alias !== alias);
		if (next.length === entries.length) return false;
		this.#data.remote.workspaces = next;
		await this.#write();
		return true;
	}

	/** Persisted per-chat session mappings. */
	getSessionMappings(): SessionMapping[] {
		return this.#data.remote.sessionMappings ?? [];
	}

	/** Find the binding for one remote chat; most specific match wins. */
	findSessionMapping(
		platform: SessionMapping["platform"],
		chatId: string,
		opts: { userId?: string; chatType?: string; connectionId?: string } = {},
	): SessionMapping | undefined {
		const candidates = this.getSessionMappings().filter(
			mapping => mapping.platform === platform && mapping.chatId === chatId,
		);
		if (candidates.length === 0) return undefined;
		const withUser = candidates.find(
			mapping =>
				mapping.userId !== undefined &&
				mapping.userId !== "" &&
				mapping.userId === opts.userId &&
				(!mapping.connectionId || mapping.connectionId === opts.connectionId),
		);
		if (withUser) return withUser;
		const withConn = candidates.find(
			mapping => !mapping.userId && (!mapping.connectionId || mapping.connectionId === opts.connectionId),
		);
		return withConn ?? candidates[0];
	}

	/** Add or replace one session mapping and persist. */
	async setSessionMapping(mapping: SessionMapping): Promise<void> {
		const entries = this.getSessionMappings();
		const next = entries.filter(
			entry =>
				!(
					entry.platform === mapping.platform &&
					entry.chatId === mapping.chatId &&
					entry.userId === mapping.userId
				),
		);
		next.push(mapping);
		this.#data.remote.sessionMappings = next;
		await this.#write();
	}

	/** Remove a session mapping and persist. */
	async removeSessionMapping(platform: SessionMapping["platform"], chatId: string, userId?: string): Promise<boolean> {
		const entries = this.getSessionMappings();
		const next = entries.filter(
			entry => !(entry.platform === platform && entry.chatId === chatId && entry.userId === userId),
		);
		if (next.length === entries.length) return false;
		this.#data.remote.sessionMappings = next;
		await this.#write();
		return true;
	}

	/**
	 * Merge fields into a chat's session mapping, creating a chat-level mapping
	 * (no user id) when none exists. `null` deletes a field, `undefined` leaves
	 * it untouched. Used by `!session use` / `!lang` and the workspace router.
	 */
	async updateChatMapping(
		platform: SessionMapping["platform"],
		chatId: string,
		patch: { sessionId?: string | null; lang?: "zh" | "en" | null; workspaceAlias?: string | null },
	): Promise<void> {
		const entries = this.getSessionMappings();
		const existing = entries.find(
			entry => entry.platform === platform && entry.chatId === chatId && entry.userId === undefined,
		);
		const next = entries.filter(
			entry => !(entry.platform === platform && entry.chatId === chatId && entry.userId === undefined),
		);
		const merged = { ...(existing ?? { platform, chatId }) };
		for (const [key, value] of Object.entries(patch)) {
			if (value === undefined) continue;
			if (value === null) {
				delete (merged as Record<string, unknown>)[key];
			} else {
				(merged as Record<string, unknown>)[key] = value;
			}
		}
		next.push(merged as SessionMapping);
		this.#data.remote.sessionMappings = next;
		await this.#write();
	}

	/** Registered default-space bot sessions. */
	getBotSessions(): BotSessionEntry[] {
		return this.#data.remote.botSessions ?? [];
	}

	/** One registered bot session by id. */
	getBotSession(id: string): BotSessionEntry | undefined {
		return this.getBotSessions().find(entry => entry.id === id);
	}

	/** Register (or replace) one bot session entry and persist. */
	async upsertBotSession(entry: BotSessionEntry): Promise<void> {
		const next = this.getBotSessions().filter(existing => existing.id !== entry.id);
		next.push(entry);
		this.#data.remote.botSessions = next;
		await this.#write();
	}

	/** Remove a bot session entry and persist. Returns false when absent. */
	async removeBotSession(id: string): Promise<boolean> {
		const next = this.getBotSessions().filter(entry => entry.id !== id);
		if (next.length === this.getBotSessions().length) return false;
		this.#data.remote.botSessions = next;
		await this.#write();
		return true;
	}

	/** Whether the web-ui sidebar shows relay/bot sessions. */
	getShowBotSessions(): boolean {
		return this.#data.remote.showBotSessions === true;
	}

	/** Drop every chat's `sessionId` pointer to a deleted bot session. */
	async clearChatSessionReferences(sessionId: string): Promise<void> {
		const entries = this.getSessionMappings();
		const referenced = entries.filter(entry => entry.sessionId === sessionId);
		if (referenced.length === 0) return;
		this.#data.remote.sessionMappings = entries.map(entry => {
			if (entry.sessionId !== sessionId) return entry;
			const { sessionId: _drop, ...rest } = entry;
			return rest;
		});
		await this.#write();
	}

	/** Re-read the file from disk, discarding in-memory changes. */
	async reload(): Promise<void> {
		const fresh = await WebConfig.load(this.#filePath);
		this.#data = fresh.#data;
	}

	async #write(): Promise<void> {
		const dir = path.dirname(this.#filePath);
		await fs.promises.mkdir(dir, { recursive: true });
		const tempPath = `${this.#filePath}.${process.pid}.${randomUUID()}.tmp`;
		let removeTemp = false;
		try {
			const handle = await fs.promises.open(tempPath, "wx", 0o600);
			removeTemp = true;
			try {
				await handle.writeFile(YAML.stringify(this.#data, null, 2), "utf8");
				await handle.sync();
			} finally {
				await handle.close();
			}
			await fs.promises.rename(tempPath, this.#filePath);
			removeTemp = false;
		} finally {
			if (removeTemp) {
				await fs.promises.rm(tempPath, { force: true }).catch(() => {});
			}
		}
	}
}
