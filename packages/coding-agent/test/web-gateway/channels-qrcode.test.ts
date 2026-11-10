/**
 * `GET /api/channels/wechat/qrcode` — the QR-login state the settings surface
 * polls while WeChat is enabled and unpaired.
 *
 * The route reads the adapter's module-level bridge, not a second cache; these
 * tests set that bridge directly and drive the real gateway dispatch.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshDirsFromEnv } from "@linxiraos/pi-utils";
import { setPendingWechatQr } from "../../src/channels";
import { webGatewayFetch } from "../../src/server/web-gateway";

const cleanups: Array<() => Promise<void>> = [];
const savedAgentDir = process.env.ZETA_CODING_AGENT_DIR;

async function setup(): Promise<void> {
	const agentDir = await mkdtemp(join(tmpdir(), "zeta-gw-qr-"));
	cleanups.push(() => rm(agentDir, { recursive: true, force: true }));
	process.env.ZETA_CODING_AGENT_DIR = agentDir;
	refreshDirsFromEnv();
}

afterEach(async () => {
	setPendingWechatQr(null);
	if (savedAgentDir === undefined) delete process.env.ZETA_CODING_AGENT_DIR;
	else process.env.ZETA_CODING_AGENT_DIR = savedAgentDir;
	refreshDirsFromEnv();
	await Promise.all(cleanups.splice(0).map(fn => fn()));
});

function qrRequest(method = "GET"): Request {
	return new Request("http://127.0.0.1/api/channels/wechat/qrcode", { method });
}

describe("GET /api/channels/wechat/qrcode", () => {
	test("reports no pending login when the adapter has no QR", async () => {
		await setup();
		setPendingWechatQr(null);
		const res = await webGatewayFetch(qrRequest(), "127.0.0.1");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ pending: false });
	});

	test("surfaces the live QR payload and status", async () => {
		await setup();
		setPendingWechatQr({
			qrcode: "qr-token",
			qrcodeUrl: "https://liteapp.weixin.qq.com/q/demo",
			status: "wait",
		});
		const res = await webGatewayFetch(qrRequest(), "127.0.0.1");
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body).toMatchObject({
			pending: true,
			qrcodeUrl: "https://liteapp.weixin.qq.com/q/demo",
			status: "wait",
		});
		// The settings pane draws this symbol itself: the gateway encodes the
		// same payload the terminal renders as block characters.
		expect(typeof body["svg"]).toBe("string");
		expect(String(body["svg"]).startsWith("<svg")).toBe(true);
	});

	test("only GET is accepted", async () => {
		await setup();
		const res = await webGatewayFetch(qrRequest("POST"), "127.0.0.1");
		expect(res.status).toBe(405);
	});
});
