/**
 * Feishu / Lark channel — official `@larksuiteoapi/node-sdk` with the
 * WebSocket long-connection mode (no public webhook needed).
 *
 * Inbound: text plus image/file resources, stored in the instance attachment inbox.
 * The peer is the `chat_id` (works for both p2p chats and groups), and
 * replies go back with `receive_id_type: "chat_id"`.
 *
 * Outbound: `im.message.create` for text, `im.image.create` (message type)
 * + image message for pictures. The SDK handles `tenant_access_token`
 * internally.
 */

import { addAbortSignal, Readable } from "node:stream";
import * as Lark from "@larksuiteoapi/node-sdk";
import { logger } from "@linxiraos/pi-utils";
import { DEFAULT_ATTACHMENT_TIMEOUT_MS, storeAttachments, type AttachmentSource } from "./attachments";
import type { ChannelCapabilities, ChatChannel, ChatImage, InboundAttachment, InboundMessage } from "./channel";

export type FeishuInboundHandler = (message: InboundMessage) => void;

export interface FeishuChannelOptions {
	instanceId?: string;
	appId: string;
	appSecret: string;
	domain?: "feishu" | "lark";
	onMessage: FeishuInboundHandler;
	/** Inbound image/file inbox; absent storage is reported as an unavailable attachment. */
	attachmentDir?: string;
	maxAttachmentBytes?: number;
}

export interface FeishuMessageEvent {
	message?: {
		message_id?: string;
		chat_id?: string;
		chat_type?: string;
		message_type?: string;
		content?: string;
	};
	sender?: { sender_id?: { open_id?: string; user_id?: string } };
}

export interface FeishuInboundOptions {
	onMessage: FeishuInboundHandler;
	attachmentDir?: string;
	maxAttachmentBytes?: number;
	openResource: (messageId: string, fileKey: string, type: "image" | "file", signal: AbortSignal) => Promise<Response>;
}

/** Decode the event and persist authenticated media before publishing the inbound message. */
export async function receiveFeishuMessage(data: FeishuMessageEvent, options: FeishuInboundOptions): Promise<void> {
	const message = data.message;
	const chatId = message?.chat_id;
	if (!message || typeof chatId !== "string" || chatId === "") return;
	const type = message.message_type;
	if (type !== "text" && type !== "image" && type !== "file") {
		logger.warn("Feishu inbound message rejected: unsupported message type", { chatId, type });
		return;
	}
	let content: Record<string, unknown> = {};
	try {
		const parsed: unknown = JSON.parse(message.content ?? "{}");
		if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
			content = parsed as Record<string, unknown>;
		}
	} catch {
		if (type === "text") content.text = message.content ?? "";
	}
	// Mention gaps are cleaned without flattening the user's intentional newlines.
	const body = (typeof content.text === "string" ? content.text : "")
		.replace(/@_user_\d+/g, " ")
		.replace(/[ \t]{2,}/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	let attachments: InboundAttachment[] = [];
	if (type !== "text") {
		const fileKey = content[type === "image" ? "image_key" : "file_key"];
		const name = typeof content.file_name === "string" ? content.file_name : undefined;
		const base: InboundAttachment = { kind: type, ...(name ? { name } : {}) };
		if (typeof fileKey !== "string" || fileKey === "" || !message.message_id) {
			attachments = [{ ...base, error: "Feishu media is missing its message id or resource key" }];
		} else if (!options.attachmentDir) {
			attachments = [{ ...base, error: "Feishu attachment storage is not configured" }];
		} else {
			const messageId = message.message_id;
			const source: AttachmentSource = {
				...base,
				open: signal => options.openResource(messageId, fileKey, type, signal),
			};
			attachments = await storeAttachments([source], {
				dir: options.attachmentDir,
				messageKey: messageId,
				maxBytes: options.maxAttachmentBytes,
			});
		}
	}
	if (body === "" && attachments.length === 0) return;
	const sender = data.sender?.sender_id;
	options.onMessage({
		peer: chatId,
		chatType: message.chat_type === "group" ? "group" : "dm",
		...(sender?.open_id || sender?.user_id ? { senderId: sender.open_id ?? sender.user_id } : {}),
		body,
		...(message.message_id ? { messageId: message.message_id } : {}),
		...(attachments.length > 0 ? { attachments } : {}),
		ts: Date.now(),
	});
}

/** `bot_p2p_chat_entered` v2 event payload (first contact in a private chat). */
interface FeishuP2pEnteredData {
	chat_id?: string;
	event?: { chat_id?: string };
}

const P2P_ONBOARDING_TEXT =
	"你好！我是 Zeta 助手。发送消息即可开始对话。\n\nHello! I'm the Zeta assistant. Send a message to start chatting.";

export class FeishuChannel implements ChatChannel {
	readonly id: string;
	readonly platform = "feishu" as const;
	readonly capabilities: ChannelCapabilities = {
		maxTextLength: Number.POSITIVE_INFINITY,
		supportsImages: true,
		supportsFiles: false,
		supportsTyping: false,
	};
	readonly #options: FeishuChannelOptions;
	readonly #onMessage: FeishuInboundHandler;
	#client: Lark.Client | null = null;
	#ws: Lark.WSClient | null = null;
	#started = false;
	#startPromise: Promise<void> | null = null;

	constructor(options: FeishuChannelOptions) {
		this.id = options.instanceId ?? "feishu";
		this.#options = options;
		this.#onMessage = options.onMessage;
	}

	#sdkDomain(): Lark.Domain {
		return this.#options.domain === "lark" ? Lark.Domain.Lark : Lark.Domain.Feishu;
	}

	async start(): Promise<void> {
		if (this.#started) return;
		this.#started = true;
		this.#startPromise = this.#connect();
		await this.#startPromise;
	}

	async #connect(): Promise<void> {
		const { appId, appSecret } = this.#options;
		this.#client = new Lark.Client({
			appId,
			appSecret,
			appType: Lark.AppType.SelfBuild,
			domain: this.#sdkDomain(),
		});
		const http = this.#client.httpInstance;
		this.#client.httpInstance = {
			request: <T = unknown, R = T, D = unknown>(options: Lark.HttpRequestOptions<D>): Promise<R> =>
				http.request<T, R, D>({ ...options, timeout: DEFAULT_ATTACHMENT_TIMEOUT_MS }),
			get: http.get.bind(http),
			delete: http.delete.bind(http),
			head: http.head.bind(http),
			options: http.options.bind(http),
			post: http.post.bind(http),
			put: http.put.bind(http),
			patch: http.patch.bind(http),
		};
		const dispatcher = new Lark.EventDispatcher({});
		dispatcher.register({
			"im.message.receive_v1": (data: FeishuMessageEvent) => {
				// Acknowledge the event before a resource download; holding the SDK
				// callback open makes large media look undelivered to Feishu.
				void this.#onEvent(data).catch(error => {
					logger.warn("Feishu inbound delivery failed", {
						error: error instanceof Error ? error.message : String(error),
					});
				});
			},
			bot_p2p_chat_entered: (data: FeishuP2pEnteredData) => this.#onP2pEntered(data),
		});

		const ws = new Lark.WSClient({
			appId,
			appSecret,
			domain: this.#sdkDomain(),
			loggerLevel: Lark.LoggerLevel.error,
			wsConfig: { pingTimeout: 3 },
			onError: err => {
				logger.warn("Feishu WebSocket error", {
					error: err instanceof Error ? err.message : String(err),
				});
			},
		});
		this.#ws = ws;
		await ws.start({ eventDispatcher: dispatcher });
		logger.info("Feishu channel connected (WebSocket long connection)");
	}

	async stop(): Promise<void> {
		if (!this.#started) return;
		this.#started = false;
		try {
			this.#ws?.close({ force: true });
		} catch (error) {
			logger.warn("Feishu WebSocket close failed", {
				error: error instanceof Error ? error.message : String(error),
			});
		}
		this.#ws = null;
		this.#client = null;
		this.#startPromise = null;
	}

	async #onEvent(data: FeishuMessageEvent): Promise<void> {
		const client = this.#requireClient();
		await receiveFeishuMessage(data, {
			onMessage: message => {
				if (this.#client === client) this.#onMessage(message);
			},
			attachmentDir: this.#options.attachmentDir,
			maxAttachmentBytes: this.#options.maxAttachmentBytes,
			openResource: async (messageId, fileKey, type, signal) => {
				const resource = await client.im.messageResource.get({
					path: { message_id: messageId, file_key: fileKey },
					params: { type },
				});
				const stream = addAbortSignal(signal, resource.getReadableStream());
				const headers = new Headers();
				for (const name of ["content-type", "content-length"]) {
					const value: unknown = resource.headers?.[name];
					if (typeof value === "string") headers.set(name, value);
				}
				return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { headers });
			},
		});
	}

	#onP2pEntered(data: FeishuP2pEnteredData): void {
		const chatId = data.chat_id ?? data.event?.chat_id;
		if (typeof chatId !== "string" || chatId === "") return;
		logger.info("Feishu first p2p contact; sending onboarding", { chatId });
		void this.sendText(chatId, P2P_ONBOARDING_TEXT).catch(error => {
			logger.warn("Feishu onboarding reply failed", {
				error: error instanceof Error ? error.message : String(error),
			});
		});
	}

	#requireClient(): Lark.Client {
		if (!this.#client) throw new Error("Feishu channel is not started");
		return this.#client;
	}

	async sendText(to: string, text: string): Promise<void> {
		const client = this.#requireClient();
		const res = await client.im.message.create({
			params: { receive_id_type: "chat_id" },
			data: {
				receive_id: to,
				msg_type: "text",
				content: JSON.stringify({ text }),
			},
		});
		if (res.code !== 0) {
			throw new Error(`Feishu sendMessage failed: code=${String(res.code)} msg=${res.msg ?? ""}`);
		}
	}

	async sendImage(to: string, image: ChatImage, caption?: string): Promise<void> {
		const client = this.#requireClient();
		const upload = await client.im.image.create({
			data: {
				image_type: "message",
				image: Buffer.from(image.data),
			},
		});
		const imageKey = upload?.image_key;
		if (!imageKey) {
			throw new Error("Feishu image upload failed: no image_key returned");
		}
		const res = await client.im.message.create({
			params: { receive_id_type: "chat_id" },
			data: {
				receive_id: to,
				msg_type: "image",
				content: JSON.stringify({ image_key: imageKey }),
			},
		});
		if (res.code !== 0) {
			throw new Error(`Feishu image message failed: code=${String(res.code)} msg=${res.msg ?? ""}`);
		}
		if (caption && caption !== "") {
			await this.sendText(to, caption);
		}
	}
}
