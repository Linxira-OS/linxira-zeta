/**
 * Serve registry + discovery contract: the `~/.zeta/serve.json` registration
 * (0600, atomic, self-owned), the identity probe that decides whether a port is
 * ours, stale (dead pid) cleanup, and the port-scoped reuse/refuse decision a
 * starting `zeta serve` makes.
 *
 * All probes run against injected fetchers and injected liveness, so nothing
 * here binds a port or signals a real process.
 */

import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getBaseConfigRoot } from "@linxiraos/pi-utils";
import {
	clearServeRegistration,
	decideServeReuse,
	discoverServeInstance,
	identityProbeUrls,
	isPidAlive,
	parseServeRegistration,
	planServeStart,
	probeServeIdentity,
	readServeRegistration,
	SERVE_REGISTRY_ENV,
	serveRegistryPath,
	writeServeRegistration,
	type ServeRegistration,
} from "../src/server/serve-registry";
import { SERVE_IDENTITY_APP, type ServeIdentity } from "../src/server/web-gateway/identity";

const tempDirs: string[] = [];
const savedEnv = new Map<string, string | undefined>();

function tempRegistry(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-serve-registry-"));
	tempDirs.push(dir);
	return path.join(dir, "serve.json");
}

function registration(overrides: Partial<ServeRegistration> = {}): ServeRegistration {
	return {
		pid: 4242,
		webUrl: "http://127.0.0.1:30141",
		statsUrl: "http://127.0.0.1:3847",
		gatewayUrl: "http://127.0.0.1:30142",
		version: "1.2.0",
		startedAt: "2026-10-13T00:00:00.000Z",
		cwd: "/work",
		...overrides,
	};
}

function identity(overrides: Partial<ServeIdentity> = {}): ServeIdentity {
	return {
		app: SERVE_IDENTITY_APP,
		version: "1.2.0",
		pid: 4242,
		startedAt: "2026-10-13T00:00:00.000Z",
		webUrl: "http://127.0.0.1:30141",
		statsUrl: "http://127.0.0.1:3847",
		gatewayUrl: "http://127.0.0.1:30142",
		...overrides,
	};
}

/** Fetcher that answers the identity path from `responder`, refusing everything else. */
function fakeFetch(responder: (url: string) => Response | null): typeof fetch {
	return (async (input: string | URL | Request) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
		const response = responder(url);
		if (!response) throw new Error(`ECONNREFUSED ${url}`);
		return response;
	}) as unknown as typeof fetch;
}

/** Answers only on the URLs in `ports`, with the given identity payload. */
function fetchOnPorts(ports: number[], payload: ServeIdentity): typeof fetch {
	return fakeFetch(url => {
		try {
			const parsed = new URL(url);
			return ports.includes(Number(parsed.port)) ? Response.json(payload) : null;
		} catch {
			return null;
		}
	});
}

afterEach(() => {
	for (const [key, value] of savedEnv) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	savedEnv.clear();
	for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("serveRegistryPath", () => {
	test("honors ZETA_SERVE_REGISTRY and defaults to <config root>/serve.json", () => {
		savedEnv.set(SERVE_REGISTRY_ENV, process.env[SERVE_REGISTRY_ENV]);
		delete process.env[SERVE_REGISTRY_ENV];
		expect(serveRegistryPath({})).toBe(path.join(getBaseConfigRoot(), "serve.json"));
		expect(serveRegistryPath({ [SERVE_REGISTRY_ENV]: "  /tmp/custom.json  " })).toBe(
			path.resolve("/tmp/custom.json"),
		);
	});
});

describe("registration file", () => {
	test("round-trips an entry and writes it owner-only", () => {
		const file = tempRegistry();
		writeServeRegistration(registration({ desktopOpenSecret: "s3cret" }), file);
		const read = readServeRegistration(file);
		expect(read?.pid).toBe(4242);
		expect(read?.webUrl).toBe("http://127.0.0.1:30141");
		expect(read?.desktopOpenSecret).toBe("s3cret");
		if (process.platform !== "win32") {
			expect(fs.statSync(file).mode & 0o777).toBe(0o600);
		}
	});

	test("a malformed or non-conforming file is never trusted", () => {
		const file = tempRegistry();
		fs.writeFileSync(file, "{ not json", "utf8");
		expect(readServeRegistration(file)).toBeNull();
		fs.writeFileSync(file, JSON.stringify({ pid: "4242", webUrl: "http://x" }), "utf8");
		expect(readServeRegistration(file)).toBeNull();
		fs.writeFileSync(file, JSON.stringify({ pid: 1, version: "1.2.0" }), "utf8");
		expect(readServeRegistration(file)).toBeNull();
		expect(readServeRegistration(path.join(path.dirname(file), "absent.json"))).toBeNull();
		expect(parseServeRegistration({ pid: 0, webUrl: "http://x", version: "1" })).toBeNull();
	});

	test("only the owning pid may clear the record", () => {
		const file = tempRegistry();
		writeServeRegistration(registration({ pid: 4242 }), file);
		expect(clearServeRegistration(9999, file)).toBe(false);
		expect(readServeRegistration(file)?.pid).toBe(4242);
		expect(clearServeRegistration(4242, file)).toBe(true);
		expect(fs.existsSync(file)).toBe(false);
	});

	test("an unparsable file is left alone (a foreign build may own it)", () => {
		const file = tempRegistry();
		fs.writeFileSync(file, "{ not json", "utf8");
		expect(clearServeRegistration(process.pid, file)).toBe(false);
		expect(fs.existsSync(file)).toBe(true);
	});
});

describe("pid liveness", () => {
	test("the current process is alive, an impossible pid is not", () => {
		expect(isPidAlive(process.pid)).toBe(true);
		expect(isPidAlive(0)).toBe(false);
		expect(isPidAlive(Number.NaN)).toBe(false);
	});
});

describe("identity probe", () => {
	test("returns the identity when a Zeta instance answers", async () => {
		const found = await probeServeIdentity("http://127.0.0.1:30141", {
			fetchImpl: fetchOnPorts([30141], identity()),
			timeoutMs: 200,
		});
		expect(found?.version).toBe("1.2.0");
		expect(found?.pid).toBe(4242);
	});

	test("rejects a non-Zeta server, an HTTP error, and a connection refusal", async () => {
		const foreign = await probeServeIdentity("http://127.0.0.1:1", {
			fetchImpl: fakeFetch(() => Response.json({ app: "something-else", version: "1.2.0", pid: 1 })),
			timeoutMs: 200,
		});
		expect(foreign).toBeNull();
		const notFound = await probeServeIdentity("http://127.0.0.1:1", {
			fetchImpl: fakeFetch(() => new Response("nope", { status: 404 })),
			timeoutMs: 200,
		});
		expect(notFound).toBeNull();
		const refused = await probeServeIdentity("http://127.0.0.1:1", {
			fetchImpl: fakeFetch(() => null),
			timeoutMs: 200,
		});
		expect(refused).toBeNull();
	});

	test("probes loopback before a bind-all or interface host", () => {
		expect(identityProbeUrls("http://127.0.0.1:30141")).toEqual(["http://127.0.0.1:30141"]);
		expect(identityProbeUrls("http://0.0.0.0:30141")).toEqual(["http://127.0.0.1:30141", "http://0.0.0.0:30141"]);
		expect(identityProbeUrls("not a url")).toEqual(["not a url"]);
	});
});

describe("discovery", () => {
	const target = "http://127.0.0.1:30141";

	test("drops a dead-pid registration and reports it as stale", async () => {
		const file = tempRegistry();
		writeServeRegistration(registration({ pid: 777 }), file);
		const discovery = await discoverServeInstance({
			targetUrl: target,
			registryFile: file,
			fetchImpl: fetchOnPorts([30141], identity()),
			isAlive: () => false,
		});
		expect(discovery.staleRegistration?.pid).toBe(777);
		expect(fs.existsSync(file)).toBe(false);
		// A live identity still answers on the port: stale metadata, not a dead service.
		expect(discovery.identity?.pid).toBe(4242);
		expect(discovery.registration).toBeNull();
	});

	test("keeps a registration that belongs to the instance that answered", async () => {
		const file = tempRegistry();
		writeServeRegistration(registration(), file);
		const discovery = await discoverServeInstance({
			targetUrl: target,
			registryFile: file,
			fetchImpl: fetchOnPorts([30141], identity()),
			isAlive: () => true,
		});
		expect(discovery.staleRegistration).toBeNull();
		expect(discovery.registration?.pid).toBe(4242);
		expect(discovery.probedUrl).toBe(target);
	});

	test("finds an instance whose registration file is gone", async () => {
		const discovery = await discoverServeInstance({
			targetUrl: target,
			registryFile: tempRegistry(),
			fetchImpl: fetchOnPorts([30141], identity({ pid: 99 })),
			isAlive: () => true,
		});
		expect(discovery.identity?.pid).toBe(99);
		expect(discovery.registration).toBeNull();
	});

	test("reports nothing when no instance answers", async () => {
		const discovery = await discoverServeInstance({
			targetUrl: target,
			registryFile: tempRegistry(),
			fetchImpl: fetchOnPorts([], identity()),
			isAlive: () => true,
		});
		expect(discovery.identity).toBeNull();
		expect(discovery.probedUrl).toBeNull();
	});
});

describe("reuse decision (zeta serve)", () => {
	const target = "http://127.0.0.1:30141";

	test("reuses a healthy same-version instance holding the target port", async () => {
		const file = tempRegistry();
		writeServeRegistration(registration(), file);
		const discovery = await discoverServeInstance({
			targetUrl: target,
			registryFile: file,
			fetchImpl: fetchOnPorts([30141], identity()),
			isAlive: () => true,
		});
		const plan = planServeStart({ discovery, targetUrl: target, currentVersion: "1.2.0" });
		expect(plan.action).toBe("reuse");
		if (plan.action !== "reuse") throw new Error("expected reuse");
		expect(plan.identity.pid).toBe(4242);
		expect(plan.registration?.webUrl).toBe(target);
	});

	test("reports the removed dead-owner registration on the reuse branch too", async () => {
		const file = tempRegistry();
		writeServeRegistration(registration({ pid: 777 }), file);
		const discovery = await discoverServeInstance({
			targetUrl: target,
			registryFile: file,
			// The port answers with a live instance while the file names a dead one.
			fetchImpl: fetchOnPorts([30141], identity()),
			isAlive: () => false,
		});
		const plan = planServeStart({ discovery, targetUrl: target, currentVersion: "1.2.0" });
		expect(plan.action).toBe("reuse");
		if (plan.action !== "reuse") throw new Error("expected reuse");
		expect(plan.stale?.pid).toBe(777);
		expect(plan.registration).toBeNull();
	});

	test("refuses a different version holding the target port", async () => {
		const discovery = await discoverServeInstance({
			targetUrl: target,
			registryFile: tempRegistry(),
			fetchImpl: fetchOnPorts([30141], identity({ version: "1.1.0" })),
			isAlive: () => true,
		});
		const plan = planServeStart({ discovery, targetUrl: target, currentVersion: "1.2.0" });
		expect(plan.action).toBe("version-mismatch");
		if (plan.action !== "version-mismatch") throw new Error("expected version-mismatch");
		expect(plan.identity.version).toBe("1.1.0");
	});

	test("starts anyway when the same-version instance is on another port", async () => {
		const file = tempRegistry();
		writeServeRegistration(registration(), file);
		const discovery = await discoverServeInstance({
			targetUrl: "http://127.0.0.1:39999",
			registryFile: file,
			fetchImpl: fetchOnPorts([30141], identity()),
			isAlive: () => true,
		});
		const plan = planServeStart({
			discovery,
			targetUrl: "http://127.0.0.1:39999",
			currentVersion: "1.2.0",
		});
		expect(plan.action).toBe("start");
		if (plan.action !== "start") throw new Error("expected start");
		expect(plan.other?.pid).toBe(4242);
		expect(plan.other?.webUrl).toBe("http://127.0.0.1:30141");
	});

	test("starts when nothing answers, carrying the stale record", async () => {
		const file = tempRegistry();
		writeServeRegistration(registration({ pid: 777 }), file);
		const discovery = await discoverServeInstance({
			targetUrl: target,
			registryFile: file,
			fetchImpl: fetchOnPorts([], identity()),
			isAlive: () => false,
		});
		const plan = planServeStart({ discovery, targetUrl: target, currentVersion: "1.2.0" });
		expect(plan.action).toBe("start");
		if (plan.action !== "start") throw new Error("expected start");
		expect(plan.stale?.pid).toBe(777);
		expect(plan.other).toBeNull();
	});
});

describe("reuse decision (desktop shell, port-agnostic)", () => {
	test("reuses any healthy same-version instance", () => {
		expect(
			decideServeReuse({ identity: identity({ version: "1.2.0" }), registration: null, currentVersion: "1.2.0" }),
		).toEqual({ action: "reuse", identity: identity({ version: "1.2.0" }), registration: null });
		expect(
			decideServeReuse({ identity: identity({ version: "1.0.0" }), registration: null, currentVersion: "1.2.0" })
				.action,
		).toBe("version-mismatch");
		expect(decideServeReuse({ identity: null, registration: null, currentVersion: "1.2.0" }).action).toBe("start");
	});
});
