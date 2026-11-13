/**
 * Telegram channel — Bot API long polling, no dependencies.
 *
 * Inbound: `getUpdates` with a 35s poll timeout; the `offset` cursor is
 * advanced past every received `update_id` so the API never redelivers.
 * Only `message.text` payloads are forwarded (media and `/command` messages
 * are ignored).
 *
 * Outbound: `sendMessage` for text (split at Telegram's 4096-character limit),
 * multipart `sendPhoto` for images.
 */

import { logger } from "@linxiraos/pi-utils";
import type { ChannelCapabilities, ChannelSendOptions, ChatChannel, ChatImage, InboundMessage } from "./channel";
import { splitText } from "./text";

export type TelegramInboundHandler = (message: InboundMessage) => void;

export interface TelegramChannelOptions {
	/** Stable instance id; defaults to the platform name for legacy callers. */
	instanceId?: string;
	botToken: string;
	onMessage: TelegramInboundHandler;
	/** Test seam: inject a custom fetch implementation (defaults to global fetch). */
	customFetch?: typeof globalThis.fetch;
}

const API_BASE = "https://api.telegram.org";
const POLL_TIMEOUT_SECONDS = 35;
const REQUEST_TIMEOUT_MS = 70_000;
const RETRY_DELAY_MS = 3_000;
const MAX_TEXT = 4_096;

export class TelegramChannel implements ChatChannel {
	readonly id: string;
	readonly platform = "telegram" as const;
	readonly capabilities: ChannelCapabilities = {
		maxTextLength: MAX_TEXT,
		supportsImages: true,
		supportsFiles: false,
		supportsTyping: false,
	};
	readonly #botToken: string;
	readonly #onMessage: TelegramInboundHandler;
	readonly #fetch: typeof globalThis.fetch;
	#offset = 0;
	#started = false;
	#abort: AbortController | null = null;
	#loop: Promise<void> | null = null;

	constructor(options: TelegramChannelOptions) {
		this.id = options.instanceId ?? "telegram";
		this.#botToken = options.botToken;
		this.#onMessage = options.onMessage;
		this.#fetch = options.customFetch ?? globalThis.fetch;
	}

	async start(): Promise<void> {
		if (this.#started) return;
		this.#started = true;
		this.#abort = new AbortController();
		this.#loop = this.#pollLoop();
	}

	async stop(): Promise<void> {
		if (!this.#started) return;
		this.#started = false;
		this.#abort?.abort();
		await this.#loop?.catch(() => {});
		this.#loop = null;
	}

	#apiUrl(method: string): string {
		return `${API_BASE}/bot${this.#botToken}/${method}`;
	}

	async #pollLoop(): Promise<void> {
		while (this.#started && !this.#abort?.signal.aborted) {
			try {
				const url = `${this.#apiUrl("getUpdates")}?timeout=${POLL_TIMEOUT_SECONDS}&offset=${this.#offset + 1}`;
				const res = await this.#fetch(url, {
					signal: AbortSignal.any([
						this.#abort?.signal ?? AbortSignal.abort(),
						AbortSignal.timeout(REQUEST_TIMEOUT_MS),
					]),
				});
				if (res.status === 401) {
					logger.error("Telegram bot token rejected (HTTP 401); polling stopped");
					break;
				}
				if (!res.ok) {
					logger.warn("Telegram getUpdates failed", { status: res.status });
					await Bun.sleep(RETRY_DELAY_MS);
					continue;
				}
				const data = (await res.json()) as {
					ok?: boolean;
					result?: Array<{
						update_id?: number;
						message?: {
							message_id?: number;
							chat?: { id?: number; type?: string };
							from?: { id?: number; username?: string; first_name?: string };
							text?: string;
						};
					}>;
				};
				for (const update of data.result ?? []) {
					if (typeof update.update_id === "number") {
						this.#offset = Math.max(this.#offset, update.update_id);
					}
					const chatId = update.message?.chat?.id;
					const text = update.message?.text;
					if (chatId === undefined || typeof text !== "string" || text === "") continue;
					if (text.startsWith("/")) continue;
					const chatType = update.message?.chat?.type;
					const from = update.message?.from;
					logger.debug("Telegram message received", {
						chatId,
						length: text.length,
					});
					this.#onMessage({
						peer: String(chatId),
						chatType:
							chatType === "group" || chatType === "supergroup"
								? "group"
								: chatType === "channel"
									? "channel"
									: "dm",
						...(typeof from?.id === "number" ? { senderId: String(from.id) } : {}),
						...(from?.username || from?.first_name ? { senderName: from.username ?? from.first_name } : {}),
						body: text,
						messageId: String(update.message?.message_id ?? ""),
						ts: Date.now(),
					});
				}
			} catch (error) {
				if (this.#abort?.signal.aborted) break;
				if (error instanceof Error && error.name === "TimeoutError") continue;
				logger.warn("Telegram polling error", {
					error: error instanceof Error ? error.message : String(error),
				});
				await Bun.sleep(RETRY_DELAY_MS);
			}
		}
	}

	async sendText(to: string, text: string, options?: ChannelSendOptions): Promise<void> {
		const replyTo = options?.replyToMessageId;
		for (const [index, chunk] of splitText(text, MAX_TEXT).entries()) {
			for (let attempt = 0; ; attempt++) {
				const res = await this.#fetch(this.#apiUrl("sendMessage"), {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						chat_id: to,
						text: chunk,
						...(index === 0 && replyTo ? { reply_parameters: { message_id: Number(replyTo) } } : {}),
					}),
				});
				if (res.ok) break;
				if (res.status === 429 && attempt < 2) {
					const body = (await res.json().catch(() => null)) as { parameters?: { retry_after?: number } } | null;
					await Bun.sleep(Math.max(1, body?.parameters?.retry_after ?? 1) * 1_000);
					continue;
				}
				throw new Error(`Telegram sendMessage failed (HTTP ${res.status}): ${await res.text()}`);
			}
		}
	}

	async sendImage(to: string, image: ChatImage, caption?: string): Promise<void> {
		const form = new FormData();
		form.append("chat_id", to);
		form.append("photo", new Blob([image.data], { type: image.mime }), "plan.png");
		if (caption && caption !== "") form.append("caption", caption);
		const res = await this.#fetch(this.#apiUrl("sendPhoto"), {
			method: "POST",
			body: form,
		});
		if (!res.ok) {
			throw new Error(`Telegram sendPhoto failed (HTTP ${res.status}): ${await res.text()}`);
		}
	}
}
