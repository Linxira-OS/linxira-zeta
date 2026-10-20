/**
 * Remote-access hardening: the failure limiter, and the gate's use of it plus
 * token rotation/revocation. A rotated-away token and a revoked token are both
 * rejected with 401 (the CSRF origin guard keeps its separate 403).
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshDirsFromEnv } from "@linxiraos/pi-utils";
import { WebConfig } from "../../src/config/web-config";
import { AuthFailureLimiter, resetRemoteAccessForTests } from "../../src/server/web-gateway/remote-access";
import { webGatewayFetch } from "../../src/server/web-gateway";
import { hashRemoteToken } from "../../src/utils/remote-token";

const ENV_KEYS = ["ZETA_CODING_AGENT_DIR"];
const savedEnv = new Map<string, string | undefined>();
const cleanups: Array<() => Promise<void>> = [];

async function setup(yaml: string): Promise<void> {
	const agentDir = await mkdtemp(join(tmpdir(), "zeta-gw-remote-"));
	cleanups.push(() => rm(agentDir, { recursive: true, force: true }));
	for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
	process.env.ZETA_CODING_AGENT_DIR = agentDir;
	await writeFile(join(agentDir, "web.yml"), yaml, "utf8");
	refreshDirsFromEnv();
}

function tokenYaml(token: string, extra = ""): string {
	return `remote:\n  token: ${token}\n${extra}`;
}

function gate(headers: Record<string, string> = {}, remoteAddr = "203.0.113.7"): Promise<Response> {
	return webGatewayFetch(new Request("http://127.0.0.1/api/anything", { headers }), remoteAddr);
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
	await Promise.all(cleanups.splice(0).map(fn => fn()));
});

describe("AuthFailureLimiter", () => {
	test("trips after maxFailures inside the window and blocks for the cooldown", () => {
		const limiter = new AuthFailureLimiter({ maxFailures: 3, windowMs: 1_000, blockMs: 5_000 });
		expect(limiter.recordFailure("peer", 1_000).blocked).toBe(false);
		expect(limiter.recordFailure("peer", 1_100).blocked).toBe(false);
		const tripped = limiter.recordFailure("peer", 1_200);
		expect(tripped.blocked).toBe(true);
		expect(tripped.retryAfterSeconds).toBe(5);
		expect(limiter.status("peer", 1_300)).toEqual({ blocked: true, retryAfterSeconds: 5 });
		expect(limiter.status("peer", 6_200)).toEqual({ blocked: false, retryAfterSeconds: 0 });
	});

	test("failures older than the window do not accumulate", () => {
		const limiter = new AuthFailureLimiter({ maxFailures: 2, windowMs: 1_000, blockMs: 5_000 });
		expect(limiter.recordFailure("peer", 0).blocked).toBe(false);
		// The 0ms failure has aged out, so this one is alone in the window.
		expect(limiter.recordFailure("peer", 5_000).blocked).toBe(false);
		expect(limiter.recordFailure("peer", 5_100).blocked).toBe(true);
	});

	test("peers are isolated and clear() forgets one peer", () => {
		const limiter = new AuthFailureLimiter({ maxFailures: 1, windowMs: 1_000, blockMs: 5_000 });
		expect(limiter.recordFailure("a", 10).blocked).toBe(true);
		expect(limiter.status("b", 10).blocked).toBe(false);
		limiter.clear("a");
		expect(limiter.status("a", 10).blocked).toBe(false);
	});
});

describe("access gate with rotation/revocation", () => {
	test("missing and wrong tokens are 401, not 403", async () => {
		await setup(tokenYaml("secret123"));
		const missing = await gate();
		expect(missing.status).toBe(401);
		expect(missing.headers.get("www-authenticate")).toContain("Bearer");
		expect((await gate({ "x-zeta-token": "wrong" })).status).toBe(401);
	});

	test("a valid token passes (unknown route → 404), and clears failures", async () => {
		await setup(tokenYaml("secret123"));
		await gate({ "x-zeta-token": "wrong" });
		expect((await gate({ authorization: "Bearer secret123" })).status).toBe(404);
	});

	test("a revoked token is rejected even when it matches remote.token", async () => {
		const token = "revoked-token";
		await setup(tokenYaml(token, `  revokedTokens:\n    - ${hashRemoteToken(token)}\n`));
		expect((await gate({ "x-zeta-token": token })).status).toBe(401);
	});

	test("rotating the token rejects the old value and accepts the new one", async () => {
		await setup(tokenYaml("old-token"));
		const config = await WebConfig.load();
		const fresh = await config.rotateRemoteToken();
		expect(fresh).not.toBe("old-token");

		expect((await gate({ "x-zeta-token": "old-token" }, "203.0.113.8")).status).toBe(401);
		expect((await gate({ "x-zeta-token": fresh }, "203.0.113.8")).status).toBe(404);

		const reloaded = await WebConfig.load();
		expect(reloaded.getRemoteToken()).toBe(fresh);
		expect(reloaded.getRevokedTokenHashes()).toContain(hashRemoteToken("old-token"));
	});

	test("rate limits failed attempts and refuses a valid token while blocked", async () => {
		await setup(tokenYaml("secret123"));
		const peer = "198.51.100.4";
		// Nine failures stay 401; the tenth trips the limiter and is answered 429.
		for (let attempt = 0; attempt < 9; attempt++) {
			expect((await gate({ "x-zeta-token": "nope" }, peer)).status).toBe(401);
		}
		const limited = await gate({ "x-zeta-token": "nope" }, peer);
		expect(limited.status).toBe(429);
		expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
		// The rate limit outranks the token check: no free retry while blocked.
		expect((await gate({ "x-zeta-token": "secret123" }, peer)).status).toBe(429);
		// Another peer is unaffected.
		expect((await gate({ "x-zeta-token": "secret123" }, "198.51.100.5")).status).toBe(404);
	});
});
