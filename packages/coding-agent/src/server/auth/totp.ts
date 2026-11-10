/**
 * RFC 6238 TOTP, the verifier behind account/device two-factor auth.
 *
 * Deliberately dependency-free and pure: no file I/O, no clock, no logging.
 * The store (`two-factor-store.ts`) owns persistence and replay state; this
 * module only turns (secret, time) into a code and checks a presented code
 * against that secret.
 *
 * Parameters are fixed by the contract: HMAC-SHA1, 6 digits, 30-second step,
 * 20-byte base32 secrets, ±1 step of clock tolerance.
 *
 * 2FA protects *account/device* access only. IM channel credentials are not
 * two-factor and never pass through here.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Digits in every code. */
export const TOTP_DIGITS = 6;

/** Step length in seconds. */
export const TOTP_PERIOD_SECONDS = 30;

/** Accepted clock drift: one step before and after the current one. */
export const TOTP_WINDOW = 1;

/** Secret size in bytes (160 bits, the RFC 4226 recommendation). */
export const TOTP_SECRET_BYTES = 20;

/** Recovery codes minted at a time. */
export const RECOVERY_CODE_COUNT = 10;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Crockford base32: no I, L, O, U, so a printed code cannot be misread. */
const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** RFC 4648 base32 without padding (what authenticator apps accept). */
export function base32Encode(data: Uint8Array): string {
	let bits = 0;
	let value = 0;
	let output = "";
	for (const byte of data) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}
	if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
	return output;
}

/** Decode base32; tolerates lowercase, spaces and `=` padding. Throws on garbage. */
export function base32Decode(input: string): Buffer {
	const normalized = input.toUpperCase().replace(/[\s=]/gu, "");
	let bits = 0;
	let value = 0;
	const bytes: number[] = [];
	for (const char of normalized) {
		const index = BASE32_ALPHABET.indexOf(char);
		if (index < 0) throw new Error("invalid_base32");
		value = (value << 5) | index;
		bits += 5;
		if (bits >= 8) {
			bytes.push((value >>> (bits - 8)) & 0xff);
			bits -= 8;
		}
	}
	return Buffer.from(bytes);
}

/** A fresh 160-bit secret in base32, the only form ever persisted. */
export function generateTotpSecret(): string {
	return base32Encode(randomBytes(TOTP_SECRET_BYTES));
}

/** Counter (step number) for an epoch-millisecond timestamp. */
export function totpStep(nowMs: number = Date.now(), periodSeconds: number = TOTP_PERIOD_SECONDS): number {
	return Math.floor(nowMs / 1000 / periodSeconds);
}

/** RFC 4226 HOTP over an arbitrary counter. */
export function hotp(secret: Buffer, counter: number, digits: number = TOTP_DIGITS): string {
	const message = Buffer.alloc(8);
	message.writeBigUInt64BE(BigInt(counter));
	const digest = createHmac("sha1", secret).update(message).digest();
	const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
	const binary =
		(((digest[offset] ?? 0) & 0x7f) << 24) |
		(((digest[offset + 1] ?? 0) & 0xff) << 16) |
		(((digest[offset + 2] ?? 0) & 0xff) << 8) |
		((digest[offset + 3] ?? 0) & 0xff);
	return String(binary % 10 ** digits).padStart(digits, "0");
}

/** The code for one timestamp. */
export function totp(secretBase32: string, nowMs: number = Date.now(), digits: number = TOTP_DIGITS): string {
	return hotp(base32Decode(secretBase32), totpStep(nowMs), digits);
}

/** Outcome of checking a presented code. */
export type TotpCheck = { ok: true; step: number } | { ok: false; reason: "format" | "mismatch" | "replay" };

/**
 * Check a 6-digit code against a secret.
 *
 * `lastUsedStep` makes replay impossible: a code whose step is not strictly
 * greater than the last accepted one is rejected, even inside the tolerance
 * window. That is why the store persists the step instead of a boolean.
 */
export function verifyTotpCode(
	secretBase32: string,
	code: string,
	options: { nowMs?: number; lastUsedStep?: number; window?: number } = {},
): TotpCheck {
	const normalized = code.trim();
	if (!/^\d{6}$/u.test(normalized)) return { ok: false, reason: "format" };
	let secret: Buffer;
	try {
		secret = base32Decode(secretBase32);
	} catch {
		return { ok: false, reason: "mismatch" };
	}
	if (secret.length === 0) return { ok: false, reason: "mismatch" };

	const current = totpStep(options.nowMs ?? Date.now());
	const tolerance = options.window ?? TOTP_WINDOW;
	const lastUsedStep = options.lastUsedStep ?? 0;
	const presented = Buffer.from(normalized, "utf8");
	for (let delta = -tolerance; delta <= tolerance; delta += 1) {
		const step = current + delta;
		if (step < 0) continue;
		const expected = Buffer.from(hotp(secret, step), "utf8");
		if (expected.length !== presented.length || !timingSafeEqual(expected, presented)) continue;
		// A match below or at the stored step was already burned. Keep scanning:
		// another offset cannot match with an honest code, but this keeps the
		// failure reason precise instead of depending on iteration order.
		if (step <= lastUsedStep) return { ok: false, reason: "replay" };
		return { ok: true, step };
	}
	return { ok: false, reason: "mismatch" };
}

/** Build the `otpauth://` URI an authenticator app imports. */
export function buildOtpauthUrl(input: { secret: string; issuer: string; account: string }): string {
	const issuer = input.issuer.trim() === "" ? "Zeta" : input.issuer.trim();
	const account = input.account.trim() === "" ? "remote" : input.account.trim();
	const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
	const params = new URLSearchParams({
		secret: input.secret,
		issuer,
		algorithm: "SHA1",
		digits: String(TOTP_DIGITS),
		period: String(TOTP_PERIOD_SECONDS),
	});
	return `otpauth://totp/${label}?${params.toString()}`;
}

/**
 * Ten one-time recovery codes, `XXXXX-XXXXX`, Crockford base32. Only hashes
 * are persisted; the plaintext exists in this return value and one response.
 */
export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
	const codes: string[] = [];
	for (let index = 0; index < count; index += 1) {
		const raw = randomBytes(10);
		let body = "";
		for (const byte of raw) body += CROCKFORD_ALPHABET[byte % 32];
		codes.push(`${body.slice(0, 5)}-${body.slice(5, 10)}`);
	}
	return codes;
}

/**
 * Normalize a typed recovery code: uppercase, drop separators, and fold the
 * characters Crockford treats as aliases (`O`→`0`, `I`/`L`→`1`).
 */
export function normalizeRecoveryCode(input: string): string {
	return input
		.toUpperCase()
		.replace(/[^0-9A-Z]/gu, "")
		.replace(/O/gu, "0")
		.replace(/[IL]/gu, "1");
}

/** SHA-256 of a normalized recovery code, hex. Never store the code itself. */
export function hashRecoveryCode(code: string): string {
	return createHash("sha256").update(normalizeRecoveryCode(code), "utf8").digest("hex");
}

/** Constant-time comparison of a presented recovery code against stored hashes. */
export function matchesRecoveryCode(presented: string, storedHashes: readonly string[]): string | null {
	const digest = Buffer.from(hashRecoveryCode(presented), "utf8");
	for (const stored of storedHashes) {
		const candidate = Buffer.from(stored, "utf8");
		if (candidate.length === digest.length && timingSafeEqual(candidate, digest)) return stored;
	}
	return null;
}
