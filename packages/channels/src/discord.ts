/**
 * Discord channel — official Bot API over the Gateway v10 WebSocket.
 *
 * Inbound: `MESSAGE_CREATE` from `MESSAGE_CONTENT` (privileged intent) in
 * guild channels and DMs. A guild message only reaches the agent when the bot
 * is @mentioned or the user replies to one of its messages; DMs always do.
 * Mentions are stripped before the text is delivered.
 *
 * Attachments: Discord hands out signed CDN URLs that expire, so they are
 * downloaded immediately (bounded size/count) and reported as local paths.
 *
 * Slash commands are answered locally (`/help`, `/status`) with an ephemeral
 * interaction response — they never start an agent turn, which keeps the
 * three-second interaction deadline out of the turn path.
 *
 * Reconnect: replies to `HELLO` with heartbeats, resumes with `RESUME` when a
 * session id exists, re-IDENTIFYs after `INVALID_SESSION`, and backs off with
 * jitter. Fatal close codes (bad token / disallowed intents) stop the loop and
 * surface `auth-failed` instead of hammering the gateway.
 */

import { logger } from "@linxiraos/pi-utils";
import {
	DEFAULT_MAX_ATTACHMENT_BYTES,
	DEFAULT_MAX_ATTACHMENTS_PER_MESSAGE,
	storeAttachments,
	type AttachmentSource,
} from "./attachments";
import type {
	ChannelCapabilities,
	ChannelHealth,
	ChannelHealthState,
	ChannelSendOptions,
	ChatChannel,
	ChatImage,
	InboundAttachment,
	InboundMessage,
} from "./channel";
import { bunSocketFactory, socketOpen, type SocketFactory, type SocketLike } from "./socket";
import { splitText } from "./text";

export type DiscordInboundHandler = (message: InboundMessage) => void;

export interface DiscordChannelOptions {
	instanceId?: string;
	botToken: string;
	onMessage: DiscordInboundHandler;
	/** Gateway URL override (tests). */
	gatewayUrl?: string;
	/** REST origin including the API version (tests). */
	apiBase?: string;
	/** Inbound attachment inbox root; omit to keep expiring URLs only. */
	attachmentDir?: string;
	maxAttachmentBytes?: number;
	maxAttachments?: number;
	customFetch?: typeof globalThis.fetch;
	createSocket?: SocketFactory;
	/** Test seams for backoff and scheduling. */
	sleep?: (ms: number) => Promise<void>;
	random?: () => number;
	maxReconnectAttempts?: number;
	/** 0 disables the heartbeat (tests). */
	heartbeat?: boolean;
}

const DEFAULT_GATEWAY = "wss://gateway.discord.gg/?v=10&encoding=json";
const DEFAULT_API_BASE = "https://discord.com/api/v10";
const MAX_TEXT = 2_000;
const INTENTS =
	(1 << 0) | // GUILDS
	(1 << 9) | // GUILD_MESSAGES
	(1 << 12) | // DIRECT_MESSAGES
	(1 << 15); // MESSAGE_CONTENT (privileged)

/** Close codes that mean "do not reconnect": bad auth, intents, or shard config. */
const FATAL_CLOSE_CODES = new Set([4004, 4010, 4011, 4012, 4013, 4014]);

interface DiscordUser {
	id?: string;
	username?: string;
	global_name?: string | null;
	bot?: boolean;
}

interface DiscordAttachmentPayload {
	id?: string;
	filename?: string;
	content_type?: string | null;
	size?: number;
	url?: string;
}

interface DiscordMessagePayload {
	id?: string;
	channel_id?: string;
	guild_id?: string | null;
	content?: string;
	author?: DiscordUser;
	mentions?: DiscordUser[];
	attachments?: DiscordAttachmentPayload[];
	message_reference?: { message_id?: string };
	referenced_message?: { author?: DiscordUser } | null;
	timestamp?: string;
}

interface DiscordInteractionPayload {
	id?: string;
	application_id?: string;
	token?: string;
	type?: number;
	data?: { name?: string };
	channel_id?: string;
}

interface GatewayPayload {
	op?: number;
	d?: unknown;
	t?: string;
	s?: number;
}

function record(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function text(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function number(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** The bot user id from a `READY` payload. */
function readyUserId(d: unknown): string {
	const ready = record(d);
	const user = record(ready?.user);
	return text(user?.id);
}

/** `resume_gateway_url`, when the platform supplied one. */
function readyResumeUrl(d: unknown): string | undefined {
	const value = text(record(d)?.resume_gateway_url);
	return value === "" ? undefined : `${value.replace(/\/+$/, "")}/?v=10&encoding=json`;
}

export class DiscordChannel implements ChatChannel {
	readonly id: string;
	readonly platform = "discord" as const;
	readonly capabilities: ChannelCapabilities = {
		maxTextLength: MAX_TEXT,
		supportsImages: true,
		supportsFiles: true,
		supportsTyping: true,
	};

	readonly #botToken: string;
	readonly #onMessage: DiscordInboundHandler;
	readonly #gatewayUrl: string;
	readonly #apiBase: string;
	readonly #attachmentDir: string | undefined;
	readonly #maxAttachmentBytes: number;
	readonly #maxAttachments: number;
	readonly #fetch: typeof globalThis.fetch;
	readonly #createSocket: SocketFactory;
	readonly #sleep: (ms: number) => Promise<void>;
	readonly #random: () => number;
	readonly #maxReconnectAttempts: number;
	readonly #heartbeatEnabled: boolean;

	#socket: SocketLike | null = null;
	#started = false;
	#closed = false;
	#botUserId = "";
	#sessionId: string | null = null;
	#resumeUrl: string | undefined;
	#seq: number | null = null;
	#heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	#heartbeatAcked = true;
	#reconnectTask: Promise<void> | null = null;
	#reconnectAttempts = 0;
	#lastMessageId = "";
	#health: ChannelHealth = { state: "stopped", since: Date.now() };

	constructor(options: DiscordChannelOptions) {
		this.id = options.instanceId ?? "discord";
		this.#botToken = options.botToken;
		this.#onMessage = options.onMessage;
		this.#gatewayUrl = options.gatewayUrl ?? DEFAULT_GATEWAY;
		this.#apiBase = (options.apiBase ?? DEFAULT_API_BASE).replace(/\/+$/, "");
		this.#attachmentDir = options.attachmentDir;
		this.#maxAttachmentBytes = options.maxAttachmentBytes ?? DEFAULT_MAX_ATTACHMENT_BYTES;
		this.#maxAttachments = options.maxAttachments ?? DEFAULT_MAX_ATTACHMENTS_PER_MESSAGE;
		this.#fetch = options.customFetch ?? globalThis.fetch;
		this.#createSocket = options.createSocket ?? bunSocketFactory;
		this.#sleep = options.sleep ?? (ms => Bun.sleep(ms));
		this.#random = options.random ?? Math.random;
		this.#maxReconnectAttempts = options.maxReconnectAttempts ?? Number.POSITIVE_INFINITY;
		this.#heartbeatEnabled = options.heartbeat !== false;
	}

	getHealth(): ChannelHealth {
		return { ...this.#health };
	}

	async start(): Promise<void> {
		if (this.#started) return;
		this.#started = true;
		this.#closed = false;
		this.#setHealth("connecting", "opening gateway");
		await this.#dial();
	}

	async stop(): Promise<void> {
		if (!this.#started) return;
		this.#started = false;
		this.#closed = true;
		this.#stopHeartbeat();
		const socket = this.#socket;
		this.#socket = null;
		socket?.close(1000, "channel stopped");
		this.#setHealth("stopped");
	}

	async sendTyping(to: string): Promise<void> {
		await this.#api(`/channels/${encodeURIComponent(to)}/typing`, { method: "POST" }).catch(() => {});
	}

	async sendText(to: string, body: string, options?: ChannelSendOptions): Promise<void> {
		const chunks = splitText(body, MAX_TEXT);
		for (const [index, chunk] of chunks.entries()) {
			const replyTo = index === 0 ? options?.replyToMessageId : undefined;
			await this.#api(`/channels/${encodeURIComponent(to)}/messages`, {
				method: "POST",
				body: JSON.stringify({
					content: chunk,
					...(replyTo ? { message_reference: { message_id: replyTo, fail_if_not_exists: false } } : {}),
				}),
			});
		}
	}

	async sendImage(to: string, image: ChatImage, caption?: string): Promise<void> {
		await this.#sendFiles(to, [{ data: image.data, name: "image.png", mime: image.mime }], caption);
	}

	async sendFile(
		to: string,
		file: { data: Uint8Array; name: string; mime?: string },
		caption?: string,
	): Promise<void> {
		await this.#sendFiles(to, [file], caption);
	}

	async #sendFiles(
		to: string,
		files: readonly { data: Uint8Array; name: string; mime?: string }[],
		caption?: string,
	): Promise<void> {
		const form = new FormData();
		const attachments = files.map((file, index) => ({ id: String(index), filename: file.name }));
		form.append("payload_json", JSON.stringify({ content: caption ?? "", attachments }));
		for (const [index, file] of files.entries()) {
			form.append(
				`files[${index}]`,
				new Blob([file.data], { type: file.mime ?? "application/octet-stream" }),
				file.name,
			);
		}
		await this.#api(`/channels/${encodeURIComponent(to)}/messages`, { method: "POST", body: form });
	}

	#setHealth(state: ChannelHealthState, detail?: string, lastError?: string): void {
		this.#health = {
			state,
			since: Date.now(),
			...(detail ? { detail } : {}),
			...(lastError ? { lastError } : {}),
			...(this.#health.lastInboundAt === undefined ? {} : { lastInboundAt: this.#health.lastInboundAt }),
		};
	}

	/** One REST call with 429 handling; errors never echo the token. */
	async #api(pathname: string, init: RequestInit): Promise<unknown> {
		const headers: Record<string, string> = {
			authorization: `Bot ${this.#botToken}`,
			...(init.body instanceof FormData ? {} : { "content-type": "application/json" }),
		};
		for (let attempt = 0; ; attempt++) {
			const response = await this.#fetch(`${this.#apiBase}${pathname}`, { ...init, headers });
			if (response.status === 429) {
				const body = record(await response.json().catch(() => null));
				const retryAfter = number(body?.retry_after) ?? Number(response.headers.get("retry-after") ?? "1");
				if (attempt >= 2) throw new Error(`Discord rate limited on ${pathname}`);
				await this.#sleep(Math.max(0, retryAfter) * 1_000 + 100 + Math.floor(this.#random() * 400));
				continue;
			}
			if (response.status === 401) throw new Error("Discord rejected the bot token (HTTP 401)");
			if (!response.ok) {
				const detail = await response.text().catch(() => "");
				throw new Error(
					`Discord ${pathname} failed (HTTP ${response.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`,
				);
			}
			if (response.status === 204) return undefined;
			return await response.json().catch(() => undefined);
		}
	}

	/** Dial once; resolves when the socket is open (READY arrives later). */
	#dial(): Promise<void> {
		const url = this.#sessionId && this.#resumeUrl ? this.#resumeUrl : this.#gatewayUrl;
		const { promise, resolve, reject } = Promise.withResolvers<void>();
		let settled = false;
		let socket: SocketLike;
		try {
			socket = this.#createSocket(url, {});
		} catch (error) {
			reject(error instanceof Error ? error : new Error(String(error)));
			return promise;
		}
		this.#socket = socket;
		socket.onOpen(() => {
			if (settled) return;
			settled = true;
			this.#reconnectAttempts = 0;
			this.#setHealth("connecting", "gateway open");
			resolve();
		});
		socket.onError(error => {
			const message = error instanceof Error ? error.message : "gateway error";
			this.#setHealth("degraded", undefined, message);
			if (settled) return;
			settled = true;
			reject(new Error(`Discord gateway connection failed: ${message}`));
		});
		socket.onClose((code, reason) => {
			if (this.#socket === socket) this.#socket = null;
			this.#stopHeartbeat();
			if (!this.#started || this.#closed) {
				this.#setHealth("stopped");
				return;
			}
			if (!settled) {
				settled = true;
				reject(new Error(`Discord gateway closed before ready (code ${code}${reason ? `: ${reason}` : ""})`));
			}
			if (FATAL_CLOSE_CODES.has(code)) {
				const detail =
					code === 4004
						? "invalid bot token"
						: code === 4013 || code === 4014
							? "MESSAGE_CONTENT intent is not enabled for this bot"
							: `gateway closed with code ${code}`;
				this.#setHealth("auth-failed", detail, detail);
				return;
			}
			this.#scheduleReconnect(`gateway closed (code ${code})`);
		});
		socket.onMessage(data => this.#handleFrame(data));
		return promise;
	}

	#scheduleReconnect(detail: string): void {
		if (this.#closed || !this.#started || this.#reconnectTask) return;
		this.#setHealth("connecting", detail);
		this.#reconnectTask = (async () => {
			try {
				while (this.#started && !this.#closed) {
					if (this.#reconnectAttempts >= this.#maxReconnectAttempts) {
						this.#setHealth("degraded", "reconnect attempts exhausted");
						return;
					}
					const attempt = this.#reconnectAttempts++;
					const delay = Math.min(60_000, 1_000 * 2 ** attempt) * (0.8 + this.#random() * 0.4);
					await this.#sleep(Math.round(delay));
					if (this.#closed || !this.#started) return;
					try {
						await this.#dial();
						return;
					} catch (error) {
						this.#setHealth("degraded", undefined, error instanceof Error ? error.message : String(error));
					}
				}
			} finally {
				this.#reconnectTask = null;
			}
		})();
	}

	#sendOp(op: number, d: unknown): void {
		if (!socketOpen(this.#socket)) return;
		this.#socket?.send(JSON.stringify({ op, d }));
	}

	#identify(): void {
		this.#sendOp(2, {
			token: this.#botToken,
			intents: INTENTS,
			properties: { os: process.platform, browser: "zeta", device: "zeta" },
		});
	}

	#handleFrame(raw: string): void {
		let payload: GatewayPayload;
		try {
			payload = JSON.parse(raw) as GatewayPayload;
		} catch {
			return;
		}
		if (typeof payload.s === "number") this.#seq = payload.s;
		switch (payload.op) {
			case 10: {
				const interval = number(record(payload.d)?.["heartbeat_interval"]) ?? 41_250;
				this.#startHeartbeat(interval);
				if (this.#sessionId && this.#seq !== null) {
					this.#sendOp(6, { token: this.#botToken, session_id: this.#sessionId, seq: this.#seq });
				} else {
					this.#identify();
				}
				return;
			}
			case 11:
				this.#heartbeatAcked = true;
				return;
			case 1:
				this.#heartbeatAcked = true;
				this.#sendOp(1, this.#seq);
				return;
			case 7:
				this.#socket?.close(4000, "reconnect requested");
				return;
			case 9:
				this.#sessionId = null;
				this.#seq = null;
				this.#resumeUrl = undefined;
				this.#identify();
				return;
			case 0:
				this.#handleDispatch(payload);
				return;
			default:
				return;
		}
	}

	#startHeartbeat(interval: number): void {
		if (!this.#heartbeatEnabled) return;
		this.#stopHeartbeat();
		this.#heartbeatAcked = true;
		const beat = (): void => {
			if (!this.#started || this.#closed) return;
			if (!this.#heartbeatAcked) {
				this.#socket?.terminate?.();
				this.#socket?.close(4000, "heartbeat ack missing");
				return;
			}
			this.#heartbeatAcked = false;
			this.#sendOp(1, this.#seq);
		};
		const first = setTimeout(beat, Math.floor(interval * this.#random()));
		(first as { unref?: () => void }).unref?.();
		this.#heartbeatTimer = setInterval(beat, interval);
		(this.#heartbeatTimer as { unref?: () => void }).unref?.();
	}

	#stopHeartbeat(): void {
		if (this.#heartbeatTimer) {
			clearInterval(this.#heartbeatTimer);
			this.#heartbeatTimer = null;
		}
	}

	#handleDispatch(payload: GatewayPayload): void {
		switch (payload.t) {
			case "READY": {
				this.#botUserId = readyUserId(payload.d);
				this.#sessionId = text(record(payload.d)?.session_id);
				this.#resumeUrl = readyResumeUrl(payload.d);
				this.#setHealth("ready", "gateway ready");
				return;
			}
			case "RESUMED":
				this.#setHealth("ready", "gateway resumed");
				return;
			case "MESSAGE_CREATE": {
				const message = payload.d as DiscordMessagePayload;
				void this.#handleMessage(message).catch(error => {
					logger.warn("Discord message handling failed", {
						error: error instanceof Error ? error.message : String(error),
					});
				});
				return;
			}
			case "INTERACTION_CREATE": {
				void this.#handleInteraction(payload.d as DiscordInteractionPayload).catch(error => {
					logger.warn("Discord interaction failed", {
						error: error instanceof Error ? error.message : String(error),
					});
				});
				return;
			}
			default:
				return;
		}
	}

	async #handleMessage(message: DiscordMessagePayload): Promise<void> {
		const messageId = text(message.id);
		if (messageId === "" || messageId === this.#lastMessageId) return;
		this.#lastMessageId = messageId;

		const author = message.author;
		if (!author || author.bot === true) return;
		const senderId = text(author.id);
		if (senderId === "" || senderId === this.#botUserId) return;

		const isDirect = !message.guild_id;
		const mentioned =
			this.#botUserId !== "" &&
			(text(message.content).includes(`<@${this.#botUserId}>`) ||
				text(message.content).includes(`<@!${this.#botUserId}>`) ||
				(message.mentions ?? []).some(user => user.id === this.#botUserId));
		const repliedToBot = message.referenced_message?.author?.id === this.#botUserId;
		if (!isDirect && !mentioned && !repliedToBot) return;

		let body = text(message.content);
		if (this.#botUserId !== "") {
			body = body.replaceAll(`<@${this.#botUserId}>`, " ").replaceAll(`<@!${this.#botUserId}>`, " ");
		}
		body = body.trim();

		const attachments = await this.#downloadAttachments(message);
		if (body === "" && attachments.length === 0) return;

		const peer = text(message.channel_id);
		if (peer === "") return;
		const timestamp = Date.parse(text(message.timestamp));
		const replyTo = text(message.message_reference?.message_id);

		this.#health = { ...this.#health, lastInboundAt: Date.now() };
		this.#onMessage({
			peer,
			chatType: isDirect ? "dm" : "channel",
			senderId,
			senderName: text(author.global_name) || text(author.username) || senderId,
			body,
			messageId,
			...(replyTo === "" ? {} : { replyToMessageId: replyTo }),
			...(attachments.length > 0 ? { attachments } : {}),
			allowKeys: isDirect ? [peer] : [peer, `guild:${text(message.guild_id)}`].filter(key => key !== "guild:"),
			ts: Number.isFinite(timestamp) ? timestamp : Date.now(),
		});
	}

	async #downloadAttachments(message: DiscordMessagePayload): Promise<InboundAttachment[]> {
		const listed = (message.attachments ?? []).filter(item => text(item.url) !== "");
		if (listed.length === 0) return [];
		const sources: AttachmentSource[] = listed.map(item => ({
			url: text(item.url),
			name: text(item.filename),
			...(text(item.content_type) ? { mime: text(item.content_type) } : {}),
			kind: text(item.content_type).startsWith("image/") ? "image" : "file",
		}));
		if (!this.#attachmentDir) {
			return sources.map(source => ({
				kind: source.kind ?? "file",
				...(source.url ? { url: source.url } : {}),
				...(source.name ? { name: source.name } : {}),
			}));
		}
		return await storeAttachments(sources, {
			dir: this.#attachmentDir,
			messageKey: text(message.id) || crypto.randomUUID(),
			maxBytes: this.#maxAttachmentBytes,
			maxPerMessage: this.#maxAttachments,
			fetch: this.#fetch,
		});
	}

	async #handleInteraction(interaction: DiscordInteractionPayload): Promise<void> {
		const id = text(interaction.id);
		const token = text(interaction.token);
		if (id === "" || token === "") return;
		const name = text(interaction.data?.name);
		const content =
			name === "status"
				? `Zeta channel: ${this.#health.state}${this.#health.detail ? ` (${this.#health.detail})` : ""}`
				: "Zeta bot is online. Send a message here to talk to the agent.";
		await this.#api(`/interactions/${id}/${token}/callback`, {
			method: "POST",
			body: JSON.stringify({ type: 4, data: { content, flags: 64 } }),
		});
	}
}
