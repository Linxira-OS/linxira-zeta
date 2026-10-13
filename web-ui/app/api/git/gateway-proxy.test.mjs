import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { GET: getBranches } = await jiti.import("./branches/route.ts");
const { POST: postCheckout } = await jiti.import("./checkout/route.ts");
const { POST: postBranch } = await jiti.import("./branch/route.ts");

const ENV_KEYS = ["ZETA_WEB_GATEWAY_URL", "ZETA_WEB_GATEWAY_PORT"];

/**
 * Invoke a git route handler with a NextRequest-shaped request, capturing what
 * it handed to `fetch`. Env is applied per call and restored afterwards.
 */
async function callHandler(handler, { method = "GET", url, body, env = {} } = {}) {
	const originalEnv = new Map(ENV_KEYS.map(key => [key, process.env[key]]));
	const originalFetch = globalThis.fetch;
	const calls = [];
	globalThis.fetch = async (input, init) => {
		calls.push({ url: String(input), method: init?.method, body: init?.body });
		return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
	};
	try {
		for (const key of ENV_KEYS) delete process.env[key];
		Object.assign(process.env, env);
		const request = new Request(url, {
			method,
			body: body === undefined ? undefined : JSON.stringify(body),
			headers: body === undefined ? undefined : { "content-type": "application/json" },
		});
		Object.defineProperty(request, "nextUrl", { value: new URL(url) });
		const response = await handler(request);
		return { calls, status: response.status };
	} finally {
		globalThis.fetch = originalFetch;
		for (const [key, value] of originalEnv) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

test("branches proxies to the gateway origin injected by zeta serve", async () => {
	const { calls, status } = await callHandler(getBranches, {
		url: "http://127.0.0.1/api/git/branches?cwd=%2Frepo",
		env: { ZETA_WEB_GATEWAY_URL: "http://127.0.0.1:30242" },
	});
	assert.equal(status, 200);
	assert.deepEqual(calls, [{ url: "http://127.0.0.1:30242/api/git/branches?cwd=%2Frepo", method: "GET", body: undefined }]);
});

test("checkout forwards method and body to the configured gateway port", async () => {
	const { calls } = await callHandler(postCheckout, {
		method: "POST",
		url: "http://127.0.0.1/api/git/checkout",
		body: { cwd: "C:\\repo", branch: "main" },
		env: { ZETA_WEB_GATEWAY_PORT: "45000" },
	});
	assert.deepEqual(calls, [
		{ url: "http://127.0.0.1:45000/api/git/checkout", method: "POST", body: '{"cwd":"C:\\\\repo","branch":"main"}' },
	]);
});

test("branch creation falls back to the default gateway port standalone", async () => {
	const { calls } = await callHandler(postBranch, {
		method: "POST",
		url: "http://127.0.0.1/api/git/branch",
		body: { cwd: "C:\\repo", name: "feature" },
	});
	assert.equal(calls[0].url, "http://127.0.0.1:30142/api/git/branch");
});

test("an unreachable gateway surfaces as 502 instead of a crash", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		throw new Error("connect ECONNREFUSED 127.0.0.1:30142");
	};
	try {
		const request = new Request("http://127.0.0.1/api/git/branches?cwd=%2Frepo");
		Object.defineProperty(request, "nextUrl", { value: new URL(request.url) });
		const response = await getBranches(request);
		assert.equal(response.status, 502);
		assert.match((await response.json()).error, /ECONNREFUSED/);
	} finally {
		globalThis.fetch = originalFetch;
	}
});
