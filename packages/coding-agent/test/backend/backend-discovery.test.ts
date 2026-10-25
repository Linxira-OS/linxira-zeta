/**
 * Backend discovery contract:
 *
 * - an explicit URL or `ZETA_GATEWAY_URL` pins discovery; a healthy default
 *   port or a registered instance must not turn that pin into an ambiguity;
 * - an invalid `ZETA_WEB_GATEWAY_PORT` is ignored rather than poisoning every
 *   candidate URL;
 * - the same instance answering on its gateway and web origins is one
 *   backend, not two (dedupe by pid);
 * - dead-pid registrations are hints that must not be probed.
 */
import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { backendCandidateUrls, DEFAULT_BACKEND_PORT, discoverBackends } from "../../src/backend/client";
import { writeServeRegistration, type ServeRegistration } from "../../src/server/serve-registry";
import { VERSION } from "@linxiraos/pi-utils";

const temps: string[] = [];

afterEach(() => {
	for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function registry(): { file: string; dir: string } {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-backend-discovery-"));
	temps.push(dir);
	return { file: path.join(dir, "serve.json"), dir: path.join(dir, "serve") };
}

function registration(overrides: Partial<ServeRegistration> = {}): ServeRegistration {
	return {
		pid: process.pid,
		webUrl: "http://127.0.0.1:43141",
		statsUrl: "http://127.0.0.1:43147",
		gatewayUrl: "http://127.0.0.1:43143",
		version: VERSION,
		startedAt: "2026-10-25T00:00:00.000Z",
		cwd: "/repo",
		...overrides,
	};
}

function requestUrl(input: string | URL | Request): string {
	return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

describe("backend candidate discovery", () => {
	it("pins an explicit gateway URL and skips default/registry hints", () => {
		const { file, dir } = registry();
		writeServeRegistration(registration(), file, dir);

		expect(
			backendCandidateUrls({
				env: { ZETA_GATEWAY_URL: "http://backend.example:9999/api" },
				registryFile: file,
			}),
		).toEqual(["http://backend.example:9999"]);
	});

	it("uses a valid ZETA_WEB_GATEWAY_PORT before the default port", () => {
		expect(backendCandidateUrls({ env: { ZETA_WEB_GATEWAY_PORT: "45143" } })).toEqual(["http://127.0.0.1:45143"]);
	});

	it("ignores an invalid ZETA_WEB_GATEWAY_PORT and keeps the registry hint", () => {
		const { file, dir } = registry();
		writeServeRegistration(registration(), file, dir);

		const candidates = backendCandidateUrls({
			env: { ZETA_WEB_GATEWAY_PORT: "not-a-port" },
			registryFile: file,
		});

		expect(candidates[0]).toBe(`http://127.0.0.1:${DEFAULT_BACKEND_PORT}`);
		expect(candidates).toContain("http://127.0.0.1:43143");
	});

	it("normalizes an explicit URL to its origin", () => {
		expect(
			backendCandidateUrls({
				url: "http://backend.example:9999/api/v1/",
				env: {},
			}),
		).toEqual(["http://backend.example:9999"]);
	});

	it("does not probe a registration whose pid is dead", () => {
		const { file, dir } = registry();
		writeServeRegistration(registration({ pid: 999_999, gatewayUrl: "http://127.0.0.1:45143" }), file, dir);

		const candidates = backendCandidateUrls({ env: {}, registryFile: file });

		expect(candidates).toEqual([`http://127.0.0.1:${DEFAULT_BACKEND_PORT}`]);
	});

	it("deduplicates one instance answering on both gateway and web origins", async () => {
		const { file, dir } = registry();
		const gateway = "http://127.0.0.1:45143";
		const web = "http://127.0.0.1:45141";
		writeServeRegistration(registration({ gatewayUrl: gateway, webUrl: web }), file, dir);

		const seen: string[] = [];
		const fetchImpl = (async (input: string | URL | Request) => {
			const url = requestUrl(input);
			seen.push(url);
			if (!url.startsWith("http://127.0.0.1:4514")) return new Response("not zeta", { status: 404 });
			return Response.json({
				app: "zeta",
				version: VERSION,
				pid: process.pid,
				startedAt: "2026-10-25T00:00:00.000Z",
				webUrl: web,
				statsUrl: "http://127.0.0.1:45147",
				gatewayUrl: gateway,
			});
		}) as typeof fetch;

		const found = await discoverBackends({ env: {}, registryFile: file, fetchImpl, timeoutMs: 100 });

		expect(found).toHaveLength(1);
		expect(found[0]?.identity.pid).toBe(process.pid);
		expect(seen.some(url => url.startsWith(gateway))).toBe(true);
		expect(seen.some(url => url.startsWith(web))).toBe(true);
	});
});
