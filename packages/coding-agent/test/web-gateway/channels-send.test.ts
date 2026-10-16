/**
 * `POST /api/channels/send` — the IM write entry's contract.
 *
 * The route exists so a caller *outside* the `zeta serve` process (the desktop
 * shell, the GUI's notification fallback, a script) can push one message through
 * a running channel. Its answers have to separate three different failures, and
 * the tests pin the status codes rather than the wording:
 *
 * - the channel is not running here → **404**
 * - the peer is not paired with that channel → **400**
 * - the field that says where the message goes is missing → **400**, sink untouched
 * - the platform refused the send → **500**
 * - the channel took it → **200** with the receipt
 *
 * The runtime sink is registered directly here: `zeta-server` owns the real one
 * (it wires it next to `registerChannelStatus`), and this file drives the
 * handler through the real `webGatewayFetch` dispatch.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshDirsFromEnv } from "@linxiraos/pi-utils";
import { webGatewayFetch } from "../../src/server/web-gateway";
import {
	type ChannelSendOutcome,
	classifySendError,
	handleChannelSend,
	registerChannelSend,
} from "../../src/server/web-gateway/channels";

const ENV_KEYS = ["ZETA_CODING_AGENT_DIR"];
const savedEnv = new Map<string, string | undefined>();
const cleanups: Array<() => Promise<void>> = [];

function send(body: unknown): Request {
	return new Request("http://127.0.0.1/api/channels/send", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: typeof body === "string" ? body : JSON.stringify(body),
	});
}

/** A JSON object body, validated so every field read below is checked. */
async function objectBody(res: Response): Promise<Record<string, unknown>> {
	const value: unknown = await res.json();
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`expected a JSON object body, got ${JSON.stringify(value)}`);
	}
	return value as Record<string, unknown>;
}

/** The `error` string of a gateway error body. */
async function errorOf(res: Response): Promise<string> {
	const error = (await objectBody(res))["error"];
	return typeof error === "string" ? error : `<no error string: ${JSON.stringify(error)}>`;
}

/** The `receipt` object of a send that went out. */
function receiptFrom(body: Record<string, unknown>): Record<string, unknown> {
	const receipt = body["receipt"];
	if (receipt === null || typeof receipt !== "object" || Array.isArray(receipt)) {
		throw new Error(`expected a receipt object, got ${JSON.stringify(receipt)}`);
	}
	return receipt as Record<string, unknown>;
}

/** Register a sink that records its arguments and answers with `outcome`. */
function sinkReturning(outcome: ChannelSendOutcome): Array<[string, string, string]> {
	const calls: Array<[string, string, string]> = [];
	registerChannelSend(async (channelId, to, text) => {
		calls.push([channelId, to, text]);
		return outcome;
	});
	return calls;
}

async function setup(): Promise<void> {
	const agentDir = await mkdtemp(join(tmpdir(), "zeta-gw-channels-"));
	cleanups.push(() => rm(agentDir, { recursive: true, force: true }));
	for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
	process.env.ZETA_CODING_AGENT_DIR = agentDir;
	refreshDirsFromEnv();
}

afterEach(async () => {
	// Module-level seam: never leave a sink behind for the next file.
	registerChannelSend(null);
	for (const key of ENV_KEYS) {
		const previous = savedEnv.get(key);
		if (previous === undefined) delete process.env[key];
		else process.env[key] = previous;
	}
	savedEnv.clear();
	refreshDirsFromEnv();
	await Promise.all(cleanups.splice(0).map(fn => fn()));
});

describe("POST /api/channels/send", () => {
	test("sends one message and answers with the channel's receipt", async () => {
		await setup();
		const calls = sinkReturning({ ok: true, channelId: "wechat", to: "wx-peer" });
		const res = await webGatewayFetch(send({ channelId: "wechat", to: "wx-peer", text: "干完了" }), "127.0.0.1");
		expect(res.status).toBe(200);
		expect(calls).toEqual([["wechat", "wx-peer", "干完了"]]);
		const body = await objectBody(res);
		expect(body["ok"]).toBe(true);
		const receipt = receiptFrom(body);
		expect(receipt["channelId"]).toBe("wechat");
		expect(receipt["to"]).toBe("wx-peer");
		expect(receipt["textLength"]).toBe(3);
		const sentAt = receipt["sentAt"];
		expect(typeof sentAt === "string" && !Number.isNaN(Date.parse(sentAt))).toBe(true);
	});

	test("a channel that is not running here is 404", async () => {
		await setup();
		sinkReturning({ ok: false, kind: "unknown-channel", message: "Channel not enabled: telegram" });
		const res = await webGatewayFetch(send({ channelId: "telegram", to: "42", text: "hi" }), "127.0.0.1");
		expect(res.status).toBe(404);
		expect(await errorOf(res)).toBe("Channel not enabled: telegram");
	});

	test("no channel runtime at all is 404, not a silent success", async () => {
		await setup();
		registerChannelSend(null);
		const res = await webGatewayFetch(send({ channelId: "wechat", to: "wx-peer", text: "hi" }), "127.0.0.1");
		expect(res.status).toBe(404);
		expect(await errorOf(res)).toBe("IM channels are not started");
	});

	test("a peer the channel never paired is 400", async () => {
		await setup();
		sinkReturning({
			ok: false,
			kind: "unpaired",
			message: "WeChat: no context token for peer (wait for an inbound message first)",
		});
		const res = await webGatewayFetch(send({ channelId: "wechat", to: "stranger", text: "hi" }), "127.0.0.1");
		expect(res.status).toBe(400);
		expect(await errorOf(res)).toContain("no context token");
	});

	test("the platform refusing the send is 500", async () => {
		await setup();
		sinkReturning({ ok: false, kind: "failed", message: "Telegram sendMessage failed (HTTP 400): chat not found" });
		const res = await webGatewayFetch(send({ channelId: "telegram", to: "42", text: "hi" }), "127.0.0.1");
		expect(res.status).toBe(500);
		expect(await errorOf(res)).toContain("chat not found");
	});

	test("every missing or blank field is 400 and never reaches the channel", async () => {
		await setup();
		const calls = sinkReturning({ ok: true, channelId: "wechat", to: "wx-peer" });
		const bodies: unknown[] = [
			{ to: "wx-peer", text: "hi" },
			{ channelId: "wechat", text: "hi" },
			{ channelId: "wechat", to: "wx-peer" },
			{ channelId: "wechat", to: "  ", text: "hi" },
			{ channelId: "wechat", to: "wx-peer", text: "" },
			{ channelId: 7, to: "wx-peer", text: "hi" },
			[],
			"not a body",
		];
		for (const body of bodies) {
			const res = await webGatewayFetch(send(body), "127.0.0.1");
			expect(res.status).toBe(400);
		}
		expect(calls).toEqual([]);
	});

	test("only POST is allowed", async () => {
		await setup();
		sinkReturning({ ok: true, channelId: "wechat", to: "wx-peer" });
		const res = await webGatewayFetch(
			new Request("http://127.0.0.1/api/channels/send", { method: "GET" }),
			"127.0.0.1",
		);
		expect(res.status).toBe(405);
	});

	test("the route rides the gateway's existing access gate", async () => {
		await setup();
		const calls = sinkReturning({ ok: true, channelId: "wechat", to: "wx-peer" });
		const body = { channelId: "wechat", to: "wx-peer", text: "hi" };
		// Non-loopback with no token configured, and a cross-site browser
		// request on loopback: both are refused before the sink is reached.
		const remote = await webGatewayFetch(send(body), "192.168.1.5");
		expect(remote.status).toBe(403);
		const crossSite = await webGatewayFetch(
			new Request("http://127.0.0.1/api/channels/send", {
				method: "POST",
				headers: { "Content-Type": "application/json", origin: "https://evil.example" },
				body: JSON.stringify(body),
			}),
			"127.0.0.1",
		);
		expect(crossSite.status).toBe(403);
		expect(calls).toEqual([]);
	});
});

describe("classifySendError", () => {
	test("WeChat's unbound peer reads as unpaired, platform refusals as failed", () => {
		expect(classifySendError("WeChat: no context token for peer (wait for an inbound message first)")).toBe(
			"unpaired",
		);
		expect(classifySendError("Telegram sendMessage failed (HTTP 400): chat not found")).toBe("failed");
		expect(classifySendError("Feishu sendMessage failed: code=9499 msg=bad receive_id")).toBe("failed");
	});
});

describe("handleChannelSend (direct)", () => {
	test("an unparseable body is 400, not a crash", async () => {
		await setup();
		const res = await handleChannelSend(send("{not json"));
		expect(res.status).toBe(400);
		expect(await errorOf(res)).toBe("Invalid JSON body");
	});
});
