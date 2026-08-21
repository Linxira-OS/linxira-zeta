/**
 * Gateway access-gate contract — the socket peer address (never the
 * client-controlled `Host` header) decides loopback, non-loopback callers
 * must present the configured `remote.token`, and the CSRF Origin guard only
 * constrains unauthenticated loopback browsers.
 *
 * Regression contracts:
 * - B1: a spoofed `Host: 127.0.0.1` header must NOT grant loopback when the
 *   socket address is missing or non-loopback.
 * - M1: `0.0.0.0` is a bind-all address, not loopback — it must require a token.
 * - M2: a valid remote token lets an authenticated non-loopback caller through
 *   even with a cross-site `Origin` header (an attacker's page cannot read or
 *   send the token, so it is not a CSRF vector).
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshDirsFromEnv } from "@linxiraos/pi-utils";
import { hostIsLoopback, webGatewayFetch } from "../../src/server/web-gateway";

const ENV_KEYS = ["ZETA_CODING_AGENT_DIR", "OMP_CODING_AGENT_DIR", "PI_CODING_AGENT_DIR"];
const savedEnv = new Map<string, string | undefined>();
const cleanups: Array<() => Promise<void>> = [];

function gatewayRequest(headers: Record<string, string> = {}): Request {
	return new Request("http://127.0.0.1/api/anything", { headers });
}

/** Point the config dir at a fresh temp dir; optionally seed remote.token. */
async function setup(token?: string): Promise<void> {
	const agentDir = await mkdtemp(join(tmpdir(), "zeta-gw-access-"));
	cleanups.push(() => rm(agentDir, { recursive: true, force: true }));
	for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
	process.env.ZETA_CODING_AGENT_DIR = agentDir;
	process.env.OMP_CODING_AGENT_DIR = agentDir;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	if (token) {
		await writeFile(join(agentDir, "web.yml"), `remote:\n  token: ${token}\n`, "utf8");
	}
	refreshDirsFromEnv();
}

afterEach(async () => {
	for (const key of ENV_KEYS) {
		const saved = savedEnv.get(key);
		if (saved === undefined) delete process.env[key];
		else process.env[key] = saved;
	}
	savedEnv.clear();
	refreshDirsFromEnv();
	await Promise.all(cleanups.splice(0).map(fn => fn()));
});

describe("hostIsLoopback (socket peer address)", () => {
	test("loopback literals and localhost are loopback", () => {
		expect(hostIsLoopback(gatewayRequest(), "127.0.0.1")).toBe(true);
		expect(hostIsLoopback(gatewayRequest(), "::1")).toBe(true);
		expect(hostIsLoopback(gatewayRequest(), "[::1]")).toBe(true);
		expect(hostIsLoopback(gatewayRequest(), "localhost")).toBe(true);
	});

	test("LAN, bind-all, and missing socket addresses are NOT loopback", () => {
		expect(hostIsLoopback(gatewayRequest(), "192.168.1.5")).toBe(false);
		expect(hostIsLoopback(gatewayRequest(), "10.0.0.2")).toBe(false);
		// 0.0.0.0 is bind-all, never loopback (M1).
		expect(hostIsLoopback(gatewayRequest(), "0.0.0.0")).toBe(false);
		// No socket info → untrusted, never a loopback pass.
		expect(hostIsLoopback(gatewayRequest(), undefined)).toBe(false);
		expect(hostIsLoopback(gatewayRequest(), "")).toBe(false);
	});
});

describe("webGatewayFetch access gate", () => {
	test("loopback socket address passes even with a spoofed Host header (B1)", async () => {
		await setup();
		const res = await webGatewayFetch(gatewayRequest({ Host: "127.0.0.1" }), "127.0.0.1");
		// Gate passed (route is unknown → 404, not 403).
		expect(res.status).toBe(404);
	});

	test("spoofed loopback Host header without a socket address is rejected (B1)", async () => {
		await setup();
		const res = await webGatewayFetch(gatewayRequest({ Host: "127.0.0.1" }), undefined);
		expect(res.status).toBe(403);
	});

	test("0.0.0.0 socket address is rejected without a token (M1)", async () => {
		await setup();
		const res = await webGatewayFetch(gatewayRequest(), "0.0.0.0");
		expect(res.status).toBe(403);
	});

	test("non-loopback socket requires the configured token (remote access)", async () => {
		await setup("secret123");
		const noToken = await webGatewayFetch(gatewayRequest(), "192.168.1.5");
		expect(noToken.status).toBe(403);
		const badToken = await webGatewayFetch(gatewayRequest({ "x-zeta-token": "wrong" }), "192.168.1.5");
		expect(badToken.status).toBe(403);
		const goodToken = await webGatewayFetch(gatewayRequest({ authorization: "Bearer secret123" }), "192.168.1.5");
		expect(goodToken.status).toBe(404);
	});

	test("authenticated remote caller passes the Origin guard (M2)", async () => {
		await setup("secret123");
		const res = await webGatewayFetch(
			gatewayRequest({ "x-zeta-token": "secret123", origin: "https://evil.example" }),
			"192.168.1.5",
		);
		expect(res.status).toBe(404);
	});

	test("unauthenticated loopback browser with a cross-site Origin is rejected (CSRF)", async () => {
		await setup();
		const res = await webGatewayFetch(gatewayRequest({ origin: "https://evil.example" }), "127.0.0.1");
		expect(res.status).toBe(403);
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe("Forbidden origin");
	});
});
