import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { GET } = await jiti.import("./route.ts");

const ENV_KEYS = ["ZETA_WEB_GATEWAY_URL", "ZETA_WEB_GATEWAY_PORT"];

/** Capture the URL the handler proxies to, and restore env afterwards. */
async function proxiedUrl(env, search = "?cwd=%2Ftmp") {
	const originalEnv = new Map(ENV_KEYS.map(key => [key, process.env[key]]));
	const originalFetch = globalThis.fetch;
	const seen = [];
	globalThis.fetch = async input => {
		seen.push(String(input));
		return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
	};
	try {
		for (const key of ENV_KEYS) delete process.env[key];
		Object.assign(process.env, env);
		// Shape the request like NextRequest: the handler reads `nextUrl.search`,
		// the `x-zeta-cwd` header and the method.
		const url = `http://127.0.0.1/api/tracking${search}`;
		const request = new Request(url, { headers: { "x-zeta-cwd": "/tmp" } });
		Object.defineProperty(request, "nextUrl", { value: new URL(url) });
		await GET(request);
	} finally {
		globalThis.fetch = originalFetch;
		for (const [key, value] of originalEnv) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
	assert.equal(seen.length, 1);
	return seen[0];
}

test("proxies tracking reads to the gateway origin injected by zeta serve", async () => {
	assert.equal(
		await proxiedUrl({ ZETA_WEB_GATEWAY_URL: "http://127.0.0.1:30242" }),
		"http://127.0.0.1:30242/api/tracking?cwd=%2Ftmp",
	);
});

test("falls back to the configured gateway port when no URL is injected", async () => {
	assert.equal(await proxiedUrl({ ZETA_WEB_GATEWAY_PORT: "45000" }), "http://127.0.0.1:45000/api/tracking?cwd=%2Ftmp");
});

test("falls back to the default gateway port standalone", async () => {
	assert.equal(await proxiedUrl({}), "http://127.0.0.1:30142/api/tracking?cwd=%2Ftmp");
});
