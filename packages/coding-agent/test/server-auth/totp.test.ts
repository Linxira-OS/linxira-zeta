/**
 * RFC 6238 vectors and the replay/window rules the 2FA store relies on.
 *
 * The 8-digit reference values are truncated to the six digits this product
 * uses; that is the only permitted deviation from the RFC examples.
 */

import { describe, expect, test } from "bun:test";
import {
	base32Decode,
	base32Encode,
	buildOtpauthUrl,
	generateRecoveryCodes,
	generateTotpSecret,
	hashRecoveryCode,
	hotp,
	matchesRecoveryCode,
	normalizeRecoveryCode,
	totp,
	totpStep,
	verifyTotpCode,
} from "../../src/server/auth/totp";

const RFC_SECRET_ASCII = "12345678901234567890";
const RFC_SECRET_BASE32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("base32", () => {
	test("round-trips the RFC 4226 secret", () => {
		expect(base32Encode(Buffer.from(RFC_SECRET_ASCII, "ascii"))).toBe(RFC_SECRET_BASE32);
		expect(base32Decode(RFC_SECRET_BASE32).toString("ascii")).toBe(RFC_SECRET_ASCII);
	});

	test("decoding tolerates lowercase, spaces and padding", () => {
		expect(base32Decode("gezd gnbv gy3t qojq gezd gnbv gy3t qojq====").toString("ascii")).toBe(RFC_SECRET_ASCII);
		expect(() => base32Decode("not-base32!")).toThrow("invalid_base32");
	});

	test("a generated secret is 160 bits of base32", () => {
		const secret = generateTotpSecret();
		expect(secret).toMatch(/^[A-Z2-7]{32}$/u);
		expect(base32Decode(secret)).toHaveLength(20);
	});
});

describe("RFC 6238 vectors (6-digit truncation)", () => {
	const vectors: Array<[seconds: number, code: string]> = [
		[59, "287082"],
		[1111111109, "081804"],
		[1111111111, "050471"],
		[1234567890, "005924"],
		[2000000000, "279037"],
		[20000000000, "353130"],
	];

	for (const [seconds, expected] of vectors) {
		test(`T=${seconds} → ${expected}`, () => {
			expect(totp(RFC_SECRET_BASE32, seconds * 1000)).toBe(expected);
		});
	}

	test("HOTP counters match the RFC 4226 test values", () => {
		const secret = Buffer.from(RFC_SECRET_ASCII, "ascii");
		expect(hotp(secret, 0)).toBe("755224");
		expect(hotp(secret, 1)).toBe("287082");
		expect(hotp(secret, 2)).toBe("359152");
	});

	test("the step advances every 30 seconds", () => {
		expect(totpStep(0)).toBe(0);
		expect(totpStep(29_999)).toBe(0);
		expect(totpStep(30_000)).toBe(1);
	});
});

describe("verification window and replay", () => {
	const now = 1_700_000_000_000;
	const secret = generateTotpSecret();

	test("accepts the current step", () => {
		const result = verifyTotpCode(secret, totp(secret, now), { nowMs: now });
		expect(result).toEqual({ ok: true, step: totpStep(now) });
	});

	test("accepts ±1 step of clock drift", () => {
		const oneStep = 30_000;
		expect(verifyTotpCode(secret, totp(secret, now - oneStep), { nowMs: now }).ok).toBe(true);
		expect(verifyTotpCode(secret, totp(secret, now + oneStep), { nowMs: now }).ok).toBe(true);
	});

	test("rejects a code two steps away", () => {
		const twoSteps = 60_000;
		expect(verifyTotpCode(secret, totp(secret, now - twoSteps), { nowMs: now })).toEqual({
			ok: false,
			reason: "mismatch",
		});
		expect(verifyTotpCode(secret, totp(secret, now + twoSteps), { nowMs: now }).ok).toBe(false);
	});

	test("a step at or below the last accepted one is a replay", () => {
		const current = totpStep(now);
		expect(verifyTotpCode(secret, totp(secret, now), { nowMs: now, lastUsedStep: current })).toEqual({
			ok: false,
			reason: "replay",
		});
		expect(verifyTotpCode(secret, totp(secret, now), { nowMs: now, lastUsedStep: current - 1 }).ok).toBe(true);
	});

	test("malformed input never touches the secret", () => {
		expect(verifyTotpCode(secret, "12345", { nowMs: now })).toEqual({ ok: false, reason: "format" });
		expect(verifyTotpCode(secret, "abcdef", { nowMs: now })).toEqual({ ok: false, reason: "format" });
	});
});

describe("otpauth URL", () => {
	test("carries the secret, issuer and fixed parameters", () => {
		const url = new URL(buildOtpauthUrl({ secret: RFC_SECRET_BASE32, issuer: "Zeta", account: "remote" }));
		expect(url.protocol).toBe("otpauth:");
		expect(url.host).toBe("totp");
		expect(url.pathname).toBe("/Zeta:remote");
		expect(url.searchParams.get("secret")).toBe(RFC_SECRET_BASE32);
		expect(url.searchParams.get("issuer")).toBe("Zeta");
		expect(url.searchParams.get("algorithm")).toBe("SHA1");
		expect(url.searchParams.get("digits")).toBe("6");
		expect(url.searchParams.get("period")).toBe("30");
	});
});

describe("recovery codes", () => {
	test("ten Crockford codes in XXXXX-XXXXX form", () => {
		const codes = generateRecoveryCodes();
		expect(codes).toHaveLength(10);
		expect(new Set(codes).size).toBe(10);
		for (const code of codes) expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/u);
	});

	test("normalization folds Crockford aliases and separators", () => {
		expect(normalizeRecoveryCode(" abcd-efghi ")).toBe("ABCDEFGH1");
		expect(normalizeRecoveryCode("o0il1")).toBe("00111");
	});

	test("matches by hash and never stores plaintext", () => {
		const [code] = generateRecoveryCodes(1);
		expect(code).toBeDefined();
		const hashes = [hashRecoveryCode(code ?? "")];
		expect(hashes[0]).toMatch(/^[0-9a-f]{64}$/u);
		expect(matchesRecoveryCode((code ?? "").toLowerCase(), hashes)).toBe(hashes[0]);
		expect(matchesRecoveryCode("AAAAA-AAAAA", hashes)).toBeNull();
	});
});
