/**
 * `GET /api/channels/instances/<id>/wechat/qrcode` — the QR-login state the
 * settings surface polls while a WeChat instance is enabled and unpaired.
 *
 * The route reads the adapter's module-level bridge, not a second cache; these
 * tests set that bridge directly and drive the real gateway dispatch.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshDirsFromEnv } from "@linxiraos/pi-utils";
import { setPendingWechatQr } from "../../src/channels";
import { WebConfig } from "../../src/config/web-config";
import { webGatewayFetch } from "../../src/server/web-gateway";

const PROFILE = {
	id: "companion",
	label: "Companion",
	persona: { mode: "workspace" },
	location: { kind: "workspace", workspace: "main" },
	tools: { builtin: [], extensions: [], customTools: [], mcpServers: [], skills: [], commands: [] },
	memory: {},
};

const cleanups: Array<() => Promise<void>> = [];
const savedAgentDir = process.env.ZETA_CODING_AGENT_DIR;

async function setup(): Promise<void> {
	const agentDir = await mkdtemp(join(tmpdir(), "zeta-gw-qr-"));
	cleanups.push(() => rm(agentDir, { recursive: true, force: true }));
	await writeFile(
		join(agentDir, "web.yml"),
		JSON.stringify({
			channels: {
				instances: [
					{
						id: "wechat",
						platform: "wechat",
						label: "WeChat",
						enabled: true,
						agentProfile: PROFILE.id,
						allow: { peers: ["wx-peer"] },
						credentials: {},
					},
				],
			},
			imAgents: [PROFILE],
			remote: {},
		}),
	);
	process.env.ZETA_CODING_AGENT_DIR = agentDir;
	refreshDirsFromEnv();
	WebConfig.resetShared();
}

afterEach(async () => {
	setPendingWechatQr("wechat", null);
	if (savedAgentDir === undefined) delete process.env.ZETA_CODING_AGENT_DIR;
	else process.env.ZETA_CODING_AGENT_DIR = savedAgentDir;
	refreshDirsFromEnv();
	WebConfig.resetShared();
	await Promise.all(cleanups.splice(0).map(fn => fn()));
});

function qrRequest(method = "GET"): Request {
	return new Request("http://127.0.0.1/api/channels/instances/wechat/wechat/qrcode", { method });
}

describe("GET /api/channels/instances/<id>/wechat/qrcode", () => {
	test("reports no pending login when the adapter has no QR", async () => {
		await setup();
		setPendingWechatQr("wechat", null);
		const res = await webGatewayFetch(qrRequest(), "127.0.0.1");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ pending: false });
	});

	test("surfaces the live QR payload and status", async () => {
		await setup();
		setPendingWechatQr("wechat", {
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

	test("another instance's QR is not reported for this one", async () => {
		await setup();
		setPendingWechatQr("wechat-other", {
			qrcode: "qr-other",
			qrcodeUrl: "https://liteapp.weixin.qq.com/q/other",
			status: "wait",
		});
		const res = await webGatewayFetch(qrRequest(), "127.0.0.1");
		expect(await res.json()).toEqual({ pending: false });
	});

	test("only GET is accepted", async () => {
		await setup();
		const res = await webGatewayFetch(qrRequest("POST"), "127.0.0.1");
		expect(res.status).toBe(405);
	});
});
