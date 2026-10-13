import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { resolveGatewayUrl, resolveStatsUrl } = await jiti.import("./proxy-targets.ts");
const config = (await jiti.import("../next.config.ts")).default;

/** Run `rewrites()` with the given env, restoring the process env after. */
async function rewriteDestination(source, env) {
	const keys = ["ZETA_WEB_GATEWAY_URL", "ZETA_WEB_GATEWAY_PORT", "NEXT_PUBLIC_STATS_URL"];
	const original = new Map(keys.map(key => [key, process.env[key]]));
	try {
		for (const key of keys) delete process.env[key];
		Object.assign(process.env, env);
		const { beforeFiles } = await config.rewrites();
		return beforeFiles.find(rule => rule.source === source)?.destination;
	} finally {
		for (const [key, value] of original) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

test("resolveGatewayUrl prefers the injected URL, then the documented port, then the default", () => {
	assert.equal(resolveGatewayUrl({ ZETA_WEB_GATEWAY_URL: "http://127.0.0.1:30242/" }), "http://127.0.0.1:30242");
	assert.equal(resolveGatewayUrl({ ZETA_WEB_GATEWAY_PORT: "45000" }), "http://127.0.0.1:45000");
	assert.equal(resolveGatewayUrl({}), "http://127.0.0.1:30142");
});

test("resolveStatsUrl prefers the injected URL, then the default", () => {
	assert.equal(resolveStatsUrl({ NEXT_PUBLIC_STATS_URL: "http://127.0.0.1:4900" }), "http://127.0.0.1:4900");
	assert.equal(resolveStatsUrl({}), "http://127.0.0.1:3847");
});

test("gateway rewrites follow the injected gateway origin, never a literal port", async () => {
	const env = { ZETA_WEB_GATEWAY_URL: "http://127.0.0.1:30242" };
	assert.equal(await rewriteDestination("/api/sessions/:path*", env), "http://127.0.0.1:30242/api/sessions/:path*");
	assert.equal(await rewriteDestination("/api/tracking/:path*", env), "http://127.0.0.1:30242/api/tracking/:path*");
});

test("/api/git/* is not rewritten: Next serves it through request-time proxies", async () => {
	// A beforeFiles rewrite would shadow the local git route handlers and freeze
	// the gateway port into the build output; the family must resolve the origin
	// per request instead (app/api/git/*).
	assert.equal(await rewriteDestination("/api/git/:path*", {}), undefined);
	assert.equal(await rewriteDestination("/api/git/branches", {}), undefined);
});

test("stats rewrite follows the injected stats origin", async () => {
	assert.equal(
		await rewriteDestination("/api/stats/:path*", { NEXT_PUBLIC_STATS_URL: "http://127.0.0.1:4900" }),
		"http://127.0.0.1:4900/api/stats/:path*",
	);
});
