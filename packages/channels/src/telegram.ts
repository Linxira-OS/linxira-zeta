/**
 * Telegram channel — Bot API long polling, no dependencies.
 *
 * Inbound: `getUpdates` with a 35s poll timeout; the `offset` cursor is
 * advanced past every received `update_id` so the API never redelivers.
 * Only `message.text` payloads are forwarded (media and `/command` messages
 * are ignored).
 *
 * Outbound: `sendMessage` for text, multipart `sendPhoto` for images.
 */

import { logger } from "@linxiraos/pi-utils";
import type { ChatChannel, ChatImage } from "./channel";

export type TelegramInboundHandler = (peer: string, body: string, messageId?: string) => void;

export interface TelegramChannelOptions {
	botToken: string;
	onMessage: TelegramInboundHandler;
	/** Test seam: inject a custom fetch implementation (defaults to global fetch). */
	customFetch?: typeof globalThis.fetch;
}

const API_BASE = "https://api.telegram.org";
const POLL_TIMEOUT_SECONDS = 35;
const REQUEST_TIMEOUT_MS = 70_000;
const RETRY_DELAY_MS = 3_000;

export class TelegramChannel implements ChatChannel {
	readonly id = "telegram" as const;
	readonly #botToken: string;
	readonly #onMessage: TelegramInboundHandler;
	readonly #fetch: typeof globalThis.fetch;
	#offset = 0;
	#started = false;
	#abort: AbortController | null = null;
	#loop: Promise<void> | null = null;

	constructor(options: TelegramChannelOptions) {
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
							chat?: { id?: number };
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
					logger.debug("Telegram message received", {
						chatId,
						length: text.length,
					});
					this.#onMessage(String(chatId), text, String(update.message?.message_id ?? ""));
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

	async sendText(to: string, text: string): Promise<void> {
		const res = await this.#fetch(this.#apiUrl("sendMessage"), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ chat_id: to, text }),
		});
		if (!res.ok) {
			throw new Error(`Telegram sendMessage failed (HTTP ${res.status}): ${await res.text()}`);
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
