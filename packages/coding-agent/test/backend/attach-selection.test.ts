/**
 * Attach selection with several live backends: an explicit URL or a session id
 * must select exactly one instance, and any ambiguity must stop startup rather
 * than betting on whichever registration was written last.
 */
import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { BackendAttachError, type BackendAttachIntent, resolveBackendTarget } from "../../src/backend/attach-intent";
import type { BackendTarget } from "../../src/backend/client";
import {
	clearServeRegistration,
	listServeRegistrations,
	writeServeRegistration,
} from "../../src/server/serve-registry";
import { VERSION } from "@linxiraos/pi-utils";

const INTENT: BackendAttachIntent = { newSession: false, explicit: true };

function target(port: number, pid: number, version = VERSION): BackendTarget {
	return {
		baseUrl: `http://127.0.0.1:${port}`,
		identity: {
			app: "zeta",
			version,
			pid,
			startedAt: "2026-10-24T00:00:00.000Z",
			webUrl: `http://127.0.0.1:${port}`,
			statsUrl: `http://127.0.0.1:${port + 1}`,
			gatewayUrl: `http://127.0.0.1:${port}`,
		},
	};
}

const A = target(43143, 101);
const B = target(44143, 202);

/** Gateway answer that owns no sessions. */
const EMPTY_SESSIONS = (async () =>
	new Response(JSON.stringify({ sessions: [] }), {
		status: 200,
		headers: { "content-type": "application/json" },
	})) as unknown as typeof fetch;

const temps: string[] = [];
afterEach(() => {
	for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("attach selection", () => {
	it("refuses to guess between two compatible backends", async () => {
		await expect(
			resolveBackendTarget(INTENT, { discoverAll: async () => [A, B], sleepImpl: async () => undefined }),
		).rejects.toThrow(BackendAttachError);
	});

	it("an explicit URL pins one backend even when another probes first", async () => {
		const resolved = await resolveBackendTarget(
			{ ...INTENT, url: B.baseUrl },
			{ discoverAll: async () => [A, B], sleepImpl: async () => undefined },
		);
		expect(resolved?.backend.baseUrl).toBe(B.baseUrl);
	});

	it("a session id selects the backend that owns it", async () => {
		const fetchImpl = (async (input: string | URL | Request) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			const ids = url.startsWith(A.baseUrl) ? ["a-session"] : ["b-session"];
			return new Response(JSON.stringify({ sessions: ids.map(id => ({ id, cwd: "/repo" })) }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}) as typeof fetch;
		const resolved = await resolveBackendTarget(
			{ ...INTENT, sessionId: "b-session" },
			{ discoverAll: async () => [A, B], fetchImpl, sleepImpl: async () => undefined },
		);
		expect(resolved?.backend.baseUrl).toBe(B.baseUrl);
	});

	it("selects the backend that already owns the workspace session", async () => {
		const fetchImpl = (async (input: string | URL | Request) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			const sessions = url.startsWith(A.baseUrl)
				? [{ id: "a-session", cwd: "/work/repo", modified: "2026-10-24T00:00:00.000Z" }]
				: [{ id: "b-session", cwd: "/other", modified: "2026-10-24T00:00:00.000Z" }];
			return new Response(JSON.stringify({ sessions }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}) as typeof fetch;
		const resolved = await resolveBackendTarget(INTENT, {
			discoverAll: async () => [A, B],
			fetchImpl,
			cwd: "/work/repo",
			sleepImpl: async () => undefined,
		});
		expect(resolved?.backend.baseUrl).toBe(A.baseUrl);
	});

	it("reports a missing session instead of attaching elsewhere", async () => {
		await expect(
			resolveBackendTarget(
				{ ...INTENT, sessionId: "missing" },
				{
					discoverAll: async () => [A, B],
					fetchImpl: EMPTY_SESSIONS,
					sleepImpl: async () => undefined,
				},
			),
		).rejects.toMatchObject({ code: "session-not-found" });
	});

	it("refuses a backend running another zeta version", async () => {
		await expect(
			resolveBackendTarget(INTENT, {
				discoverAll: async () => [target(45143, 303, "0.0.0-other")],
				sleepImpl: async () => undefined,
			}),
		).rejects.toMatchObject({ code: "version-mismatch" });
	});
});

describe("serve instance registry", () => {
	it("lists every instance and clears only the named pid", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-serve-registry-"));
		temps.push(dir);
		const file = path.join(dir, "serve.json");
		const instances = path.join(dir, "serve");
		const base = {
			statsUrl: "",
			gatewayUrl: null,
			version: VERSION,
			startedAt: "2026-10-24T00:00:00.000Z",
			cwd: "/repo",
		};
		writeServeRegistration({ pid: 101, webUrl: A.baseUrl, ...base }, file, instances);
		writeServeRegistration(
			{ pid: 202, webUrl: B.baseUrl, ...base, startedAt: "2026-10-24T00:00:01.000Z" },
			file,
			instances,
		);
		expect(listServeRegistrations({ file, dir: instances }).map(entry => entry.pid)).toEqual([202, 101]);

		clearServeRegistration(202, file, instances);
		expect(listServeRegistrations({ file, dir: instances }).map(entry => entry.pid)).toEqual([101]);
	});
});
