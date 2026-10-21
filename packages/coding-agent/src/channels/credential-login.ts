/**
 * Credential pairing for the two token channels (`login feishu`,
 * `login telegram`).
 *
 * WeChat pairs by QR because it authenticates a *user* account. Feishu and
 * Telegram authenticate a *bot*, whose credential is an app id/secret or a bot
 * token the user copies out of the platform console. Both flows here do the
 * same four things the QR flow does:
 *
 * 1. validate the credential against the platform before anything is written,
 * 2. report the bot identity the platform returned,
 * 3. persist only after the platform accepted it (through the same
 *    `WebConfig` every other surface uses),
 * 4. expose the same state words as `wechat-login` (`pending → connected`, with
 *    `timeout` and `error` for the two failure modes).
 *
 * There is no QR code and no second persistence path. `channels logout` already
 * unbinds both channels by emptying the secret fields.
 */

import type { FeishuChannelConfig, TelegramChannelConfig, WebConfig, WebConfigData } from "../config/web-config";

/** Channels that pair with a pasted credential instead of a QR code. */
export type CredentialChannel = "feishu" | "telegram";

/**
 * The same terminal states `wechat-login` reports. `pending` never escapes
 * this module — it is the state while a network validation is in flight, which
 * the CLI renders as "validating" and the GUI models as `Validating`.
 */
export type CredentialLoginState = "pending" | "connected" | "timeout" | "error";

/** The bot the platform says the credential belongs to. Never a secret. */
export interface CredentialIdentity {
	/** Platform id: Feishu `open_id`, Telegram bot id. */
	id: string;
	/** Display name: Feishu app name, Telegram first name. */
	name: string;
	/** Telegram `@username` (without the `@`), when the bot has one. */
	username?: string;
}

export interface CredentialLoginResult {
	channel: CredentialChannel;
	state: CredentialLoginState;
	identity: CredentialIdentity | null;
	/** True only when the platform accepted the credential and it was written. */
	credentialsPersisted: boolean;
	error?: string;
}

export interface CredentialLoginOptions {
	webConfig: WebConfig;
	/** Blank/absent fields fall back to the credentials already in `web.yml`. */
	appId?: string;
	appSecret?: string;
	domain?: "feishu" | "lark";
	botToken?: string;
	/** How long one platform request may take (default 15 s). */
	timeoutMs?: number;
	/** Test seam: swaps `globalThis.fetch` for a stub HTTP endpoint. */
	customFetch?: typeof globalThis.fetch;
	/** Test seam: overrides the platform origin (Feishu also honours `domain`). */
	baseUrl?: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** Feishu Open Platform origins; `lark` is the international deployment. */
const FEISHU_BASE = {
	feishu: "https://open.feishu.cn",
	lark: "https://open.larksuite.com",
} as const;

const TELEGRAM_BASE = "https://api.telegram.org";

/** A platform request that exceeded {@link CredentialLoginOptions.timeoutMs}. */
export class CredentialTimeoutError extends Error {
	constructor() {
		super("The credential check timed out");
		this.name = "CredentialTimeoutError";
	}
}

/** The platform answered, but rejected the credential. */
export class CredentialRejectedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CredentialRejectedError";
	}
}

/**
 * Replace every occurrence of a secret with bullets. Platform messages are
 * normally secret-free ("app secret invalid"), but a proxy or a misconfigured
 * endpoint can echo the request, and the CLI must never print a credential.
 */
export function redactSecrets(message: string, secrets: ReadonlyArray<string | undefined>): string {
	let redacted = message;
	for (const secret of secrets) {
		const trimmed = secret?.trim() ?? "";
		if (trimmed.length === 0) continue;
		redacted = redacted.split(trimmed).join("••••");
	}
	return redacted;
}

/** `App Name (@bot)` — the identity line the CLI and GUI show. */
export function formatCredentialIdentity(identity: CredentialIdentity | null): string {
	if (!identity) return "";
	const name = identity.name.trim() || identity.id.trim();
	const username = identity.username?.trim() ?? "";
	if (username) return `${name} (@${username})`;
	const id = identity.id.trim();
	return id && id !== name ? `${name} (${id})` : name;
}

interface JsonResponse {
	status: number;
	body: unknown;
}

/** One bounded JSON request; never includes the request URL in an error. */
async function postJson(
	fetchImpl: typeof globalThis.fetch,
	url: string,
	init: RequestInit,
	timeoutMs: number,
): Promise<JsonResponse> {
	let response: Response;
	try {
		response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(Math.max(1, timeoutMs)) });
	} catch (error) {
		const name = error instanceof Error ? error.name : "";
		if (name === "TimeoutError" || name === "AbortError") throw new CredentialTimeoutError();
		throw new CredentialRejectedError(error instanceof Error ? error.message : String(error));
	}
	const text = await response.text().catch(() => "");
	let body: unknown = text;
	if (text.trim() !== "") {
		try {
			body = JSON.parse(text);
		} catch {
			body = text;
		}
	} else {
		body = {};
	}
	return { status: response.status, body };
}

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

/** A human message from a platform payload, without echoing the request. */
function platformMessage(body: unknown, fallback: string): string {
	const root = record(body);
	const detail = text(root.msg) || text(root.message) || text(root.description) || text(root.error);
	if (!detail) return fallback;
	const code = root.code ?? root.error_code;
	return code === undefined ? detail : `${detail} (code ${String(code)})`;
}

/** Failures that mean "the platform said no", not "the network broke". */
function rejected(message: string, ...secrets: Array<string | undefined>): CredentialRejectedError {
	return new CredentialRejectedError(redactSecrets(message, secrets));
}

/**
 * Validate a Feishu/Lark app credential: exchange app id + secret for a
 * `tenant_access_token`, then read the bot identity with that token.
 *
 * Both steps are required — a valid token for an app without the bot capability
 * cannot host a channel, and reporting "connected" there would be a lie.
 */
export async function validateFeishuCredentials(options: {
	appId: string;
	appSecret: string;
	domain?: "feishu" | "lark";
	timeoutMs?: number;
	customFetch?: typeof globalThis.fetch;
	baseUrl?: string;
}): Promise<CredentialIdentity> {
	const fetchImpl = options.customFetch ?? globalThis.fetch;
	const base = (options.baseUrl ?? FEISHU_BASE[options.domain ?? "feishu"]).replace(/\/+$/, "");
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const secrets = [options.appSecret];

	const tokenReply = await postJson(
		fetchImpl,
		`${base}/open-apis/auth/v3/tenant_access_token/internal`,
		{
			method: "POST",
			headers: { "content-type": "application/json; charset=utf-8" },
			body: JSON.stringify({ app_id: options.appId, app_secret: options.appSecret }),
		},
		timeoutMs,
	);
	const tokenBody = record(tokenReply.body);
	if (tokenReply.status < 200 || tokenReply.status >= 300 || Number(tokenBody.code ?? 0) !== 0) {
		throw rejected(
			`Feishu rejected the app credentials: ${platformMessage(tokenReply.body, `HTTP ${tokenReply.status}`)}`,
			...secrets,
		);
	}
	const accessToken = text(tokenBody.tenant_access_token);
	if (!accessToken) {
		throw rejected("Feishu returned no tenant access token", ...secrets);
	}

	const infoReply = await postJson(
		fetchImpl,
		`${base}/open-apis/bot/v3/info`,
		{ method: "GET", headers: { authorization: `Bearer ${accessToken}` } },
		timeoutMs,
	);
	const infoBody = record(infoReply.body);
	if (infoReply.status < 200 || infoReply.status >= 300 || Number(infoBody.code ?? 0) !== 0) {
		throw rejected(
			`Feishu issued a token but the bot identity lookup failed: ${platformMessage(infoBody, `HTTP ${infoReply.status}`)}`,
			...secrets,
			accessToken,
		);
	}
	const bot = record(infoBody.bot);
	const id = text(bot.open_id) || text(bot.app_id) || options.appId;
	const name = text(bot.app_name) || id;
	if (!name) {
		throw rejected("Feishu did not report a bot identity", ...secrets, accessToken);
	}
	return { id, name };
}

/**
 * Validate a Telegram bot token with the Bot API's `getMe`. The token is part
 * of the URL path, which is why every error message is redacted before it can
 * reach a terminal.
 */
export async function validateTelegramToken(options: {
	botToken: string;
	timeoutMs?: number;
	customFetch?: typeof globalThis.fetch;
	baseUrl?: string;
}): Promise<CredentialIdentity> {
	const fetchImpl = options.customFetch ?? globalThis.fetch;
	const base = (options.baseUrl ?? TELEGRAM_BASE).replace(/\/+$/, "");
	const reply = await postJson(
		fetchImpl,
		`${base}/bot${options.botToken}/getMe`,
		{ method: "GET" },
		options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
	);
	const body = record(reply.body);
	if (reply.status < 200 || reply.status >= 300 || body.ok !== true) {
		throw rejected(
			`Telegram rejected the bot token: ${platformMessage(body, `HTTP ${reply.status}`)}`,
			options.botToken,
		);
	}
	const result = record(body.result);
	const id = result.id === undefined || result.id === null ? "" : String(result.id);
	const name = text(result.first_name) || text(result.username) || id;
	if (!name) throw rejected("Telegram did not report a bot identity", options.botToken);
	const username = text(result.username);
	return { id, name, ...(username ? { username } : {}) };
}

function readStored(
	data: WebConfigData,
	channel: CredentialChannel,
): {
	appId?: string;
	appSecret?: string;
	domain?: "feishu" | "lark";
	botToken?: string;
} {
	if (channel === "feishu") {
		const feishu = data.channels.feishu as FeishuChannelConfig;
		return { appId: feishu.appId, appSecret: feishu.appSecret, domain: feishu.domain };
	}
	const telegram = data.channels.telegram as TelegramChannelConfig;
	return { botToken: telegram.botToken };
}

/**
 * Validate one pasted credential and persist it only after the platform
 * accepted it. Blank options fall back to what `web.yml` already holds, so
 * "validate the stored credentials" and "replace them" are the same call.
 */
export async function runCredentialLogin(
	channel: CredentialChannel,
	options: CredentialLoginOptions,
): Promise<CredentialLoginResult> {
	const stored = readStored(options.webConfig.getData(), channel);
	const secrets = [options.appSecret, options.botToken, stored.appSecret, stored.botToken];
	const fail = (state: CredentialLoginState, message: string): CredentialLoginResult => ({
		channel,
		state,
		identity: null,
		credentialsPersisted: false,
		error: redactSecrets(message, secrets),
	});

	try {
		if (channel === "feishu") {
			const appId = options.appId?.trim() || stored.appId?.trim() || "";
			const appSecret = options.appSecret?.trim() || stored.appSecret?.trim() || "";
			const domain = options.domain ?? stored.domain ?? "feishu";
			if (!appId || !appSecret) {
				return fail("error", "Feishu needs an App ID and an App Secret");
			}
			const identity = await validateFeishuCredentials({
				appId,
				appSecret,
				domain,
				...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
				...(options.customFetch ? { customFetch: options.customFetch } : {}),
				...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
			});
			await options.webConfig.set("channels.feishu.appId", appId);
			await options.webConfig.set("channels.feishu.appSecret", appSecret);
			await options.webConfig.set("channels.feishu.domain", domain);
			return { channel, state: "connected", identity, credentialsPersisted: true };
		}

		const botToken = options.botToken?.trim() || stored.botToken?.trim() || "";
		if (!botToken) return fail("error", "Telegram needs a bot token");
		const identity = await validateTelegramToken({
			botToken,
			...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
			...(options.customFetch ? { customFetch: options.customFetch } : {}),
			...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
		});
		await options.webConfig.set("channels.telegram.botToken", botToken);
		return { channel, state: "connected", identity, credentialsPersisted: true };
	} catch (error) {
		if (error instanceof CredentialTimeoutError) return fail("timeout", error.message);
		return fail("error", error instanceof Error ? error.message : String(error));
	}
}
