/**
 * WeChat ClawBot channel — Tencent iLink Bot API over plain fetch.
 *
 * Protocol reference: `temp/weixin-clawbot/weixin-bot-api.md` (iLink
 * 1.0.2/2.x), endpoints on `https://ilinkai.weixin.qq.com`.
 *
 * - Login: `get_bot_qrcode` (bot_type=3) → poll `get_qrcode_status` until
 *   `status === "confirmed"` → persist `bot_token`/`baseurl` back into the
 *   web config. `expired` → re-fetch a fresh QR code.
 * - Inbound: `getupdates` long poll (server holds ≤35s); the returned
 *   `get_updates_buf` cursor MUST be sent back on the next request or the
 *   server redelivers. Only `message_type === 1` messages with a text item
 *   are forwarded.
 * - Outbound: `sendmessage` carries `context_token` from the peer's latest
 *   inbound message — without it the reply never lands in the right chat.
 * - Auth: `Authorization: Bearer <bot_token>` + a fresh random
 *   `X-WECHAT-UIN` per request. A 401 triggers the QR re-login flow.
 * - Images: AES-128-ECB-encrypted CDN upload via `getuploadurl`, then a
 *   `sendmessage` image item referencing the uploaded URL. The exact
 *   upload-url response keys are best-effort (undocumented); failures throw
 *   so callers can fall back to `sendText`.
 */

import * as crypto from "node:crypto";
import { logger } from "@linxiraos/pi-utils";
import type { WebConfig } from "../config/web-config";
import type { ChatChannel, ChatImage } from "./channel";

export type WeChatInboundHandler = (peer: string, body: string, messageId?: string) => void;

/** QR login progress surfaced to the UI (web settings panel). */
export interface WeChatQrStatus {
	qrcode: string;
	/** `qrcode_img_content` (image data URL) when the server provides it, else the raw qrcode. */
	qrcodeUrl: string;
	/** Latest poll status: "wait" | "scaned" | "confirmed" | "expired" | raw server status. */
	status: string;
}

export interface WeChatChannelOptions {
	config: {
		botToken?: string;
		ilinkBotId?: string;
		ilinkUserId?: string;
		baseUrl?: string;
	};
	webConfig?: WebConfig;
	onMessage: WeChatInboundHandler;
	/** Surfaced QR-login progress (the web-ui renders the QR for the user to scan). */
	onQrCode?: (payload: WeChatQrStatus) => void;
	/** Test seam: inject a custom fetch implementation (defaults to global fetch). */
	customFetch?: typeof globalThis.fetch;
}

const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
const CHANNEL_VERSION = "2.4.3";
const QR_POLL_INTERVAL_MS = 2_000;
const POLL_REQUEST_TIMEOUT_MS = 45_000;
const RETRY_DELAY_MS = 3_000;

function randomUin(): string {
	const value = crypto.getRandomValues(new Uint32Array(1))[0];
	return Buffer.from(String(value), "utf8").toString("base64");
}

function randomClientId(): string {
	return `zeta-wechat-${crypto.randomBytes(4).toString("hex")}`;
}

/** AES-128-ECB with PKCS7 padding (WebCrypto has no ECB mode; CBC + zero IV is equivalent). */
async function aesEcbEncrypt(data: Uint8Array, key: Uint8Array): Promise<Uint8Array> {
	const paddedLength = data.length + (16 - (data.length % 16));
	const padded = new Uint8Array(paddedLength);
	padded.set(data);
	for (let i = data.length; i < paddedLength; i++) {
		padded[i] = paddedLength - data.length;
	}
	const cryptoKey = await crypto.subtle.importKey(
		"raw",
		new Uint8Array(key),
		{ name: "AES-CBC" },
		false,
		["encrypt"],
	);
	const encrypted = await crypto.subtle.encrypt(
		{ name: "AES-CBC", iv: new Uint8Array(16) },
		cryptoKey,
		padded,
	);
	return new Uint8Array(encrypted);
}

interface WeChatMessage {
	from_user_id?: string;
	to_user_id?: string;
	message_type?: number;
	message_state?: number;
	context_token?: string;
	item_list?: Array<{ type?: number; text_item?: { text?: string } }>;
}

export class WeChatChannel implements ChatChannel {
	readonly id = "wechat" as const;
	readonly #options: WeChatChannelOptions;
	readonly #onMessage: WeChatInboundHandler;
	readonly #fetch: typeof globalThis.fetch;
	#botToken: string | undefined;
	#baseUrl: string;
	/** Latest context_token per peer — required to reply in the right chat. */
	#contextTokens = new Map<string, string>();
	#started = false;
	#abort: AbortController | null = null;
	#loop: Promise<void> | null = null;

	constructor(options: WeChatChannelOptions) {
		this.#options = options;
		this.#onMessage = options.onMessage;
		this.#botToken = options.config.botToken;
		this.#baseUrl = options.config.baseUrl ?? DEFAULT_BASE_URL;
		this.#fetch = options.customFetch ?? globalThis.fetch;
	}

	/** Restart the login/message loop (e.g. user re-triggers QR login from the UI). */
	async reconnect(): Promise<void> {
		if (!this.#started) {
			this.#started = true;
			this.#abort = new AbortController();
			this.#loop = this.#run();
			return;
		}
		const previous = this.#loop;
		this.#abort?.abort();
		this.#abort = new AbortController();
		this.#loop = this.#run();
		if (previous) void previous.catch(() => {});
	}

	async start(): Promise<void> {
		if (this.#started) return;
		this.#started = true;
		this.#abort = new AbortController();
		this.#loop = this.#run();
	}

	async stop(): Promise<void> {
		if (!this.#started) return;
		this.#started = false;
		this.#abort?.abort();
		await this.#loop?.catch(() => {});
		this.#loop = null;
	}

	async #run(): Promise<void> {
		if (!this.#botToken) {
			await this.#loginFlow();
		}
		await this.#pollLoop();
	}

	#headers(): Record<string, string> {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			AuthorizationType: "ilink_bot_token",
			"X-WECHAT-UIN": randomUin(),
			"iLink-App-Id": "bot",
			"iLink-App-ClientVersion": String((2 << 16) | (4 << 8) | 3),
		};
		if (this.#botToken) headers.Authorization = `Bearer ${this.#botToken}`;
		return headers;
	}

	#baseInfo(): Record<string, string> {
		return { channel_version: CHANNEL_VERSION, bot_agent: "zeta-WeChat-ClawBot/1.0.0" };
	}

	async #apiGet(path: string): Promise<Record<string, unknown>> {
		const res = await this.#fetch(`${this.#baseUrl}/${path}`, {
			headers: this.#headers(),
			signal: this.#abort?.signal,
		});
		const text = await res.text();
		if (res.status === 401) throw new WeChatAuthError("iLink request unauthorized");
		try {
			return JSON.parse(text) as Record<string, unknown>;
		} catch {
			throw new Error(`iLink returned non-JSON (HTTP ${res.status})`);
		}
	}

	async #apiPost(path: string, body: unknown): Promise<Record<string, unknown>> {
		const res = await this.#fetch(`${this.#baseUrl}/${path}`, {
			method: "POST",
			headers: this.#headers(),
			body: JSON.stringify(body),
			signal: this.#abort?.signal,
		});
		const text = await res.text();
		if (res.status === 401) throw new WeChatAuthError("iLink request unauthorized");
		try {
			return JSON.parse(text) as Record<string, unknown>;
		} catch {
			throw new Error(`iLink returned non-JSON (HTTP ${res.status})`);
		}
	}

	async #loginFlow(): Promise<void> {
		// QR fetch: 2.x POST first, fall back to the 1.0.2 GET shape.
		let data: Record<string, unknown> | null = null;
		try {
			data = await this.#apiPost(
				"ilink/bot/get_bot_qrcode?bot_type=3",
				{ local_token_list: this.#botToken ? [this.#botToken] : [] },
			);
		} catch {
			data = null;
		}
		if (!data?.qrcode) {
			data = await this.#apiGet("ilink/bot/get_bot_qrcode?bot_type=3");
		}
		const qrcode = data?.qrcode;
		if (typeof qrcode !== "string" || qrcode === "") {
			throw new Error("WeChat login failed: no QR code returned");
		}
		const qrcodeUrl = String(data?.qrcode_img_content ?? qrcode);
		this.#options.onQrCode?.({ qrcode, qrcodeUrl, status: "wait" });
		logger.info("WeChat channel: scan the QR code to log in", { qrcodeUrl });

		while (this.#started && !this.#abort?.signal.aborted) {
			try {
				const status = await this.#apiGet(`ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`);
				if (typeof status.bot_token === "string" && status.bot_token !== "") {
					this.#botToken = status.bot_token;
					if (typeof status.baseurl === "string" && status.baseurl !== "") {
						this.#baseUrl = status.baseurl;
					}
					// Persist credentials so the next serve start skips scanning.
					const config = this.#options.webConfig;
					if (config) {
						await config.set("channels.wechat.botToken", this.#botToken);
						if (this.#baseUrl !== DEFAULT_BASE_URL) {
							await config.set("channels.wechat.baseUrl", this.#baseUrl);
						}
						if (typeof status.ilink_bot_id === "string" && status.ilink_bot_id !== "") {
							await config.set("channels.wechat.ilinkBotId", status.ilink_bot_id);
						}
						if (typeof status.ilink_user_id === "string" && status.ilink_user_id !== "") {
							await config.set("channels.wechat.ilinkUserId", status.ilink_user_id);
						}
					}
					this.#options.onQrCode?.({ qrcode, qrcodeUrl, status: "confirmed" });
					logger.info("WeChat channel logged in", { baseUrl: this.#baseUrl });
					return;
				}
				if (status.status === "scaned_but_redirect") {
					// Server redirected the session to another host; follow it.
					if (typeof status.redirect_host === "string" && status.redirect_host !== "") {
						this.#baseUrl = `https://${status.redirect_host}`;
					}
					this.#options.onQrCode?.({ qrcode, qrcodeUrl, status: "scaned" });
				} else if (status.status === "expired") {
					logger.warn("WeChat QR code expired; fetching a fresh one");
					this.#options.onQrCode?.({ qrcode, qrcodeUrl, status: "expired" });
					return await this.#loginFlow();
				} else {
					this.#options.onQrCode?.({
						qrcode,
						qrcodeUrl,
						status: typeof status.status === "string" && status.status !== "" ? status.status : "wait",
					});
				}
				await Bun.sleep(QR_POLL_INTERVAL_MS);
			} catch (error) {
				logger.warn("WeChat QR status poll failed", {
					error: error instanceof Error ? error.message : String(error),
				});
				await Bun.sleep(QR_POLL_INTERVAL_MS);
			}
		}
		throw new Error("WeChat login aborted");
	}

	async #pollLoop(): Promise<void> {
		let cursor = "";
		while (this.#started && !this.#abort?.signal.aborted) {
			try {
				const data = await this.#apiPost("ilink/bot/getupdates", {
					get_updates_buf: cursor,
					base_info: this.#baseInfo(),
				});
				const nextCursor = data.get_updates_buf;
				if (typeof nextCursor === "string" && nextCursor !== "") {
					cursor = nextCursor;
				}
				for (const raw of (data.msgs as unknown[] | undefined) ?? []) {
					const msg = raw as WeChatMessage;
					if (msg.message_type !== 1) continue;
					const from = msg.from_user_id;
					if (typeof from !== "string" || from === "") continue;
					if (typeof msg.context_token === "string" && msg.context_token !== "") {
						this.#contextTokens.set(from, msg.context_token);
					}
					const textItem = (msg.item_list ?? []).find(item => item.type === 1)?.text_item?.text;
					if (typeof textItem !== "string" || textItem === "") continue;
					logger.debug("WeChat message received", { from, length: textItem.length });
					this.#onMessage(from, textItem, String(msg.to_user_id ?? ""));
				}
			} catch (error) {
				if (this.#abort?.signal.aborted) break;
				if (error instanceof WeChatAuthError) {
					logger.warn("WeChat credentials invalid; restarting QR login");
					try {
						await this.#loginFlow();
						continue;
					} catch (loginError) {
						logger.error("WeChat re-login failed", {
							error: loginError instanceof Error ? loginError.message : String(loginError),
						});
						await Bun.sleep(RETRY_DELAY_MS);
					}
					continue;
				}
				logger.warn("WeChat getupdates failed", {
					error: error instanceof Error ? error.message : String(error),
				});
				await Bun.sleep(RETRY_DELAY_MS);
			}
		}
	}

	#contextTokenFor(peer: string): string | undefined {
		return this.#contextTokens.get(peer);
	}

	async sendText(to: string, text: string): Promise<void> {
		const contextToken = this.#contextTokenFor(to);
		if (!contextToken) {
			throw new Error("WeChat: no context token for peer (wait for an inbound message first)");
		}
		const data = await this.#apiPost("ilink/bot/sendmessage", {
			msg: {
				from_user_id: "",
				to_user_id: to,
				client_id: randomClientId(),
				message_type: 2,
				message_state: 2,
				context_token: contextToken,
				item_list: [{ type: 1, text_item: { text } }],
			},
			base_info: this.#baseInfo(),
		});
		if (data?.ret !== undefined && data.ret !== 0) {
			throw new Error(`WeChat sendmessage failed: ret=${String(data.ret)}`);
		}
	}

	async sendImage(to: string, image: ChatImage, caption?: string): Promise<void> {
		const contextToken = this.#contextTokenFor(to);
		if (!contextToken) {
			throw new Error("WeChat: no context token for peer (wait for an inbound message first)");
		}
		const aesKey = crypto.getRandomValues(new Uint8Array(16));
		const encrypted = await aesEcbEncrypt(image.data, aesKey);
		const fileBase = (caption ?? "plan").replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 40) || "plan";

		// 1. Request a presigned CDN upload URL.
		const upload = await this.#apiPost("ilink/bot/getuploadurl", {
			msg: {
				from_user_id: "",
				to_user_id: to,
				client_id: randomClientId(),
				message_type: 2,
				message_state: 2,
				context_token: contextToken,
				item_list: [
					{
						type: 2,
						image_item: {
							aes_key: Buffer.from(aesKey).toString("base64"),
							file_size: encrypted.length,
							file_name: `${fileBase}.png`,
						},
					},
				],
			},
			base_info: this.#baseInfo(),
		});
		const uploadUrl =
			typeof upload.upload_full_url === "string"
				? upload.upload_full_url
				: typeof upload.full_url === "string"
					? upload.full_url
					: undefined;
		if (!uploadUrl) {
			throw new Error("WeChat getuploadurl returned no upload URL; cannot send image");
		}

		// 2. PUT the encrypted payload to the CDN.
		const putRes = await this.#fetch(uploadUrl, { method: "PUT", body: encrypted, signal: this.#abort?.signal });
		if (!putRes.ok) {
			throw new Error(`WeChat CDN upload failed (HTTP ${putRes.status})`);
		}

		// 3. Reference the uploaded media in a sendmessage.
		const data = await this.#apiPost("ilink/bot/sendmessage", {
			msg: {
				from_user_id: "",
				to_user_id: to,
				client_id: randomClientId(),
				message_type: 2,
				message_state: 2,
				context_token: contextToken,
				item_list: [
					{
						type: 2,
						image_item: {
							aes_key: Buffer.from(aesKey).toString("base64"),
							full_url: uploadUrl,
							file_name: `${fileBase}.png`,
						},
					},
				],
			},
			base_info: this.#baseInfo(),
		});
		if (data?.ret !== undefined && data.ret !== 0) {
			throw new Error(`WeChat sendmessage (image) failed: ret=${String(data.ret)}`);
		}
	}
}

class WeChatAuthError extends Error {}
