/**
 * Feishu / Lark channel — official `@larksuiteoapi/node-sdk` with the
 * WebSocket long-connection mode (no public webhook needed).
 *
 * Inbound: `im.message.receive_v1` events; only text messages are forwarded.
 * The peer is the `chat_id` (works for both p2p chats and groups), and
 * replies go back with `receive_id_type: "chat_id"`.
 *
 * Outbound: `im.message.create` for text, `im.image.create` (message type)
 * + image message for pictures. The SDK handles `tenant_access_token`
 * internally.
 */

import * as Lark from "@larksuiteoapi/node-sdk";
import { logger } from "@linxiraos/pi-utils";
import type { ChatChannel, ChatImage } from "./channel";

export type FeishuInboundHandler = (
	peer: string,
	body: string,
	messageId?: string,
) => void;

export interface FeishuChannelOptions {
	appId: string;
	appSecret: string;
	domain?: "feishu" | "lark";
	onMessage: FeishuInboundHandler;
}

interface FeishuTextEventData {
	message?: {
		message_id?: string;
		chat_id?: string;
		message_type?: string;
		content?: string;
	};
}

/** `bot_p2p_chat_entered` v2 event payload (first contact in a private chat). */
interface FeishuP2pEnteredData {
	chat_id?: string;
	event?: { chat_id?: string };
}

const P2P_ONBOARDING_TEXT =
	"你好！我是 Zeta 助手。发送消息即可开始对话。\n\nHello! I'm the Zeta assistant. Send a message to start chatting.";

export class FeishuChannel implements ChatChannel {
	readonly id = "feishu" as const;
	readonly #options: FeishuChannelOptions;
	readonly #onMessage: FeishuInboundHandler;
	#client: Lark.Client | null = null;
	#ws: Lark.WSClient | null = null;
	#started = false;
	#startPromise: Promise<void> | null = null;

	constructor(options: FeishuChannelOptions) {
		this.#options = options;
		this.#onMessage = options.onMessage;
	}

	#sdkDomain(): Lark.Domain {
		return this.#options.domain === "lark"
			? Lark.Domain.Lark
			: Lark.Domain.Feishu;
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
		const dispatcher = new Lark.EventDispatcher({});
		dispatcher.register({
			"im.message.receive_v1": (data: FeishuTextEventData) =>
				this.#onEvent(data),
			bot_p2p_chat_entered: (data: FeishuP2pEnteredData) =>
				this.#onP2pEntered(data),
		});

		const ws = new Lark.WSClient({
			appId,
			appSecret,
			domain: this.#sdkDomain(),
			loggerLevel: Lark.LoggerLevel.error,
			wsConfig: { pingTimeout: 3 },
			onError: (err) => {
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

	#onEvent(data: FeishuTextEventData): void {
		const message = data.message;
		if (message?.message_type !== "text") return;
		const chatId = message.chat_id;
		let text = "";
		try {
			const parsed = JSON.parse(message.content ?? "{}") as { text?: string };
			text = parsed.text ?? "";
		} catch {
			text = message.content ?? "";
		}
		if (typeof chatId !== "string" || chatId === "") return;
		// Feishu renders `@` as mention placeholders (`@_user_1`); strip them so
		// command text and prompts arrive clean (a bot @-mention in a group is
		// not part of the user's actual message). Only collapse the mention
		// gaps — preserve intentional newlines in multi-line prompts.
		text = text
			.replace(/@_user_\d+/g, " ")
			.replace(/[ \t]{2,}/g, " ")
			.replace(/\n{3,}/g, "\n\n")
			.trim();
		if (text === "") return;
		logger.debug("Feishu message received", { chatId, length: text.length });
		this.#onMessage(chatId, text, message.message_id);
	}

	#onP2pEntered(data: FeishuP2pEnteredData): void {
		const chatId = data.chat_id ?? data.event?.chat_id;
		if (typeof chatId !== "string" || chatId === "") return;
		logger.info("Feishu first p2p contact; sending onboarding", { chatId });
		void this.sendText(chatId, P2P_ONBOARDING_TEXT).catch((error) => {
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
			throw new Error(
				`Feishu sendMessage failed: code=${String(res.code)} msg=${res.msg ?? ""}`,
			);
		}
	}

	async sendImage(
		to: string,
		image: ChatImage,
		caption?: string,
	): Promise<void> {
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
			throw new Error(
				`Feishu image message failed: code=${String(res.code)} msg=${res.msg ?? ""}`,
			);
		}
		if (caption && caption !== "") {
			await this.sendText(to, caption);
		}
	}
}
