/**
 * Work Studio → IM channels: the data layer.
 *
 * The gateway owns every fact this pane shows — `~/.zeta/agent/web.yml`
 * (`GET`/`PUT /api/web-config`) and the live `zetacode serve` channel runtime
 * (`/api/channels/*`). Device, pairing, remote-token and TOTP facts live in
 * `securityApi.ts` (Settings → 身份与设备). This module only shapes requests and
 * responses: it keeps no cache, stores no credential, and never invents a
 * value the server did not send.
 *
 * The functions take a `fetcher` so the tests can drive real response shapes
 * without a live server; production passes the global `fetch` (same origin,
 * exactly like the raw-config editor).
 */

import { isRecord } from "../typeGuards";
import { defaultGatewayFetch, gatewayJson, type GatewayFetch } from "./gatewayRequest";

export const CHANNEL_IDS = ["wechat", "feishu", "telegram", "discord", "qq"] as const;
export type ChannelId = (typeof CHANNEL_IDS)[number];

/** The mask `GET /api/web-config` uses in place of every stored secret. */
export const MASKED_SECRET = "••••";

/** Alias kept for the pane and its tests; the transport lives in gatewayRequest.ts. */
export type ChannelsFetch = GatewayFetch;

const defaultFetch: ChannelsFetch = defaultGatewayFetch;

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

/** One channel's live membership in the serve runtime. */
export interface ChannelStatusEntry {
	id: ChannelId;
	running: boolean;
}

export interface WechatChannelView {
	enabled: boolean;
	workspaceRoot?: string;
	/** Masked (`••••`) when a token is stored. */
	botToken?: string;
	ilinkBotId?: string;
}

export interface FeishuChannelView {
	enabled: boolean;
	workspaceRoot?: string;
	appId?: string;
	/** Masked (`••••`) when a secret is stored. */
	appSecret?: string;
	domain?: "feishu" | "lark";
}

export interface TelegramChannelView {
	enabled: boolean;
	workspaceRoot?: string;
	/** Masked (`••••`) when a token is stored. */
	botToken?: string;
}

export interface DiscordChannelView {
	enabled: boolean;
	workspaceRoot?: string;
	/** Masked (`••••`) when a token is stored. */
	botToken?: string;
}

export interface QqChannelView {
	enabled: boolean;
	workspaceRoot?: string;
	endpoint?: string;
	/** Masked (`••••`) when a token is stored. */
	token?: string;
	mode?: "forward" | "reverse";
}

export interface WebConfigView {
	channels: {
		wechat: WechatChannelView;
		feishu: FeishuChannelView;
		telegram: TelegramChannelView;
		discord: DiscordChannelView;
		qq: QqChannelView;
	};
	remote: {
		workspaces?: unknown;
		sessionMappings?: unknown;
		botSessions?: unknown;
	};
}

/**
 * One persisted chat → target binding (`remote.sessionMappings`). Only the
 * fields this pane edits are named; every other key the router wrote (`userId`,
 * `chatType`, `connectionId`, `mode`, `lang`, future fields) rides along
 * untouched because a binding edit rewrites the object, not the row.
 */
export interface ChatBinding {
	platform: ChannelId;
	chatId: string;
	workspaceAlias?: string;
	sessionId?: string;
	userId?: string;
	connectionId?: string;
	chatType?: string;
	mode?: "direct" | "relay";
	lang?: "zh" | "en";
	[key: string]: unknown;
}

/** A default-space bot session (`remote.botSessions`); read-only here. */
export interface BotSessionView {
	id: string;
	name: string;
	tag?: string;
	workspaceAlias?: string;
}

export interface WechatQr {
	pending: boolean;
	qrcodeUrl?: string;
	status?: string;
	/** Server-rendered scannable symbol for a page payload; absent for image payloads. */
	svg?: string;
}

export interface CredentialIdentity {
	id?: string;
	name?: string;
	username?: string;
}

export interface CredentialResult {
	channel: ChannelId;
	state: "connected" | "error" | "timeout";
	identity?: CredentialIdentity | null;
	credentialsPersisted?: boolean;
}

export type CredentialRequest =
	| { channel: "feishu"; appId?: string; appSecret?: string; domain?: "feishu" | "lark" }
	| { channel: "telegram"; botToken?: string };

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** `GET /api/channels/status` — only the channels the runtime actually started. */
export async function fetchChannelStatus(fetcher: ChannelsFetch = defaultFetch): Promise<ChannelStatusEntry[]> {
	const payload = await gatewayJson(fetcher, "/api/channels/status");
	const entries = isRecord(payload) ? payload.channels : undefined;
	if (!Array.isArray(entries)) throw new Error("Channel status response is malformed");
	const status: ChannelStatusEntry[] = [];
	for (const entry of entries) {
		if (!isRecord(entry) || !isChannelId(entry.id) || typeof entry.running !== "boolean") continue;
		status.push({ id: entry.id, running: entry.running });
	}
	return status;
}

/** `GET /api/web-config` — the merged config with every secret masked. */
export async function fetchWebConfig(fetcher: ChannelsFetch = defaultFetch): Promise<WebConfigView> {
	const payload = await gatewayJson(fetcher, "/api/web-config");
	if (!isRecord(payload) || !isRecord(payload.channels)) throw new Error("Web config response is malformed");
	const channels = payload.channels;
	const remote = isRecord(payload.remote) ? payload.remote : {};
	return {
		channels: {
			wechat: channelView<WechatChannelView>(channels.wechat, ["workspaceRoot", "botToken", "ilinkBotId"]),
			feishu: channelView<FeishuChannelView>(channels.feishu, ["workspaceRoot", "appId", "appSecret", "domain"]),
			telegram: channelView<TelegramChannelView>(channels.telegram, ["workspaceRoot", "botToken"]),
			discord: channelView<DiscordChannelView>(channels.discord, ["workspaceRoot", "botToken"]),
			qq: channelView<QqChannelView>(channels.qq, ["workspaceRoot", "endpoint", "token", "mode"]),
		},
		remote: {
			workspaces: remote.workspaces,
			sessionMappings: remote.sessionMappings,
			botSessions: remote.botSessions,
		},
	};
}

/** A channel entry, copied field by field so unknown/malformed fields stay out. */
function channelView<T>(value: unknown, keys: readonly string[]): T {
	const record = isRecord(value) ? value : {};
	const view: Record<string, unknown> = { enabled: record.enabled === true };
	for (const key of keys) {
		const field = record[key];
		if (typeof field === "string") view[key] = field;
	}
	return view as unknown as T;
}

/** `GET /api/channels/wechat/qrcode` — the live login symbol, if a login is pending. */
export async function fetchWechatQr(fetcher: ChannelsFetch = defaultFetch): Promise<WechatQr> {
	const payload = await gatewayJson(fetcher, "/api/channels/wechat/qrcode");
	if (!isRecord(payload)) throw new Error("WeChat QR response is malformed");
	const qr: WechatQr = { pending: payload.pending === true };
	if (typeof payload.qrcodeUrl === "string" && payload.qrcodeUrl !== "") qr.qrcodeUrl = payload.qrcodeUrl;
	if (typeof payload.status === "string" && payload.status !== "") qr.status = payload.status;
	if (typeof payload.svg === "string" && payload.svg !== "") qr.svg = payload.svg;
	return qr;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Known `PUT /api/web-config` paths this pane writes. */
export type WebConfigPath =
	| "channels.wechat.enabled"
	| "channels.wechat.workspaceRoot"
	| "channels.feishu.enabled"
	| "channels.feishu.workspaceRoot"
	| "channels.telegram.enabled"
	| "channels.telegram.workspaceRoot"
	| "channels.discord.enabled"
	| "channels.discord.workspaceRoot"
	| "channels.qq.enabled"
	| "channels.qq.workspaceRoot"
	| "remote.sessionMappings";

/** `PUT /api/web-config` — one dot path. The gateway restarts channels after a `channels.*` write. */
export async function putWebConfigValue(fetcher: ChannelsFetch, path: WebConfigPath, value: unknown): Promise<void> {
	await gatewayJson(fetcher, "/api/web-config", {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ path, value }),
	});
}

/**
 * `POST /api/channels/credentials` — validate against the platform, then save.
 * An empty secret means "re-validate what is stored", never "clear it".
 */
export async function validateChannelCredentials(
	fetcher: ChannelsFetch,
	body: CredentialRequest,
): Promise<CredentialResult> {
	const payload = await gatewayJson(fetcher, "/api/channels/credentials", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	if (!isRecord(payload) || payload.state !== "connected") throw new Error("Credential validation failed");
	const result: CredentialResult = { channel: body.channel, state: payload.state };
	if (isRecord(payload.identity)) result.identity = payload.identity as unknown as CredentialIdentity;
	if (typeof payload.credentialsPersisted === "boolean") result.credentialsPersisted = payload.credentialsPersisted;
	return result;
}

/** `POST /api/channels/wechat/{reconnect,unbind}`. */
export async function runWechatAction(fetcher: ChannelsFetch, action: "reconnect" | "unbind"): Promise<void> {
	await gatewayJson(fetcher, `/api/channels/wechat/${action}`, { method: "POST" });
}

/** `POST /api/channels/send` — one test message through a running channel. */
export async function sendChannelTest(
	fetcher: ChannelsFetch,
	body: { channelId: ChannelId; to: string; text: string },
): Promise<void> {
	await gatewayJson(fetcher, "/api/channels/send", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

// ---------------------------------------------------------------------------
// Pure view state
// ---------------------------------------------------------------------------

export function isChannelId(value: unknown): value is ChannelId {
	return CHANNEL_IDS.some(id => id === value);
}

/** True when the config carries a stored (masked) secret for that channel. */
export function channelConfigured(id: ChannelId, config: WebConfigView): boolean {
	if (id === "wechat") return secretPresent(config.channels.wechat.botToken);
	if (id === "feishu") return Boolean(config.channels.feishu.appId) && secretPresent(config.channels.feishu.appSecret);
	if (id === "telegram") return secretPresent(config.channels.telegram.botToken);
	if (id === "discord") return secretPresent(config.channels.discord.botToken);
	// QQ over OneBot: reverse mode needs its token, forward mode an endpoint.
	return config.channels.qq.mode === "reverse"
		? secretPresent(config.channels.qq.token)
		: Boolean(config.channels.qq.endpoint);
}

function secretPresent(value: string | undefined): boolean {
	return typeof value === "string" && value !== "";
}

/**
 * The three words this pane may show for a channel. `error` is the honest
 * "the config enables it but the runtime did not start it" state — never a
 * fabricated `running`.
 */
export type ChannelRuntimeState = "running" | "stopped" | "error";

export function channelRuntimeState(enabled: boolean, running: boolean): ChannelRuntimeState {
	if (!enabled) return "stopped";
	return running ? "running" : "error";
}

/** The runtime's `running` flag for one channel; absent means "not started". */
export function runningFor(status: readonly ChannelStatusEntry[], id: ChannelId): boolean {
	return status.some(entry => entry.id === id && entry.running);
}

/** The four WeChat login states, from the route's own words. */
export type WechatLoginStage = "unbound" | "pending" | "scanned" | "connected" | "expired";

export function wechatLoginStage(qr: WechatQr | null, hasStoredToken: boolean): WechatLoginStage {
	if (qr?.pending === true) {
		const status = (qr.status ?? "").trim().toLowerCase();
		if (status === "scaned" || status === "scanned") return "scanned";
		if (status === "confirmed" || status === "connected") return "connected";
		if (status === "expired") return "expired";
		return "pending";
	}
	// A stored token with no pending login is a completed earlier login; the
	// pane labels it "credentials saved", not "connected", because a token can
	// still be rejected by WeChat at any time.
	return hasStoredToken ? "connected" : "unbound";
}

/** The alias registry, normalizing the legacy bare-path form to a display alias. */
export function workspaceAliases(workspaces: unknown): string[] {
	if (!Array.isArray(workspaces)) return [];
	const aliases: string[] = [];
	for (const entry of workspaces) {
		if (typeof entry === "string" && entry.trim() !== "") {
			const parts = entry.split(/[\\/]/).filter(part => part !== "");
			aliases.push(parts[parts.length - 1] ?? entry);
			continue;
		}
		if (isRecord(entry) && typeof entry.alias === "string" && entry.alias !== "") aliases.push(entry.alias);
	}
	return [...new Set(aliases)];
}

/** `remote.botSessions`, narrowed to the fields a binding needs. */
export function botSessionViews(botSessions: unknown): BotSessionView[] {
	if (!Array.isArray(botSessions)) return [];
	const sessions: BotSessionView[] = [];
	for (const entry of botSessions) {
		if (!isRecord(entry)) continue;
		if (typeof entry.id !== "string" || entry.id === "") continue;
		const view: BotSessionView = { id: entry.id, name: typeof entry.name === "string" ? entry.name : entry.id };
		if (typeof entry.tag === "string") view.tag = entry.tag;
		if (typeof entry.workspaceAlias === "string") view.workspaceAlias = entry.workspaceAlias;
		sessions.push(view);
	}
	return sessions;
}

/** The binding rows, dropping entries that are not binding-shaped at all. */
export function chatBindings(sessionMappings: unknown): ChatBinding[] {
	if (!Array.isArray(sessionMappings)) return [];
	return sessionMappings.filter(
		(entry): entry is ChatBinding =>
			isRecord(entry) && isChannelId(entry.platform) && typeof entry.chatId === "string" && entry.chatId !== "",
	);
}

const KNOWN_BINDING_KEYS: Record<string, true> = {
	platform: true,
	chatId: true,
	workspaceAlias: true,
	sessionId: true,
	userId: true,
	connectionId: true,
	chatType: true,
	mode: true,
	lang: true,
};

/** Keys this pane does not edit; they are preserved verbatim on every write. */
export function unknownBindingKeys(binding: ChatBinding): string[] {
	return Object.keys(binding).filter(key => !Object.hasOwn(KNOWN_BINDING_KEYS, key));
}

/** Row identity, matching the gateway's "one binding per platform+chat+user" rule. */
export function bindingKey(binding: ChatBinding): string {
	return [binding.platform, binding.chatId, binding.userId ?? ""].join("\u0000");
}

export interface BindingDraft {
	platform: ChannelId;
	chatId: string;
	/** Empty = no workspace binding. */
	workspaceAlias: string;
	/** Empty = no bot-session pointer. */
	sessionId: string;
}

export type BindingProblem = "chatId" | "target" | "alias";

/**
 * The gateway's own validation (`web-config.ts` `mappingProblem`), mirrored so
 * the pane can disable Save instead of posting a request that will 400. An
 * `agentId` row is not a possibility here: the field is PLANNED, not stored.
 */
export function bindingProblem(draft: BindingDraft, aliases: readonly string[]): BindingProblem | null {
	if (draft.chatId.trim() === "") return "chatId";
	if (draft.workspaceAlias !== "" && !aliases.includes(draft.workspaceAlias)) return "alias";
	if (draft.workspaceAlias === "" && draft.sessionId === "") return "target";
	return null;
}

/** True when another row already owns this platform+chat key. */
export function conflictingBinding(
	rows: readonly ChatBinding[],
	draft: BindingDraft,
	target: ChatBinding | null,
): boolean {
	const key = bindingKey({ platform: draft.platform, chatId: draft.chatId });
	const targetKey = target === null ? null : bindingKey(target);
	return rows.some(row => bindingKey(row) === key && bindingKey(row) !== targetKey);
}

/**
 * Add a binding, or replace the edited one in place. Every field this pane does
 * not own (`userId`, `chatType`, `connectionId`, `mode`, `lang`, …) keeps its
 * value on an edit; clearing the alias/session deletes that key rather than
 * writing `undefined`, which the gateway would reject.
 */
export function upsertBinding(
	rows: readonly ChatBinding[],
	target: ChatBinding | null,
	draft: BindingDraft,
): ChatBinding[] {
	const next = rows.slice();
	const patched: ChatBinding = target === null ? { platform: draft.platform, chatId: draft.chatId } : { ...target };
	patched.platform = draft.platform;
	patched.chatId = draft.chatId;
	if (draft.workspaceAlias === "") delete patched.workspaceAlias;
	else patched.workspaceAlias = draft.workspaceAlias;
	if (draft.sessionId === "") delete patched.sessionId;
	else patched.sessionId = draft.sessionId;
	if (target === null) {
		next.push(patched);
		return next;
	}
	const key = bindingKey(target);
	const index = next.findIndex(row => bindingKey(row) === key);
	if (index < 0) next.push(patched);
	else next[index] = patched;
	return next;
}

/** Remove one binding by identity (not by list position). */
export function removeBinding(rows: readonly ChatBinding[], target: ChatBinding): ChatBinding[] {
	const key = bindingKey(target);
	return rows.filter(row => bindingKey(row) !== key);
}

/** Absolute paths only; the router resolves a workspace by real path. */
export function isAbsolutePath(value: string): boolean {
	return /^(?:[A-Za-z]:[\\/]|[\\/])/.test(value.trim());
}
