/**
 * Device routes at the gateway boundary: listing, revocation, scope, migration.
 *
 * The contract these tests pin (see `local://qfa-device-auth.md`):
 * - a loopback caller lists devices without any credential (unchanged trust);
 * - a remote caller passes with *either* the machine-wide `remote.token` or one
 *   active device token, and a revoked device token stops working immediately;
 * - revocation is idempotent, an unknown id is a 404, and `revoke-all` can spare
 *   the caller;
 * - no response ever contains a token or its hash;
 * - rotating the machine token does not silently log paired devices out, and
 *   says so (`devicesStillActive`);
 * - pairing issues exactly one device token, and revoking that device drops the
 *   sessions it was paired for.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshDirsFromEnv } from "@linxiraos/pi-utils";
import { WebConfig } from "../../src/config/web-config";
import { DeviceRegistry } from "../../src/server/auth/device-registry";
import { setDeviceRegistryForTest } from "../../src/server/auth/device-registry";
import { StudioHost, StudioOperations, setStudioHostForTest } from "../../src/server/studio-host/index.js";
import { resetRemoteAccessForTests } from "../../src/server/web-gateway/remote-access";
import { webGatewayFetch } from "../../src/server/web-gateway";

const ENV_KEYS = ["ZETA_CODING_AGENT_DIR"];
const savedEnv = new Map<string, string | undefined>();
const cleanups: Array<() => Promise<void>> = [];
const REMOTE_PEER = "203.0.113.7";

let registry: DeviceRegistry;

function operations(): StudioOperations {
	return new StudioOperations([
		{
			id: "test",
			queries: { "environment.get": async () => ({}) },
			commands: { "core.abort": async () => undefined },
		} as never,
	]);
}

async function setup(yaml?: string): Promise<void> {
	const agentDir = await mkdtemp(join(tmpdir(), "zeta-device-auth-"));
	cleanups.push(() => rm(agentDir, { recursive: true, force: true }));
	for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
	process.env.ZETA_CODING_AGENT_DIR = agentDir;
	if (yaml !== undefined) await writeFile(join(agentDir, "web.yml"), yaml, "utf8");
	refreshDirsFromEnv();
	WebConfig.resetShared();
	registry = new DeviceRegistry(join(agentDir, "auth", "devices.json"));
	setDeviceRegistryForTest(registry);
	setStudioHostForTest(new StudioHost(operations(), { pairingCode: "424242" }));
}

function call(path: string, init: RequestInit = {}, remoteAddr = "127.0.0.1"): Promise<Response> {
	return webGatewayFetch(new Request(`http://127.0.0.1${path}`, init), remoteAddr);
}

interface DeviceListBody {
	devices: Array<{ id: string; label: string; revokedAt: string | null; scopes: string[] }>;
	currentDeviceId: string | null;
	legacyTokenActive: boolean;
}

function rotateBody() {
	return call("/api/remote/token/rotate", { method: "POST" });
}

beforeEach(() => {
	resetRemoteAccessForTests();
});

afterEach(async () => {
	setDeviceRegistryForTest(undefined);
	setStudioHostForTest(undefined);
	for (const key of ENV_KEYS) {
		const saved = savedEnv.get(key);
		if (saved === undefined) delete process.env[key];
		else process.env[key] = saved;
	}
	savedEnv.clear();
	WebConfig.resetShared();
	refreshDirsFromEnv();
	await Promise.all(cleanups.splice(0).map(fn => fn()));
});

describe("GET /api/remote/devices", () => {
	test("loopback lists without a credential and never exposes secrets", async () => {
		await setup();
		const issued = await registry.issue({ label: "Pixel 8", platform: "android" });

		const response = await call("/api/remote/devices");
		expect(response.status).toBe(200);
		const body = (await response.json()) as DeviceListBody;
		expect(body.devices).toHaveLength(1);
		expect(body.devices[0]?.label).toBe("Pixel 8");
		expect(body.currentDeviceId).toBeNull();
		expect(body.legacyTokenActive).toBe(false);

		const raw = JSON.stringify(body);
		expect(raw).not.toContain(issued.token);
		expect(raw).not.toContain("tokenHash");
		expect(raw).not.toContain("zdt_");
	});

	test("a remote caller needs a credential", async () => {
		await setup("remote:\n  token: legacy-secret\n");
		expect((await call("/api/remote/devices", {}, REMOTE_PEER)).status).toBe(401);
	});

	test("the machine token still authenticates a remote caller (migration)", async () => {
		await setup("remote:\n  token: legacy-secret\n");
		await registry.issue({ platform: "android" });

		const response = await call(
			"/api/remote/devices",
			{ headers: { authorization: "Bearer legacy-secret" } },
			REMOTE_PEER,
		);
		expect(response.status).toBe(200);
		const body = (await response.json()) as DeviceListBody;
		expect(body.legacyTokenActive).toBe(true);
		expect(body.currentDeviceId).toBeNull();
	});

	test("a device token authenticates and identifies its own row", async () => {
		await setup();
		const issued = await registry.issue({ label: "Pixel 8", platform: "android" });

		const response = await call(
			"/api/remote/devices",
			{ headers: { authorization: `Bearer ${issued.token}` } },
			REMOTE_PEER,
		);
		expect(response.status).toBe(200);
		const body = (await response.json()) as DeviceListBody;
		expect(body.currentDeviceId).toBe(issued.device.id);
	});

	test("a revoked device token is rejected by the gate", async () => {
		await setup();
		const issued = await registry.issue({ platform: "android" });
		await registry.revoke(issued.device.id);

		const response = await call(
			"/api/remote/devices",
			{ headers: { authorization: `Bearer ${issued.token}` } },
			REMOTE_PEER,
		);
		expect(response.status).toBe(401);
	});
});

describe("DELETE /api/remote/devices/:id", () => {
	test("revokes one device and stops its token", async () => {
		await setup();
		const issued = await registry.issue({ platform: "android" });

		const response = await call(`/api/remote/devices/${issued.device.id}`, { method: "DELETE" });
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ ok: true, revoked: true, current: false });

		const after = await call(
			"/api/remote/devices",
			{ headers: { authorization: `Bearer ${issued.token}` } },
			REMOTE_PEER,
		);
		expect(after.status).toBe(401);
	});

	test("is idempotent and distinguishes an unknown id", async () => {
		await setup();
		const issued = await registry.issue({ platform: "android" });

		expect((await call(`/api/remote/devices/${issued.device.id}`, { method: "DELETE" })).status).toBe(200);
		const again = await call(`/api/remote/devices/${issued.device.id}`, { method: "DELETE" });
		expect(again.status).toBe(200);
		expect(await again.json()).toMatchObject({ ok: true, revoked: false, current: false });

		expect((await call("/api/remote/devices/dev_missing", { method: "DELETE" })).status).toBe(404);
	});

	test("self-revocation is allowed and reports current", async () => {
		await setup();
		const issued = await registry.issue({ platform: "android" });

		const response = await call(
			`/api/remote/devices/${issued.device.id}`,
			{ method: "DELETE", headers: { authorization: `Bearer ${issued.token}` } },
			REMOTE_PEER,
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ revoked: true, current: true });
	});

	test("a read-only device may list but not revoke", async () => {
		await setup();
		const reader = await registry.issue({ platform: "web", scopes: ["read"] });

		const list = await call(
			"/api/remote/devices",
			{ headers: { authorization: `Bearer ${reader.token}` } },
			REMOTE_PEER,
		);
		expect(list.status).toBe(200);

		const revoke = await call(
			`/api/remote/devices/${reader.device.id}`,
			{ method: "DELETE", headers: { authorization: `Bearer ${reader.token}` } },
			REMOTE_PEER,
		);
		expect(revoke.status).toBe(403);
	});
});

describe("POST /api/remote/devices/revoke-all", () => {
	test("revokes every device and can spare the caller", async () => {
		await setup();
		const keeper = await registry.issue({ label: "keep", platform: "web" });
		const other = await registry.issue({ label: "other", platform: "android" });

		const response = await call(
			"/api/remote/devices/revoke-all",
			{
				method: "POST",
				headers: { authorization: `Bearer ${keeper.token}`, "content-type": "application/json" },
				body: JSON.stringify({ keepCurrent: true }),
			},
			REMOTE_PEER,
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ ok: true, revoked: 1 });

		expect(await registry.findByToken(keeper.token)).toBeDefined();
		expect(await registry.findByToken(other.token)).toBeUndefined();
	});

	test("an empty body revokes everything, including the caller", async () => {
		await setup();
		const caller = await registry.issue({ platform: "web" });
		await registry.issue({ platform: "android" });

		const response = await call(
			"/api/remote/devices/revoke-all",
			{ method: "POST", headers: { authorization: `Bearer ${caller.token}` } },
			REMOTE_PEER,
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ revoked: 2 });
		expect(await registry.findByToken(caller.token)).toBeUndefined();
	});
});

describe("token rotation", () => {
	test("reports how many devices stay logged in", async () => {
		await setup("remote:\n  token: legacy-secret\n");
		await registry.issue({ platform: "android" });
		await registry.issue({ platform: "web" });

		const response = await rotateBody();
		expect(response.status).toBe(200);
		const body = (await response.json()) as { devicesStillActive: number; token: string };
		expect(body.devicesStillActive).toBe(2);
		expect(body.token).not.toBe("legacy-secret");
	});
});

describe("pairing issues a device", () => {
	function pair(remoteAddr: string, headers: Record<string, string> = {}, body: unknown = { code: "424242" }) {
		return new StudioHost(operations(), { pairingCode: "424242" }).handle(
			new Request("http://127.0.0.1/api/v1/pair", {
				method: "POST",
				headers: { origin: "http://127.0.0.1:43141", "content-type": "application/json", ...headers },
				body: JSON.stringify(body),
			}),
			remoteAddr,
		);
	}

	test("returns one token, records the device, and drops its sessions on revoke", async () => {
		await setup();
		const host = new StudioHost(operations(), { pairingCode: "424242" });
		const response = await host.handle(
			new Request("http://127.0.0.1/api/v1/pair", {
				method: "POST",
				headers: {
					origin: "http://127.0.0.1:43141",
					"content-type": "application/json",
					"user-agent": "Mozilla/5.0 (Linux; Android 15)",
				},
				body: JSON.stringify({ code: "424242", device: { label: "Pixel 8", issueToken: true } }),
			}),
			"127.0.0.1",
		);
		expect(response.status).toBe(200);
		const body = (await response.json()) as { device: { id: string; token: string; platform: string } };
		expect(body.device.token.startsWith("zdt_")).toBe(true);
		expect(body.device.platform).toBe("android");
		expect((await registry.findByToken(body.device.token))?.id).toBe(body.device.id);

		expect(host.dropDeviceSessions(body.device.id)).toBe(1);
		expect(host.dropDeviceSessions(body.device.id)).toBe(0);
	});

	test("each pairing mints a distinct device", async () => {
		await setup();
		const host = new StudioHost(operations(), { pairingCode: "424242" });
		const first = await host.handle(
			new Request("http://127.0.0.1/api/v1/pair", {
				method: "POST",
				headers: { origin: "http://127.0.0.1:43141", "content-type": "application/json" },
				body: JSON.stringify({ code: "424242", device: { issueToken: true } }),
			}),
			"127.0.0.1",
		);
		const second = await host.handle(
			new Request("http://127.0.0.1/api/v1/pair", {
				method: "POST",
				headers: { origin: "http://127.0.0.1:43141", "content-type": "application/json" },
				body: JSON.stringify({ code: "424242", device: { issueToken: true } }),
			}),
			"127.0.0.1",
		);
		const a = (await first.json()) as { device: { id: string; token: string } };
		const b = (await second.json()) as { device: { id: string; token: string } };
		expect(a.device.id).not.toBe(b.device.id);
		expect(a.device.token).not.toBe(b.device.token);
		expect(await registry.activeCount()).toBe(2);
	});

	test("a remote pairing request from the site's own origin is accepted", async () => {
		// Regression: the Origin allowlist only knew loopback origins, so a phone
		// behind a real host name got 403 even with a valid credential. The guard
		// now compares against the request's own origin.
		await setup("remote:\n  token: legacy-secret\n");
		const response = await new StudioHost(operations(), { pairingCode: "424242" }).handle(
			new Request("https://zeta.example.com/api/v1/pair", {
				method: "POST",
				headers: {
					origin: "https://zeta.example.com",
					"content-type": "application/json",
				},
				body: JSON.stringify({ code: "424242" }),
			}),
			REMOTE_PEER,
		);
		expect(response.status).toBe(200);
	});

	test("a loopback page with a foreign origin is still refused", async () => {
		await setup();
		const response = await pair("127.0.0.1", { origin: "https://evil.example" }, { code: "424242" });
		expect(response.status).toBe(403);
	});
});
