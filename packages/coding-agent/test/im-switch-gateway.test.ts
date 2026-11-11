/** IM switch gateway wire: required identity and mandatory atomic request ids. */

import { afterEach, describe, expect, test } from "bun:test";
import { registerImSwitchGateway } from "../src/channels/session-router";
import {
	handleImSwitchCancel,
	handleImSwitchConfirm,
	handleImSwitchGet,
} from "../src/server/web-gateway/im-instances";

afterEach(() => {
	registerImSwitchGateway(null);
});

function request(body: Record<string, unknown>): Request {
	return new Request("http://127.0.0.1/api/im/switch/confirm", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

describe("IM switch gateway", () => {
	test("missing relay or identity is an explicit error", async () => {
		registerImSwitchGateway(null);
		expect((await handleImSwitchGet(new Request("http://127.0.0.1/api/im/switch?chatId=c1"))).status).toBe(503);
		expect((await handleImSwitchConfirm(request({ chatId: "c1", requestId: "r1" }))).status).toBe(503);

		registerImSwitchGateway({
			status: async () => ({ current: { targetKey: "workspace:main" } }),
			confirm: async () => ({ ok: false, error: "unused" }),
			cancel: async () => false,
		});
		expect((await handleImSwitchGet(new Request("http://127.0.0.1/api/im/switch?instanceId=tg"))).status).toBe(400);
		expect((await handleImSwitchConfirm(request({ chatId: "c1", requestId: "r1" }))).status).toBe(400);
		expect((await handleImSwitchConfirm(request({ instanceId: "tg", chatId: "c1", requestId: " " }))).status).toBe(400);
		expect((await handleImSwitchCancel(request({ instanceId: "tg", chatId: "c1" }))).status).toBe(400);
	});

	test("mutations pass the mandatory request id straight to the router", async () => {
		const calls: Array<{ action: string; requestId: string; userId?: string }> = [];
		registerImSwitchGateway({
			status: async () => ({ current: { targetKey: "workspace:main" } }),
			confirm: async (_instance, _chat, context, requestId) => {
				calls.push({ action: "confirm", requestId, ...(context.userId ? { userId: context.userId } : {}) });
				return { ok: true, target: { kind: "workspace", workspace: "other" } };
			},
			cancel: async (_instance, _chat, context, requestId) => {
				calls.push({ action: "cancel", requestId, ...(context.userId ? { userId: context.userId } : {}) });
				return requestId === "live";
			},
		});

		const confirmed = await handleImSwitchConfirm(
			request({ instanceId: "tg", chatId: "c1", threadId: "t1", userId: "u1", requestId: "live" }),
		);
		expect(confirmed.status).toBe(200);
		expect(await confirmed.json()).toMatchObject({ ok: true, target: { workspace: "other" } });

		// A stale id reaches the router (which compares atomically) and fails closed.
		const stale = await handleImSwitchCancel(
			request({ instanceId: "tg", chatId: "c1", threadId: "t1", userId: "u1", requestId: "old" }),
		);
		expect(stale.status).toBe(409);
		expect(await stale.json()).toEqual({ ok: false, error: "stale-request" });
		expect(calls).toEqual([
			{ action: "confirm", requestId: "live", userId: "u1" },
			{ action: "cancel", requestId: "old", userId: "u1" },
		]);
	});
});
