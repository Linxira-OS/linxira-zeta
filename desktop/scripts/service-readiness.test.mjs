/**
 * Desktop service readiness: the three surfaces the shell probes, the
 * deregistration decision for a reused corpse, and the failure text.
 *
 * The probe leg runs against a real loopback HTTP server (no Electron, no
 * external network) that reproduces the v1.2.1 shape: the gateway route answers
 * while the Web UI page is a 502 from the serve reverse proxy — exactly what the
 * desktop saw when its reused instance's Web UI child had never come up.
 */

import assert from "node:assert/strict";
import * as http from "node:http";
import test from "node:test";

import {
	describeReadinessFailure,
	probeServiceReadiness,
	READINESS_PROBE_TIMEOUT_MS,
	registrationPidToRetire,
} from "../src/service-readiness.ts";

/**
 * A serve-shaped loopback pair: the web URL answers `/api/sessions` in-process
 * while every other path is a 502 "Bad Gateway" (the proxy could not reach its
 * Web UI child) — the v1.2.1 shape — and the stats listener answers everything.
 * `webUiAlive` flips `/` to 200 so the healthy shape is covered too.
 */
async function withFakeService(webUiAlive, run) {
	const handler = (req, res) => {
		if (req.url === "/api/sessions") {
			res.writeHead(200, { "content-type": "application/json" });
			res.end("[]");
			return;
		}
		if (req.url === "/" && webUiAlive) {
			res.writeHead(200, { "content-type": "text/html" });
			res.end("<!doctype html>");
			return;
		}
		res.writeHead(502, { "content-type": "text/plain" });
		res.end("Bad Gateway");
	};
	const statsHandler = (_req, res) => {
		res.writeHead(200, { "content-type": "text/html" });
		res.end("<html>stats</html>");
	};
	const webUi = http.createServer(handler);
	const stats = http.createServer(statsHandler);
	await new Promise(resolve => webUi.listen(0, "127.0.0.1", resolve));
	await new Promise(resolve => stats.listen(0, "127.0.0.1", resolve));
	try {
		await run({
			webUiUrl: `http://127.0.0.1:${webUi.address().port}`,
			statsUrl: `http://127.0.0.1:${stats.address().port}`,
		});
	} finally {
		await new Promise(resolve => webUi.close(resolve));
		await new Promise(resolve => stats.close(resolve));
	}
}

test("a gateway-up/Web-UI-dead instance is not ready, and the probes say why", async () => {
	await withFakeService(false, async ({ webUiUrl, statsUrl }) => {
		const readiness = await probeServiceReadiness({ webUiUrl, statsUrl });
		assert.equal(readiness.ready, false);
		const byLabel = Object.fromEntries(readiness.probes.map(probe => [probe.label, probe]));
		assert.equal(byLabel["gateway API"].ok, true);
		assert.equal(byLabel["gateway API"].status, 200);
		assert.equal(byLabel["Web UI page"].ok, false);
		assert.equal(byLabel["Web UI page"].status, 502);
		assert.equal(byLabel["Web UI page"].url, `${webUiUrl}/`);
		assert.equal(byLabel["stats dashboard"].ok, true);
	});
});

test("every surface answering is the only ready shape", async () => {
	await withFakeService(true, async ({ webUiUrl, statsUrl }) => {
		const readiness = await probeServiceReadiness({ webUiUrl, statsUrl });
		assert.equal(readiness.ready, true);
		assert.equal(
			readiness.probes.every(probe => probe.ok),
			true,
		);
	});
});

test("an unreachable surface is a failed probe, never a throw", async () => {
	// Nothing listening: connection refused on all three surfaces.
	const readiness = await probeServiceReadiness({
		webUiUrl: "http://127.0.0.1:1",
		statsUrl: "http://127.0.0.1:1",
		timeoutMs: 250,
	});
	assert.equal(readiness.ready, false);
	assert.equal(readiness.probes.length, 3);
	assert.equal(
		readiness.probes.every(probe => probe.status === null && typeof probe.error === "string"),
		true,
	);
	assert.equal(READINESS_PROBE_TIMEOUT_MS > 0, true);
});

test("registrationPidToRetire retires only the registration of the reused pid", () => {
	assert.equal(registrationPidToRetire({ reusedPid: 42556, registrationPid: 42556 }), 42556);
	// Registry already rewritten by a successor — nothing of ours to drop.
	assert.equal(registrationPidToRetire({ reusedPid: 42556, registrationPid: 4242 }), null);
	assert.equal(registrationPidToRetire({ reusedPid: 42556, registrationPid: null }), null);
	assert.equal(registrationPidToRetire({ reusedPid: null, registrationPid: 42556 }), null);
});

test("the failure text names the gateway, the dead Web UI child and the registration", () => {
	const readiness = {
		ready: false,
		probes: [
			{ label: "gateway API", url: "http://127.0.0.1:30141/api/sessions", ok: true, status: 200, error: null },
			{ label: "Web UI page", url: "http://127.0.0.1:30141/", ok: false, status: 502, error: null },
			{ label: "stats dashboard", url: "http://127.0.0.1:3847/", ok: true, status: 200, error: null },
		],
	};
	const text = describeReadinessFailure({
		readiness,
		reused: { pid: 42556, version: "1.2.1", webUrl: "http://127.0.0.1:30141" },
		retire: { pid: 42556, retired: true },
	});
	assert.match(text, /Web UI/);
	assert.match(text, /GET http:\/\/127\.0\.0\.1:30141\/ → HTTP 502/);
	assert.match(text, /gateway answered/);
	assert.match(text, /Web UI child process/);
	assert.match(text, /registration was removed/);
	assert.match(text, /pid 42556/);
	assert.doesNotMatch(text, /did not answer\./);
});

test("a kept registration and a cold start are described without the corpse story", () => {
	const probes = [
		{ label: "gateway API", url: "http://127.0.0.1:30141/api/sessions", ok: false, status: null, error: "ECONNREFUSED" },
		{ label: "Web UI page", url: "http://127.0.0.1:30141/", ok: false, status: null, error: "ECONNREFUSED" },
		{ label: "stats dashboard", url: "http://127.0.0.1:3847/", ok: false, status: null, error: "ECONNREFUSED" },
	];
	const cold = describeReadinessFailure({ readiness: { ready: false, probes }, reused: null, retire: null });
	assert.match(cold, /did not become ready in time/);
	assert.match(cold, /ECONNREFUSED/);
	assert.doesNotMatch(cold, /Web UI child process/);

	const kept = describeReadinessFailure({
		readiness: { ready: false, probes: [probes[0], probes[1], probes[2]] },
		reused: { pid: 42556, version: "1.2.1", webUrl: "http://127.0.0.1:30141" },
		retire: { pid: 42556, retired: false },
	});
	assert.match(kept, /was left untouched/);
});
