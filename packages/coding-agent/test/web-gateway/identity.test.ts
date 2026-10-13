/**
 * `/api/server/identity` contract — the discovery probe a starting
 * `zeta serve` / desktop shell uses to decide whether a port is a healthy Zeta
 * instance of its own version. Covers the payload (app/version/pid/URLs, the
 * desktop provenance flag) and that the route rides the existing gateway access
 * gate instead of bypassing it.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshDirsFromEnv, VERSION } from "@linxiraos/pi-utils";
import {
	handleServeIdentityGet,
	registerServeInstanceUrls,
	serveIdentity,
	SERVE_IDENTITY_APP,
	SERVE_IDENTITY_PATH,
} from "../../src/server/web-gateway/identity";
import { webGatewayFetch } from "../../src/server/web-gateway";

const ENV_KEYS = ["ZETA_CODING_AGENT_DIR"] as const;
const savedEnv = new Map<string, string | undefined>();
let agentDir = "";

beforeEach(async () => {
	agentDir = await mkdtemp(join(tmpdir(), "zeta-identity-"));
	for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
	process.env.ZETA_CODING_AGENT_DIR = agentDir;
	refreshDirsFromEnv();
});

afterEach(async () => {
	registerServeInstanceUrls(null);
	for (const key of ENV_KEYS) {
		const saved = savedEnv.get(key);
		if (saved === undefined) delete process.env[key];
		else process.env[key] = saved;
	}
	savedEnv.clear();
	refreshDirsFromEnv();
	await rm(agentDir, { recursive: true, force: true });
});

describe("serve identity payload", () => {
	test("reports app, version and the registered URLs", () => {
		registerServeInstanceUrls(
			{
				webUrl: "http://127.0.0.1:30141",
				statsUrl: "http://127.0.0.1:3847",
				gatewayUrl: "http://127.0.0.1:30142",
			},
			new Date("2026-10-13T00:00:00.000Z"),
		);
		const identity = serveIdentity();
		expect(identity.app).toBe(SERVE_IDENTITY_APP);
		expect(identity.version).toBe(VERSION);
		expect(identity.pid).toBe(process.pid);
		expect(identity.startedAt).toBe("2026-10-13T00:00:00.000Z");
		expect(identity.webUrl).toBe("http://127.0.0.1:30141");
		expect(identity.gatewayUrl).toBe("http://127.0.0.1:30142");
	});

	test("drops the URLs once withdrawn and still reports this process's age", () => {
		registerServeInstanceUrls(null);
		const identity = serveIdentity();
		expect(identity.webUrl).toBeUndefined();
		expect(identity.statsUrl).toBeUndefined();
		expect(identity.gatewayUrl).toBeUndefined();
		expect(Date.parse(identity.startedAt)).toBeLessThanOrEqual(Date.now());
	});

	test("the handler answers the identity as no-store JSON", async () => {
		registerServeInstanceUrls(null);
		const response = handleServeIdentityGet();
		expect(response.status).toBe(200);
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		expect(await response.json()).toMatchObject({ app: SERVE_IDENTITY_APP, version: VERSION });
	});
});

describe("identity route over the gateway", () => {
	function request(method: string): Request {
		return new Request(`http://127.0.0.1${SERVE_IDENTITY_PATH}`, { method });
	}

	test("a loopback probe gets the identity", async () => {
		registerServeInstanceUrls({
			webUrl: "http://127.0.0.1:30141",
			statsUrl: "http://127.0.0.1:3847",
			gatewayUrl: null,
		});
		const response = await webGatewayFetch(request("GET"), "127.0.0.1");
		expect(response.status).toBe(200);
		const body: unknown = await response.json();
		expect(body).toMatchObject({ app: SERVE_IDENTITY_APP, webUrl: "http://127.0.0.1:30141" });
	});

	test("only GET is served", async () => {
		expect((await webGatewayFetch(request("POST"), "127.0.0.1")).status).toBe(405);
	});

	test("a non-loopback caller still needs the remote token", async () => {
		expect((await webGatewayFetch(request("GET"), "192.168.1.9")).status).toBe(403);
	});
});
