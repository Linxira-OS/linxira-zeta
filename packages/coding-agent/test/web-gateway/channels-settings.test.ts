/**
 * Work Studio IM settings routes: the per-instance WeChat QR symbol, binding
 * CRUD through `PUT /api/im/bindings`, and credential validation.
 *
 * The pane consumes exactly these shapes: `svg` rendered locally (no external
 * QR image service), the whole bindings array written back with the validator's
 * own rules, and `POST /api/channels/credentials` validating against the
 * platform before it persists a secret to one instance.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshDirsFromEnv } from "@linxiraos/pi-utils";
import { setPendingWechatQr } from "../../src/channels";
import { WebConfig } from "../../src/config/web-config";
import { webGatewayFetch } from "../../src/server/web-gateway";

const savedAgentDir = process.env.ZETA_CODING_AGENT_DIR;
let agentDir: string;

const PROFILE = {
	id: "companion",
	label: "Companion",
	persona: { mode: "workspace" },
	location: { kind: "workspace", workspace: "main" },
	tools: { builtin: [], extensions: [], customTools: [], mcpServers: [], skills: [], commands: [] },
	memory: {},
};

const BASE_BINDING = {
	id: "b_0123456789abcdef",
	instanceId: "wechat",
	platform: "wechat",
	chatId: "wx-peer",
	agentProfileId: "companion",
	sessionId: "s1",
	target: { kind: "workspace", workspace: "main" },
	role: "answer",
	createdAt: "2026-01-01T00:00:00.000Z",
};

function gateway(path: string, init?: RequestInit): Promise<Response> {
	return webGatewayFetch(new Request(`http://127.0.0.1${path}`, init), "127.0.0.1");
}

async function body(response: Response): Promise<Record<string, unknown>> {
	const value: unknown = await response.json();
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("expected a JSON object");
	return value as Record<string, unknown>;
}

function putBindings(bindings: unknown[]): Promise<Response> {
	return gateway("/api/im/bindings", {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ bindings }),
	});
}

/** Bindings as the gateway reports them (masked web-config or im route). */
async function bindings(): Promise<Array<Record<string, unknown>>> {
	const payload = await body(await gateway("/api/im/bindings"));
	const rows = payload["bindings"];
	if (!Array.isArray(rows)) throw new Error("missing bindings array");
	return rows as Array<Record<string, unknown>>;
}

beforeEach(async () => {
	agentDir = await mkdtemp(join(tmpdir(), "zeta-gw-im-settings-"));
	process.env.ZETA_CODING_AGENT_DIR = agentDir;
	refreshDirsFromEnv();
	WebConfig.resetShared();
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
					{
						id: "telegram",
						platform: "telegram",
						label: "Telegram",
						enabled: false,
						agentProfile: PROFILE.id,
						allow: { peers: ["42"] },
						credentials: {},
					},
				],
			},
			imAgents: [PROFILE],
			remote: {},
		}),
	);
	setPendingWechatQr("wechat", null);
});

afterEach(async () => {
	setPendingWechatQr("wechat", null);
	if (savedAgentDir === undefined) delete process.env.ZETA_CODING_AGENT_DIR;
	else process.env.ZETA_CODING_AGENT_DIR = savedAgentDir;
	refreshDirsFromEnv();
	WebConfig.resetShared();
	await rm(agentDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined);
});

describe("GET /api/channels/instances/<id>/wechat/qrcode", () => {
	function qr(): Promise<Response> {
		return gateway("/api/channels/instances/wechat/wechat/qrcode");
	}

	test("no pending login is not an error", async () => {
		const response = await qr();
		expect(response.status).toBe(200);
		expect(await body(response)).toEqual({ pending: false });
	});

	test("a page payload comes back with a locally rendered SVG", async () => {
		setPendingWechatQr("wechat", {
			qrcode: "token-1",
			qrcodeUrl: "https://liteapp.weixin.qq.com/q/abc123",
			status: "wait",
		});
		const response = await qr();
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
		setPendingWechatQr("wechat", {
			qrcode: "token-2",
			qrcodeUrl: "data:image/png;base64,AAAA",
			status: "wait",
		});
		const payload = await body(await qr());
		expect(payload["pending"]).toBe(true);
		expect(payload["qrcodeUrl"]).toBe("data:image/png;base64,AAAA");
		expect(Object.hasOwn(payload, "svg")).toBe(false);
	});
});

describe("remote.imBindings through PUT /api/im/bindings", () => {
	test("add, edit and remove keep the fields the router owns", async () => {
		const added = {
			...BASE_BINDING,
			id: "b_fedcba9876543210",
			chatId: "oc_1",
			threadId: "t1",
			userId: "u1",
			lang: "zh",
			role: "mention",
		};
		expect((await putBindings([added])).status).toBe(200);
		expect(await bindings()).toMatchObject([added]);

		// An edit is the same whole-array write: the row's other fields ride along.
		const edited = {
			...added,
			target: { kind: "workspace", workspace: "beta" },
			needsReview: true,
			needsReviewReason: "target moved",
		};
		expect((await putBindings([edited])).status).toBe(200);
		expect(await bindings()).toMatchObject([edited]);

		expect((await putBindings([])).status).toBe(200);
		expect(await bindings()).toEqual([]);
	});

	test("a binding with no target is rejected before it reaches the file", async () => {
		const { target: _target, ...untargeted } = BASE_BINDING;
		const response = await putBindings([untargeted]);
		expect(response.status).toBe(400);
		expect(String((await body(response))["error"])).toContain("target");
		expect(await bindings()).toEqual([]);
	});

	test("a binding that names an unknown instance is rejected, never silently re-homed", async () => {
		const response = await putBindings([{ ...BASE_BINDING, instanceId: "missing", chatId: "oc_2" }]);
		expect(response.status).toBe(400);
		expect(String((await body(response))["error"])).toContain("unknown instance");
		expect(await bindings()).toEqual([]);
	});

	test("the router's own keys survive a round trip", async () => {
		const row = {
			...BASE_BINDING,
			lang: "en",
			role: "observe",
			needsReview: true,
			needsReviewReason: "legacy connectionId/instance mapping needs review",
			model: { provider: "anthropic", model: "claude-sonnet-4" },
		};
		expect((await putBindings([row])).status).toBe(200);
		expect(await bindings()).toMatchObject([row]);
	});
});

describe("POST /api/channels/credentials", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	async function telegramCredentials(): Promise<Record<string, unknown>> {
		const config = (await WebConfig.shared()).getData();
		const found = config.channels.instances.find(entry => entry.id === "telegram");
		return found?.credentials ?? {};
	}

	test("an unknown instance is a caller error", async () => {
		const response = await gateway("/api/channels/credentials", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ instanceId: "slack", botToken: "x" }),
		});
		expect(response.status).toBe(404);
	});

	test("a missing instanceId is a usage error", async () => {
		const response = await gateway("/api/channels/credentials", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ channel: "telegram" }),
		});
		expect(response.status).toBe(400);
		expect(String((await body(response))["error"])).toContain("instanceId");
	});

	test("a missing token fails without writing anything", async () => {
		const response = await gateway("/api/channels/credentials", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ instanceId: "telegram" }),
		});
		expect(response.status).toBe(400);
		const payload = await body(response);
		expect(payload["state"]).toBe("error");
		expect(await telegramCredentials()).toEqual({});
	});

	test("a validated token is stored and masked on read", async () => {
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ ok: true, result: { id: 42, first_name: "Build", username: "build_bot" } }), {
				status: 200,
			})) as unknown as typeof globalThis.fetch;
		const response = await gateway("/api/channels/credentials", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ instanceId: "telegram", botToken: "123456:AAH-secret" }),
		});
		expect(response.status).toBe(200);
		const payload = await body(response);
		expect(payload["state"]).toBe("connected");
		expect(payload["credentialsPersisted"]).toBe(true);

		const config = await body(await gateway("/api/web-config"));
		const channels = config["channels"] as { instances: Array<Record<string, unknown>> };
		const telegram = channels.instances.find(entry => entry["id"] === "telegram");
		const credentials = telegram?.["credentials"] as Record<string, unknown> | undefined;
		expect(credentials?.["botToken"]).toBe("••••");
	});

	test("a rejected token is a 400 and leaves the file untouched", async () => {
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ ok: false }), { status: 401 })) as unknown as typeof globalThis.fetch;
		const response = await gateway("/api/channels/credentials", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ instanceId: "telegram", botToken: "123456:bad" }),
		});
		expect(response.status).toBe(400);
		expect((await body(response))["state"]).toBe("error");
		expect(await telegramCredentials()).toEqual({});
	});
});
