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
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
const ENV_KEYS = ["ZETA_CODING_AGENT_DIR", "ZETA_STUDIO_PAIRING_CODE"];
const savedEnv = new Map<string, string | undefined>();
const cleanups: Array<() => Promise<void>> = [];

let agentDir = "";
let registry: DeviceRegistry;
let server: Server<unknown> | undefined;
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

/** A real server over one host, mirroring `zeta serve`'s dispatch. */
function serveHost(host: StudioHost): { server: Server; base: string } {
	const started = Bun.serve<{ kind: "studio"; sessionId: string }>({
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
				const scope =
					parsed !== null && typeof parsed === "object" && "scope" in parsed
						? (parsed.scope as { scope: "all" })
						: { scope: "all" as const };
				for (const event of host.openEvent(scope)) ws.send(JSON.stringify(event));
			},
			close(ws) {
				host.detachSocket(ws.data.sessionId, ws);
			},
		},
	});
	return { server: started, base: `http://127.0.0.1:${started.port}` };
}

/** Start the shared server that mirrors `zeta serve`'s dispatch. */
function startServer(): void {
	const host = new StudioHost(operations(), { pairingCode: "424242" });
	setStudioHostForTest(host);
	const started = serveHost(host);
	server = started.server;
	base = started.base;
}

/** A request as a remote browser sends it: public Host + forwarded peer. */
function requestTo(targetBase: string, path: string, init: RequestInit = {}): Promise<Response> {
	return fetch(`${targetBase}${path}`, {
		...init,
		headers: {
			host: HOST,
			origin: ORIGIN,
			"x-forwarded-for": PEER,
			...(init.headers as Record<string, string> | undefined),
		},
	});
}

function remote(path: string, init: RequestInit = {}): Promise<Response> {
	return requestTo(base, path, init);
}

function cookiesFrom(response: Response): string {
	const raw = response.headers.getSetCookie?.() ?? [];
	return raw.map(entry => entry.split(";")[0]).join("; ");
}

/**
 * Whether a response was refused by the **binding** gate, rather than by the
 * route's own policy (the file handler has its own 403 for a cwd it does not
 * know, which is not what this suite is testing).
 */
async function isBindingDenied(response: Response): Promise<boolean> {
	if (response.status !== 403) return false;
	try {
		const body: unknown = await response.clone().json();
		return body !== null && typeof body === "object" && "error" in body && body.error === "binding_scope";
	} catch {
		return false;
	}
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
	delete process.env.ZETA_STUDIO_PAIRING_CODE;
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

	test("pairing needs the code, and a malformed binding does not burn it", async () => {
		// This host uses a generated (single-use) code, so "not burned" is observable.
		const host = new StudioHost(operations());
		const started = serveHost(host);
		const post = (body: unknown) =>
			requestTo(started.base, "/api/v1/pair", {
				method: "POST",
				headers: { authorization: "Bearer machine-secret", "content-type": "application/json" },
				body: JSON.stringify(body),
			});
		const code = host.pairingCode;
		try {
			// A token header is not a substitute for the presence credential.
			const noCode = await post({ device: { label: "Pixel" } });
			expect(noCode.status).toBe(401);
			const noCodeBody = (await noCode.json()) as { error: string };
			expect(noCodeBody.error).toBe("unauthenticated");

			// A malformed binding is a 400 *before* the one-time code is reserved.
			const invalid = await post({ code, device: { binding: { sessionId: 42 } } });
			expect(invalid.status).toBe(400);
			const invalidBody = (await invalid.json()) as { error: string };
			expect(invalidBody.error).toBe("binding_invalid");

			// The same code still pairs: it was not burned by the invalid block.
			const paired = await post({ code, device: { label: "Pixel", issueToken: true } });
			expect(paired.status).toBe(200);
			const pairedBody = (await paired.json()) as { device: { token: string } };
			expect(pairedBody.device.token.startsWith("zdt_")).toBe(true);

			// Now it is consumed; replaying the old code fails.
			const replay = await post({ code });
			expect(replay.status).toBe(401);
		} finally {
			started.server.stop(true);
		}
	});

	test("a read-only device cannot mint, verify-write, or read the pairing code", async () => {
		const reader = await registry.issue({ label: "tablet", scopes: ["read"] });
		const auth = { authorization: `Bearer ${reader.token}` };
		expect(
			(
				await remote("/api/v1/query", {
					method: "POST",
					headers: { ...auth, "content-type": "application/json" },
					body: JSON.stringify({ queryName: "environment.get", input: {} }),
				})
			).status,
		).toBe(200);
		expect(
			(
				await remote("/api/v1/command", {
					method: "POST",
					headers: { ...auth, "content-type": "application/json" },
					body: JSON.stringify({ commandName: "core.abort", input: {}, idempotencyKey: "k1", requestId: "r1" }),
				})
			).status,
		).toBe(403);
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

	test("a Studio cookie session slides its one-hour expiry on use", async () => {
		const device = await pair();
		const storePath = join(agentDir, "auth", "sessions.json");
		const expiry = async (): Promise<number> => {
			const file = JSON.parse(await readFile(storePath, "utf8")) as { sessions: Array<{ expiresAt: number }> };
			return file.sessions[0]?.expiresAt ?? 0;
		};
		const created = await expiry();

		// Advance the clock past the one-minute touch throttle: an active Studio
		// request must move the expiry forward, not leave it at pairing time.
		const realNow = Date.now;
		const later = created - 3_600_000 + 61_000;
		Date.now = () => later;
		try {
			const bootstrap = await remote("/api/v1/bootstrap", { headers: { cookie: device.cookie } });
			expect(bootstrap.status).toBe(200);
		} finally {
			Date.now = realNow;
		}

		const slid = await expiry();
		expect(slid).toBeGreaterThan(created);
		expect(slid).toBe(later + 3_600_000);
	});

	test("a cookie failure does not fall back to the machine token", async () => {
		const response = await remote("/api/v1/bootstrap", {
			headers: { cookie: "studio_session=stale-value", authorization: "Bearer machine-secret" },
		});
		expect(response.status).toBe(401);
	});
});

describe("scope", () => {
	test("write is its own grant and does not imply read", async () => {
		const writer = await registry.issue({ label: "writer", scopes: ["write"] });
		const auth = { authorization: `Bearer ${writer.token}` };
		const command = () =>
			remote("/api/v1/command", {
				method: "POST",
				headers: { ...auth, "content-type": "application/json" },
				body: JSON.stringify({ commandName: "core.abort", input: {}, idempotencyKey: "k", requestId: "r" }),
			});

		expect((await remote("/api/v1/bootstrap", { headers: auth })).status).toBe(403);
		expect(
			(
				await remote("/api/v1/query", {
					method: "POST",
					headers: { ...auth, "content-type": "application/json" },
					body: JSON.stringify({ queryName: "environment.get", input: {} }),
				})
			).status,
		).toBe(403);
		expect((await command()).status).toBe(202);
	});

	test("an empty scope grant reaches nothing", async () => {
		const disabled = await registry.issue({ label: "disabled", scopes: [] });
		expect(disabled.device.scopes).toEqual([]);
		const auth = { authorization: `Bearer ${disabled.token}` };

		expect((await remote("/api/v1/bootstrap", { headers: auth })).status).toBe(403);
		expect(
			(
				await remote("/api/v1/query", {
					method: "POST",
					headers: { ...auth, "content-type": "application/json" },
					body: JSON.stringify({ queryName: "environment.get", input: {} }),
				})
			).status,
		).toBe(403);
		expect(
			(
				await remote("/api/v1/command", {
					method: "POST",
					headers: { ...auth, "content-type": "application/json" },
					body: JSON.stringify({ commandName: "core.abort", input: {}, idempotencyKey: "k", requestId: "r" }),
				})
			).status,
		).toBe(403);
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
			workspaceOfCwd: async cwd => (cwd === "/ws/one" ? "ws-1" : undefined),
		});
		const bound = await registry.issue({ label: "bound", binding: { workspaceId: "ws-1" } });
		const auth = { authorization: `Bearer ${bound.token}` };

		expect((await remote("/api/sessions/sess-a", { headers: auth })).status).not.toBe(403);
		expect((await remote("/api/sessions/sess-b", { headers: auth })).status).toBe(403);
		// A declared workspaceId is not authority: it cannot smuggle in a session
		// the registry attributes elsewhere.
		expect((await remote("/api/sessions/sess-b?workspaceId=ws-1", { headers: auth })).status).toBe(403);
	});

	test("file routes are attributed by the real cwd, not a declared workspace", async () => {
		setResourceOwnership({
			workspaceOfSession: async () => undefined,
			workspaceOfCwd: async cwd => (cwd === "/ws/one" ? "ws-1" : undefined),
		});
		const bound = await registry.issue({ label: "bound", binding: { workspaceId: "ws-1" } });
		const auth = { authorization: `Bearer ${bound.token}` };

		// The binding gate must not be the reason this is refused: the file route
		// may still answer with its own policy error.
		expect(await isBindingDenied(await remote("/api/files/a.txt?cwd=/ws/one", { headers: auth }))).toBe(false);
		// The forged workspaceId does not help when the cwd belongs to ws-2.
		expect(
			await isBindingDenied(
				await remote("/api/files/a.txt?workspaceId=ws-1", { headers: { ...auth, "x-zeta-cwd": "/ws/two" } }),
			),
		).toBe(true);
		// Nor when the request carries no cwd at all: unattributable is refused.
		expect(await isBindingDenied(await remote("/api/files/a.txt?workspaceId=ws-1", { headers: auth }))).toBe(true);
	});

	test("a tampered binding on disk drops the device instead of widening it", async () => {
		const bound = await registry.issue({ label: "bound", binding: { sessionId: "sess-a" } });
		await writeFile(
			join(agentDir, "auth", "devices.json"),
			JSON.stringify({
				version: 1,
				devices: [{ id: bound.device.id, tokenHash: "0".repeat(64), binding: "not-an-object" }],
			}),
			"utf8",
		);
		expect(
			(await remote("/api/remote/devices", { headers: { authorization: `Bearer ${bound.token}` } })).status,
		).toBe(401);
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

	test("revoke-all also drops the caller's 2FA grant", async () => {
		const store = twoFactorStore();
		const enrollment = await store.enroll();
		expect((await store.confirm(totp(enrollment.secret, Date.now()))).ok).toBe(true);
		await store.setRequired(true);
		const machine = { authorization: "Bearer machine-secret" };

		const verify = await remote("/api/auth/2fa/verify", {
			method: "POST",
			headers: { ...machine, "content-type": "application/json" },
			body: JSON.stringify({ code: totp(enrollment.secret, Date.now()) }),
		});
		expect(verify.status).toBe(200);

		const command = () =>
			remote("/api/v1/command", {
				method: "POST",
				headers: { ...machine, "content-type": "application/json" },
				body: JSON.stringify({ commandName: "core.abort", input: {}, idempotencyKey: "k", requestId: "r" }),
			});
		expect((await command()).status).toBe(202);

		const revokeAll = await remote("/api/remote/devices/revoke-all", {
			method: "POST",
			headers: { ...machine, "content-type": "application/json" },
			body: "{}",
		});
		expect(revokeAll.status).toBe(200);

		// The machine token still authenticates, so a 403 means the *grant* is gone.
		const after = await command();
		expect(after.status).toBe(403);
		const afterBody = (await after.json()) as { error: string };
		expect(afterBody.error).toBe("totp_required");
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
