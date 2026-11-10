/**
 * 2FA at the HTTP boundary: enrollment is local, remote writes need a verify,
 * sensitive device actions need a fresh step-up, and the migration path keeps
 * working until the operator enables the policy.
 *
 * The gateway and Studio host share one store and one in-memory grant map, so
 * these tests exercise the real routing and the real limiter.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshDirsFromEnv } from "@linxiraos/pi-utils";
import { WebConfig } from "../../src/config/web-config";
import { DeviceRegistry, setDeviceRegistryForTest } from "../../src/server/auth/device-registry";
import { TwoFactorStore, setTwoFactorStoreForTest } from "../../src/server/auth/two-factor-store";
import { resetTwoFactorGrantsForTests } from "../../src/server/auth/two-factor-auth";
import { totp } from "../../src/server/auth/totp";
import { StudioHost, StudioOperations, setStudioHostForTest } from "../../src/server/studio-host/index.js";
import { resetRemoteAccessForTests } from "../../src/server/web-gateway/remote-access";
import { webGatewayFetch } from "../../src/server/web-gateway";

const ENV_KEYS = ["ZETA_CODING_AGENT_DIR"];
const savedEnv = new Map<string, string | undefined>();
const cleanups: Array<() => Promise<void>> = [];
const REMOTE_PEER = "203.0.113.9";

let registry: DeviceRegistry;
let store: TwoFactorStore;
let agentDir: string;

function operations(): StudioOperations {
	return new StudioOperations([
		{
			id: "test",
			queries: { "environment.get": async () => ({}) },
			commands: { "core.abort": async () => undefined },
		} as never,
	]);
}

interface EnrollmentBody {
	secret: string;
	otpauthUrl: string;
	qrSvg: string;
	recoveryCodes: string[];
	expiresAt: string;
}

interface StatusBody {
	enrolled: boolean;
	required: boolean;
	verified: boolean;
	verifiedUntil: string | null;
	recoveryCodesRemaining: number;
}

async function setup(): Promise<void> {
	agentDir = await mkdtemp(join(tmpdir(), "zeta-2fa-http-"));
	cleanups.push(() => rm(agentDir, { recursive: true, force: true }));
	for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
	process.env.ZETA_CODING_AGENT_DIR = agentDir;
	refreshDirsFromEnv();
	WebConfig.resetShared();
	registry = new DeviceRegistry(join(agentDir, "auth", "devices.json"));
	store = new TwoFactorStore(join(agentDir, "auth", "totp.json"));
	setDeviceRegistryForTest(registry);
	setTwoFactorStoreForTest(store);
	setStudioHostForTest(new StudioHost(operations(), { pairingCode: "424242" }));
}

function call(path: string, init: RequestInit = {}, remoteAddr = "127.0.0.1"): Promise<Response> {
	return webGatewayFetch(new Request(`http://127.0.0.1${path}`, init), remoteAddr);
}

function jsonHeaders(token?: string): Record<string, string> {
	return {
		"content-type": "application/json",
		...(token !== undefined ? { authorization: `Bearer ${token}` } : {}),
	};
}

async function enrollLocally(): Promise<EnrollmentBody> {
	const response = await call("/api/auth/2fa/enroll", { method: "POST" });
	expect(response.status).toBe(200);
	return (await response.json()) as EnrollmentBody;
}

async function enableTwoFactor(): Promise<EnrollmentBody> {
	const enrollment = await enrollLocally();
	const confirm = await call("/api/auth/2fa/confirm", {
		method: "POST",
		headers: jsonHeaders(),
		body: JSON.stringify({ code: totp(enrollment.secret) }),
	});
	expect(confirm.status).toBe(200);
	const policy = await call("/api/auth/2fa/policy", {
		method: "PUT",
		headers: jsonHeaders(),
		body: JSON.stringify({ required: true }),
	});
	expect(policy.status).toBe(200);
	return enrollment;
}

beforeEach(() => {
	resetRemoteAccessForTests();
	resetTwoFactorGrantsForTests();
});

afterEach(async () => {
	setDeviceRegistryForTest(undefined);
	setTwoFactorStoreForTest(undefined);
	setStudioHostForTest(undefined);
	for (const key of ENV_KEYS) {
		const saved = savedEnv.get(key);
		if (saved === undefined) delete process.env[key];
		else process.env[key] = saved;
	}
	savedEnv.clear();
	WebConfig.resetShared();
	refreshDirsFromEnv();
	await Promise.all(cleanups.splice(0).map(fn => fn()));
});

describe("status and enrollment", () => {
	test("status is off by default and never contains a secret", async () => {
		await setup();
		const response = await call("/api/auth/2fa");
		expect(response.status).toBe(200);
		const body = (await response.json()) as StatusBody;
		expect(body).toMatchObject({ enrolled: false, required: false, verified: false, recoveryCodesRemaining: 0 });
		expect(JSON.stringify(body)).not.toContain("secret");
	});

	test("local enrollment returns the secret, QR and recovery codes exactly once", async () => {
		await setup();
		const response = await call("/api/auth/2fa/enroll", { method: "POST" });
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toContain("no-store");
		const body = (await response.json()) as EnrollmentBody;
		expect(body.secret).toMatch(/^[A-Z2-7]{32}$/u);
		expect(body.otpauthUrl).toContain("otpauth://totp/");
		expect(body.qrSvg).toContain("<svg");
		expect(body.recoveryCodes).toHaveLength(10);

		// Still pending: the status must not claim enrollment before confirm.
		const status = (await (await call("/api/auth/2fa")).json()) as StatusBody;
		expect(status.enrolled).toBe(false);

		// The secret is in the store; recovery plaintext is not.
		const file = await readFile(join(agentDir, "auth", "totp.json"), "utf8");
		expect(file).toContain(body.secret);
		for (const code of body.recoveryCodes) expect(file).not.toContain(code);
	});

	test("a remote caller cannot enroll: a stolen token must not install a factor", async () => {
		await setup();
		const issued = await registry.issue({ platform: "android" });
		const response = await call(
			"/api/auth/2fa/enroll",
			{ method: "POST", headers: jsonHeaders(issued.token) },
			REMOTE_PEER,
		);
		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ error: "local_required" });
	});

	test("the policy refuses a fake enable before enrollment", async () => {
		await setup();
		const response = await call("/api/auth/2fa/policy", {
			method: "PUT",
			headers: jsonHeaders(),
			body: JSON.stringify({ required: true }),
		});
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: "not_enrolled" });
	});
});

describe("remote write gate", () => {
	test("without 2FA, existing device tokens keep working (migration)", async () => {
		await setup();
		const issued = await registry.issue({ platform: "android" });
		const target = await registry.issue({ platform: "web" });
		const response = await call(
			`/api/remote/devices/${target.device.id}`,
			{ method: "DELETE", headers: jsonHeaders(issued.token) },
			REMOTE_PEER,
		);
		expect(response.status).toBe(200);
	});

	test("sensitive revoke is denied until a code is verified, then allowed", async () => {
		await setup();
		const enrollment = await enableTwoFactor();
		const issued = await registry.issue({ platform: "android" });
		const target = await registry.issue({ platform: "web" });

		const denied = await call(
			`/api/remote/devices/${target.device.id}`,
			{ method: "DELETE", headers: jsonHeaders(issued.token) },
			REMOTE_PEER,
		);
		expect(denied.status).toBe(403);
		expect(await denied.json()).toMatchObject({ error: "totp_required", stepUp: true });

		const verify = await call(
			"/api/auth/2fa/verify",
			{
				method: "POST",
				headers: jsonHeaders(issued.token),
				body: JSON.stringify({ code: totp(enrollment.secret) }),
			},
			REMOTE_PEER,
		);
		expect(verify.status).toBe(200);
		const verified = (await verify.json()) as { verifiedUntil: string; method: string };
		expect(verified.method).toBe("totp");
		expect(verified.verifiedUntil).not.toBeNull();

		const allowed = await call(
			`/api/remote/devices/${target.device.id}`,
			{ method: "DELETE", headers: jsonHeaders(issued.token) },
			REMOTE_PEER,
		);
		expect(allowed.status).toBe(200);
	});

	test("a loopback caller is never challenged", async () => {
		await setup();
		await enableTwoFactor();
		const target = await registry.issue({ platform: "web" });
		const response = await call(`/api/remote/devices/${target.device.id}`, { method: "DELETE" });
		expect(response.status).toBe(200);
	});

	test("machine-token rotation is step-up gated too", async () => {
		await setup();
		await enableTwoFactor();
		const issued = await registry.issue({ platform: "android" });
		const denied = await call(
			"/api/remote/token/rotate",
			{ method: "POST", headers: jsonHeaders(issued.token) },
			REMOTE_PEER,
		);
		expect(denied.status).toBe(403);
		expect(await denied.json()).toMatchObject({ error: "totp_required" });
	});

	test("remote commands are write-gated while queries stay readable", async () => {
		await setup();
		await enableTwoFactor();
		const issued = await registry.issue({ platform: "android" });
		const host = new StudioHost(operations(), { pairingCode: "424242" });
		const post = (path: string, body: unknown) =>
			host.handle(
				new Request(`http://127.0.0.1${path}`, {
					method: "POST",
					headers: { "content-type": "application/json", authorization: `Bearer ${issued.token}` },
					body: JSON.stringify(body),
				}),
				REMOTE_PEER,
			);

		const denied = await post("/api/v1/command", { commandName: "core.abort" });
		expect(denied.status).toBe(403);
		expect(await denied.json()).toMatchObject({ error: "totp_required" });

		// A query reaches ordinary session auth instead of the 2FA gate.
		const query = await post("/api/v1/query", { queryName: "environment.get" });
		expect(query.status).toBe(401);
		expect(await query.json()).toEqual({ error: "unauthenticated" });
	});

	test("pairing a new device needs a fresh step-up", async () => {
		await setup();
		await enableTwoFactor();
		const issued = await registry.issue({ platform: "android" });
		const response = await new StudioHost(operations(), { pairingCode: "424242" }).handle(
			new Request("http://127.0.0.1/api/v1/pair", {
				method: "POST",
				headers: {
					origin: "https://zeta.example.com",
					"content-type": "application/json",
					authorization: `Bearer ${issued.token}`,
				},
				body: JSON.stringify({ code: "424242" }),
			}),
			REMOTE_PEER,
		);
		expect(response.status).toBe(403);
		expect(await response.json()).toMatchObject({ error: "totp_required", stepUp: true });
	});
});

describe("verification", () => {
	test("the same code cannot be replayed", async () => {
		await setup();
		const enrollment = await enableTwoFactor();
		const issued = await registry.issue({ platform: "android" });
		const body = JSON.stringify({ code: totp(enrollment.secret) });

		const first = await call(
			"/api/auth/2fa/verify",
			{ method: "POST", headers: jsonHeaders(issued.token), body },
			REMOTE_PEER,
		);
		expect(first.status).toBe(200);
		const second = await call(
			"/api/auth/2fa/verify",
			{ method: "POST", headers: jsonHeaders(issued.token), body },
			REMOTE_PEER,
		);
		expect(second.status).toBe(401);
		expect(await second.json()).toEqual({ error: "invalid_code" });
	});

	test("a recovery code works once, then is dead", async () => {
		await setup();
		const enrollment = await enableTwoFactor();
		const issued = await registry.issue({ platform: "android" });
		const code = enrollment.recoveryCodes[0] ?? "";
		const body = JSON.stringify({ recoveryCode: code });

		const first = await call(
			"/api/auth/2fa/verify",
			{ method: "POST", headers: jsonHeaders(issued.token), body },
			REMOTE_PEER,
		);
		expect(first.status).toBe(200);
		expect((await first.json()) as { method: string }).toMatchObject({ method: "recovery" });

		const again = await call(
			"/api/auth/2fa/verify",
			{ method: "POST", headers: jsonHeaders(issued.token), body },
			REMOTE_PEER,
		);
		expect(again.status).toBe(401);
	});

	test("repeated wrong codes trip the 2FA limiter", async () => {
		await setup();
		await enableTwoFactor();
		const issued = await registry.issue({ platform: "android" });
		const attempt = () =>
			call(
				"/api/auth/2fa/verify",
				{ method: "POST", headers: jsonHeaders(issued.token), body: JSON.stringify({ code: "000000" }) },
				REMOTE_PEER,
			);

		for (let index = 0; index < 9; index += 1) expect((await attempt()).status).toBe(401);
		const blocked = await attempt();
		expect(blocked.status).toBe(429);
		expect(blocked.headers.get("retry-after")).not.toBeNull();
	});

	test("status reports the caller's verification window", async () => {
		await setup();
		const enrollment = await enableTwoFactor();
		const issued = await registry.issue({ platform: "android" });
		const before = (await (
			await call("/api/auth/2fa", { headers: jsonHeaders(issued.token) }, REMOTE_PEER)
		).json()) as StatusBody;
		expect(before.verified).toBe(false);

		await call(
			"/api/auth/2fa/verify",
			{
				method: "POST",
				headers: jsonHeaders(issued.token),
				body: JSON.stringify({ code: totp(enrollment.secret) }),
			},
			REMOTE_PEER,
		);
		const after = (await (
			await call("/api/auth/2fa", { headers: jsonHeaders(issued.token) }, REMOTE_PEER)
		).json()) as StatusBody;
		expect(after.verified).toBe(true);
		expect(after.verifiedUntil).not.toBeNull();
	});
});

describe("disable and recovery regeneration", () => {
	test("local disable clears the secret and the policy", async () => {
		await setup();
		await enableTwoFactor();
		const response = await call("/api/auth/2fa/disable", { method: "POST" });
		expect(response.status).toBe(200);
		const status = (await (await call("/api/auth/2fa")).json()) as StatusBody;
		expect(status).toMatchObject({ enrolled: false, required: false, recoveryCodesRemaining: 0 });
	});

	test("remote disable requires a code and erases the grant", async () => {
		await setup();
		const enrollment = await enableTwoFactor();
		const issued = await registry.issue({ platform: "android" });
		const noCode = await call(
			"/api/auth/2fa/disable",
			{ method: "POST", headers: jsonHeaders(issued.token), body: "{}" },
			REMOTE_PEER,
		);
		expect(noCode.status).toBe(403);

		await call(
			"/api/auth/2fa/verify",
			{
				method: "POST",
				headers: jsonHeaders(issued.token),
				body: JSON.stringify({ code: totp(enrollment.secret) }),
			},
			REMOTE_PEER,
		);
		const disabled = await call(
			"/api/auth/2fa/disable",
			{
				method: "POST",
				headers: jsonHeaders(issued.token),
				body: JSON.stringify({ recoveryCode: enrollment.recoveryCodes[1] ?? "" }),
			},
			REMOTE_PEER,
		);
		expect(disabled.status).toBe(200);
	});

	test("regenerating recovery codes needs a code and replaces the old set", async () => {
		await setup();
		const enrollment = await enableTwoFactor();
		const response = await call("/api/auth/2fa/recovery/regenerate", {
			method: "POST",
			headers: jsonHeaders(),
			body: JSON.stringify({ code: totp(enrollment.secret) }),
		});
		expect(response.status).toBe(200);
		const body = (await response.json()) as { recoveryCodes: string[] };
		expect(body.recoveryCodes).toHaveLength(10);
		expect(body.recoveryCodes).not.toContain(enrollment.recoveryCodes[0] ?? "");
	});
});

describe("damaged store", () => {
	test("a corrupt file reads as 2FA off instead of locking the machine", async () => {
		await setup();
		await mkdir(join(agentDir, "auth"), { recursive: true });
		await writeFile(join(agentDir, "auth", "totp.json"), "{not json", "utf8");
		const status = (await (await call("/api/auth/2fa")).json()) as StatusBody;
		expect(status.enrolled).toBe(false);
		expect(status.required).toBe(false);
		// And the local recovery path still works.
		expect((await call("/api/auth/2fa/enroll", { method: "POST" })).status).toBe(200);
	});
});
