/**
 * QQ channel — a generic OneBot v11 adapter. The bridge is the user's own
 * process (NapCat, LLBot, SnowLuma, …); this file implements only the
 * protocol, never a bridge-specific branch.
 *
 * Transport: forward WebSocket (we dial the bridge, `Authorization: Bearer`)
 * or reverse WebSocket (the bridge dials a loopback server we own). Requests
 * are correlated by the `echo` field; events are OneBot v11 message events.
 *
 * Login/QR belongs to the bridge. Zeta stores only the endpoint, the token and
 * the optional self id; it never touches QQ credentials or local QQ data.
 *
 * Health: a socket that is merely OPEN proves nothing (a bridge can accept
 * TCP while its account is logged out), so readiness is decided by frames and
 * by a periodic `get_status` round-trip when the bridge supports it.
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
import {
	bunReverseServerFactory,
	bunSocketFactory,
	socketOpen,
	type ReverseServerFactory,
	type ReverseServerLike,
	type SocketFactory,
	type SocketLike,
} from "./socket";
import { splitText } from "./text";

export type OneBotInboundHandler = (message: InboundMessage) => void;

export type OneBotMode = "forward" | "reverse";

export interface OneBotChannelOptions {
	/** Forward mode only: ws://127.0.0.1:3001 (the bridge's OneBot server). */
	endpoint?: string;
	/** OneBot access token; sent as `Authorization: Bearer`. */
	token?: string;
	mode?: OneBotMode;
	/** Reverse mode listen port (loopback only). Default 8082. */
	reversePort?: number;
	/** Bot QQ number; read from `get_login_info` when omitted. */
	selfId?: string;
	onMessage: OneBotInboundHandler;
	/** Inbound attachment inbox root; omit to keep URLs only. */
	attachmentDir?: string;
	maxAttachmentBytes?: number;
	maxAttachments?: number;
	customFetch?: typeof globalThis.fetch;
	createSocket?: SocketFactory;
	createServer?: ReverseServerFactory;
	/** Test seams. */
	sleep?: (ms: number) => Promise<void>;
	random?: () => number;
	maxReconnectAttempts?: number;
	/** 0 disables the periodic `get_status` probe (tests). */
	probeIntervalMs?: number;
	/** 0 disables the ping/pong watchdog (tests). */
	pingIntervalMs?: number;
}

export interface OneBotSegment {
	type: string;
	data: Record<string, unknown>;
}

export interface ParsedOneBotMessage {
	text: string;
	/** QQ numbers @-mentioned in this message (`all` for @everyone). */
	mentionedIds: string[];
	replyTo?: string;
	attachments: AttachmentSource[];
}

interface OneBotEvent {
	post_type?: string;
	message_type?: string;
	message_id?: number | string;
	user_id?: number | string;
	group_id?: number | string;
	self_id?: number | string;
	message?: string | OneBotSegment[];
	sender?: { nickname?: string };
}

interface PendingCall {
	resolve(value: unknown): void;
	reject(error: Error): void;
	timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_REVERSE_PORT = 8082;
const DEFAULT_REVERSE_HOST = "127.0.0.1";
const MAX_TEXT = 4_500;
const SEND_SPACING_MS = 1_000;
const DEFAULT_PROBE_INTERVAL_MS = 60_000;
const DEFAULT_PING_INTERVAL_MS = 30_000;
const PING_TIMEOUT_MS = 65_000;

function record(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function text(value: unknown): string {
	return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

/** OneBot CQ-code escapes, per the v11 message format. */
function unescapeCq(value: string): string {
	return value.replaceAll("&#91;", "[").replaceAll("&#93;", "]").replaceAll("&#44;", ",").replaceAll("&amp;", "&");
}

function cqParams(raw: string): Record<string, string> {
	const params: Record<string, string> = {};
	for (const pair of raw.split(",")) {
		if (pair === "") continue;
		const index = pair.indexOf("=");
		if (index <= 0) continue;
		params[pair.slice(0, index)] = unescapeCq(pair.slice(index + 1));
	}
	return params;
}

/** Append text without doubling the space at a segment junction. */
function appendSegmentText(buffer: string, chunk: string): string {
	if (buffer !== "" && chunk.startsWith(" ") && buffer.endsWith(" ")) return buffer + chunk.slice(1);
	return buffer + chunk;
}

function appendAttachment(attachments: AttachmentSource[], type: string, data: Record<string, string>): void {
	const kind = type === "image" ? "image" : type === "record" ? "audio" : type === "video" ? "video" : "file";
	const name = data.name || data.file || undefined;
	const url = data.url || (data.file?.startsWith("http") ? data.file : undefined);
	const base64 = data.file?.startsWith("base64://") ? data.file.slice("base64://".length) : undefined;
	if (!url && !base64 && !name) return;
	attachments.push({ kind, ...(url ? { url } : {}), ...(base64 ? { base64 } : {}), ...(name ? { name } : {}) });
}

/**
 * Parse both OneBot message formats: the segment array (preferred) and the
 * CQ-code string older deployments still emit. Unknown segments are dropped
 * from the text instead of leaking their raw CQ code into the prompt.
 */
export function parseOneBotMessage(message: string | OneBotSegment[] | undefined): ParsedOneBotMessage {
	const parsed: ParsedOneBotMessage = { text: "", mentionedIds: [], attachments: [] };
	if (message === undefined) return parsed;
	if (Array.isArray(message)) {
		let buffer = "";
		for (const segment of message) {
			const data = record(segment.data) ?? {};
			switch (segment.type) {
				case "text":
					buffer = appendSegmentText(buffer, text(data.text));
					break;
				case "at": {
					const qq = text(data.qq);
					if (qq === "all") {
						buffer = appendSegmentText(buffer, "@全体成员 ");
						break;
					}
					if (qq !== "") parsed.mentionedIds.push(qq);
					buffer = appendSegmentText(buffer, `@${text(data.name) || qq} `);
					break;
				}
				case "reply":
					parsed.replyTo = text(data.id);
					break;
				case "image":
				case "record":
				case "video":
				case "file":
					appendAttachment(
						parsed.attachments,
						segment.type,
						Object.fromEntries(Object.entries(data).map(([key, value]) => [key, text(value)])),
					);
					break;
				default:
					break;
			}
		}
		parsed.text = buffer.trim();
		return parsed;
	}

	let buffer = "";
	let cursor = 0;
	const pattern = /\[CQ:([A-Za-z0-9_.-]+)((?:,[^\]]*)?)\]/g;
	for (const match of message.matchAll(pattern)) {
		buffer = appendSegmentText(buffer, unescapeCq(message.slice(cursor, match.index)));
		cursor = match.index + match[0].length;
		const type = match[1] ?? "";
		const data = cqParams(match[2] ?? "");
		if (type === "at") {
			const qq = data.qq ?? "";
			if (qq === "all") buffer = appendSegmentText(buffer, "@全体成员 ");
			else {
				if (qq !== "") parsed.mentionedIds.push(qq);
				buffer = appendSegmentText(buffer, `@${data.name || qq} `);
			}
			continue;
		}
		if (type === "reply") {
			parsed.replyTo = data.id;
			continue;
		}
		if (type === "image" || type === "record" || type === "video" || type === "file") {
			appendAttachment(parsed.attachments, type, data);
		}
	}
	buffer = appendSegmentText(buffer, unescapeCq(message.slice(cursor)));
	parsed.text = buffer.trim();
	return parsed;
}

function encodePeer(kind: "group" | "user", id: string): string {
	return `${kind}:${id}`;
}

/** `group:<id>` / `user:<id>`; a bare id is treated as a private chat. */
export function parseOneBotPeer(peer: string): { kind: "group" | "user"; id: string } {
	const separator = peer.indexOf(":");
	if (separator > 0) {
		const prefix = peer.slice(0, separator);
		if (prefix === "group" || prefix === "user") {
			return { kind: prefix, id: peer.slice(separator + 1) };
		}
	}
	return { kind: "user", id: peer };
}

function numericId(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

export class OneBotChannel implements ChatChannel {
	readonly id = "qq" as const;
	readonly capabilities: ChannelCapabilities = {
		maxTextLength: MAX_TEXT,
		supportsImages: true,
		supportsFiles: false,
		supportsTyping: false,
	};

	readonly #onMessage: OneBotInboundHandler;
	readonly #mode: OneBotMode;
	readonly #endpoint: string | undefined;
	readonly #token: string | undefined;
	readonly #reversePort: number;
	readonly #createSocket: SocketFactory;
	readonly #createServer: ReverseServerFactory;
	readonly #fetch: typeof globalThis.fetch;
	readonly #sleep: (ms: number) => Promise<void>;
	readonly #random: () => number;
	readonly #maxReconnectAttempts: number;
	readonly #probeIntervalMs: number;
	readonly #pingIntervalMs: number;
	readonly #attachmentDir: string | undefined;
	readonly #maxAttachmentBytes: number;
	readonly #maxAttachments: number;

	#socket: SocketLike | null = null;
	#server: ReverseServerLike | null = null;
	#started = false;
	#closed = false;
	#selfId: string;
	#health: ChannelHealth = { state: "stopped", since: Date.now() };
	#reconnectTask: Promise<void> | null = null;
	#reconnectAttempts = 0;
	#pending = new Map<string, PendingCall>();
	#echoSeq = 0;
	#chains = new Map<string, Promise<void>>();
	#lastSendAt = new Map<string, number>();
	#lastFrameAt = 0;
	#probeTimer: ReturnType<typeof setInterval> | null = null;
	#pingTimer: ReturnType<typeof setInterval> | null = null;
	#probeFailures = 0;
	#probeSupported = true;

	constructor(options: OneBotChannelOptions) {
		this.#onMessage = options.onMessage;
		this.#mode = options.mode ?? "forward";
		this.#endpoint = options.endpoint;
		this.#token = options.token;
		this.#reversePort = options.reversePort ?? DEFAULT_REVERSE_PORT;
		this.#createSocket = options.createSocket ?? bunSocketFactory;
		this.#createServer = options.createServer ?? bunReverseServerFactory;
		this.#fetch = options.customFetch ?? globalThis.fetch;
		this.#sleep = options.sleep ?? (ms => Bun.sleep(ms));
		this.#random = options.random ?? Math.random;
		this.#maxReconnectAttempts = options.maxReconnectAttempts ?? Number.POSITIVE_INFINITY;
		this.#probeIntervalMs = options.probeIntervalMs ?? DEFAULT_PROBE_INTERVAL_MS;
		this.#pingIntervalMs = options.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
		this.#attachmentDir = options.attachmentDir;
		this.#maxAttachmentBytes = options.maxAttachmentBytes ?? DEFAULT_MAX_ATTACHMENT_BYTES;
		this.#maxAttachments = options.maxAttachments ?? DEFAULT_MAX_ATTACHMENTS_PER_MESSAGE;
		this.#selfId = options.selfId ?? "";
	}

	getHealth(): ChannelHealth {
		return { ...this.#health };
	}

	async start(): Promise<void> {
		if (this.#started) return;
		this.#started = true;
		this.#closed = false;
		this.#setHealth("connecting", this.#mode === "reverse" ? "waiting for the bridge" : "dialling the bridge");
		if (this.#mode === "reverse") {
			this.#startReverseServer();
			return;
		}
		await this.#dial();
	}

	async stop(): Promise<void> {
		if (!this.#started) return;
		this.#started = false;
		this.#closed = true;
		this.#clearTimers();
		const socket = this.#socket;
		this.#socket = null;
		socket?.close(1000, "channel stopped");
		this.#server?.stop();
		this.#server = null;
		this.#rejectPending(new Error("channel stopped"));
		this.#setHealth("stopped");
	}

	async sendText(to: string, body: string, options?: ChannelSendOptions): Promise<void> {
		const target = parseOneBotPeer(to);
		const chunks = splitText(body, MAX_TEXT);
		for (const [index, chunk] of chunks.entries()) {
			const message: OneBotSegment[] = [];
			if (index === 0 && options?.replyToMessageId) {
				const replyId = numericId(options.replyToMessageId);
				if (replyId !== undefined) message.push({ type: "reply", data: { id: replyId } });
			}
			message.push({ type: "text", data: { text: chunk } });
			await this.#enqueue(to, () => this.#sendMessage(target, message));
		}
	}

	async sendImage(to: string, image: ChatImage, caption?: string): Promise<void> {
		const target = parseOneBotPeer(to);
		const message: OneBotSegment[] = [
			{ type: "image", data: { file: `base64://${Buffer.from(image.data).toString("base64")}` } },
		];
		if (caption && caption.trim() !== "") message.push({ type: "text", data: { text: caption } });
		await this.#enqueue(to, () => this.#sendMessage(target, message));
	}

	async #sendMessage(target: { kind: "group" | "user"; id: string }, message: OneBotSegment[]): Promise<void> {
		const id = numericId(target.id);
		if (id === undefined) throw new Error(`QQ: invalid ${target.kind} id "${target.id}"`);
		if (target.kind === "group") {
			await this.#call("send_group_msg", { group_id: id, message });
		} else {
			await this.#call("send_private_msg", { user_id: id, message });
		}
	}

	/** Serialize per conversation and keep at least `SEND_SPACING_MS` apart. */
	#enqueue(peer: string, task: () => Promise<void>): Promise<void> {
		const previous = this.#chains.get(peer) ?? Promise.resolve();
		const next = previous.then(async () => {
			const last = this.#lastSendAt.get(peer) ?? 0;
			const wait = last + SEND_SPACING_MS - Date.now();
			if (wait > 0) await this.#sleep(wait);
			this.#lastSendAt.set(peer, Date.now());
			await task();
		});
		this.#chains.set(
			peer,
			next.then(
				() => undefined,
				() => undefined,
			),
		);
		return next;
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

	#rejectPending(error: Error): void {
		for (const [echo, pending] of this.#pending) {
			clearTimeout(pending.timer);
			pending.reject(error);
			this.#pending.delete(echo);
		}
	}

	#dial(): Promise<void> {
		if (!this.#endpoint) return Promise.reject(new Error("QQ channel needs an OneBot endpoint (forward mode)"));
		const headers: Record<string, string> = this.#token ? { authorization: `Bearer ${this.#token}` } : {};
		const { promise, resolve, reject } = Promise.withResolvers<void>();
		let settled = false;
		let socket: SocketLike;
		try {
			socket = this.#createSocket(this.#endpoint, headers);
		} catch (error) {
			reject(error instanceof Error ? error : new Error(String(error)));
			return promise;
		}
		this.#socket = socket;
		socket.onOpen(() => {
			if (settled) return;
			settled = true;
			this.#reconnectAttempts = 0;
			this.#setHealth("connecting", "bridge socket open");
			this.#startPingWatchdog();
			void this.#handshake();
			resolve();
		});
		socket.onMessage(data => this.#handleFrame(data));
		socket.onError(error => {
			const message = error instanceof Error ? error.message : "socket error";
			this.#setHealth("degraded", undefined, message);
			if (settled) return;
			settled = true;
			reject(new Error(`OneBot connection failed: ${message}`));
		});
		socket.onClose((code, reason) => {
			if (this.#socket === socket) this.#socket = null;
			this.#clearTimers();
			this.#rejectPending(new Error(`OneBot socket closed (code ${code})`));
			if (!this.#started || this.#closed) {
				this.#setHealth("stopped");
				return;
			}
			if (!settled) {
				settled = true;
				reject(new Error(`OneBot socket closed before open (code ${code}${reason ? `: ${reason}` : ""})`));
			}
			this.#scheduleReconnect(`bridge socket closed (code ${code})`);
		});
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

	#startReverseServer(): void {
		try {
			this.#server = this.#createServer({
				hostname: DEFAULT_REVERSE_HOST,
				port: this.#reversePort,
				...(this.#token ? { token: this.#token } : {}),
				onConnection: connection => this.#adopt(connection.socket, "reverse"),
			});
			this.#setHealth("connecting", `reverse ws listening on ${DEFAULT_REVERSE_HOST}:${this.#server.port}`);
		} catch (error) {
			this.#setHealth("degraded", "reverse ws bind failed", error instanceof Error ? error.message : String(error));
			throw error;
		}
	}

	/** Adopt an already-open socket (reverse mode) and wire the same protocol. */
	#adopt(socket: SocketLike, label: string): void {
		const previous = this.#socket;
		if (previous && previous !== socket) previous.close(1000, "replaced by a newer bridge connection");
		this.#socket = socket;
		this.#reconnectAttempts = 0;
		this.#setHealth("connecting", `${label} socket accepted`);
		this.#startPingWatchdog();
		socket.onMessage(data => this.#handleFrame(data));
		socket.onClose((code, reason) => {
			if (this.#socket === socket) this.#socket = null;
			this.#clearTimers();
			this.#rejectPending(new Error(`OneBot socket closed (code ${code})`));
			if (!this.#started || this.#closed) return;
			this.#setHealth("connecting", `bridge disconnected (code ${code}${reason ? `: ${reason}` : ""})`);
		});
		socket.onError(error => {
			this.#setHealth("degraded", undefined, error instanceof Error ? error.message : "socket error");
		});
		void this.#handshake();
	}

	/** Login probe: confirms the bridge has an account, not merely a socket. */
	async #handshake(): Promise<void> {
		try {
			const user = record(await this.#call("get_login_info", {}, 10_000)) ?? {};
			const id = text(user.user_id) || this.#selfId;
			if (id !== "") this.#selfId = id;
			this.#probeFailures = 0;
			this.#setHealth("ready", `uin ${id || "unknown"}`);
			this.#startProbing();
		} catch (error) {
			this.#setHealth(
				"degraded",
				"bridge connected but not logged in",
				error instanceof Error ? error.message : String(error),
			);
			// Keep retrying the login handshake: a bridge often connects before
			// its account finishes logging in, and it will not necessarily
			// reconnect once it does.
			this.#startProbing();
		}
	}

	#startPingWatchdog(): void {
		if (this.#pingIntervalMs <= 0) return;
		this.#lastFrameAt = Date.now();
		this.#clearPingWatchdog();
		this.#pingTimer = setInterval(() => {
			if (!this.#started || this.#closed) return;
			if (Date.now() - this.#lastFrameAt > PING_TIMEOUT_MS) {
				this.#setHealth("degraded", "no frame from bridge for 65s");
				this.#socket?.terminate?.();
				this.#socket?.close(4000, "heartbeat timeout");
				return;
			}
			this.#socket?.ping?.();
		}, this.#pingIntervalMs);
		(this.#pingTimer as { unref?: () => void }).unref?.();
	}

	#clearPingWatchdog(): void {
		if (this.#pingTimer) {
			clearInterval(this.#pingTimer);
			this.#pingTimer = null;
		}
	}

	/** `get_status` probe (OneBot meta API); bridges that reject it are left alone. */
	#startProbing(): void {
		if (this.#probeIntervalMs <= 0 || this.#probeTimer) return;
		this.#probeTimer = setInterval(() => {
			if (!this.#started || this.#closed || !socketOpen(this.#socket)) return;
			if (this.#health.state !== "ready") {
				void this.#handshake();
				return;
			}
			if (!this.#probeSupported) return;
			void this.#call("get_status", {}, 10_000)
				.then(() => {
					this.#probeFailures = 0;
				})
				.catch(error => {
					const message = error instanceof Error ? error.message : String(error);
					if (/retcode 1404|unsupported|not found/i.test(message)) {
						this.#probeSupported = false;
						return;
					}
					this.#probeFailures += 1;
					if (this.#probeFailures >= 2) this.#setHealth("degraded", "get_status probe failing", message);
				});
		}, this.#probeIntervalMs);
		(this.#probeTimer as { unref?: () => void }).unref?.();
	}

	#clearTimers(): void {
		this.#clearPingWatchdog();
		if (this.#probeTimer) {
			clearInterval(this.#probeTimer);
			this.#probeTimer = null;
		}
	}

	#call(action: string, params: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<unknown> {
		const socket = this.#socket;
		if (!socketOpen(socket)) return Promise.reject(new Error(`OneBot is not connected (${action})`));
		const echo = `zeta-onebot-${Date.now()}-${this.#echoSeq++}`;
		const { promise, resolve, reject } = Promise.withResolvers<unknown>();
		const timer = setTimeout(() => {
			this.#pending.delete(echo);
			reject(new Error(`OneBot ${action} timed out after ${timeoutMs}ms`));
		}, timeoutMs);
		(timer as { unref?: () => void }).unref?.();
		this.#pending.set(echo, { resolve, reject, timer });
		socket?.send(JSON.stringify({ action, params, echo }));
		return promise;
	}

	#handleFrame(raw: string): void {
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			return;
		}
		const payload = record(parsed);
		if (!payload) return;
		this.#lastFrameAt = Date.now();

		const echo = text(payload.echo);
		if (echo !== "" && this.#pending.has(echo)) {
			const pending = this.#pending.get(echo);
			if (!pending) return;
			this.#pending.delete(echo);
			clearTimeout(pending.timer);
			const status = text(payload.status);
			const retcode = typeof payload.retcode === "number" ? payload.retcode : 0;
			if (status === "ok" || retcode === 0) pending.resolve(payload.data);
			else
				pending.reject(
					new Error(`OneBot API failed: retcode ${retcode} ${text(payload.wording) || text(payload.msg)}`.trim()),
				);
			return;
		}

		if (payload.post_type === "meta_event") return;
		if (payload.post_type !== "message") return;
		const event = payload as unknown as OneBotEvent;
		if (event.message_type !== "group" && event.message_type !== "private") return;

		const selfId = text(event.self_id) || this.#selfId;
		if (selfId !== "") this.#selfId = selfId;
		const messageIdRaw = text(event.message_id);
		const parsedMessage = parseOneBotMessage(event.message);
		if (event.message_type === "group") {
			// Group chats are noisy; only an explicit @bot starts a turn. Until the
			// bridge reports its own uin we cannot tell "me" from "someone else",
			// so a group message stays ignored rather than answered by mistake.
			if (selfId === "" || !parsedMessage.mentionedIds.includes(selfId)) return;
		}
		const body = parsedMessage.text.trim();
		const senderId = text(event.user_id);
		const peer =
			event.message_type === "group" ? encodePeer("group", text(event.group_id)) : encodePeer("user", senderId);
		if (peer.endsWith(":")) return;
		if (body === "" && parsedMessage.attachments.length === 0) return;

		void this.#emit(
			{
				peer,
				chatType: event.message_type === "group" ? "group" : "dm",
				...(senderId ? { senderId } : {}),
				...(text(event.sender?.nickname) ? { senderName: text(event.sender?.nickname) } : {}),
				body,
				...(messageIdRaw ? { messageId: `${selfId || "qq"}:${messageIdRaw}` } : {}),
				...(parsedMessage.replyTo ? { replyToMessageId: parsedMessage.replyTo } : {}),
				allowKeys: [peer],
				ts: Date.now(),
			},
			parsedMessage.attachments,
			messageIdRaw || crypto.randomUUID(),
		);
	}

	async #emit(message: InboundMessage, sources: AttachmentSource[], messageKey: string): Promise<void> {
		const attachments = await this.#download(sources, messageKey);
		this.#health = { ...this.#health, lastInboundAt: Date.now() };
		this.#onMessage({ ...message, ...(attachments.length > 0 ? { attachments } : {}) });
	}

	async #download(sources: AttachmentSource[], messageKey: string): Promise<InboundAttachment[]> {
		if (sources.length === 0) return [];
		if (!this.#attachmentDir) {
			return sources.map(source => ({
				kind: source.kind ?? "file",
				...(source.url ? { url: source.url } : {}),
				...(source.name ? { name: source.name } : {}),
			}));
		}
		try {
			return await storeAttachments(sources, {
				dir: this.#attachmentDir,
				messageKey,
				maxBytes: this.#maxAttachmentBytes,
				maxPerMessage: this.#maxAttachments,
				fetch: this.#fetch,
			});
		} catch (error) {
			logger.warn("QQ attachment storage failed", {
				error: error instanceof Error ? error.message : String(error),
			});
			return [];
		}
	}
}

export interface OneBotProbeResult {
	selfId: string;
	nickname: string;
}

/** Connect to a forward OneBot endpoint and read `get_login_info`. */
export async function probeOneBotEndpoint(options: {
	endpoint: string;
	token?: string;
	timeoutMs?: number;
	createSocket?: SocketFactory;
}): Promise<OneBotProbeResult> {
	const timeoutMs = options.timeoutMs ?? 10_000;
	const createSocket = options.createSocket ?? bunSocketFactory;
	const headers: Record<string, string> = options.token ? { authorization: `Bearer ${options.token}` } : {};
	const { promise, resolve, reject } = Promise.withResolvers<OneBotProbeResult>();
	let settled = false;
	const timer = setTimeout(() => {
		if (settled) return;
		settled = true;
		reject(new Error("OneBot endpoint did not answer in time"));
	}, timeoutMs);
	(timer as { unref?: () => void }).unref?.();
	let socket: SocketLike;
	try {
		socket = createSocket(options.endpoint, headers);
	} catch (error) {
		settled = true;
		clearTimeout(timer);
		reject(error instanceof Error ? error : new Error(String(error)));
		return promise;
	}
	const finish = (result: OneBotProbeResult): void => {
		if (settled) return;
		settled = true;
		clearTimeout(timer);
		// Resolve before closing: `close` fires the onClose handler synchronously
		// in tests (and could race the rejection in production).
		resolve(result);
		socket.close(1000, "probe done");
	};
	const fail = (message: string): void => {
		if (settled) return;
		settled = true;
		clearTimeout(timer);
		reject(new Error(message));
		socket.close(1000, "probe failed");
	};
	const echo = `zeta-probe-${Date.now()}`;
	socket.onOpen(() => {
		socket.send(JSON.stringify({ action: "get_login_info", params: {}, echo }));
	});
	socket.onMessage(raw => {
		let payload: unknown;
		try {
			payload = JSON.parse(raw);
		} catch {
			return;
		}
		const body = record(payload);
		if (!body || text(body.echo) !== echo) return;
		if (text(body.status) !== "ok" && body.retcode !== 0) {
			fail(`OneBot rejected get_login_info: retcode ${text(body.retcode) || "?"}`);
			return;
		}
		const data = record(body.data) ?? {};
		finish({ selfId: text(data.user_id), nickname: text(data.nickname) });
	});
	socket.onError(error => {
		fail(`OneBot endpoint unreachable: ${error instanceof Error ? error.message : String(error)}`);
	});
	socket.onClose((code, reason) => {
		fail(`OneBot endpoint closed before answering (code ${code}${reason ? `: ${reason}` : ""})`);
	});
	return promise;
}

/** Reverse mode validation: can we bind the loopback port the bridge will dial? */
export function probeOneBotReversePort(options: {
	port: number;
	token?: string;
	hostname?: string;
	createServer?: ReverseServerFactory;
}): number {
	const factory = options.createServer ?? bunReverseServerFactory;
	const server = factory({
		hostname: options.hostname ?? DEFAULT_REVERSE_HOST,
		port: options.port,
		...(options.token ? { token: options.token } : {}),
		onConnection: () => {},
	});
	const bound = server.port;
	server.stop();
	return bound;
}
