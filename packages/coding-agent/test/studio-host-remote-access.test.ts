/**
 * Studio `/api/v1` remote-access gate — the P0 this suite pins down.
 *
 * `/api/v1/*` used to be dispatched before `checkRemoteAccess`, so it relied on
 * `isAllowedOrigin` plus an implicit loopback pairing. Behind a reverse proxy or
 * tunnel every remote peer *is* `127.0.0.1`, so that pair of checks effectively
 * disabled authentication for the whole world. The contracts:
 *
 * - a direct loopback socket (no forwarding header, remote access off) still
 *   auto-pairs, so the local desktop keeps working;
 * - a loopback socket carrying `x-forwarded-for` / `forwarded` is treated as a
 *   remote peer and needs `remote.token` (and shares the failure limiter);
 * - any non-loopback socket needs the token, 401 otherwise;
 * - once remote access is configured (`remote.token` / `remote.publicUrl`),
 *   even a direct loopback peer must pair with the code — no implicit pairing;
 * - a wrong pairing code is a rate-limited auth failure (429 after the limit);
 * - a paired session keeps working end to end (pair → query → bootstrap).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshDirsFromEnv } from "@linxiraos/pi-utils";
import { WebConfig } from "../src/config/web-config";
import { StudioHost, StudioOperations } from "../src/server/studio-host/index.js";
import { resetRemoteAccessForTests } from "../src/server/web-gateway/remote-access";

const ORIGIN = "http://127.0.0.1:43150";
const ENV_KEYS = ["ZETA_CODING_AGENT_DIR"];
const savedEnv = new Map<string, string | undefined>();
const cleanups: Array<() => Promise<void>> = [];

function operations(): StudioOperations {
	return new StudioOperations([
		{
			id: "test",
			queries: { "environment.get": async () => ({}) },
			commands: { "core.abort": async () => undefined },
		} as never,
	]);
}

function newHost(): StudioHost {
	return new StudioHost(operations());
}

/** Point the agent dir at a fresh temp dir; optionally seed remote access. */
async function setup(yaml?: string): Promise<void> {
	const agentDir = await mkdtemp(join(tmpdir(), "zeta-studio-remote-"));
	cleanups.push(() => rm(agentDir, { recursive: true, force: true }));
	for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
	process.env.ZETA_CODING_AGENT_DIR = agentDir;
	if (yaml !== undefined) await writeFile(join(agentDir, "web.yml"), yaml, "utf8");
	refreshDirsFromEnv();
	WebConfig.resetShared();
}

function request(path: string, init: RequestInit = {}, headers: Record<string, string> = {}): Request {
	return new Request(`http://127.0.0.1${path}`, {
		...init,
		headers: { origin: ORIGIN, ...headers, ...(init.headers as Record<string, string> | undefined) },
	});
}

function pair(host: StudioHost, remoteAddr?: string, headers: Record<string, string> = {}): Promise<Response> {
	return host.handle(
		request(
			"/api/v1/pair",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ code: host.pairingCode }),
			},
			headers,
		),
		remoteAddr,
	);
}

beforeEach(() => {
	resetRemoteAccessForTests();
});

afterEach(async () => {
	for (const key of ENV_KEYS) {
		const saved = savedEnv.get(key);
		if (saved === undefined) delete process.env[key];
		else process.env[key] = saved;
	}
	savedEnv.clear();
	refreshDirsFromEnv();
	WebConfig.resetShared();
	resetRemoteAccessForTests();
	await Promise.all(cleanups.splice(0).map(fn => fn()));
});

describe("Studio /api/v1 remote-access gate", () => {
	test("direct loopback keeps implicit pairing", async () => {
		await setup();
		const host = newHost();
		const response = await host.handle(request("/api/v1/bootstrap"), "127.0.0.1");
		expect(response.status).toBe(200);
		expect(response.headers.get("set-cookie")).toContain("studio_session=");
		expect(response.headers.get("x-studio-csrf")).toBeTruthy();
	});

	test("a proxied loopback socket needs the remote token", async () => {
		await setup();
		const host = newHost();
		for (const header of ["x-forwarded-for", "forwarded", "x-real-ip"]) {
			const response = await host.handle(request("/api/v1/bootstrap", {}, { [header]: "203.0.113.9" }), "127.0.0.1");
			expect(response.status).toBe(401);
			expect(response.headers.get("set-cookie")).toBeNull();
			expect(response.headers.get("x-studio-csrf")).toBeNull();
		}
	});

	test("non-loopback peers are rejected without a token", async () => {
		await setup();
		const host = newHost();
		const response = await host.handle(request("/api/v1/bootstrap"), "203.0.113.9");
		expect(response.status).toBe(401);
		expect(response.headers.get("set-cookie")).toBeNull();
	});

	test("remote.token is required for a non-loopback peer and accepted when presented", async () => {
		await setup("remote:\n  token: studio-secret\n");
		const host = newHost();

		const denied = await host.handle(request("/api/v1/pair", { method: "POST", body: "{}" }), "203.0.113.9");
		expect(denied.status).toBe(401);
		expect(denied.headers.get("www-authenticate")).toContain("Bearer");

		const paired = await pair(host, "203.0.113.9", { "x-zeta-token": "studio-secret" });
		expect(paired.status).toBe(200);
		const cookie = paired.headers.get("set-cookie");
		expect(cookie).toContain("studio_session=");

		// A token-authenticated remote peer still has no implicit bootstrap.
		const bare = await host.handle(
			request("/api/v1/bootstrap", {}, { "x-zeta-token": "studio-secret" }),
			"203.0.113.9",
		);
		expect(bare.status).toBe(401);

		const bootstrapped = await host.handle(
			request("/api/v1/bootstrap", {}, { "x-zeta-token": "studio-secret", cookie: cookie! }),
			"203.0.113.9",
		);
		expect(bootstrapped.status).toBe(200);
	});

	test("remote mode disables implicit pairing for a local socket", async () => {
		await setup("remote:\n  token: studio-secret\n");
		const host = newHost();
		const response = await host.handle(request("/api/v1/bootstrap"), "127.0.0.1");
		expect(response.status).toBe(401);
		expect(response.headers.get("set-cookie")).toBeNull();

		// The pairing code still works locally.
		expect((await pair(host, "127.0.0.1")).status).toBe(200);
	});

	test("failed pairing codes are rate limited and refuse a later good code", async () => {
		await setup();
		const host = newHost();
		const badPairBody = JSON.stringify({ code: "x" });

		// Nine bad guesses stay 401; the tenth trips the limiter and is 429.
		for (let attempt = 0; attempt < 9; attempt++) {
			const response = await host.handle(
				request("/api/v1/pair", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: badPairBody,
				}),
				"127.0.0.1",
			);
			expect(response.status).toBe(401);
		}
		const limited = await host.handle(
			request("/api/v1/pair", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: badPairBody,
			}),
			"127.0.0.1",
		);
		expect(limited.status).toBe(429);
		expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);

		// The rate limit outranks the code check: no free guess while blocked.
		expect((await pair(host, "127.0.0.1")).status).toBe(429);
	});

	test("a paired session authorizes queries end to end", async () => {
		await setup();
		const host = newHost();
		const paired = await pair(host, "127.0.0.1");
		expect(paired.status).toBe(200);
		const cookie = paired.headers.get("set-cookie");
		expect(cookie).toContain("studio_session=");

		const response = await host.handle(
			request(
				"/api/v1/query",
				{
					method: "POST",
					headers: { cookie: cookie!, "content-type": "application/json" },
					body: JSON.stringify({ queryName: "environment.get", input: {} }),
				},
				{},
			),
			"127.0.0.1",
		);
		expect(response.status).toBe(200);
		expect((await response.json()) as { ok: boolean }).toMatchObject({ ok: true });
	});

	test("the event socket is gated like the REST routes", async () => {
		await setup();
		const host = newHost();
		let upgraded = false;
		const server = {
			upgrade() {
				upgraded = true;
				return true;
			},
		};
		const proxied = await host.upgrade(
			request("/api/v1/events", { headers: { upgrade: "websocket" } }, { "x-forwarded-for": "203.0.113.9" }),
			server,
			"127.0.0.1",
		);
		expect(proxied?.status).toBe(401);
		expect(upgraded).toBe(false);
	});

	test("/health stays an unauthenticated probe", async () => {
		await setup("remote:\n  token: studio-secret\n");
		const host = newHost();
		const response = await host.handle(request("/health", {}, { "x-forwarded-for": "203.0.113.9" }), "127.0.0.1");
		expect(response.status).toBe(200);
		expect((await response.json()) as { ok: boolean }).toMatchObject({ ok: true });
	});
});
