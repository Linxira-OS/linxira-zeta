/**
 * Desktop service discovery: the shell reuses a healthy same-version Zeta
 * service instead of spawning a second one (and never takes over a
 * differently-versioned instance). Covers the registry read/validate/stale
 * cleanup, the identity probe, and the reuse-versus-spawn decision.
 *
 * Everything runs over injected seams (registry text, liveness, fetcher), so no
 * port is bound and no real process is probed.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";

import {
	clearServeRegistrationForPid,
	desktopServeDiscoveryDeps,
	discoverDesktopService,
	identityProbeUrls,
	loopbackUrlFor,
	parseServeRegistration,
	probeServeIdentity,
	serveRegistryPathIn,
	SERVE_REGISTRY_ENV,
} from "../src/serve-discovery.ts";

const TARGET_URL = "http://127.0.0.1:30141";
const DEFAULT_STATS_URL = "http://127.0.0.1:3847";

function registration(overrides = {}) {
	return {
		pid: 4242,
		webUrl: TARGET_URL,
		statsUrl: DEFAULT_STATS_URL,
		gatewayUrl: "http://127.0.0.1:30142",
		version: "1.2.0",
		startedAt: "2026-10-13T00:00:00.000Z",
		cwd: "/work/space",
		...overrides,
	};
}

function identity(overrides = {}) {
	return {
		app: "zeta",
		version: "1.2.0",
		pid: 4242,
		startedAt: "2026-10-13T00:00:00.000Z",
		webUrl: TARGET_URL,
		statsUrl: DEFAULT_STATS_URL,
		gatewayUrl: "http://127.0.0.1:30142",
		...overrides,
	};
}

/** Deps over an in-memory registry document. */
function makeDeps({ file = null, alive = () => true, responder = () => null, env = {} } = {}) {
	const removed = [];
	return {
		removed,
		deps: {
			env: { [SERVE_REGISTRY_ENV]: "/virtual/serve.json", ...env },
			readTextFile: () => file,
			removeFile: target => removed.push(target),
			isPidAlive: alive,
			timeoutMs: 50,
			// The Web UI probe retries once in production; keep the suite instant.
			sleep: async () => {},
			fetchImpl: async url => {
				const response = responder(String(url));
				if (!response) throw new Error(`ECONNREFUSED ${url}`);
				return response;
			},
		},
	};
}

/** Answers only on the URLs whose port is listed. */
function responderOnPorts(ports, payload) {
	return url => {
		try {
			return ports.includes(Number(new URL(url).port)) ? Response.json(payload) : null;
		} catch {
			return null;
		}
	};
}

function planFromEnv(options) {
	return discoverDesktopService({
		deps: options.deps,
		targetUrl: TARGET_URL,
		expectedVersion: "1.2.0",
		fallbackStatsUrl: DEFAULT_STATS_URL,
	});
}

test("serveRegistryPathIn honors the override, else the config dir", () => {
	const { deps } = makeDeps();
	assert.equal(serveRegistryPathIn(deps), path.resolve("/virtual/serve.json"));
	const { deps: plain } = makeDeps({ env: { [SERVE_REGISTRY_ENV]: "  " } });
	assert.equal(serveRegistryPathIn(plain), path.join(os.homedir(), ".zeta", "serve.json"));
	const { deps: custom } = makeDeps({ env: { [SERVE_REGISTRY_ENV]: " ", ZETA_CONFIG_DIR: "my-zeta" } });
	assert.equal(serveRegistryPathIn(custom), path.join(os.homedir(), "my-zeta", "serve.json"));
});

test("parseServeRegistration rejects junk and keeps valid fields", () => {
	assert.equal(parseServeRegistration(null), null);
	assert.equal(parseServeRegistration("nope"), null);
	assert.equal(parseServeRegistration({ pid: 0, webUrl: TARGET_URL, version: "1.2.0" }), null);
	assert.equal(parseServeRegistration({ pid: 1, version: "1.2.0" }), null);
	assert.equal(parseServeRegistration({ pid: 1, webUrl: TARGET_URL }), null);
	const parsed = parseServeRegistration(registration({ desktopOpenSecret: "secret" }));
	assert.equal(parsed.pid, 4242);
	assert.equal(parsed.webUrl, TARGET_URL);
	assert.equal(parsed.desktopOpenSecret, "secret");
	assert.equal(parsed.cwd, "/work/space");
});

test("identityProbeUrls probes loopback first and loopbackUrlFor normalizes URLs", () => {
	assert.deepEqual(identityProbeUrls(TARGET_URL), [TARGET_URL]);
	assert.deepEqual(identityProbeUrls("http://0.0.0.0:30141"), ["http://127.0.0.1:30141", "http://0.0.0.0:30141"]);
	assert.deepEqual(identityProbeUrls("garbage"), ["garbage"]);
	assert.equal(loopbackUrlFor("http://0.0.0.0:3847"), "http://127.0.0.1:3847");
	assert.equal(loopbackUrlFor("http://127.0.0.1:3847"), "http://127.0.0.1:3847");
	assert.equal(loopbackUrlFor("garbage"), "garbage");
});

test("probeServeIdentity accepts only a Zeta identity", async () => {
	const { deps } = makeDeps({ responder: responderOnPorts([30141], identity()) });
	assert.equal((await probeServeIdentity(TARGET_URL, deps)).version, "1.2.0");

	const { deps: foreign } = makeDeps({ responder: () => Response.json({ app: "nginx", version: "1.0.0", pid: 1 }) });
	assert.equal(await probeServeIdentity(TARGET_URL, foreign), null);

	const { deps: missing } = makeDeps({ responder: () => new Response("nope", { status: 404 }) });
	assert.equal(await probeServeIdentity(TARGET_URL, missing), null);

	const { deps: refused } = makeDeps();
	assert.equal(await probeServeIdentity(TARGET_URL, refused), null);
});

test("reuses a healthy same-version instance, adopting its URLs, workspace and secret", async () => {
	const { deps } = makeDeps({
		file: JSON.stringify(registration({ desktopOpenSecret: "shared-secret" })),
		responder: responderOnPorts([30141], identity()),
	});
	const plan = await planFromEnv({ deps });
	assert.equal(plan.action, "reuse");
	assert.equal(plan.webUrl, TARGET_URL);
	assert.equal(plan.statsUrl, DEFAULT_STATS_URL);
	assert.equal(plan.gatewayUrl, "http://127.0.0.1:30142");
	assert.equal(plan.identity.pid, 4242);
	assert.equal(plan.registration.cwd, "/work/space");
	assert.equal(plan.registration.desktopOpenSecret, "shared-secret");
	assert.equal(plan.stalePid, null);
});

test("reuses a same-version instance on a non-default port", async () => {
	const { deps } = makeDeps({
		file: JSON.stringify(registration({ webUrl: "http://127.0.0.1:39999", statsUrl: "http://0.0.0.0:3847" })),
		responder: responderOnPorts([39999], identity({ webUrl: "http://127.0.0.1:39999" })),
	});
	const plan = await planFromEnv({ deps });
	assert.equal(plan.action, "reuse");
	// The window loads the loopback URL that answered; stats is normalized too.
	assert.equal(plan.webUrl, "http://127.0.0.1:39999");
	assert.equal(plan.statsUrl, "http://127.0.0.1:3847");
});

test("refuses a differently-versioned instance instead of taking its port", async () => {
	const { deps } = makeDeps({
		file: JSON.stringify(registration({ version: "1.1.0" })),
		responder: responderOnPorts([30141], identity({ version: "1.1.0" })),
	});
	const plan = await planFromEnv({ deps });
	assert.equal(plan.action, "version-mismatch");
	assert.equal(plan.identity.version, "1.1.0");
	assert.equal(plan.registration.pid, 4242);
});

test("spawns when no instance answers", async () => {
	const { deps } = makeDeps();
	const plan = await planFromEnv({ deps });
	assert.deepEqual(plan, { action: "spawn", stalePid: null });
});

test("drops a dead-pid registration before deciding", async () => {
	const { deps, removed } = makeDeps({
		file: JSON.stringify(registration({ pid: 777 })),
		alive: () => false,
	});
	const plan = await planFromEnv({ deps });
	assert.deepEqual(plan, { action: "spawn", stalePid: 777 });
	assert.deepEqual(removed, [path.resolve("/virtual/serve.json")]);
});

test("finds an instance whose registration names another pid (registry deleted/overwritten)", async () => {
	const { deps } = makeDeps({ responder: responderOnPorts([30141], identity({ pid: 99 })) });
	const plan = await planFromEnv({ deps });
	assert.equal(plan.action, "reuse");
	assert.equal(plan.identity.pid, 99);
	assert.equal(plan.registration, null);
	// No recorded workspace/secret: the shell falls back to its own defaults.
	assert.equal(plan.statsUrl, DEFAULT_STATS_URL);
});

/**
 * The v1.2.1 corpse: the serve process answers `/api/server/identity` in-process
 * while its Web UI child is gone, so the page it proxies returns 502 (release
 * log: `Proxy request failed … ECONNREFUSED` on the child port). Such an
 * instance must never be classified as reusable, and a second candidate that is
 * healthy must still win.
 */
function responderWithDeadWebUi(ports, payload) {
	return url => {
		const parsed = new URL(url);
		if (!ports.includes(Number(parsed.port))) return null;
		if (parsed.pathname === "/api/server/identity") return Response.json(payload);
		return new Response("Bad Gateway", { status: 502 });
	};
}

test("never reuses an instance whose Web UI does not answer", async () => {
	const { deps } = makeDeps({
		file: JSON.stringify(registration()),
		responder: responderWithDeadWebUi([30141], identity()),
	});
	const plan = await planFromEnv({ deps });
	assert.equal(plan.action, "web-ui-unreachable");
	assert.equal(plan.identity.pid, 4242);
	assert.equal(plan.registration.pid, 4242);
	assert.equal(plan.webUrl, TARGET_URL);
	assert.equal(plan.statsUrl, DEFAULT_STATS_URL);
	assert.equal(plan.probe.url, `${TARGET_URL}/`);
	assert.equal(plan.probe.status, 502);
	// The probe is bounded (2 attempts) so a booting child is not condemned.
	assert.equal(plan.probe.attempts, 2);
});

test("keeps looking past a corpse: a healthy instance on another URL still wins", async () => {
	const { deps } = makeDeps({
		file: JSON.stringify(registration({ webUrl: "http://127.0.0.1:39999" })),
		responder: url => {
			const parsed = new URL(url);
			if (Number(parsed.port) === 39999) {
				return parsed.pathname === "/api/server/identity"
					? Response.json(identity({ webUrl: "http://127.0.0.1:39999" }))
					: new Response("Bad Gateway", { status: 502 });
			}
			if (Number(parsed.port) === 30141) {
				return parsed.pathname === "/api/server/identity" ? Response.json(identity({ pid: 99 })) : new Response("ok");
			}
			return null;
		},
	});
	const plan = await planFromEnv({ deps });
	assert.equal(plan.action, "reuse");
	assert.equal(plan.identity.pid, 99);
	assert.equal(plan.webUrl, TARGET_URL);
});

test("clearServeRegistrationForPid retires only the matching registration", async () => {
	const { deps, removed } = makeDeps({ file: JSON.stringify(registration({ pid: 4242 })) });
	assert.equal(clearServeRegistrationForPid(4242, deps), true);
	assert.deepEqual(removed, [path.resolve("/virtual/serve.json")]);

	const { deps: other, removed: otherRemoved } = makeDeps({ file: JSON.stringify(registration({ pid: 999 })) });
	assert.equal(clearServeRegistrationForPid(4242, other), false);
	assert.deepEqual(otherRemoved, []);

	const { deps: absent, removed: absentRemoved } = makeDeps({});
	assert.equal(clearServeRegistrationForPid(4242, absent), false);
	assert.deepEqual(absentRemoved, []);
});

test("production deps read the real filesystem and process table", () => {
	const deps = desktopServeDiscoveryDeps({});
	assert.equal(deps.isPidAlive(process.pid), true);
	assert.equal(deps.isPidAlive(0), false);
	assert.equal(deps.readTextFile(path.join(os.tmpdir(), "zeta-absent-registry.json")), null);
	const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "zeta-desktop-discovery-")), "serve.json");
	fs.writeFileSync(file, JSON.stringify(registration()), "utf8");
	assert.equal(deps.readTextFile(file).includes("4242"), true);
	deps.removeFile(file);
	assert.equal(fs.existsSync(file), false);
});
