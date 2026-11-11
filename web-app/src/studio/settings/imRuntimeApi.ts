/**
 * Studio IM runtime: client for the frozen ADR-IM-0007 contract.
 *
 * This is the only data layer the new IM pages use. It deliberately does not
 * fall back to `channels.<platform>` / `remote.sessionMappings`: the contract
 * makes `channels.instances`, `remote.imBindings` and `imAgents` the runtime
 * truth, and a silent legacy fallback would hide a backend that has not
 * migrated. When a route is missing the page shows the gateway's own error.
 *
 * Secrets are masked (`••••`) on read. A whole-array write preserves them:
 * omit the field (or send the mask) to keep the stored value, send `null` to
 * clear it, send a new string to replace it.
 */
import { isRecord } from "../typeGuards";
import { defaultGatewayFetch, gatewayJson, type GatewayFetch } from "./gatewayRequest";

export type ImFetch = GatewayFetch;

const defaultFetch: ImFetch = defaultGatewayFetch;

export type ChannelPlatform = "wechat" | "feishu" | "telegram" | "discord" | "qq";

export const CHANNEL_PLATFORMS: readonly ChannelPlatform[] = [
	"wechat",
	"feishu",
	"telegram",
	"discord",
	"qq",
];

export type ChannelInstanceId = string;
export type ImAgentProfileId = string;
export type ImBindingId = string;

/** The mask every read route uses in place of a stored secret. */
export const SECRET_MASK = "••••";

export interface ChannelStatus {
	id: ChannelInstanceId;
	platform: ChannelPlatform;
	label: string;
	running: boolean;
	state?: string;
	detail?: string;
	lastError?: string;
	since?: number;
	lastInboundAt?: number;
	/** UI extensions requested from the backend (optional during rollout). */
	configured?: boolean;
	agentProfileId?: string;
	targetDisplay?: string | null;
	targetAvailable?: boolean;
	targetReason?: string | null;
}

export interface StatusEnvelope {
	instances: readonly ChannelStatus[];
	runtime?: unknown;
}

/** Masked credential bag; exact fields depend on the platform. */
export type CredentialBag = Record<string, unknown>;

export interface ChannelAllow {
	peers: string[];
	users?: string[];
}

export interface ChannelInstance {
	id: ChannelInstanceId;
	platform: ChannelPlatform;
	label: string;
	note?: string;
	enabled: boolean;
	agentProfile: ImAgentProfileId;
	allow: ChannelAllow;
	credentials: CredentialBag;
	options?: { peerTokens?: Record<string, string> };
}

export interface ImTarget {
	kind: "workspace" | "team-pm" | "engineer" | string;
	key?: string;
	display?: string;
	available?: boolean;
	reason?: string;
	detail?: string;
}

export interface ImAgentLocation {
	kind: "workspace" | "team-pm" | "engineer";
	workspace?: string;
	team?: string;
	pm?: string;
	engineer?: string;
	repo?: string;
}

export type ToolPreset = "companion" | "read-only-chat" | "roleplay" | "team-pm" | "engineer";
export type ImApprovalMode = "always-ask" | "write" | "yolo";
export type MemoryBackend = "off" | "local" | "hindsight" | "mnemopi" | "sharpshooter";

export interface ImAgentTools {
	preset?: ToolPreset;
	/** Allowlist; [] means no builtin tool, never "all". */
	builtin: string[];
	extensions: string[];
	mcpServers: string[];
	/** Custom tools are empty by default and never inherit ambient tools. */
	customTools: string[];
	skills: string[];
	commands: string[];
	approvalMode?: ImApprovalMode;
	/** Present only when the backend truly enforces it; the editor never writes it. */
	capabilities?: unknown;
}

export interface ImAgentProfile {
	id: ImAgentProfileId;
	label: string;
	persona: { mode: "file" | "inline" | "workspace"; file?: string; text?: string };
	model?: { provider: string; model: string };
	location: ImAgentLocation;
	tools: ImAgentTools;
	memory?: { backend?: MemoryBackend; namespace?: string; workspaceContext?: boolean };
}

export interface ImBinding {
	id: ImBindingId;
	instanceId: ChannelInstanceId;
	platform: ChannelPlatform;
	chatId: string;
	threadId?: string;
	userId?: string;
	agentProfileId: ImAgentProfileId;
	sessionId: string;
	target?: ImTarget;
	/** Backend-projected display facts; optional during rollout. */
	targetDisplay?: string;
	targetAvailable?: boolean;
	targetReason?: string | null;
	role: "answer" | "observe";
	lang?: "zh" | "en";
	model?: { provider: string; model: string };
	createdAt: string;
	needsReview?: boolean;
	needsReviewReason?: string;
}

export interface BotCommands {
	bot?: { instanceId: ChannelInstanceId; label: string; platform: ChannelPlatform };
	binding?: { id: ImBindingId; role: "answer" | "observe" };
	session?: { id: string; display?: string };
	model?: { provider: string; model: string; display?: string };
	voice: { supported: boolean; reason?: string };
	examples: readonly string[];
	/** Backend-computed runtime identity (includes bindingId); the UI never composes it. */
	agentRuntimeId?: string;
	bindingId?: string;
}

export interface AgentsEnvelope {
	profiles: readonly ImAgentProfile[];
	targets: readonly ImTarget[];
}

export interface ValidateResult {
	state: "connected" | "error" | "timeout";
	identity?: { id?: string; name?: string; username?: string } | null;
}

// ---------------------------------------------------------------------------
// Parsing helpers (narrow at the boundary, keep the contract's optional fields)
// ---------------------------------------------------------------------------

function stringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function records(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value) ? value.filter(isRecord) : [];
}

function platformOf(value: unknown): ChannelPlatform | null {
	return CHANNEL_PLATFORMS.includes(value as ChannelPlatform) ? (value as ChannelPlatform) : null;
}

function statusOf(value: Record<string, unknown>): ChannelStatus | null {
	if (typeof value.id !== "string" || value.id === "") return null;
	const platform = platformOf(value.platform);
	if (platform === null) return null;
	const status: ChannelStatus = {
		id: value.id,
		platform,
		label: typeof value.label === "string" ? value.label : value.id,
		running: value.running === true,
	};
	if (typeof value.state === "string") status.state = value.state;
	if (typeof value.detail === "string") status.detail = value.detail;
	if (typeof value.lastError === "string") status.lastError = value.lastError;
	if (typeof value.since === "number") status.since = value.since;
	if (typeof value.lastInboundAt === "number") status.lastInboundAt = value.lastInboundAt;
	if (typeof value.configured === "boolean") status.configured = value.configured;
	if (typeof value.agentProfileId === "string") status.agentProfileId = value.agentProfileId;
	if (typeof value.targetDisplay === "string" || value.targetDisplay === null) {
		status.targetDisplay = value.targetDisplay as string | null;
	}
	if (typeof value.targetAvailable === "boolean") status.targetAvailable = value.targetAvailable;
	if (typeof value.targetReason === "string" || value.targetReason === null) {
		status.targetReason = value.targetReason as string | null;
	}
	return status;
}

function instanceOf(value: Record<string, unknown>): ChannelInstance | null {
	if (typeof value.id !== "string" || value.id === "") return null;
	const platform = platformOf(value.platform);
	if (platform === null) return null;
	const allow = isRecord(value.allow) ? value.allow : {};
	return {
		id: value.id,
		platform,
		label: typeof value.label === "string" ? value.label : value.id,
		...(typeof value.note === "string" ? { note: value.note } : {}),
		enabled: value.enabled === true,
		agentProfile: typeof value.agentProfile === "string" ? value.agentProfile : "",
		allow: {
			peers: stringArray(allow.peers),
			...(Array.isArray(allow.users) ? { users: stringArray(allow.users) } : {}),
		},
		credentials: isRecord(value.credentials) ? { ...value.credentials } : {},
		...(isRecord(value.options) ? { options: value.options as NonNullable<ChannelInstance["options"]> } : {}),
	};
}

function targetOf(value: unknown): ImTarget | undefined {
	if (!isRecord(value) || typeof value.kind !== "string") return undefined;
	const target: ImTarget = { kind: value.kind };
	if (typeof value.key === "string") target.key = value.key;
	if (typeof value.display === "string") target.display = value.display;
	if (typeof value.available === "boolean") target.available = value.available;
	if (typeof value.reason === "string") target.reason = value.reason;
	if (typeof value.detail === "string") target.detail = value.detail;
	return target;
}

function locationOf(value: unknown): ImAgentLocation | null {
	if (!isRecord(value)) return null;
	if (value.kind !== "workspace" && value.kind !== "team-pm" && value.kind !== "engineer") return null;
	const location: ImAgentLocation = { kind: value.kind };
	for (const key of ["workspace", "team", "pm", "engineer", "repo"] as const) {
		if (typeof value[key] === "string") location[key] = value[key];
	}
	return location;
}

function toolsOf(value: unknown): ImAgentTools {
	const record = isRecord(value) ? value : {};
	const tools: ImAgentTools = {
		builtin: stringArray(record.builtin),
		extensions: stringArray(record.extensions),
		mcpServers: stringArray(record.mcpServers),
		customTools: stringArray(record.customTools),
		skills: stringArray(record.skills),
		commands: stringArray(record.commands),
	};
	if (typeof record.preset === "string") tools.preset = record.preset as ToolPreset;
	if (record.approvalMode === "always-ask" || record.approvalMode === "write" || record.approvalMode === "yolo") {
		tools.approvalMode = record.approvalMode;
	}
	if (record.capabilities !== undefined) tools.capabilities = record.capabilities;
	return tools;
}

function profileOf(value: Record<string, unknown>): ImAgentProfile | null {
	if (typeof value.id !== "string" || value.id === "") return null;
	const persona = isRecord(value.persona) ? value.persona : {};
	const location = locationOf(value.location);
	if (location === null) return null;
	const profile: ImAgentProfile = {
		id: value.id,
		label: typeof value.label === "string" ? value.label : value.id,
		persona: {
			mode: persona.mode === "file" || persona.mode === "workspace" ? persona.mode : "inline",
			...(typeof persona.file === "string" ? { file: persona.file } : {}),
			...(typeof persona.text === "string" ? { text: persona.text } : {}),
		},
		location,
		tools: toolsOf(value.tools),
	};
	if (isRecord(value.model) && typeof value.model.provider === "string" && typeof value.model.model === "string") {
		profile.model = { provider: value.model.provider, model: value.model.model };
	}
	if (isRecord(value.memory)) {
		const memory: NonNullable<ImAgentProfile["memory"]> = {};
		if (
			value.memory.backend === "off" ||
			value.memory.backend === "local" ||
			value.memory.backend === "hindsight" ||
			value.memory.backend === "mnemopi" ||
			value.memory.backend === "sharpshooter"
		) {
			memory.backend = value.memory.backend;
		}
		if (typeof value.memory.namespace === "string") memory.namespace = value.memory.namespace;
		if (typeof value.memory.workspaceContext === "boolean") memory.workspaceContext = value.memory.workspaceContext;
		profile.memory = memory;
	}
	return profile;
}

function bindingOf(value: Record<string, unknown>): ImBinding | null {
	const platform = platformOf(value.platform);
	if (
		typeof value.id !== "string" ||
		typeof value.instanceId !== "string" ||
		typeof value.chatId !== "string" ||
		typeof value.agentProfileId !== "string" ||
		typeof value.sessionId !== "string" ||
		platform === null
	) {
		return null;
	}
	const binding: ImBinding = {
		id: value.id,
		instanceId: value.instanceId,
		platform,
		chatId: value.chatId,
		agentProfileId: value.agentProfileId,
		sessionId: value.sessionId,
		role: value.role === "observe" ? "observe" : "answer",
		createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
	};
	if (typeof value.threadId === "string") binding.threadId = value.threadId;
	if (typeof value.userId === "string") binding.userId = value.userId;
	if (typeof value.lang === "string") binding.lang = value.lang === "en" ? "en" : "zh";
	if (isRecord(value.model) && typeof value.model.provider === "string" && typeof value.model.model === "string") {
		binding.model = { provider: value.model.provider, model: value.model.model };
	}
	const target = targetOf(value.target);
	if (target !== undefined) binding.target = target;
	if (typeof value.targetDisplay === "string") binding.targetDisplay = value.targetDisplay;
	else if (target?.display !== undefined) binding.targetDisplay = target.display;
	if (typeof value.targetAvailable === "boolean") binding.targetAvailable = value.targetAvailable;
	else if (target?.available !== undefined) binding.targetAvailable = target.available;
	if (typeof value.targetReason === "string" || value.targetReason === null) binding.targetReason = value.targetReason as string | null;
	else if (target?.reason !== undefined) binding.targetReason = target.reason;
	if (value.needsReview === true) binding.needsReview = true;
	if (typeof value.needsReviewReason === "string") binding.needsReviewReason = value.needsReviewReason;
	return binding;
}

function commandsOf(value: unknown): BotCommands {
	const record = isRecord(value) ? value : {};
	const voice = isRecord(record.voice) ? record.voice : {};
	const commands: BotCommands = {
		voice: {
			supported: voice.supported === true,
			...(typeof voice.reason === "string" ? { reason: voice.reason } : {}),
		},
		examples: stringArray(record.examples),
	};
	if (isRecord(record.bot) && typeof record.bot.instanceId === "string" && typeof record.bot.label === "string") {
		const platform = platformOf(record.bot.platform);
		if (platform !== null) commands.bot = { instanceId: record.bot.instanceId, label: record.bot.label, platform };
	}
	if (isRecord(record.binding) && typeof record.binding.id === "string") {
		commands.binding = { id: record.binding.id, role: record.binding.role === "observe" ? "observe" : "answer" };
	}
	if (isRecord(record.session) && typeof record.session.id === "string") {
		commands.session = {
			id: record.session.id,
			...(typeof record.session.display === "string" ? { display: record.session.display } : {}),
		};
	}
	if (isRecord(record.model) && typeof record.model.provider === "string" && typeof record.model.model === "string") {
		commands.model = {
			provider: record.model.provider,
			model: record.model.model,
			...(typeof record.model.display === "string" ? { display: record.model.display } : {}),
		};
	}
	if (typeof record.agentRuntimeId === "string") commands.agentRuntimeId = record.agentRuntimeId;
	if (typeof record.bindingId === "string") commands.bindingId = record.bindingId;
	return commands;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function fetchChannelStatus(fetcher: ImFetch = defaultFetch): Promise<StatusEnvelope> {
	const payload = await gatewayJson(fetcher, "/api/channels/status");
	if (!isRecord(payload) || !Array.isArray(payload.instances)) throw new Error("Channel status response is malformed");
	const instances: ChannelStatus[] = [];
	for (const entry of records(payload.instances)) {
		const status = statusOf(entry);
		if (status !== null) instances.push(status);
	}
	return { instances, ...(payload.runtime === undefined ? {} : { runtime: payload.runtime }) };
}

export async function fetchChannelInstances(fetcher: ImFetch = defaultFetch): Promise<ChannelInstance[]> {
	const payload = await gatewayJson(fetcher, "/api/channels/instances");
	if (!isRecord(payload) || !Array.isArray(payload.instances)) throw new Error("Channel instances response is malformed");
	return records(payload.instances).flatMap(entry => {
		const instance = instanceOf(entry);
		return instance === null ? [] : [instance];
	});
}

export async function fetchImAgents(fetcher: ImFetch = defaultFetch): Promise<AgentsEnvelope> {
	const payload = await gatewayJson(fetcher, "/api/im/agents");
	if (!isRecord(payload) || !Array.isArray(payload.profiles) || !Array.isArray(payload.targets)) {
		throw new Error("Agent profiles response is malformed");
	}
	return {
		profiles: records(payload.profiles).flatMap(entry => {
			const profile = profileOf(entry);
			return profile === null ? [] : [profile];
		}),
		targets: payload.targets.flatMap(entry => {
			const target = targetOf(entry);
			return target === undefined ? [] : [target];
		}),
	};
}

export async function fetchImBindings(fetcher: ImFetch = defaultFetch, instanceId?: string): Promise<ImBinding[]> {
	const query = instanceId === undefined ? "" : `?instanceId=${encodeURIComponent(instanceId)}`;
	const payload = await gatewayJson(fetcher, `/api/im/bindings${query}`);
	if (!isRecord(payload) || !Array.isArray(payload.bindings)) throw new Error("Bindings response is malformed");
	return records(payload.bindings).flatMap(entry => {
		const binding = bindingOf(entry);
		return binding === null ? [] : [binding];
	});
}

export async function fetchBotCommands(
	fetcher: ImFetch,
	instanceId: string,
	chatId: string,
): Promise<BotCommands> {
	const query = `?instanceId=${encodeURIComponent(instanceId)}&chatId=${encodeURIComponent(chatId)}`;
	return commandsOf(await gatewayJson(fetcher, `/api/im/commands${query}`));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function putChannelInstances(fetcher: ImFetch, instances: readonly ChannelInstance[]): Promise<void> {
	await gatewayJson(fetcher, "/api/channels/instances", {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ instances }),
	});
}

export async function putImAgents(fetcher: ImFetch, profiles: readonly ImAgentProfile[]): Promise<void> {
	await gatewayJson(fetcher, "/api/im/agents", {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ profiles }),
	});
}

/**
 * The write projection: UI display extensions (`targetDisplay`, `targetAvailable`,
 * `needsReviewReason`) are read-only facts and must not be sent back as if they
 * were caller input.
 */
export function bindingWire(binding: ImBinding): Record<string, unknown> {
	return {
		id: binding.id,
		instanceId: binding.instanceId,
		platform: binding.platform,
		chatId: binding.chatId,
		...(binding.threadId !== undefined ? { threadId: binding.threadId } : {}),
		...(binding.userId !== undefined ? { userId: binding.userId } : {}),
		agentProfileId: binding.agentProfileId,
		sessionId: binding.sessionId,
		...(binding.target !== undefined ? { target: binding.target } : {}),
		role: binding.role,
		...(binding.lang !== undefined ? { lang: binding.lang } : {}),
		...(binding.model !== undefined ? { model: binding.model } : {}),
		createdAt: binding.createdAt,
		...(binding.needsReview === true ? { needsReview: true } : {}),
	};
}

export async function putImBindings(fetcher: ImFetch, bindings: readonly ImBinding[]): Promise<void> {
	await gatewayJson(fetcher, "/api/im/bindings", {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ bindings: bindings.map(bindingWire) }),
	});
}

export async function setInstanceEnabled(fetcher: ImFetch, id: string, enabled: boolean): Promise<void> {
	await gatewayJson(fetcher, `/api/channels/instances/${encodeURIComponent(id)}/${enabled ? "enable" : "disable"}`, {
		method: "POST",
	});
}

export async function validateInstance(
	fetcher: ImFetch,
	id: string,
	credentials: CredentialBag,
): Promise<ValidateResult> {
	const payload = await gatewayJson(fetcher, `/api/channels/instances/${encodeURIComponent(id)}/validate`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(credentials),
	});
	if (!isRecord(payload) || payload.state !== "connected") throw new Error("Credential validation failed");
	return {
		state: "connected",
		...(isRecord(payload.identity) ? { identity: payload.identity as unknown as NonNullable<ValidateResult["identity"]> } : {}),
	};
}

export async function fetchInstanceQr(fetcher: ImFetch, id: string): Promise<Record<string, unknown>> {
	const payload = await gatewayJson(fetcher, `/api/channels/instances/${encodeURIComponent(id)}/wechat/qrcode`, {
		method: "POST",
	});
	if (!isRecord(payload)) throw new Error("WeChat QR response is malformed");
	return payload;
}

export async function runInstanceWechatAction(
	fetcher: ImFetch,
	id: string,
	action: "reconnect" | "unbind",
): Promise<void> {
	await gatewayJson(fetcher, `/api/channels/instances/${encodeURIComponent(id)}/wechat/${action}`, {
		method: "POST",
	});
}

export async function sendInstanceMessage(
	fetcher: ImFetch,
	body: { instanceId: string; to: string; text: string },
): Promise<void> {
	await gatewayJson(fetcher, "/api/channels/send", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

// ---------------------------------------------------------------------------
// Secret/credential editing (keep / set / clear)
// ---------------------------------------------------------------------------

/** What the editor holds for one credential field. `keep` never writes the mask. */
export type SecretDraft =
	| { action: "keep" }
	| { action: "set"; value: string }
	| { action: "clear" };

export interface CredentialField {
	key: string;
	label: string;
	secret: boolean;
	required?: boolean;
	/** Free text or a fixed choice (e.g. Feishu domain, QQ mode). */
	options?: readonly string[];
}

/** The credential fields the editor renders per platform (contract shapes). */
export const CREDENTIAL_FIELDS: Record<ChannelPlatform, readonly CredentialField[]> = {
	wechat: [
		{ key: "botToken", label: "Bot token", secret: true },
		{ key: "baseUrl", label: "Base URL", secret: false },
		{ key: "endpoint", label: "API endpoint", secret: false },
		{ key: "ilinkBotId", label: "iLink bot id", secret: false },
		{ key: "ilinkUserId", label: "iLink user id", secret: false },
	],
	feishu: [
		{ key: "appId", label: "App ID", secret: false, required: true },
		{ key: "appSecret", label: "App secret", secret: true, required: true },
		{ key: "domain", label: "Domain", secret: false, options: ["feishu", "lark"] },
	],
	telegram: [{ key: "botToken", label: "Bot token", secret: true, required: true }],
	discord: [
		{ key: "botToken", label: "Bot token", secret: true, required: true },
		{ key: "allowedChannels", label: "Allowed channels (one per line)", secret: false, required: true },
		{ key: "allowedUsers", label: "Allowed users (one per line)", secret: false },
	],
	qq: [
		{ key: "endpoint", label: "OneBot endpoint", secret: false },
		{ key: "token", label: "OneBot token", secret: true },
		{ key: "mode", label: "Mode", secret: false, options: ["forward", "reverse"] },
		{ key: "port", label: "Reverse listen port", secret: false },
		{ key: "selfId", label: "Bot QQ", secret: false },
		{ key: "allowedGroups", label: "Allowed groups (one per line)", secret: false },
		{ key: "allowedUsers", label: "Allowed users (one per line)", secret: false },
	],
};

/** Fields whose wire value is a string array rather than a string. */
const ARRAY_FIELDS: Record<string, true> = { allowedChannels: true, allowedUsers: true, allowedGroups: true };

/**
 * Build the masked credential bag for `PUT /api/channels/instances`:
 * keep → omit the key (the stored secret survives), clear → null,
 * set → the typed value. The mask itself is never sent as a value.
 */
export function buildCredentialDraft(
	platform: ChannelPlatform,
	original: CredentialBag,
	drafts: Record<string, SecretDraft | string>,
): CredentialBag {
	const next: CredentialBag = {};
	for (const field of CREDENTIAL_FIELDS[platform]) {
		const draft = drafts[field.key];
		if (draft === undefined) {
			const kept = original[field.key];
			if (kept !== undefined) next[field.key] = kept;
			continue;
		}
		if (typeof draft === "string") {
			next[field.key] = Object.hasOwn(ARRAY_FIELDS, field.key) ? splitLines(draft) : draft;
			continue;
		}
		if (draft.action === "keep") continue;
		if (draft.action === "clear") {
			next[field.key] = null;
			continue;
		}
		next[field.key] = Object.hasOwn(ARRAY_FIELDS, field.key) ? splitLines(draft.value) : draft.value;
	}
	// Preserve credential keys this editor does not know (future platform fields).
	for (const [key, value] of Object.entries(original)) {
		if (!(key in next) && !CREDENTIAL_FIELDS[platform].some(field => field.key === key)) next[key] = value;
	}
	return next;
}

export function splitLines(value: string): string[] {
	return value
		.split(/\r?\n|,/)
		.map(entry => entry.trim())
		.filter(entry => entry !== "");
}

export function joinedLines(value: unknown): string {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string").join("\n") : "";
}

/** A draft is "set" when the field has text, "clear" when explicitly cleared. */
export function secretDraftFor(cleared: boolean, value: string): SecretDraft {
	if (cleared) return { action: "clear" };
	return value === "" ? { action: "keep" } : { action: "set", value };
}

export function isValidInstanceId(value: string): boolean {
	return /^[a-z0-9][a-z0-9_-]{1,31}$/.test(value);
}

export function isValidProfileId(value: string): boolean {
	return isValidInstanceId(value);
}

/** A new instance id that does not collide with the current list. */
export function suggestInstanceId(platform: ChannelPlatform, existing: readonly ChannelInstance[]): string {
	const used = new Set(existing.map(instance => instance.id));
	if (!used.has(platform)) return platform;
	for (let index = 2; index < 100; index++) {
		const candidate = `${platform}-${index}`;
		if (!used.has(candidate)) return candidate;
	}
	return `${platform}-${Date.now().toString(36)}`;
}

/** The binding key the backend enforces: one row per instance+chat+thread+user. */
export function bindingKey(binding: Pick<ImBinding, "instanceId" | "chatId" | "threadId" | "userId">): string {
	return [binding.instanceId, binding.chatId, binding.threadId ?? "", binding.userId ?? ""].join("\u0000");
}

/** Target availability for a row; unknown targets are never silently valid. */
export function targetState(binding: Pick<ImBinding, "targetAvailable" | "targetReason" | "needsReview">): {
	available: boolean;
	reason: string | null;
} {
	if (binding.needsReview === true) return { available: false, reason: binding.targetReason ?? "needsReview" };
	if (binding.targetAvailable === false) return { available: false, reason: binding.targetReason ?? "target-unavailable" };
	return { available: true, reason: null };
}

/** Defaults for a brand-new profile: empty allowlists, no ambient tools. */
export function emptyProfile(id: string): ImAgentProfile {
	return {
		id,
		label: id,
		persona: { mode: "inline", text: "" },
		location: { kind: "workspace", workspace: "main" },
		tools: {
			builtin: [],
			extensions: [],
			mcpServers: [],
			customTools: [],
			skills: [],
			commands: [],
			approvalMode: "yolo",
		},
		memory: { backend: "off", workspaceContext: false },
	};
}
