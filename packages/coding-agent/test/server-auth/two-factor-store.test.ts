/**
 * The 2FA store: enrollment lifecycle, replay counter, recovery codes,
 * atomic 0600 persistence, and fail-closed damaged storage.
 *
 * Every test uses its own temp file; no shared process state is touched.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	PENDING_ENROLLMENT_TTL_MS,
	TwoFactorStore,
	TwoFactorStoreUnavailableError,
} from "../../src/server/auth/two-factor-store";
import { totp, totpStep } from "../../src/server/auth/totp";

const cleanups: Array<() => Promise<void>> = [];

async function setup(): Promise<{ store: TwoFactorStore; file: string }> {
	await mkdir(join(import.meta.dir, "../../../../temp"), { recursive: true });
	const dir = await mkdtemp(join(import.meta.dir, "../../../../temp/zeta-2fa-store-"));
	cleanups.push(() => rm(dir, { recursive: true, force: true }));
	const file = join(dir, "auth", "totp.json");
	return { store: new TwoFactorStore(file), file };
}

afterEach(async () => {
	await Promise.all(cleanups.splice(0).map(fn => fn()));
});

describe("enrollment lifecycle", () => {
	test("a missing file means 2FA is off", async () => {
		const { store } = await setup();
		expect(await store.status()).toEqual({
			enrolled: false,
			required: false,
			enrolledAt: null,
			recoveryCodesRemaining: 0,
			pending: false,
		});
		expect(await store.verifyCode("123456")).toEqual({ ok: false, reason: "mismatch" });
		expect(await store.confirm("123456")).toEqual({ ok: false, reason: "no_pending" });
	});

	test("enroll → confirm activates the secret and its recovery codes", async () => {
		const { store } = await setup();
		const enrollment = await store.enroll();
		expect(enrollment.secret).toMatch(/^[A-Z2-7]{32}$/u);
		expect(enrollment.otpauthUrl).toContain("otpauth://totp/");
		expect(enrollment.recoveryCodes).toHaveLength(10);

		const pendingStatus = await store.status();
		expect(pendingStatus.enrolled).toBe(false);
		expect(pendingStatus.pending).toBe(true);

		expect((await store.confirm("000000")).ok).toBe(false);
		const confirmed = await store.confirm(totp(enrollment.secret));
		expect(confirmed.ok).toBe(true);

		const status = await store.status();
		expect(status.enrolled).toBe(true);
		expect(status.required).toBe(false);
		expect(status.pending).toBe(false);
		expect(status.recoveryCodesRemaining).toBe(10);
		expect(status.enrolledAt).not.toBeNull();
	});

	test("an unconfirmed enrollment expires after ten minutes", async () => {
		const { store } = await setup();
		const now = Date.now();
		const enrollment = await store.enroll(new Date(now - PENDING_ENROLLMENT_TTL_MS - 1));
		const outcome = await store.confirm(totp(enrollment.secret), new Date(now));
		expect(outcome).toEqual({ ok: false, reason: "expired" });
		expect((await store.status()).pending).toBe(false);
	});

	test("the policy refuses to require 2FA before enrollment", async () => {
		const { store } = await setup();
		expect(await store.setRequired(true)).toEqual({ ok: false, reason: "not_enrolled" });

		const enrollment = await store.enroll();
		await store.confirm(totp(enrollment.secret));
		expect(await store.setRequired(true)).toEqual({ ok: true });
		expect((await store.status()).required).toBe(true);
		expect(await store.setRequired(false)).toEqual({ ok: true });
		expect((await store.status()).required).toBe(false);
	});
});

describe("verification", () => {
	test("accepts once, persists the step, and rejects a replay across instances", async () => {
		const { store, file } = await setup();
		const enrollment = await store.enroll();
		await store.confirm(totp(enrollment.secret));
		const code = totp(enrollment.secret);
		const step = totpStep();

		expect(await store.verifyCode(code)).toEqual({ ok: true, step });
		expect(await store.verifyCode(code)).toEqual({ ok: false, reason: "replay" });

		// A new instance reads the persisted counter: restart does not reopen the window.
		const reopened = new TwoFactorStore(file);
		expect(await reopened.verifyCode(code)).toEqual({ ok: false, reason: "replay" });
	});

	test("a recovery code is consumed exactly once", async () => {
		const { store } = await setup();
		const enrollment = await store.enroll();
		await store.confirm(totp(enrollment.secret));
		const first = enrollment.recoveryCodes[0] ?? "";

		expect(await store.consumeRecoveryCode(first)).toBe(true);
		expect((await store.status()).recoveryCodesRemaining).toBe(9);
		expect(await store.consumeRecoveryCode(first)).toBe(false);
		expect(await store.consumeRecoveryCode("AAAAA-AAAAA")).toBe(false);
	});

	test("concurrent recovery attempts across stores publish exactly one consumption", async () => {
		const { store, file } = await setup();
		const enrollment = await store.enroll();
		await store.confirm(totp(enrollment.secret));
		const code = enrollment.recoveryCodes[0]!;
		const outcomes = await Promise.all([
			store.consumeRecoveryCode(code),
			new TwoFactorStore(file).consumeRecoveryCode(code),
		]);
		expect(outcomes.sort()).toEqual([false, true]);
		expect((await new TwoFactorStore(file).status()).recoveryCodesRemaining).toBe(9);
	});

	test("regenerating recovery codes invalidates the old set", async () => {
		const { store } = await setup();
		const enrollment = await store.enroll();
		await store.confirm(totp(enrollment.secret));
		const oldCode = enrollment.recoveryCodes[0] ?? "";

		const regenerated = await store.regenerateRecoveryCodes();
		expect(regenerated.ok).toBe(true);
		if (!regenerated.ok) return;
		expect(regenerated.recoveryCodes).toHaveLength(10);
		expect(await store.consumeRecoveryCode(oldCode)).toBe(false);
		expect(await store.consumeRecoveryCode(regenerated.recoveryCodes[0] ?? "")).toBe(true);
	});
});

describe("storage", () => {
	test("writes an atomic 0600 file that never contains recovery plaintext", async () => {
		const { store, file } = await setup();
		const enrollment = await store.enroll();
		await store.confirm(totp(enrollment.secret));

		if (process.platform !== "win32") {
			const info = await stat(file);
			expect(info.mode & 0o777).toBe(0o600);
		}
		const text = await readFile(file, "utf8");
		const parsed = JSON.parse(text) as { secret: string; recoveryCodeHashes: string[] };
		expect(parsed.secret).toBe(enrollment.secret);
		expect(parsed.recoveryCodeHashes).toHaveLength(10);
		for (const hash of parsed.recoveryCodeHashes) expect(hash).toMatch(/^[0-9a-f]{64}$/u);
		for (const code of enrollment.recoveryCodes) expect(text).not.toContain(code);
	});

	test("damaged state is preserved and only an explicit local reset can replace it", async () => {
		const { store, file } = await setup();
		await mkdir(join(file, ".."), { recursive: true });
		const damaged = "{ this is not json";
		await writeFile(file, damaged, "utf8");
		await expect(store.status()).rejects.toBeInstanceOf(TwoFactorStoreUnavailableError);
		await expect(store.enroll()).rejects.toBeInstanceOf(TwoFactorStoreUnavailableError);
		await expect(store.disable()).rejects.toBeInstanceOf(TwoFactorStoreUnavailableError);
		expect(await readFile(file, "utf8")).toBe(damaged);
		await store.disable(true);
		expect(await store.status()).toMatchObject({ enrolled: false, required: false });
		const enrollment = await store.enroll();
		expect(await store.confirm(totp(enrollment.secret))).toMatchObject({ ok: true });
	});

	test("unsupported schema and inconsistent policy or replay state never turn protection off", async () => {
		const { store, file } = await setup();
		const enrollment = await store.enroll();
		await store.confirm(totp(enrollment.secret));
		await store.setRequired(true);
		const active = await store.read();
		for (const damage of [
			{ version: 2 },
			{ required: "true" },
			{ secret: "" },
			{ enrolledAt: null },
			{ lastUsedStep: -1 },
			{ pending: {} },
		]) {
			await writeFile(file, JSON.stringify({ ...active, ...damage }));
			await expect(new TwoFactorStore(file).isRequired()).rejects.toBeInstanceOf(TwoFactorStoreUnavailableError);
		}
	});

	test("a non-file store is unavailable rather than a fresh installation", async () => {
		const { store, file } = await setup();
		await mkdir(file, { recursive: true });
		await expect(store.isRequired()).rejects.toBeInstanceOf(TwoFactorStoreUnavailableError);
	});

	test("disable erases the secret, policy and recovery codes", async () => {
		const { store } = await setup();
		const enrollment = await store.enroll();
		await store.confirm(totp(enrollment.secret));
		await store.setRequired(true);

		await store.disable();
		const status = await store.status();
		expect(status).toMatchObject({ enrolled: false, required: false, recoveryCodesRemaining: 0, pending: false });
		expect(await store.verifyCode(totp(enrollment.secret))).toEqual({ ok: false, reason: "mismatch" });
		expect(await store.consumeRecoveryCode(enrollment.recoveryCodes[0] ?? "")).toBe(false);
	});

	test("re-enrolling keeps the active secret until the new one is confirmed", async () => {
		const { store } = await setup();
		const first = await store.enroll();
		await store.confirm(totp(first.secret));

		const second = await store.enroll();
		expect((await store.status()).enrolled).toBe(true);
		expect(await store.verifyCode(totp(first.secret))).toEqual({ ok: true, step: totpStep() });

		await store.confirm(totp(second.secret));
		expect(await store.verifyCode(totp(first.secret))).toEqual({ ok: false, reason: "mismatch" });
	});
});
