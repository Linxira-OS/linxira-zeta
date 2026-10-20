/**
 * Terminal WeChat pairing for `zetacode channels login wechat`.
 *
 * The adapter owns the protocol (QR fetch, poll, credential persistence), so
 * the CLI drives the same `WeChatChannel` the gateway and serve runtime use.
 * This module only adds the observable state machine (`pending → scanned →
 * connected → timeout`), a timeout, and QR payload selection for terminal
 * rendering. Credentials are written through `webConfig.set`, exactly like
 * the adapter's serve path — there is no second persistence path.
 */

import { WeChatChannel, type WeChatChannelOptions, type WeChatQrStatus } from "@linxiraos/pi-channels";
import type { WebConfig } from "../config/web-config";
import { isImagePayload } from "./qr-terminal";

export type WechatLoginState = "pending" | "scanned" | "connected" | "timeout";

/** Map the adapter's raw poll status onto the CLI-visible state machine. */
export function wechatLoginStateFor(status: string): WechatLoginState {
	switch (status) {
		case "scaned":
		case "scanned":
		case "scaned_but_redirect":
			return "scanned";
		case "confirmed":
			return "connected";
		default:
			// "wait", "", "expired" (a fresh QR follows) and unknown statuses are
			// all still waiting for the user.
			return "pending";
	}
}

/**
 * Deterministic login state machine. `observe` is idempotent for terminal
 * states, so a late adapter callback cannot revive a timed-out login or
 * regress a confirmed one.
 */
export class WechatLoginTracker {
	#state: WechatLoginState = "pending";
	readonly #deadline: number;
	readonly #now: () => number;

	constructor(timeoutMs: number, now: () => number = Date.now) {
		this.#now = now;
		this.#deadline = now() + Math.max(0, timeoutMs);
	}

	get state(): WechatLoginState {
		if (this.#state === "pending" || this.#state === "scanned") {
			if (this.#now() >= this.#deadline) this.#state = "timeout";
		}
		return this.#state;
	}

	get remainingMs(): number {
		return Math.max(0, this.#deadline - this.#now());
	}

	observe(status: string): WechatLoginState {
		if (this.#state === "connected" || this.#state === "timeout") return this.#state;
		if (this.#now() >= this.#deadline) {
			this.#state = "timeout";
			return this.#state;
		}
		const next = wechatLoginStateFor(status);
		// Waiting after an expired QR is still pending; scanned may not regress.
		if (next === "pending" && this.#state === "scanned") return this.#state;
		this.#state = next;
		return this.#state;
	}

	expire(): WechatLoginState {
		if (this.#state !== "connected") this.#state = "timeout";
		return this.#state;
	}
}

/** The adapter callbacks `runWechatLogin` needs; injected in tests. */
export interface WechatLoginChannel {
	start(): Promise<void>;
	stop(): Promise<void>;
}

export interface WechatLoginResult {
	state: WechatLoginState;
	/** Last QR payload observed, if the adapter produced one. */
	qrcode: WeChatQrStatus | null;
	/** True only when the adapter persisted credentials after `confirmed`. */
	credentialsPersisted: boolean;
	error?: string;
}

export interface WechatLoginOptions {
	webConfig: WebConfig;
	/** Defaults to 180 s (the WeChat server also expires QR codes). */
	timeoutMs?: number;
	onQrCode?: (payload: WeChatQrStatus, state: WechatLoginState) => void;
	onState?: (state: WechatLoginState, payload: WeChatQrStatus | null) => void;
	/** Test seam: swap the adapter (the stub invokes `onQrCode` as a fake server). */
	createChannel?: (options: WeChatChannelOptions) => WechatLoginChannel;
	signal?: AbortSignal;
}

const DEFAULT_LOGIN_TIMEOUT_MS = 180_000;

/**
 * Run one QR login to completion. The adapter persists credentials before it
 * reports `confirmed`; this function stops the channel immediately after, so
 * the CLI never starts the long-poll message loop.
 */
export async function runWechatLogin(options: WechatLoginOptions): Promise<WechatLoginResult> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS;
	const tracker = new WechatLoginTracker(timeoutMs);
	const data = options.webConfig.getData();
	let lastQr: WeChatQrStatus | null = null;
	let settled = false;
	let settle: (result: WechatLoginResult) => void = () => {};
	const done = new Promise<WechatLoginResult>(resolve => {
		settle = resolve;
	});

	const finish = (result: WechatLoginResult): void => {
		if (settled) return;
		settled = true;
		settle(result);
	};

	const config = {
		config: {
			// A fresh login always starts without the old token; the QR flow then
			// persists the replacement through `webConfig`.
			baseUrl: data.channels.wechat.baseUrl,
			endpoint: data.channels.wechat.endpoint,
			peerTokens: data.channels.wechat.peerTokens,
		},
		webConfig: options.webConfig,
		onMessage: () => {},
		onQrCode: (payload: WeChatQrStatus) => {
			lastQr = payload;
			const state = tracker.observe(payload.status);
			options.onQrCode?.(payload, state);
			options.onState?.(state, payload);
			if (state === "connected") {
				finish({ state, qrcode: lastQr, credentialsPersisted: true });
			}
		},
	};
	const channel = options.createChannel
		? options.createChannel(config)
		: new WeChatChannel(config as WeChatChannelOptions);

	const timeout = setTimeout(() => {
		const state = tracker.expire();
		options.onState?.(state, lastQr);
		finish({ state, qrcode: lastQr, credentialsPersisted: false, error: "WeChat login timed out" });
	}, timeoutMs);
	const abort = (): void => {
		finish({ state: tracker.state, qrcode: lastQr, credentialsPersisted: false, error: "WeChat login aborted" });
	};
	options.signal?.addEventListener("abort", abort, { once: true });

	try {
		await channel.start();
		if (options.signal?.aborted) abort();
		return await done;
	} finally {
		clearTimeout(timeout);
		options.signal?.removeEventListener("abort", abort);
		await channel.stop().catch(() => {});
	}
}

/**
 * Choose what a terminal should encode for a QR login status. The adapter's
 * `qrcodeUrl` is normally the scannable content (or a QR image URL); the
 * legacy `qrcode` can also carry a URL. Plain image URLs fall back to raw text
 * in the renderer, so returning the URL is still useful to the caller.
 */
export function wechatQrDisplayPayload(qr: WeChatQrStatus): string {
	const url = (qr.qrcodeUrl ?? "").trim();
	const code = (qr.qrcode ?? "").trim();
	if (url && !isImagePayload(url)) return url;
	if (code && /^https?:\/\//i.test(code)) return code;
	return url || code;
}
