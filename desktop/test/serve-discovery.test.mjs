/**
 * Desktop service discovery over the same serve registration the CLI writes.
 * The shell may not import the monorepo implementation, so these tests pin the
 * two plans the desktop relies on: reuse a healthy same-version Host, and
 * refuse to take over a different version. A live identity with a dead Web UI
 * page is its own refusal, never a reuse.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { desktopServeDiscoveryDeps, discoverDesktopService, SERVE_REGISTRY_ENV } from "../src/serve-discovery.ts";

async function withRegistration(webStatus) {
	const directory = await mkdtemp(join(tmpdir(), "zeta-desktop-discovery-"));
	const registry = join(directory, "serve.json");
	let version = "1.5.12";
	const server = createServer((request, response) => {
		if (request.url === "/api/server/identity") {
			response.writeHead(200, { "content-type": "application/json" });
			response.end(
				JSON.stringify({
					app: "zeta",
					version,
					pid: process.pid,
					startedAt: "2026-11-20T00:00:00.000Z",
					webUrl: `http://127.0.0.1:${server.address().port}`,
					statsUrl: "",
					gatewayUrl: null,
				}),
			);
			return;
		}
		response.writeHead(webStatus, { "content-type": "text/html" });
		response.end(webStatus === 200 ? "<!doctype html><title>Zeta</title>" : "unreachable");
	});
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	const url = `http://127.0.0.1:${server.address().port}`;
	await writeFile(
		registry,
		JSON.stringify({
			pid: process.pid,
			webUrl: url,
			statsUrl: `${url}/stats`,
			gatewayUrl: null,
			version,
			startedAt: "2026-11-20T00:00:00.000Z",
			cwd: directory,
		}),
	);
	const deps = {
		...desktopServeDiscoveryDeps({ [SERVE_REGISTRY_ENV]: registry }),
		sleep: async () => {},
		timeoutMs: 500,
	};
	return {
		deps,
		registry,
		setVersion(value) {
			version = value;
		},
		async close() {
			await new Promise(resolve => server.close(resolve));
			await rm(directory, { recursive: true, force: true });
		},
	};
}

test("reuses a healthy same-version Host from the CLI registry", async () => {
	const fixture = await withRegistration(200);
	try {
		const plan = await discoverDesktopService({
			deps: fixture.deps,
			targetUrl: "http://127.0.0.1:1",
			expectedVersion: "1.5.12",
			fallbackStatsUrl: "http://127.0.0.1:1/stats",
		});
		assert.equal(plan.action, "reuse");
		assert.equal(plan.identity.version, "1.5.12");
		assert.equal(plan.webUrl, plan.identity.webUrl);
	} finally {
		await fixture.close();
	}
});

test("refuses a live Host of another version without taking it over", async () => {
	const fixture = await withRegistration(200);
	fixture.setVersion("1.4.10");
	try {
		const plan = await discoverDesktopService({
			deps: fixture.deps,
			targetUrl: "http://127.0.0.1:1",
			expectedVersion: "1.5.12",
			fallbackStatsUrl: "http://127.0.0.1:1/stats",
		});
		assert.equal(plan.action, "version-mismatch");
		assert.equal(plan.identity.version, "1.4.10");
	} finally {
		await fixture.close();
	}
});

test("reports a live identity with an unreachable Web UI page instead of adopting it", async () => {
	const fixture = await withRegistration(404);
	try {
		const plan = await discoverDesktopService({
			deps: fixture.deps,
			targetUrl: "http://127.0.0.1:1",
			expectedVersion: "1.5.12",
			fallbackStatsUrl: "http://127.0.0.1:1/stats",
		});
		assert.equal(plan.action, "web-ui-unreachable");
		assert.equal(plan.probe.status, 404);
	} finally {
		await fixture.close();
	}
});
