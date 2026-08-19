/**
 * WeChat channel contracts — URL-aware mock, unknown params, cast at call site.
 */
import { afterEach, describe, expect, test, vi } from "bun:test";
import { WeChatChannel } from "../../src/channels/wechat";
import type { WebConfig } from "../../src/config/web-config";

function j(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function ms(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
	return {
		from_user_id: "u1@im.wechat",
		to_user_id: "b1@im.bot",
		message_type: 1,
		message_state: 2,
		context_token: "ctx-1",
		item_list: [{ type: 1, text_item: { text: "你好" } }],
		...overrides,
	};
}

function buildMock(): {
	impl: (input: unknown, init?: unknown) => Promise<Response>;
	calls: Array<{ url: string; body?: unknown }>;
} {
	const calls: Array<{ url: string; body?: unknown }> = [];
	const impl = async (input: unknown, init?: unknown): Promise<Response> => {
		const initObj = init as RequestInit | undefined;
		const signal = initObj?.signal as AbortSignal | undefined;
		const url = typeof input === "string" ? input : (input as Request).url;
		let body: unknown;
		if (initObj?.body && typeof initObj.body === "string") {
			try {
				body = JSON.parse(initObj.body);
			} catch {
				body = initObj.body;
			}
		}
		calls.push({ url, body });

		if (url.includes("/getupdates")) {
			if (calls.filter(c => c.url.includes("/getupdates")).length === 1) {
				return j({
					ret: 0,
					msgs: [
						ms(),
						ms({
							from_user_id: "u2@im.wechat",
							context_token: "ctx-2",
							item_list: [{ type: 1, text_item: { text: "第二条" } }],
						}),
						ms({ message_type: 2 }),
						ms({ item_list: [{ type: 2 }] }),
					],
					get_updates_buf: "c1",
				});
			}
			// Park on abort signal.
			await new Promise<void>((_, reject) => {
				if (signal?.aborted) reject(new DOMException("Aborted", "AbortError"));
				signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
			});
			throw new Error("unreachable");
		}

		return j({ ret: 0 });
	};
	return { impl, calls };
}

function buildLoginMock(): {
	impl: (input: unknown, init?: unknown) => Promise<Response>;
	calls: Array<{ url: string; body?: unknown }>;
} {
	const calls: Array<{ url: string; body?: unknown }> = [];
	const impl = async (input: unknown, init?: unknown): Promise<Response> => {
		const initObj = init as RequestInit | undefined;
		const signal = initObj?.signal as AbortSignal | undefined;
		const url = typeof input === "string" ? input : (input as Request).url;
		let body: unknown;
		if (initObj?.body && typeof initObj.body === "string") {
			try {
				body = JSON.parse(initObj.body);
			} catch {
				body = initObj.body;
			}
		}
		calls.push({ url, body });

		if (url.includes("/get_bot_qrcode")) {
			return j({ qrcode: "qr-1", qrcode_img_content: "https://liteapp.weixin.qq.com/q/x" });
		}
		if (url.includes("/get_qrcode_status")) {
			if (calls.filter(c => c.url.includes("/get_qrcode_status")).length === 1) {
				return j({ status: "wait" });
			}
			return j({
				status: "confirmed",
				bot_token: "tok2",
				baseurl: "https://ilinkai.weixin.qq.com",
				ilink_bot_id: "bot-9",
			});
		}
		if (url.includes("/getupdates")) {
			if (calls.filter(c => c.url.includes("/getupdates")).length === 1) {
				return j({ ret: 0, msgs: [], get_updates_buf: "c1" });
			}
			if (calls.filter(c => c.url.includes("/getupdates")).length === 2) {
				return new Response("Unauthorized", { status: 401 });
			}
			// Park on signal.
			await new Promise<void>((_, reject) => {
				if (signal?.aborted) reject(new DOMException("Aborted", "AbortError"));
				signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
			});
			throw new Error("unreachable");
		}
		return j({ ret: 0 });
	};
	return { impl, calls };
}

describe("WeChatChannel", () => {
	afterEach(() => vi.restoreAllMocks());

	test("forwards text messages and round-trips the get_updates cursor", async () => {
		const seen: Array<{ peer: string; body: string }> = [];
		const { impl, calls } = buildMock();

		const ch = new WeChatChannel({
			config: { botToken: "tok", baseUrl: "https://ilinkai.weixin.qq.com" },
			customFetch: impl as unknown as typeof globalThis.fetch,
			onMessage: (peer, body) => seen.push({ peer, body }),
		});
		await ch.start();
		await Bun.sleep(5);
		await ch.stop();

		expect(seen).toEqual([
			{ peer: "u1@im.wechat", body: "你好" },
			{ peer: "u2@im.wechat", body: "第二条" },
		]);
		const pollCalls = calls.filter(c => c.url.includes("/getupdates"));
		expect(pollCalls.length).toBeGreaterThanOrEqual(2);
		const b0 = pollCalls[0].body as Record<string, unknown> | undefined;
		expect(b0?.get_updates_buf).toBe("");
	});

	test("sendText replies with the peer's context_token", async () => {
		const seen: Array<{ peer: string; body: string }> = [];
		const { impl, calls } = buildMock();

		const ch = new WeChatChannel({
			config: { botToken: "tok", baseUrl: "https://ilinkai.weixin.qq.com" },
			customFetch: impl as unknown as typeof globalThis.fetch,
			onMessage: (peer, body) => seen.push({ peer, body }),
		});
		await ch.start();
		await Bun.sleep(5);

		await ch.sendText("u1@im.wechat", "回复");
		const sendCall = calls.find(c => c.url.includes("/sendmessage"));
		expect(sendCall).toBeDefined();
		const b = sendCall!.body as {
			msg: {
				to_user_id: string;
				context_token: string;
				item_list: Array<{ type: number; text_item: { text: string } }>;
			};
		};
		expect(b.msg.to_user_id).toBe("u1@im.wechat");
		expect(b.msg.context_token).toBe("ctx-1");
		expect(b.msg.item_list[0]).toEqual({ type: 1, text_item: { text: "回复" } });
		await ch.stop();
	});

	test("sendText without a prior inbound message from the peer throws", async () => {
		const ch = new WeChatChannel({
			config: { botToken: "tok", baseUrl: "https://ilinkai.weixin.qq.com" },
			onMessage: () => {},
		});
		await expect(ch.sendText("stranger@im.wechat", "hi")).rejects.toThrow(/no context token/);
	});

	test("401 triggers the QR re-login flow and resumes with the new token", async () => {
		const { impl, calls } = buildLoginMock();

		const ch = new WeChatChannel({
			config: { botToken: "tok", baseUrl: "https://ilinkai.weixin.qq.com" },
			customFetch: impl as unknown as typeof globalThis.fetch,
			onMessage: () => {},
		});
		await ch.start();
		await Bun.sleep(4_500);
		await ch.stop();

		const qrCalls = calls.filter(c => c.url.includes("/get_bot_qrcode"));
		expect(qrCalls.length).toBeGreaterThan(0);
		const pollCalls = calls.filter(c => c.url.includes("/getupdates"));
		expect(pollCalls.length).toBeGreaterThanOrEqual(2);
	});

	test("persists a confirmed login to the web config", async () => {
		const webConfig = { set: vi.fn(async () => {}) } as unknown as WebConfig;
		const { impl } = buildLoginMock();

		const ch = new WeChatChannel({
			config: { baseUrl: "https://ilinkai.weixin.qq.com" },
			webConfig,
			customFetch: impl as unknown as typeof globalThis.fetch,
			onMessage: () => {},
		});
		await ch.start();
		await Bun.sleep(3_500);
		await ch.stop();

		expect(webConfig.set).toHaveBeenCalledWith("channels.wechat.botToken", "tok2");
		expect(webConfig.set).toHaveBeenCalledWith("channels.wechat.ilinkBotId", "bot-9");
	});
});

function buildV1LoginMock(): {
	impl: (input: unknown, init?: unknown) => Promise<Response>;
	calls: Array<{ url: string }>;
} {
	const calls: Array<{ url: string }> = [];
	const impl = async (input: unknown, init?: unknown): Promise<Response> => {
		const initObj = init as RequestInit | undefined;
		const signal = initObj?.signal as AbortSignal | undefined;
		const url = typeof input === "string" ? input : (input as Request).url;
		calls.push({ url });

		if (url.includes("/api/v1/wechat/qrcode/status")) {
			if (calls.filter(c => c.url.includes("/qrcode/status")).length === 1) {
				return j({ status: "wait" });
			}
			return j({
				status: "confirmed",
				data: {
					credentials: {
						bot_token: "tok-v1",
						ilink_bot_id: "bot-v1",
						ilink_user_id: "user-v1",
					},
				},
			});
		}
		if (url.includes("/api/v1/wechat/qrcode")) {
			return j({ qrcode_url: "https://liteapp.weixin.qq.com/q/v1", token: "qr-token-1" });
		}
		if (url.includes("/getupdates")) {
			if (calls.filter(c => c.url.includes("/getupdates")).length === 1) {
				return j({ ret: 0, msgs: [], get_updates_buf: "c1" });
			}
			await new Promise<void>((_, reject) => {
				if (signal?.aborted) reject(new DOMException("Aborted", "AbortError"));
				signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
			});
			throw new Error("unreachable");
		}
		if (url.includes("/api/v1/wechat/channel_reset")) {
			return j({ ret: 0 });
		}
		return j({ ret: 0 });
	};
	return { impl, calls };
}

describe("WeChatChannel v1 API", () => {
	afterEach(() => vi.restoreAllMocks());

	test("logs in through /api/v1/wechat and persists credentials", async () => {
		const webConfig = { set: vi.fn(async () => {}) } as unknown as WebConfig;
		const { impl, calls } = buildV1LoginMock();

		const ch = new WeChatChannel({
			config: { baseUrl: "https://ilinkai.weixin.qq.com" },
			webConfig,
			customFetch: impl as unknown as typeof globalThis.fetch,
			onMessage: () => {},
		});
		await ch.start();
		await Bun.sleep(4_500);
		await ch.stop();

		expect(calls.some(c => c.url.includes("/api/v1/wechat/qrcode"))).toBe(true);
		expect(calls.some(c => c.url.includes("/api/v1/wechat/qrcode/status"))).toBe(true);
		// Never fell back to the legacy iLink endpoints.
		expect(calls.some(c => c.url.includes("/get_bot_qrcode"))).toBe(false);
		expect(webConfig.set).toHaveBeenCalledWith("channels.wechat.botToken", "tok-v1");
		expect(webConfig.set).toHaveBeenCalledWith("channels.wechat.ilinkBotId", "bot-v1");
		expect(webConfig.set).toHaveBeenCalledWith("channels.wechat.ilinkUserId", "user-v1");
	});

	test("persists peer context tokens and restores them on a new instance", async () => {
		const webConfig = { set: vi.fn(async () => {}) } as unknown as WebConfig;
		const { impl } = buildMock();
		const first = new WeChatChannel({
			config: { botToken: "tok", baseUrl: "https://ilinkai.weixin.qq.com" },
			webConfig,
			customFetch: impl as unknown as typeof globalThis.fetch,
			onMessage: () => {},
		});
		await first.start();
		await Bun.sleep(5);
		await first.stop();

		expect(webConfig.set).toHaveBeenCalledWith(
			"channels.wechat.peerTokens",
			expect.objectContaining({ "u1@im.wechat": "ctx-1", "u2@im.wechat": "ctx-2" }),
		);

		// A restarted channel seeded from the persisted map can reply without a
		// fresh inbound message.
		const sentBodies: unknown[] = [];
		const recorder = Object.assign(
			async (input: unknown, init?: unknown) => {
				const initObj = init as RequestInit | undefined;
				const url = typeof input === "string" ? input : (input as Request).url;
				if (url.includes("/sendmessage")) sentBodies.push(initObj?.body);
				return j({ ret: 0 });
			},
			{ preconnect: undefined },
		);
		const restarted = new WeChatChannel({
			config: { botToken: "tok", baseUrl: "https://ilinkai.weixin.qq.com", peerTokens: { "u1@im.wechat": "ctx-1" } },
			customFetch: recorder as unknown as typeof globalThis.fetch,
			onMessage: () => {},
		});
		await restarted.sendText("u1@im.wechat", "回复");

		expect(JSON.parse(String(sentBodies[0]))).toMatchObject({
			msg: { to_user_id: "u1@im.wechat", context_token: "ctx-1" },
		});
	});

	test("unbind resets the channel and clears persisted credentials", async () => {
		const webConfig = { set: vi.fn(async () => {}) } as unknown as WebConfig;
		const { impl, calls } = buildV1LoginMock();

		const ch = new WeChatChannel({
			config: { botToken: "tok", baseUrl: "https://ilinkai.weixin.qq.com" },
			webConfig,
			customFetch: impl as unknown as typeof globalThis.fetch,
			onMessage: () => {},
		});
		await ch.unbind();

		expect(calls.some(c => c.url.includes("/api/v1/wechat/channel_reset"))).toBe(true);
		expect(webConfig.set).toHaveBeenCalledWith("channels.wechat.peerTokens", {});
		expect(webConfig.set).toHaveBeenCalledWith("channels.wechat.botToken", "");
		expect(webConfig.set).toHaveBeenCalledWith("channels.wechat.ilinkBotId", "");
		expect(webConfig.set).toHaveBeenCalledWith("channels.wechat.ilinkUserId", "");
	});
});
