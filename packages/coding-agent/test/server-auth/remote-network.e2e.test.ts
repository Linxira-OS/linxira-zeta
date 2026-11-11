/**
 * End-to-end remote access over a real Bun server.
 *
 * Every other suite calls a handler directly with a fabricated peer address.
 * Here the request actually crosses a socket, so the cookie jar, the Origin
 * header, the forwarded-for path, the WebSocket upgrade and the revocation
 * timing are exercised the way a phone would hit them.
 *
 * A remote peer is simulated the only way a reverse proxy does: the socket is
 * loopback but `x-forwarded-for` is present, which must be treated as remote.
 * `Host` is set to the public name so the browser origin matches the request
 * origin; a mismatching Origin is the cross-site case.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshDirsFromEnv } from "@linxiraos/pi-utils";
import { WebConfig } from "../../src/config/web-config";
import { DeviceRegistry, setDeviceRegistryForTest } from "../../src/server/auth/device-registry";
import { setSessionStoreForTest, SessionStore } from "../../src/server/auth/session-store";
import { setResourceOwnership } from "../../src/server/web-gateway/binding-guard";
import {
	StudioHost,
	StudioOperations,
	isStudioRequest,
	isStudioWsUpgradeRequest,
	setStudioHostForTest,
} from "../../src/server/studio-host/index.js";
import { resetRemoteAccessForTests } from "../../src/server/web-gateway/remote-access";
import { webGatewayFetch } from "../../src/server/web-gateway";
import { twoFactorStore, setTwoFactorStoreForTest } from "../../src/server/auth/two-factor-store";
import { totp, totpStep } from "../../src/server/auth/totp";

const HOST = "zeta.example.com";
const ORIGIN = `http://${HOST}`;
const PEER = "203.0.113.9";
const ENV_KEYS = ["ZETA_CODING_AGENT_DIR"];
const savedEnv = new Map<string, string | undefined>();
const cleanups: Array<() => Promise<void>> = [];

let agentDir = "";
let registry: DeviceRegistry;
let server: Server | undefined;
let base = "";

function operations(): StudioOperations {
	return new StudioOperations([
		{
			id: "test",
			queries: {
				"environment.get": async () => ({ ok: true }),
				"session.state": async () => ({ ok: true }),
			},
			commands: {
				"core.abort": async () => undefined,
				"session.create": async () => undefined,
			},
		} as never,
	]);
}

/** Start the real server that mirrors `zeta serve`'s dispatch. */
function startServer(): void {
	const host = new StudioHost(operations(), { pairingCode: "424242" });
	setStudioHostForTest(host);
	server = Bun.serve<{ kind: "studio"; sessionId: string }>({
		port: 0,
		async fetch(req, srv) {
			const remoteAddr = srv.requestIP(req)?.address;
			if (isStudioWsUpgradeRequest(req)) {
				const response = await host.upgrade(req, srv, remoteAddr);
				return response ?? undefined;
			}
			if (isStudioRequest(req)) return host.handle(req, remoteAddr);
			return webGatewayFetch(req, remoteAddr);
		},
		websocket: {
			open(ws) {
				host.attachSocket(ws.data.sessionId, ws);
			},
			message(ws, message) {
				const parsed: unknown = JSON.parse(String(message));
				const scope = parsed !== null && typeof parsed === "object" && "scope" in parsed
					? (parsed.scope as { scope: "all" })
					: { scope: "all" as const };
				for (const event of host.openEvent(scope)) ws.send(JSON.stringify(event));
			},
			close(ws) {
				host.detachSocket(ws.data.sessionId, ws);
			},
		},
	});
	base = `http://127.0.0.1:${server.port}`;
}

/** A request as a remote browser sends it: public Host + forwarded peer. */
function remote(path: string, init: RequestInit = {}): Promise<Response> {
	return fetch(`${base}${path}`, {
		...init,
		headers: {
			host: HOST,
			origin: ORIGIN,
			"x-forwarded-for": PEER,
			...(init.headers as Record<string, string> | undefined),
		},
	});
}

function cookiesFrom(response: Response): string {
	const raw = response.headers.getSetCookie?.() ?? [];
	return raw.map(entry => entry.split(";")[0]).join("; ");
}

interface PairedDevice {
	cookie: string;
	deviceId: string;
	token: string;
	csrf: string;
}

/** Pair through the real endpoint, exactly like a phone boot does. */
async function pair(label = "Pixel"): Promise<PairedDevice> {
	const response = await remote("/api/v1/pair", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ code: "424242", device: { label, platform: "android", issueToken: true } }),
	});
	expect(response.status).toBe(200);
	const body = (await response.json()) as { csrf: string; device: { id: string; token: string } };
	return { cookie: cookiesFrom(response), deviceId: body.device.id, token: body.device.token, csrf: body.csrf };
}

async function setup(): Promise<void> {
	agentDir = await mkdtemp(join(tmpdir(), "zeta-remote-net-"));
	cleanups.push(() => rm(agentDir, { recursive: true, force: true }));
	for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
	process.env.ZETA_CODING_AGENT_DIR = agentDir;
	await writeFile(join(agentDir, "web.yml"), "remote:\n  token: machine-secret\n", "utf8");
	refreshDirsFromEnv();
	WebConfig.resetShared();
	registry = new DeviceRegistry(join(agentDir, "auth", "devices.json"));
	setDeviceRegistryForTest(registry);
	const sessions = new SessionStore(join(agentDir, "auth", "sessions.json"));
	setSessionStoreForTest(sessions);
	setTwoFactorStoreForTest(undefined);
	resetRemoteAccessForTests();
}

beforeAll(() => {
	startServer();
});

afterAll(() => {
	server?.stop(true);
	setStudioHostForTest(undefined);
});

beforeEach(async () => {
	await setup();
});

afterEach(async () => {
	setResourceOwnership(undefined);
	setDeviceRegistryForTest(undefined);
	setSessionStoreForTest(undefined);
	setTwoFactorStoreForTest(undefined);
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

describe("origin and forwarded peers", () => {
	test("a forwarded loopback request is remote: no credential is 401", async () => {
		const response = await remote("/api/remote/devices");
		expect(response.status).toBe(401);
	});

	test("a remote credential with the request's own origin is accepted", async () => {
		const device = await pair();
		const response = await remote("/api/remote/devices", { headers: { cookie: device.cookie } });
		expect(response.status).toBe(200);
	});

	test("a cross-site origin is refused even with a valid cookie", async () => {
		const device = await pair();
		const response = await remote("/api/remote/devices", {
			headers: { cookie: device.cookie, origin: "https://evil.example" },
		});
		expect(response.status).toBe(403);
	});

	test("pairing returns a code QR, never the machine token", async () => {
		const response = await remote("/api/remote/pairing", {
			headers: { authorization: "Bearer machine-secret" },
		});
		expect(response.status).toBe(200);
		const body = (await response.json()) as { code: string; payload: string; token?: string };
		expect(body.code).toBe("424242");
		expect(body.payload).toContain("#zeta-pair=424242");
		expect(body.token).toBeUndefined();
		expect(JSON.stringify(body)).not.toContain("machine-secret");
	});

	test("a read-only device cannot mint, verify-write, or read the pairing code", async () => {
		const reader = await registry.issue({ label: "tablet", scopes: ["read"] });
		const auth = { authorization: `Bearer ${reader.token}` };
		expect((await remote("/api/v1/query", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ queryName: "environment.get", input: {} }) })).status).toBe(200);
		expect((await remote("/api/v1/command", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ commandName: "core.abort", input: {}, idempotencyKey: "k1", requestId: "r1" }) })).status).toBe(403);
		expect((await remote("/api/remote/pairing", { headers: auth })).status).toBe(403);
		expect((await remote("/api/terminal", { method: "POST", headers: auth })).status).toBe(403);
	});
});

describe("sessions", () => {
	test("pairing sets an HttpOnly cookie the client can use for query and bootstrap", async () => {
		const device = await pair();
		expect(device.cookie).toContain("studio_session=");

		const bootstrap = await remote("/api/v1/bootstrap", { headers: { cookie: device.cookie } });
		expect(bootstrap.status).toBe(200);

		const query = await remote("/api/v1/query", {
			method: "POST",
			headers: { cookie: device.cookie, "content-type": "application/json" },
			body: JSON.stringify({ queryName: "environment.get", input: {} }),
		});
		expect(query.status).toBe(200);
	});

	test("revoking one device kills its session and leaves the other alone", async () => {
		const first = await pair("one");
		const second = await pair("two");
		const revoke = await remote(`/api/remote/devices/${first.deviceId}`, {
			method: "DELETE",
			headers: { authorization: "Bearer machine-secret" },
		});
		expect(revoke.status).toBe(200);

		expect((await remote("/api/v1/bootstrap", { headers: { cookie: first.cookie } })).status).toBe(401);
		expect((await remote("/api/v1/bootstrap", { headers: { cookie: second.cookie } })).status).toBe(200);
	});

	test("revoke-all kills every session and answers 401 afterwards", async () => {
		const first = await pair("one");
		const second = await pair("two");
		const response = await remote("/api/remote/devices/revoke-all", {
			method: "POST",
			headers: { authorization: "Bearer machine-secret", "content-type": "application/json" },
			body: "{}",
		});
		expect(response.status).toBe(200);
		expect((await remote("/api/v1/bootstrap", { headers: { cookie: first.cookie } })).status).toBe(401);
		expect((await remote("/api/v1/bootstrap", { headers: { cookie: second.cookie } })).status).toBe(401);
	});

	test("a cookie failure does not fall back to the machine token", async () => {
		const response = await remote("/api/v1/bootstrap", {
			headers: { cookie: "studio_session=stale-value", authorization: "Bearer machine-secret" },
		});
		expect(response.status).toBe(401);
	});
});

describe("scope", () => {
	test("write scope is required for a command and allowed for a query", async () => {
		const device = await pair();
		const auth = { authorization: `Bearer ${device.token}` };
		expect((await remote("/api/v1/command", {
			method: "POST",
			headers: { ...auth, "content-type": "application/json" },
			body: JSON.stringify({ commandName: "core.abort", input: {}, idempotencyKey: "k", requestId: "r" }),
		})).status).toBe(202);
	});

	test("binding refuses a global list and the wrong session, allows the bound one", async () => {
		const bound = await registry.issue({ label: "bound", binding: { sessionId: "sess-a" } });
		const auth = { authorization: `Bearer ${bound.token}` };

		expect((await remote("/api/sessions", { headers: auth })).status).toBe(403);
		expect((await remote("/api/sessions/sess-b", { headers: auth })).status).toBe(403);
		expect((await remote("/api/sessions/sess-a", { headers: auth })).status).not.toBe(403);
	});

	test("a workspace binding resolves the session through the host's ownership lookup", async () => {
		setResourceOwnership({
			workspaceOfSession: async sessionId => (sessionId === "sess-a" ? "ws-1" : undefined),
		});
		const bound = await registry.issue({ label: "bound", binding: { workspaceId: "ws-1" } });
		const auth = { authorization: `Bearer ${bound.token}` };

		expect((await remote("/api/sessions/sess-a", { headers: auth })).status).not.toBe(403);
		expect((await remote("/api/sessions/sess-b", { headers: auth })).status).toBe(403);
		expect((await remote("/api/sessions/sess-a?workspaceId=ws-2", { headers: auth })).status).toBe(403);
	});

	test("a tampered binding on disk drops the device instead of widening it", async () => {
		const bound = await registry.issue({ label: "bound", binding: { sessionId: "sess-a" } });
		await writeFile(
			join(agentDir, "auth", "devices.json"),
			JSON.stringify({ version: 1, devices: [{ id: bound.device.id, tokenHash: "0".repeat(64), binding: "not-an-object" }] }),
			"utf8",
		);
		expect((await remote("/api/remote/devices", { headers: { authorization: `Bearer ${bound.token}` } })).status).toBe(401);
	});
});

describe("2FA challenge on a real socket", () => {
	test("command is refused until verified, then accepted", async () => {
		const device = await pair();
		const store = twoFactorStore();
		const enrollment = await store.enroll();
		const step = totpStep(Date.now());
		expect((await store.confirm(totp(enrollment.secret, Date.now()))).ok).toBe(true);
		await store.setRequired(true);

		const command = () =>
			remote("/api/v1/command", {
				method: "POST",
				headers: { cookie: device.cookie, "content-type": "application/json", "x-studio-csrf": device.csrf },
				body: JSON.stringify({ commandName: "core.abort", input: {}, idempotencyKey: "k", requestId: "r" }),
			});

		const denied = await command();
		expect(denied.status).toBe(403);
		expect(((await denied.json()) as { error: string }).error).toBe("totp_required");

		const verify = await remote("/api/auth/2fa/verify", {
			method: "POST",
			headers: { cookie: device.cookie, "content-type": "application/json" },
			body: JSON.stringify({ code: totp(enrollment.secret, Date.now()) }),
		});
		expect(verify.status).toBe(200);

		const allowed = await command();
		// Commands are accepted asynchronously: 202 is the success envelope.
		expect(allowed.status).toBe(202);
		expect(step).toBeGreaterThan(0);
	});
});

/** Open the event socket as a remote browser would, and await its first frame. */
async function openEvents(cookie: string): Promise<{ ws: WebSocket; closed: Promise<boolean> }> {
	const connect = globalThis.WebSocket as unknown as new (
		url: string,
		options: { headers: Record<string, string> },
	) => WebSocket;
	const closed = Promise.withResolvers<boolean>();
	const ws = new connect(`ws://127.0.0.1:${server?.port}/api/v1/events`, {
		headers: { host: HOST, origin: ORIGIN, "x-forwarded-for": PEER, cookie },
	});
	ws.onclose = () => closed.resolve(true);
	ws.onerror = () => closed.resolve(true);
	await new Promise<void>(resolve => {
		ws.onopen = () => {
			ws.send(JSON.stringify({ scope: { scope: "all" } }));
			resolve();
		};
	});
	return { ws, closed: closed.promise };
}

describe("events websocket", () => {
	test("revoke-all closes every device socket", async () => {
		const first = await pair("one");
		const second = await pair("two");
		const sockets = await Promise.all([openEvents(first.cookie), openEvents(second.cookie)]);

		const response = await remote("/api/remote/devices/revoke-all", {
			method: "POST",
			headers: { authorization: "Bearer machine-secret", "content-type": "application/json" },
			body: "{}",
		});
		expect(response.status).toBe(200);
		expect(await sockets[0].closed).toBe(true);
		expect(await sockets[1].closed).toBe(true);
	});

	test("a revoked device's socket is closed", async () => {
		const device = await pair();
		const opened = Promise.withResolvers<boolean>();
		const closed = Promise.withResolvers<boolean>();
		const connect = globalThis.WebSocket as unknown as new (
			url: string,
			options: { headers: Record<string, string> },
		) => WebSocket;
		const ws = new connect(`ws://127.0.0.1:${server?.port}/api/v1/events`, {
			headers: { host: HOST, origin: ORIGIN, "x-forwarded-for": PEER, cookie: device.cookie },
		});
		ws.onopen = () => {
			ws.send(JSON.stringify({ scope: { scope: "all" } }));
			opened.resolve(true);
		};
		ws.onclose = () => closed.resolve(true);
		ws.onerror = () => closed.resolve(true);

		expect(await opened.promise).toBe(true);
		await remote(`/api/remote/devices/${device.deviceId}`, {
			method: "DELETE",
			headers: { authorization: "Bearer machine-secret" },
		});
		expect(await closed.promise).toBe(true);
	});
});
