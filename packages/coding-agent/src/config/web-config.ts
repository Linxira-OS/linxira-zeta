/**
 * WebConfig — standalone configuration for the Zeta web/desktop layer
 * (`~/.zeta/agent/web.yml`).
 *
 * Deliberately independent from the CLI `Settings` singleton: this file holds
 * tray/autostart behavior, IM channel credentials, and remote-access state
 * that only the web/desktop runtime consumes. `zetacode serve` and the desktop
 * shell read and write it; CLI-only sessions never touch it. Not shipped in
 * the npm package.
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir, isEnoent, logger, resolveYamlConfigReadPath } from "@linxiraos/pi-utils";
import { YAML } from "bun";
import { generateRemoteToken, hashRemoteToken, MASKED_TOKEN } from "../utils/remote-token";
import { withFileLock } from "./file-lock";

export const WEB_CONFIG_FILENAME = "web.yml";

import {
	ImConfigError,
	bindingKey,
	isPersistableKeyText,
	type ChannelInstanceConfig,
	type ImAgentProfile,
	type ImBinding,
	validateChannelInstances,
	validateImAgentProfiles,
	validateImBindings,
} from "../channels/im-config";

export type {
	ChannelInstanceConfig,
	ChannelPlatform,
	ImAgentProfile,
	ImBinding,
	ImTarget,
} from "../channels/im-config";

/** A registered remote workspace with a user-facing alias. */
export interface RemoteWorkspace {
	/** Unique alias used in IM commands (`@workspace use <alias>`, `*<alias>`). */
	alias: string;
	/** Absolute directory of the workspace session. */
	path: string;
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
	/**
	 * Absolute project directory this session is bound to. Present on every
	 * session created after project routing; absent only on legacy entries
	 * (and the relay entry, which lives in the default workspace).
	 */
	cwd?: string;
	/**
	 * Workspace alias of the bound project (`main` is the default workspace).
	 * The bot/PM routes by this project, never by the global default.
	 */
	workspaceAlias?: string;
	/** Bound channel chat id (bot sessions only). */
	chatId?: string;
	/** Bound platform (bot sessions only). */
	platform?: string;
	/** Reply language for this session (`!lang`). */
	lang?: "zh" | "en";
	/** IM instance that owns this binding (new model). */
	instanceId?: string;
	/** Binding row id (new model). */
	bindingId?: string;
	/** Agent profile id (new model). */
	agentProfileId?: string;
	/** Resolved target snapshot (new model). */
	target?: import("../channels/im-config").ImTarget;
	/** Binding-level model override (new model). */
	model?: { provider: string; model: string };
	createdAt: string;
}

/**
 * Built-in TLS listener for `zetacode serve`. Paths point at a PEM certificate
 * chain and its private key; `enabled` forces TLS even when a reverse proxy
 * would otherwise terminate it (and refuses to start without both paths).
 */
export interface RemoteTlsConfig {
	enabled?: boolean;
	cert?: string;
	key?: string;
}

export interface WebConfigData {
	tray: {
		minimizeToTray: boolean;
		autostart: boolean;
	};
	channels: {
		/** One entry per platform account; instance id is the runtime namespace. */
		instances: ChannelInstanceConfig[];
	};
	/** Agent profiles referenced by instances and bindings. */
	imAgents: ImAgentProfile[];
	remote: {
		host?: string;
		token?: string;
		/** Public base URL a phone can reach (reverse proxy / tunnel / LAN
		 *  origin). Used as the pairing QR base; never used for binding. */
		publicUrl?: string;
		/** Opt-in to a plaintext listener on a non-loopback bind. Without it,
		 *  serve refuses to expose HTTP beyond loopback. */
		allowPlainHttp?: boolean;
		/** Built-in TLS listener (PEM cert + key paths). */
		tls?: RemoteTlsConfig;
		/** SHA-256 hashes of tokens that were rotated away or explicitly
		 *  revoked. Hashes, never the secrets themselves. */
		revokedTokens?: string[];
		/** ISO timestamp of the last rotation/revocation (informational). */
		tokenUpdatedAt?: string;
		/** Registered remote workspaces — legacy entries are bare paths,
		 *  current entries are `{ alias, path }` objects. */
		workspaces?: Array<string | RemoteWorkspace>;
		/** Persistent per-instance/chat → agent-profile bindings. */
		imBindings?: ImBinding[];
		/** Default-space bot session registry (see `BotSessionEntry`). */
		botSessions?: BotSessionEntry[];
		/** Legacy pre-instance-schema chat rows, kept only so the delete cleanup
		 *  can read/write a not-yet-migrated file; the loader migrates them. */
		sessionMappings?: Array<{ chatId?: string; instanceId?: string; sessionId?: string }>;
		/** Show relay/bot sessions in the web-ui sidebar (default false = hidden). */
		showBotSessions?: boolean;
	};
}

const DEFAULT_DATA: WebConfigData = {
	tray: { minimizeToTray: true, autostart: false },
	channels: { instances: [] },
	imAgents: [],
	remote: {},
};

/** Paths that must never be revealed through the gateway; masked as "••••". */
const SECRET_PATHS: Record<string, true> = {
	"remote.token": true,
};

type LeafType = "boolean" | "string" | "number" | "domain" | "mode" | "strings" | "record" | "workspaces";

/** Known dot paths → expected leaf type (for PUT validation). */
const KNOWN_PATHS: Record<string, LeafType> = {
	"tray.minimizeToTray": "boolean",
	"tray.autostart": "boolean",
	"remote.host": "string",
	"remote.token": "string",
	"remote.publicUrl": "string",
	"remote.allowPlainHttp": "boolean",
	"remote.tls.enabled": "boolean",
	"remote.tls.cert": "string",
	"remote.tls.key": "string",
	"remote.workspaces": "workspaces",
	"remote.showBotSessions": "boolean",
};

export function isKnownWebConfigPath(value: unknown): value is string {
	return typeof value === "string" && value in KNOWN_PATHS;
}

/**
 * Case- and separator-insensitive transcript path key (Windows paths compare
 * case-insensitively), mirroring the gateway's `sessionPathKey` semantics
 * without importing the gateway graph.
 */
function botSessionPathKey(filePath: string): string {
	const normalized = path.normalize(filePath);
	return process.platform === "win32" ? normalized.toLowerCase() : normalized;
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
		case "number":
			if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 65_535) {
				throw new Error("Expected an integer between 1 and 65535");
			}
			return;
		case "mode":
			if (value !== "forward" && value !== "reverse") throw new Error('Expected "forward" or "reverse"');
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
		case "workspaces":
			validateWorkspaces(value);
			return;
	}
}

/** Non-empty strings with no surrounding whitespace surprises. */
function requiredText(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed === "" ? null : trimmed;
}

/**
 * `remote.workspaces`: the alias registry the IM router reads. Accepts the
 * legacy bare-path form (`["/dir"]`) and the current `{alias, path}` form, so a
 * write from a GUI does not have to know which one the file already held.
 *
 * The alias rules mirror {@link WebConfig.setWorkspaceEntry}: non-empty, not
 * the reserved `main`, and an absolute directory.
 */
function validateWorkspaces(value: unknown): void {
	if (!Array.isArray(value)) throw new Error("Expected an array of workspaces");
	const aliases = new Set<string>();
	for (const entry of value) {
		if (typeof entry === "string") {
			if (!path.isAbsolute(entry)) throw new Error("Workspace paths must be absolute");
			continue;
		}
		if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
			throw new Error("Expected a workspace path or an {alias, path} object");
		}
		const record = entry as Record<string, unknown>;
		const alias = requiredText(record.alias);
		const dir = requiredText(record.path);
		if (!alias || !dir) throw new Error("Each workspace needs a non-empty alias and path");
		if (alias === "main") throw new Error('"main" is the reserved alias of the relay coordinator');
		if (!path.isAbsolute(dir)) throw new Error("Workspace paths must be absolute");
		if (aliases.has(alias)) throw new Error(`Duplicate workspace alias: ${alias}`);
		aliases.add(alias);
	}
}

/** The live remote token in a data snapshot, or `undefined` when none is configured. */
function liveRemoteToken(data: WebConfigData): string | undefined {
	const token = data.remote.token?.trim();
	return token && token !== MASKED_TOKEN ? token : undefined;
}

/** Record a token hash in the snapshot's revoked list (hashes only, never secrets). */
function revokeTokenHash(data: WebConfigData, hash: string): void {
	const hashes = data.remote.revokedTokens ?? [];
	if (!hashes.includes(hash)) hashes.push(hash);
	data.remote.revokedTokens = hashes;
}

/** Workspace entries of a snapshot, normalizing legacy bare-path rows to `{alias, path}`. */
function workspaceEntries(data: WebConfigData): RemoteWorkspace[] {
	return (data.remote.workspaces ?? []).map(entry =>
		typeof entry === "string"
			? { alias: path.basename(entry), path: entry }
			: { alias: entry.alias, path: entry.path },
	);
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

const LEGACY_BUILTIN_TOOLS = [
	"read",
	"write",
	"edit",
	"bash",
	"glob",
	"grep",
	"task",
	"todo",
	"channel_send",
	"workspace_run",
	"im_control",
];

/**
 * Validate binding rows one at a time, keeping every row that is legal on its
 * own and under the accumulated set (duplicate ids/keys/sessions drop only the
 * later row). A single malformed legacy row must never sink the whole config.
 */
function repairImBindings(
	value: unknown,
	instances: readonly ChannelInstanceConfig[],
	profiles: readonly ImAgentProfile[],
): { bindings: ImBinding[]; healed: boolean } {
	if (value === undefined) return { bindings: [], healed: false };
	const rows = Array.isArray(value) ? value : [];
	let healed = !Array.isArray(value);
	const kept: unknown[] = [];
	for (const row of rows) {
		try {
			const validated = validateImBindings([...kept, row], instances, profiles);
			if (validated.length === kept.length + 1) {
				kept.push(row);
				continue;
			}
			healed = true;
		} catch {
			healed = true;
		}
	}
	if (kept.length !== rows.length) healed = true;
	return { bindings: validateImBindings(kept, instances, profiles), healed };
}

/**
 * Drop legacy chat keys that cannot be persisted/validated: `sessionMappings`
 * is a pre-v2 shape that may survive when no instance could be matched, and
 * legacy `botSessions` may carry a malformed chat key. Legal items are kept.
 */
function cleanLegacyImChatKeys(data: WebConfigData): boolean {
	let healed = false;
	const remote = data.remote as unknown as Record<string, unknown>;
	const mappings = remote.sessionMappings;
	if (Array.isArray(mappings)) {
		const kept = mappings.filter(entry => {
			if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return false;
			const row = entry as Record<string, unknown>;
			if (!isPersistableKeyText(row.chatId)) return false;
			if (row.threadId !== undefined && !isPersistableKeyText(row.threadId)) return false;
			if (row.userId !== undefined && !isPersistableKeyText(row.userId)) return false;
			return true;
		});
		if (kept.length !== mappings.length) {
			healed = true;
			if (kept.length === 0) delete remote.sessionMappings;
			else remote.sessionMappings = kept;
		}
	}
	for (const entry of data.remote.botSessions ?? []) {
		const row = entry as unknown as Record<string, unknown>;
		if (row.chatId !== undefined && !isPersistableKeyText(row.chatId)) {
			delete row.chatId;
			healed = true;
		}
		if (row.instanceId !== undefined && !isPersistableKeyText(row.instanceId)) {
			delete row.instanceId;
			delete row.bindingId;
			healed = true;
		}
	}
	return healed;
}

/** Drop binding rows this version can no longer validate; return true when healed. */
function healUnpersistableImBindings(data: WebConfigData): boolean {
	const repaired = repairImBindings(data.remote.imBindings, data.channels.instances, data.imAgents);
	let healed = repaired.healed;
	if (healed) data.remote.imBindings = repaired.bindings;
	if (cleanLegacyImChatKeys(data)) healed = true;
	return healed;
}

/** Legacy `channels.<platform>` block, kept only inside the one-shot migrator. */
function migrateLegacyConfig(raw: Record<string, unknown>): { changed: boolean; data: Record<string, unknown> } {
	const channels = raw.channels;
	if (typeof channels !== "object" || channels === null || Array.isArray(channels))
		return { changed: false, data: raw };
	const legacy = channels as Record<string, unknown>;
	const platforms = ["wechat", "feishu", "telegram", "discord", "qq"] as const;
	if (!platforms.some(platform => typeof legacy[platform] === "object" && legacy[platform] !== null)) {
		return { changed: false, data: raw };
	}
	const instances: ChannelInstanceConfig[] = [];
	const profiles: ImAgentProfile[] = [];
	const legacyGlobalPeers = Array.isArray(legacy.allowedPeers)
		? (legacy.allowedPeers as unknown[]).filter((peer): peer is string => typeof peer === "string")
		: [];
	const remote =
		typeof raw.remote === "object" && raw.remote !== null && !Array.isArray(raw.remote)
			? (raw.remote as Record<string, unknown>)
			: {};
	const legacyMappings = Array.isArray(remote.sessionMappings) ? (remote.sessionMappings as unknown[]) : [];
	const bindings: ImBinding[] = [];
	const legacyWorkspaces: RemoteWorkspace[] = [];
	const now = new Date().toISOString();

	for (const platform of platforms) {
		const block = legacy[platform];
		if (typeof block !== "object" || block === null || Array.isArray(block)) continue;
		const rec = block as Record<string, unknown>;
		const profileId = `legacy-${platform}`;
		const workspaceRoot =
			typeof rec.workspaceRoot === "string" && rec.workspaceRoot !== "" ? rec.workspaceRoot : undefined;
		const workspaceAlias = workspaceRoot ? `legacy-${platform}` : "main";
		if (workspaceRoot) legacyWorkspaces.push({ alias: workspaceAlias, path: workspaceRoot });
		const peers = Array.isArray(rec.allowedChannels)
			? (rec.allowedChannels as unknown[]).filter((peer): peer is string => typeof peer === "string")
			: Array.isArray(rec.allowedGroups)
				? (rec.allowedGroups as unknown[]).map(group => `group:${String(group)}`)
				: legacyGlobalPeers;
		const users = Array.isArray(rec.allowedUsers)
			? (rec.allowedUsers as unknown[]).filter((user): user is string => typeof user === "string")
			: undefined;
		profiles.push({
			id: profileId,
			label: `${platform} (migrated)`,
			persona: { mode: "workspace" },
			location: { kind: "workspace", workspace: workspaceAlias },
			tools: {
				preset: "companion",
				builtin: [...LEGACY_BUILTIN_TOOLS],
				extensions: [],
				customTools: [],
				mcpServers: [],
				skills: [],
				commands: [],
				approvalMode: "yolo",
			},
			memory: { backend: "mnemopi", workspaceContext: true },
		});
		const credentials: Record<string, unknown> = {};
		for (const key of [
			"botToken",
			"ilinkBotId",
			"ilinkUserId",
			"baseUrl",
			"endpoint",
			"appId",
			"appSecret",
			"domain",
			"token",
			"mode",
			"port",
			"selfId",
		]) {
			if (rec[key] !== undefined) credentials[key] = rec[key];
		}
		const peerTokens =
			typeof rec.peerTokens === "object" && rec.peerTokens !== null && !Array.isArray(rec.peerTokens)
				? (rec.peerTokens as Record<string, string>)
				: undefined;
		instances.push({
			id: platform,
			platform,
			label: platform,
			...(workspaceRoot ? { note: `migrated workspaceRoot ${workspaceRoot}` } : {}),
			enabled: rec.enabled === true,
			agentProfile: profileId,
			allow: { peers, ...(users && users.length > 0 ? { users } : {}) },
			credentials,
			...(peerTokens ? { options: { peerTokens } } : {}),
		});
	}

	const legacyAnswerKeys = new Set<string>();
	const legacySessionIds = new Set<string>();
	for (const [index, entry] of legacyMappings.entries()) {
		if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
		const rec = entry as Record<string, unknown>;
		const platform =
			typeof rec.platform === "string" && (platforms as readonly string[]).includes(rec.platform)
				? (rec.platform as ChannelInstanceConfig["platform"])
				: undefined;
		if (!platform) continue;
		const connectionId = typeof rec.connectionId === "string" ? rec.connectionId : undefined;
		const instanceId =
			connectionId && instances.some(instance => instance.id === connectionId) ? connectionId : platform;
		const chatId = typeof rec.chatId === "string" ? rec.chatId : "";
		if (!chatId || !isPersistableKeyText(chatId)) continue;
		const workspaceAlias =
			typeof rec.workspaceAlias === "string" && rec.workspaceAlias !== "" ? rec.workspaceAlias : undefined;
		const target: ImBinding["target"] = {
			kind: "workspace",
			workspace:
				workspaceAlias ??
				(profiles.find(profile => profile.id === `legacy-${platform}`)?.location.kind === "workspace"
					? (profiles.find(profile => profile.id === `legacy-${platform}`)!.location as { workspace: string })
							.workspace
					: "main"),
		};
		const originalSessionId =
			typeof rec.sessionId === "string" && rec.sessionId !== "" ? rec.sessionId : `legacy-${index}`;
		const duplicateSession = legacySessionIds.has(originalSessionId);
		const sessionId = duplicateSession ? `legacy-${index}` : originalSessionId;
		legacySessionIds.add(sessionId);
		const answerKey = `${platform}\u0000${chatId}`;
		const duplicateAnswer = legacyAnswerKeys.has(answerKey);
		if (!duplicateAnswer) legacyAnswerKeys.add(answerKey);
		const needsReview =
			!connectionId ||
			(connectionId !== undefined &&
				instanceId === platform &&
				!instances.some(instance => instance.id === connectionId)) ||
			duplicateAnswer ||
			duplicateSession;
		bindings.push({
			id: `b_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
			instanceId,
			platform,
			chatId,
			agentProfileId: `legacy-${platform}`,
			sessionId,
			target,
			role: duplicateAnswer ? "mention" : "answer",
			...(rec.lang === "zh" || rec.lang === "en" ? { lang: rec.lang } : {}),
			createdAt: now,
			...(needsReview
				? {
						needsReview: true,
						needsReviewReason: duplicateAnswer
							? "another legacy mapping already answers this platform/chat; this binding is mention-only"
							: duplicateSession
								? "legacy mappings shared one session; this binding got its own"
								: "legacy connectionId/instance mapping needs review",
					}
				: {}),
		});
	}

	// Existing bot sessions keep their transcript, but gain the binding identity
	// so the runtime never treats them as unowned/legacy.
	const legacyBotSessions = Array.isArray(remote.botSessions) ? (remote.botSessions as unknown[]) : [];
	for (const entry of legacyBotSessions) {
		if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
		const rec = entry as Record<string, unknown>;
		if (typeof rec.instanceId === "string" && typeof rec.bindingId === "string") continue;
		const platform = typeof rec.platform === "string" ? rec.platform : undefined;
		const chatId = typeof rec.chatId === "string" ? rec.chatId : undefined;
		const instance = platform ? instances.find(candidate => candidate.platform === platform) : undefined;
		if (!instance || !chatId || !isPersistableKeyText(chatId)) continue;
		let binding =
			bindings.find(candidate => candidate.instanceId === instance.id && candidate.chatId === chatId) ??
			bindings.find(candidate => candidate.platform === platform && candidate.chatId === chatId);
		if (!binding) {
			const hasAnswer = bindings.some(
				candidate => candidate.platform === platform && candidate.chatId === chatId && candidate.role === "answer",
			);
			binding = {
				id: `b_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
				instanceId: instance.id,
				platform: instance.platform,
				chatId,
				agentProfileId: instance.agentProfile,
				sessionId: typeof rec.id === "string" && rec.id !== "" ? rec.id : `legacy-${randomUUID().slice(0, 8)}`,
				target: { kind: "workspace", workspace: "main" },
				role: hasAnswer ? "mention" : "answer",
				createdAt: now,
				needsReview: true,
				needsReviewReason: "legacy bot session had no persisted binding; target defaults to the main workspace",
			};
			bindings.push(binding);
		}
		rec.instanceId = instance.id;
		rec.bindingId = binding.id;
		rec.agentProfileId = binding.agentProfileId;
		rec.target = binding.target;
	}
	const next = structuredClone(raw);
	next.channels = { instances };
	next.imAgents = profiles;
	if (bindings.length > 0 || legacyWorkspaces.length > 0) {
		next.remote = {
			...remote,
			...(bindings.length > 0 ? { imBindings: bindings } : {}),
			...(legacyWorkspaces.length > 0
				? {
						workspaces: [
							...(Array.isArray(remote.workspaces) ? (remote.workspaces as unknown[]) : []),
							...legacyWorkspaces,
						],
					}
				: {}),
		};
		if (bindings.length > 0) delete (next.remote as Record<string, unknown>).sessionMappings;
	}
	return { changed: true, data: next };
}

/** One-shot migration with an on-disk backup; exported for migration tests. */
export async function migrateLegacyWebConfigFile(filePath: string): Promise<boolean> {
	let raw: unknown = {};
	try {
		raw = YAML.parse(await Bun.file(filePath).text()) as unknown;
	} catch (error) {
		if (isEnoent(error)) return false;
		throw error;
	}
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return false;
	const migrated = migrateLegacyConfig(raw as Record<string, unknown>);
	if (!migrated.changed) return false;
	const backup = `${filePath}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
	await Bun.write(backup, YAML.stringify(raw));
	await Bun.write(filePath, YAML.stringify(migrated.data));
	return true;
}

/**
 * Loads and persists `~/.zeta/agent/web.yml`.
 *
 * An instance is a read snapshot (the channel adapters and the router hold one
 * for a whole process); every mutation is a read-modify-write under the config
 * file lock: the freshest on-disk data is loaded, the change is applied to it,
 * and the result is written back atomically. Two writers — a running adapter
 * and a gateway request, in this process or another — therefore never drop
 * each other's keys, and a stale snapshot can never write a rotated or revoked
 * `remote.token` back to disk. {@link reload} refreshes a snapshot;
 * {@link shared} hands out the one instance per path per process.
 */
export class WebConfig {
	readonly #filePath: string;
	#data: WebConfigData;
	/** One instance per absolute path, so serve + gateway mutate one snapshot. */
	static readonly #shared = new Map<string, Promise<WebConfig>>();

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
		const { data } = await WebConfig.#read(filePath);
		return new WebConfig(filePath, data);
	}

	/**
	 * The one instance for `filePath` in this process. `serve` holds it for its
	 * adapters and the gateway for its handlers, so a PUT is visible to the
	 * running router without a reload and writers share one lock holder.
	 */
	static shared(filePath = WebConfig.defaultPath()): Promise<WebConfig> {
		const existing = WebConfig.#shared.get(filePath);
		if (existing) return existing;
		const pending = WebConfig.load(filePath);
		WebConfig.#shared.set(filePath, pending);
		return pending;
	}

	/** Forget the shared instances (tests, or after the agent dir moves). */
	static resetShared(): void {
		WebConfig.#shared.clear();
	}

	static async #read(filePath: string): Promise<{ data: WebConfigData; healed: boolean }> {
		await migrateLegacyWebConfigFile(filePath).catch(error => {
			logger.warn("web.yml legacy migration failed; continuing without migration", {
				filePath,
				error: error instanceof Error ? error.message : String(error),
			});
		});
		let raw: unknown = {};
		try {
			const readPath = resolveYamlConfigReadPath(filePath);
			const content = await Bun.file(readPath).text();
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
		const merged = deepMerge(DEFAULT_DATA, raw);
		merged.imAgents = validateImAgentProfiles(merged.imAgents);
		merged.channels.instances = validateChannelInstances(merged.channels.instances, merged.imAgents);
		// One bad legacy row must not sink the config: validate each row on its
		// own and keep every legal binding. #mutate writes the repaired file.
		const repaired = repairImBindings(merged.remote.imBindings, merged.channels.instances, merged.imAgents);
		merged.remote.imBindings = repaired.bindings;
		const healedLegacy = cleanLegacyImChatKeys(merged);
		return { data: merged, healed: repaired.healed || healedLegacy };
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
		for (const instance of masked.channels.instances) {
			for (const key of Object.keys(instance.credentials)) {
				const value = instance.credentials[key];
				if (typeof value === "string" && value !== "") instance.credentials[key] = MASKED_TOKEN;
			}
			if (instance.options?.peerTokens) {
				for (const peer of Object.keys(instance.options.peerTokens)) {
					instance.options.peerTokens[peer] = MASKED_TOKEN;
				}
			}
		}
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
					current[leaf] = MASKED_TOKEN;
				} else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
					// Record leaves (e.g. wechat peerTokens) mask every value.
					for (const key of Object.keys(value as Record<string, unknown>)) {
						if (typeof (value as Record<string, unknown>)[key] === "string") {
							(value as Record<string, unknown>)[key] = MASKED_TOKEN;
						}
					}
				}
			}
		}
		return masked;
	}

	/**
	 * Set one known dot path (e.g. `channels.wechat.enabled`) and persist.
	 * The write starts from the on-disk file under the config lock, so keys
	 * another writer changed meanwhile are preserved.
	 */
	async set(pathToSet: string, value: unknown): Promise<void> {
		const leafType = KNOWN_PATHS[pathToSet];
		if (leafType === undefined) throw new Error(`Unknown web config path: ${pathToSet}`);
		validateValue(leafType, value);
		await this.#mutate(data => {
			setByPath(data as unknown as Record<string, unknown>, pathToSet.split("."), value);
			return { changed: true, value: undefined };
		});
	}

	// ------------------------------------------------------------------
	// IM instances / agent profiles / bindings
	// ------------------------------------------------------------------

	getChannelInstances(): ChannelInstanceConfig[] {
		return structuredClone(this.#data.channels.instances);
	}

	getChannelInstance(id: string): ChannelInstanceConfig | undefined {
		return this.#data.channels.instances.find(instance => instance.id === id);
	}

	/** Whole-array write; validates against the current profiles. */
	async setChannelInstances(value: unknown): Promise<ChannelInstanceConfig[]> {
		const instances = validateChannelInstances(value, this.#data.imAgents);
		await this.#mutate(data => {
			data.channels.instances = instances;
			return { changed: true, value: instances };
		});
		return instances;
	}

	/** Update one instance's non-secret fields and/or credentials. */
	async setInstance(id: string, patch: Partial<ChannelInstanceConfig>): Promise<ChannelInstanceConfig> {
		const current = this.getChannelInstance(id);
		if (!current) throw new Error(`Unknown channel instance: ${id}`);
		const next = { ...current, ...patch, id: current.id, platform: current.platform };
		const instances = this.#data.channels.instances.map(instance => (instance.id === id ? next : instance));
		const validated = validateChannelInstances(instances, this.#data.imAgents);
		await this.#mutate(data => {
			data.channels.instances = validated;
			return { changed: true, value: undefined };
		});
		return next;
	}

	/** Remove one instance and every binding that referenced it. */
	async removeChannelInstance(id: string): Promise<boolean> {
		if (!this.getChannelInstance(id)) return false;
		await this.#mutate(data => {
			data.channels.instances = data.channels.instances.filter(instance => instance.id !== id);
			data.remote.imBindings = (data.remote.imBindings ?? []).filter(binding => binding.instanceId !== id);
			return { changed: true, value: true };
		});
		return true;
	}

	getImAgents(): ImAgentProfile[] {
		return structuredClone(this.#data.imAgents);
	}

	getImAgent(id: string): ImAgentProfile | undefined {
		return this.#data.imAgents.find(profile => profile.id === id);
	}

	async setImAgents(value: unknown): Promise<ImAgentProfile[]> {
		const profiles = validateImAgentProfiles(value);
		const referenced = new Set(this.#data.channels.instances.map(instance => instance.agentProfile));
		for (const profile of this.#data.imAgents) {
			if (referenced.has(profile.id) && !profiles.some(candidate => candidate.id === profile.id)) {
				throw new ImConfigError([
					{ path: "imAgents", message: `profile ${profile.id} is referenced by an instance` },
				]);
			}
		}
		await this.#mutate(data => {
			data.imAgents = profiles;
			return { changed: true, value: profiles };
		});
		return profiles;
	}

	getImBindings(): ImBinding[] {
		return structuredClone(this.#data.remote.imBindings ?? []);
	}

	findImBinding(
		instanceId: string,
		chatId: string,
		opts: { threadId?: string; userId?: string } = {},
	): ImBinding | undefined {
		const key = [instanceId, chatId, opts.threadId ?? "", opts.userId ?? ""].join("\u0000");
		return (this.#data.remote.imBindings ?? []).find(binding => bindingKey(binding) === key);
	}

	async setImBindings(value: unknown): Promise<ImBinding[]> {
		const bindings = validateImBindings(value, this.#data.channels.instances, this.#data.imAgents);
		await this.#mutate(data => {
			data.remote.imBindings = bindings;
			return { changed: true, value: bindings };
		});
		return bindings;
	}

	async upsertImBinding(binding: ImBinding): Promise<ImBinding> {
		const next = [
			...(this.#data.remote.imBindings ?? []).filter(
				entry => entry.id !== binding.id && bindingKey(entry) !== bindingKey(binding),
			),
			binding,
		];
		await this.setImBindings(next);
		return binding;
	}

	/** Merge fields into one chat binding; creates it from the instance default when absent. */
	async patchImBinding(
		instanceId: string,
		chatId: string,
		patch: Partial<Pick<ImBinding, "target" | "agentProfileId" | "sessionId" | "lang" | "model" | "role">>,
		opts: { threadId?: string; userId?: string } = {},
	): Promise<ImBinding> {
		const instance = this.getChannelInstance(instanceId);
		if (!instance) throw new Error(`Unknown channel instance: ${instanceId}`);
		const existing = this.findImBinding(instanceId, chatId, opts);
		const profileId = patch.agentProfileId ?? existing?.agentProfileId ?? instance.agentProfile;
		const profile = this.getImAgent(profileId);
		if (!profile) throw new Error(`Unknown agent profile: ${profileId}`);
		const next: ImBinding = existing
			? { ...existing, ...patch }
			: {
					id: `b_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
					instanceId,
					platform: instance.platform,
					chatId,
					...(opts.threadId ? { threadId: opts.threadId } : {}),
					...(opts.userId ? { userId: opts.userId } : {}),
					agentProfileId: profileId,
					sessionId: patch.sessionId ?? randomUUID().slice(0, 8),
					target: patch.target ?? profile.location,
					role: patch.role ?? "answer",
					createdAt: new Date().toISOString(),
				};
		await this.upsertImBinding(next);
		return next;
	}

	async removeImBindingByChat(instanceId: string, chatId: string): Promise<boolean> {
		const current = this.#data.remote.imBindings ?? [];
		const next = current.filter(binding => !(binding.instanceId === instanceId && binding.chatId === chatId));
		if (next.length === current.length) return false;
		await this.setImBindings(next);
		return true;
	}

	async removeImBinding(id: string): Promise<boolean> {
		const current = this.#data.remote.imBindings ?? [];
		if (!current.some(binding => binding.id === id)) return false;
		await this.setImBindings(current.filter(binding => binding.id !== id));
		return true;
	}

	/** The live remote-access token, or `undefined` when none is configured. */
	getRemoteToken(): string | undefined {
		return liveRemoteToken(this.#data);
	}

	/** Hashes of rotated-away / revoked tokens. */
	getRevokedTokenHashes(): string[] {
		return [...(this.#data.remote.revokedTokens ?? [])];
	}

	/**
	 * Replace the active token and revoke the previous one in a single write.
	 * The caller receives the new plaintext token once (the config only ever
	 * stores hashes for retired tokens). The previous token is read from disk
	 * under the config lock, so a rotation never revokes a stale value.
	 */
	async rotateRemoteToken(): Promise<string> {
		return this.#mutate(data => {
			const previous = liveRemoteToken(data);
			const next = generateRemoteToken();
			if (previous) revokeTokenHash(data, hashRemoteToken(previous));
			data.remote.token = next;
			data.remote.tokenUpdatedAt = new Date().toISOString();
			return { changed: true, value: next };
		});
	}

	/**
	 * Revoke one token. Revoking the active token also clears it, so the next
	 * access-gate check fails closed until a new token is configured.
	 */
	async revokeRemoteToken(token: string): Promise<void> {
		const candidate = token.trim();
		if (candidate === "") throw new Error("Expected a token to revoke");
		await this.#mutate(data => {
			revokeTokenHash(data, hashRemoteToken(candidate));
			if (liveRemoteToken(data) === candidate) data.remote.token = undefined;
			data.remote.tokenUpdatedAt = new Date().toISOString();
			return { changed: true, value: undefined };
		});
	}

	/** Replace the whole workspace list and persist. */
	async setWorkspaces(workspaces: string[]): Promise<void> {
		if (!Array.isArray(workspaces) || workspaces.some(item => typeof item !== "string")) {
			throw new Error("Expected an array of strings");
		}
		await this.#mutate(data => {
			data.remote.workspaces = [...workspaces];
			return { changed: true, value: undefined };
		});
	}

	/** Normalized workspace entries (legacy bare-path entries get alias = basename). */
	getWorkspaces(): RemoteWorkspace[] {
		return workspaceEntries(this.#data);
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
		return this.#mutate<{ ok: true; alias: string } | { ok: false; error: string }>(data => {
			const entries = workspaceEntries(data);
			const existing = entries.find(entry => entry.alias === cleanAlias);
			if (existing && existing.path !== dir) {
				return {
					changed: false,
					value: { ok: false as const, error: `Alias "${cleanAlias}" is already bound to ${existing.path}` },
				};
			}
			data.remote.workspaces = [
				...entries.filter(entry => entry.alias !== cleanAlias),
				{ alias: cleanAlias, path: dir },
			];
			return { changed: true, value: { ok: true as const, alias: cleanAlias } };
		});
	}

	/** Remove a workspace entry by alias and persist. */
	async removeWorkspaceEntry(alias: string): Promise<boolean> {
		return this.#mutate(data => {
			const entries = workspaceEntries(data);
			const next = entries.filter(entry => entry.alias !== alias);
			if (next.length === entries.length) return { changed: false, value: false };
			data.remote.workspaces = next;
			return { changed: true, value: true };
		});
	}

	/** Persisted per-chat session mappings. */
	getBotSessions(): BotSessionEntry[] {
		return this.#data.remote.botSessions ?? [];
	}

	/**
	 * The `relay`-tagged coordinator session bound to `sessionFile`, if any.
	 * Used by `/delete` (and the gateway's DELETE handler) to refuse deleting
	 * the IM-channel-hub transcript the relay runtime still points at.
	 */
	findRelayBotSession(sessionFile: string): BotSessionEntry | undefined {
		const key = botSessionPathKey(sessionFile);
		return this.getBotSessions().find(entry => entry.tag === "relay" && botSessionPathKey(entry.sessionFile) === key);
	}

	/** One registered bot session by id. */
	getBotSession(id: string): BotSessionEntry | undefined {
		return this.getBotSessions().find(entry => entry.id === id);
	}

	/** Register (or replace) one bot session entry and persist. */
	async upsertBotSession(entry: BotSessionEntry): Promise<void> {
		await this.#mutate(data => {
			const next = (data.remote.botSessions ?? []).filter(existing => existing.id !== entry.id);
			next.push(entry);
			data.remote.botSessions = next;
			return { changed: true, value: undefined };
		});
	}

	/** Remove a bot session entry and persist. Returns false when absent. */
	async removeBotSession(id: string): Promise<boolean> {
		return this.#mutate(data => {
			const entries = data.remote.botSessions ?? [];
			const next = entries.filter(entry => entry.id !== id);
			if (next.length === entries.length) return { changed: false, value: false };
			data.remote.botSessions = next;
			return { changed: true, value: true };
		});
	}

	/** Whether the web-ui sidebar shows relay/bot sessions. */
	getShowBotSessions(): boolean {
		return this.#data.remote.showBotSessions === true;
	}

	/** Drop every chat's `sessionId` pointer to a deleted bot session. */
	async clearChatSessionReferences(sessionId: string): Promise<void> {
		await this.#mutate(data => {
			const entries = data.remote.sessionMappings ?? [];
			if (!entries.some(entry => entry.sessionId === sessionId)) return { changed: false, value: undefined };
			data.remote.sessionMappings = entries.map(entry => {
				if (entry.sessionId !== sessionId) return entry;
				const { sessionId: _drop, ...rest } = entry;
				return rest;
			});
			return { changed: true, value: undefined };
		});
	}

	/** Re-read the file from disk (under the config lock), discarding in-memory changes. */
	async reload(): Promise<void> {
		await withFileLock(this.#filePath, async () => {
			this.#data = (await WebConfig.#read(this.#filePath)).data;
		});
	}

	/**
	 * Apply one mutation as a read-modify-write under the config file lock.
	 * The mutation edits the freshest on-disk snapshot and reports whether it
	 * changed anything; the snapshot becomes this instance's view afterwards,
	 * so a long-lived holder sees its own write without a reload.
	 */
	async #mutate<T>(mutation: (data: WebConfigData) => { changed: boolean; value: T }): Promise<T> {
		return withFileLock(this.#filePath, async () => {
			const { data, healed: readHealed } = await WebConfig.#read(this.#filePath);
			const { changed, value } = mutation(data);
			const healed = healUnpersistableImBindings(data) || readHealed;
			if (changed || healed) await this.#write(data);
			this.#data = data;
			return value;
		});
	}

	async #write(data: WebConfigData): Promise<void> {
		const dir = path.dirname(this.#filePath);
		await fs.promises.mkdir(dir, { recursive: true });
		const tempPath = `${this.#filePath}.${process.pid}.${randomUUID()}.tmp`;
		let removeTemp = false;
		try {
			const handle = await fs.promises.open(tempPath, "wx", 0o600);
			removeTemp = true;
			try {
				await handle.writeFile(YAML.stringify(data, null, 2), "utf8");
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
