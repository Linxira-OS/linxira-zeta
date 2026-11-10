/**
 * Work Studio IM settings routes: the WeChat QR symbol, binding CRUD through
 * `PUT /api/web-config`, and credential validation.
 *
 * The pane (`web-app/src/studio/settings/ImChannelsPane.tsx`) consumes exactly
 * these shapes: `svg` rendered locally (no external QR image service), the
 * whole binding array written back with the router's own validation, and
 * `POST /api/channels/credentials` validating against the platform before it
 * persists a secret.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshDirsFromEnv } from "@linxiraos/pi-utils";
import { setPendingWechatQr } from "../../src/channels";
import { WebConfig } from "../../src/config/web-config";
import { webGatewayFetch } from "../../src/server/web-gateway";

const savedAgentDir = process.env.ZETA_CODING_AGENT_DIR;
let agentDir: string;

function gateway(path: string, init?: RequestInit): Promise<Response> {
	return webGatewayFetch(new Request(`http://127.0.0.1${path}`, init), "127.0.0.1");
}

async function body(response: Response): Promise<Record<string, unknown>> {
	const value: unknown = await response.json();
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("expected a JSON object");
	return value as Record<string, unknown>;
}

function putConfig(path: string, value: unknown): Promise<Response> {
	return gateway("/api/web-config", {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ path, value }),
	});
}

/** `remote.sessionMappings` from a masked `GET /api/web-config`. */
async function mappings(): Promise<unknown[]> {
	const config = await body(await gateway("/api/web-config"));
	const remote = config["remote"];
	if (remote === null || typeof remote !== "object") throw new Error("missing remote config");
	const rows = (remote as Record<string, unknown>)["sessionMappings"];
	return Array.isArray(rows) ? rows : [];
}

beforeEach(async () => {
	agentDir = await mkdtemp(join(tmpdir(), "zeta-gw-im-settings-"));
	process.env.ZETA_CODING_AGENT_DIR = agentDir;
	refreshDirsFromEnv();
	setPendingWechatQr(null);
});

afterEach(async () => {
	setPendingWechatQr(null);
	if (savedAgentDir === undefined) delete process.env.ZETA_CODING_AGENT_DIR;
	else process.env.ZETA_CODING_AGENT_DIR = savedAgentDir;
	refreshDirsFromEnv();
	await rm(agentDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined);
});

describe("GET /api/channels/wechat/qrcode", () => {
	test("no pending login is not an error", async () => {
		const response = await gateway("/api/channels/wechat/qrcode");
		expect(response.status).toBe(200);
		expect(await body(response)).toEqual({ pending: false });
	});

	test("a page payload comes back with a locally rendered SVG", async () => {
		setPendingWechatQr({
			qrcode: "token-1",
			qrcodeUrl: "https://liteapp.weixin.qq.com/q/abc123",
			status: "wait",
		});
		const response = await gateway("/api/channels/wechat/qrcode");
		expect(response.status).toBe(200);
		const payload = await body(response);
		expect(payload["pending"]).toBe(true);
		expect(payload["status"]).toBe("wait");
		expect(payload["qrcodeUrl"]).toBe("https://liteapp.weixin.qq.com/q/abc123");
		const svg = payload["svg"];
		expect(typeof svg).toBe("string");
		expect(String(svg).startsWith("<svg")).toBe(true);
		expect(String(svg)).toContain("<path");
		// The symbol carries the payload's own content, not a placeholder.
		expect(String(svg).length).toBeGreaterThan(200);
	});

	test("an image payload keeps the image URL and omits the symbol", async () => {
		setPendingWechatQr({
			qrcode: "token-2",
			qrcodeUrl: "data:image/png;base64,AAAA",
			status: "wait",
		});
		const payload = await body(await gateway("/api/channels/wechat/qrcode"));
		expect(payload["pending"]).toBe(true);
		expect(payload["qrcodeUrl"]).toBe("data:image/png;base64,AAAA");
		expect(Object.hasOwn(payload, "svg")).toBe(false);
	});
});

describe("remote.sessionMappings through PUT /api/web-config", () => {
	test("add, edit and remove keep fields the settings table does not own", async () => {
		const added = { platform: "feishu", chatId: "oc_1", workspaceAlias: "alpha", lang: "zh", label: "kept" };
		expect((await putConfig("remote.sessionMappings", [added])).status).toBe(200);
		expect(await mappings()).toEqual([added]);

		// An edit is the same whole-array write: the row's other fields ride along.
		const edited = { ...added, workspaceAlias: "beta" };
		expect((await putConfig("remote.sessionMappings", [edited])).status).toBe(200);
		expect(await mappings()).toEqual([edited]);
		expect((await mappings())[0]).toMatchObject({ lang: "zh", label: "kept" });

		expect((await putConfig("remote.sessionMappings", [])).status).toBe(200);
		expect(await mappings()).toEqual([]);
	});

	test("a binding with no target is rejected before it reaches the file", async () => {
		const response = await putConfig("remote.sessionMappings", [{ platform: "feishu", chatId: "oc_1" }]);
		expect(response.status).toBe(400);
		expect(String((await body(response))["error"])).toContain("workspaceAlias");
		expect(await mappings()).toEqual([]);
	});

	test("the router's own keys survive a round trip", async () => {
		const row = {
			platform: "wechat",
			chatId: "wx-peer",
			sessionId: "s1",
			mode: "direct",
			userId: "u1",
			chatType: "group",
			connectionId: "bot-2",
		};
		expect((await putConfig("remote.sessionMappings", [row])).status).toBe(200);
		expect(await mappings()).toEqual([row]);
	});
});

describe("POST /api/channels/credentials", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	test("an unknown channel is a caller error", async () => {
		const response = await gateway("/api/channels/credentials", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ channel: "slack" }),
		});
		expect(response.status).toBe(400);
	});

	test("a missing token fails without writing anything", async () => {
		const response = await gateway("/api/channels/credentials", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ channel: "telegram" }),
		});
		expect(response.status).toBe(400);
		const payload = await body(response);
		expect(payload["state"]).toBe("error");
		expect((await WebConfig.shared()).getData().channels.telegram.botToken).toBeUndefined();
	});

	test("a validated token is stored and masked on read", async () => {
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ ok: true, result: { id: 42, first_name: "Build", username: "build_bot" } }), {
				status: 200,
			})) as unknown as typeof globalThis.fetch;
		const response = await gateway("/api/channels/credentials", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ channel: "telegram", botToken: "123456:AAH-secret" }),
		});
		expect(response.status).toBe(200);
		const payload = await body(response);
		expect(payload["state"]).toBe("connected");
		expect(payload["credentialsPersisted"]).toBe(true);

		const config = await body(await gateway("/api/web-config"));
		const channels = config["channels"] as Record<string, Record<string, unknown>>;
		expect(channels["telegram"]?.["botToken"]).toBe("••••");
	});

	test("a rejected token is a 400 and leaves the file untouched", async () => {
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ ok: false }), { status: 401 })) as unknown as typeof globalThis.fetch;
		const response = await gateway("/api/channels/credentials", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ channel: "telegram", botToken: "123456:bad" }),
		});
		expect(response.status).toBe(400);
		expect((await body(response))["state"]).toBe("error");
		expect((await WebConfig.shared()).getData().channels.telegram.botToken).toBeUndefined();
	});
});
