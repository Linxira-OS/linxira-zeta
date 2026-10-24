import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { type BackendAttachIntent, resolveBackendTarget } from "../../src/backend/attach-intent";
import type { BackendTarget } from "../../src/backend/client";
import { VERSION } from "@linxiraos/pi-utils";

const INTENT: BackendAttachIntent = { newSession: false, explicit: false };

const REGISTRATION = {
	pid: process.pid,
	webUrl: "http://127.0.0.1:43141",
	statsUrl: "http://127.0.0.1:43147",
	gatewayUrl: "http://127.0.0.1:43143",
	version: VERSION,
	startedAt: "2026-10-24T00:00:00.000Z",
	cwd: "/repo",
};

const BACKEND: BackendTarget = {
	baseUrl: "http://127.0.0.1:43143",
	identity: { app: "zeta", version: VERSION, pid: 1, startedAt: "", webUrl: "", statsUrl: "", gatewayUrl: null },
};

const temps: string[] = [];

function registryFile(present: boolean): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-attach-retry-"));
	temps.push(dir);
	const file = path.join(dir, "serve.json");
	if (present) fs.writeFileSync(file, JSON.stringify(REGISTRATION));
	return file;
}

afterEach(() => {
	for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("attach discovery retry", () => {
	it("retries while a registered serve is still coming up", async () => {
		let calls = 0;
		const sleeps: number[] = [];
		const backend = await resolveBackendTarget(INTENT, {
			registryFile: registryFile(true),
			discover: async () => {
				calls += 1;
				return calls >= 3 ? BACKEND : null;
			},
			sleepImpl: async (ms: number) => {
				sleeps.push(ms);
			},
		});
		expect(backend?.backend.baseUrl).toBe(BACKEND.baseUrl);
		expect(calls).toBe(3);
		expect(sleeps.length).toBe(2);
	});

	it("falls back immediately when nothing is registered", async () => {
		let calls = 0;
		const backend = await resolveBackendTarget(INTENT, {
			registryFile: registryFile(false),
			discover: async () => {
				calls += 1;
				return null;
			},
			sleepImpl: async () => undefined,
		});
		expect(backend).toBeUndefined();
		expect(calls).toBe(1);
	});

	it("gives up after the bounded retries", async () => {
		let calls = 0;
		const backend = await resolveBackendTarget(INTENT, {
			registryFile: registryFile(true),
			discover: async () => {
				calls += 1;
				return null;
			},
			sleepImpl: async () => undefined,
		});
		expect(backend).toBeUndefined();
		expect(calls).toBe(4);
	});

	it("skips discovery entirely when there is no intent", async () => {
		let calls = 0;
		const backend = await resolveBackendTarget(undefined, {
			discover: async () => {
				calls += 1;
				return BACKEND;
			},
		});
		expect(backend).toBeUndefined();
		expect(calls).toBe(0);
	});
});
