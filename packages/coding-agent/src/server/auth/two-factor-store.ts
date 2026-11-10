/**
 * Persistence for account/device two-factor auth: `<agentDir>/auth/totp.json`.
 *
 * The file is the single source of truth for the TOTP secret, the pending
 * enrollment, the recovery-code hashes and the replay counter. It is created
 * `0600` inside a `0700` directory and written atomically (temp `wx` → fsync →
 * rename) under the shared file lock, the same pattern as `devices.json` and
 * `WebConfig`.
 *
 * Secret protection: there is no OS keychain integration in this codebase, so
 * the base32 secret is stored in the file protected only by filesystem
 * permissions. Anyone who can read the agent dir as this user can compute
 * codes; 2FA still defends against a stolen device token or remote token, not
 * against a compromised local account. This limitation is documented in
 * `docs/zeta-serve-web.md`.
 *
 * Recovery codes are stored as SHA-256 hashes and consumed one at a time.
 *
 * Failure policy: a missing file means "2FA off". A corrupt file is treated as
 * off too — the operator is never locked out, and a local caller can enroll
 * again. (A corrupt file therefore cannot *silently* disable 2FA on a running
 * process beyond the next read; the honest recovery path is loopback.)
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getAgentDir, logger } from "@linxiraos/pi-utils";
import { withFileLock } from "@linxiraos/pi-utils/file-lock";
import {
	buildOtpauthUrl,
	generateRecoveryCodes,
	generateTotpSecret,
	hashRecoveryCode,
	matchesRecoveryCode,
	verifyTotpCode,
} from "./totp";

/** Schema version; a bump means a migration is required. */
export const TOTP_SCHEMA_VERSION = 1;

/** How long an unconfirmed enrollment stays usable. */
export const PENDING_ENROLLMENT_TTL_MS = 10 * 60 * 1000;

/** Issuer shown by authenticator apps. */
export const TOTP_ISSUER = "Zeta";

/** Account label shown next to the issuer. */
export const TOTP_ACCOUNT = "remote";

export interface PendingEnrollment {
	secret: string;
	createdAt: string;
	recoveryCodeHashes: string[];
}

export interface TwoFactorFile {
	version: number;
	/** Active secret (base32), or null while 2FA is not enrolled. */
	secret: string | null;
	enrolledAt: string | null;
	/** Whether write requests must be step-up verified. */
	required: boolean;
	/** Highest TOTP step ever accepted; enforces strictly-increasing steps. */
	lastUsedStep: number;
	recoveryCodeHashes: string[];
	pending: PendingEnrollment | null;
}

/** Public status; never includes the secret or recovery hashes. */
export interface TwoFactorStatus {
	enrolled: boolean;
	required: boolean;
	enrolledAt: string | null;
	recoveryCodesRemaining: number;
	/** A confirmable enrollment exists right now. */
	pending: boolean;
}

export interface EnrollmentResult {
	secret: string;
	otpauthUrl: string;
	recoveryCodes: string[];
	/** When the pending secret stops being confirmable. */
	expiresAt: string;
}

export type ConfirmResult =
	| { ok: true; enrolledAt: string }
	| { ok: false; reason: "no_pending" | "expired" | "invalid_code" };

export type CodeResult = { ok: true; step: number } | { ok: false; reason: "format" | "mismatch" | "replay" };

const EMPTY_FILE: TwoFactorFile = {
	version: TOTP_SCHEMA_VERSION,
	secret: null,
	enrolledAt: null,
	required: false,
	lastUsedStep: 0,
	recoveryCodeHashes: [],
	pending: null,
};

const BASE32_RE = /^[A-Z2-7]+$/u;
const HASH_RE = /^[0-9a-f]{64}$/u;

/** Absolute path of the 2FA store for the active profile. */
export function twoFactorFilePath(): string {
	return path.join(getAgentDir(), "auth", "totp.json");
}

function isHashList(value: unknown): value is string[] {
	return Array.isArray(value) && value.every(entry => typeof entry === "string" && HASH_RE.test(entry));
}

/** Defensive parse: anything malformed yields the empty (2FA off) file. */
function parseFile(raw: unknown): TwoFactorFile {
	if (raw === null || typeof raw !== "object") return { ...EMPTY_FILE };
	const source = raw as Record<string, unknown>;
	const secret =
		typeof source.secret === "string" && BASE32_RE.test(source.secret.toUpperCase())
			? source.secret.toUpperCase()
			: null;
	const enrolledAt = typeof source.enrolledAt === "string" && source.enrolledAt !== "" ? source.enrolledAt : null;
	const required = source.required === true && secret !== null && enrolledAt !== null;
	const lastUsedStep =
		typeof source.lastUsedStep === "number" && Number.isSafeInteger(source.lastUsedStep) && source.lastUsedStep >= 0
			? source.lastUsedStep
			: 0;
	const recoveryCodeHashes = isHashList(source.recoveryCodeHashes) ? [...source.recoveryCodeHashes] : [];

	let pending: PendingEnrollment | null = null;
	if (source.pending !== null && typeof source.pending === "object") {
		const candidate = source.pending as Record<string, unknown>;
		if (
			typeof candidate.secret === "string" &&
			BASE32_RE.test(candidate.secret.toUpperCase()) &&
			typeof candidate.createdAt === "string" &&
			!Number.isNaN(Date.parse(candidate.createdAt)) &&
			isHashList(candidate.recoveryCodeHashes)
		) {
			pending = {
				secret: candidate.secret.toUpperCase(),
				createdAt: candidate.createdAt,
				recoveryCodeHashes: [...candidate.recoveryCodeHashes],
			};
		}
	}

	return {
		version: TOTP_SCHEMA_VERSION,
		secret,
		enrolledAt: secret === null ? null : enrolledAt,
		required,
		lastUsedStep,
		recoveryCodeHashes: secret === null ? [] : recoveryCodeHashes,
		pending,
	};
}

/**
 * One 2FA store. Instances are cheap; request handlers use the module-level
 * {@link twoFactorStore}.
 */
export class TwoFactorStore {
	readonly #filePath: string;
	/** Warn once per process per damage kind: reads happen on every request. */
	readonly #warned = new Set<"read" | "parse">();

	constructor(filePath: string = twoFactorFilePath()) {
		this.#filePath = filePath;
	}

	get filePath(): string {
		return this.#filePath;
	}

	async read(): Promise<TwoFactorFile> {
		let text: string;
		try {
			text = await fs.readFile(this.#filePath, "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !this.#warned.has("read")) {
				this.#warned.add("read");
				logger.warn("Failed to read 2FA store; treating 2FA as disabled", {
					filePath: this.#filePath,
					error: error instanceof Error ? error.message : String(error),
				});
			}
			return { ...EMPTY_FILE };
		}
		try {
			return parseFile(JSON.parse(text) as unknown);
		} catch (error) {
			if (!this.#warned.has("parse")) {
				this.#warned.add("parse");
				logger.warn("Ignoring malformed 2FA store; two-factor is disabled until re-enrolled", {
					filePath: this.#filePath,
					error: error instanceof Error ? error.message : String(error),
				});
			}
			return { ...EMPTY_FILE };
		}
	}

	async status(now: Date = new Date()): Promise<TwoFactorStatus> {
		const file = await this.read();
		return {
			enrolled: file.secret !== null && file.enrolledAt !== null,
			required: file.required,
			enrolledAt: file.enrolledAt,
			recoveryCodesRemaining: file.recoveryCodeHashes.length,
			pending: file.pending !== null && !isExpired(file.pending, now),
		};
	}

	async isRequired(): Promise<boolean> {
		return (await this.read()).required;
	}

	/**
	 * Start (or restart) enrollment. Mints a fresh secret and recovery codes,
	 * stores only their hashes, and returns the plaintext exactly once. The
	 * active secret keeps working until {@link confirm} activates the pending
	 * one, so re-enrolling from a local session cannot lock anyone out.
	 */
	async enroll(now: Date = new Date()): Promise<EnrollmentResult> {
		const secret = generateTotpSecret();
		const recoveryCodes = generateRecoveryCodes();
		const pending: PendingEnrollment = {
			secret,
			createdAt: now.toISOString(),
			recoveryCodeHashes: recoveryCodes.map(hashRecoveryCode),
		};
		await this.#mutate(file => {
			file.pending = pending;
			return true;
		});
		return {
			secret,
			otpauthUrl: buildOtpauthUrl({ secret, issuer: TOTP_ISSUER, account: TOTP_ACCOUNT }),
			recoveryCodes,
			expiresAt: new Date(now.getTime() + PENDING_ENROLLMENT_TTL_MS).toISOString(),
		};
	}

	/**
	 * Activate the pending secret after the operator proved possession of the
	 * code. The replay counter resets because the secret changed; the confirm
	 * code is deliberately not consumed, so the same person can immediately
	 * use the current code for a step-up.
	 */
	async confirm(code: string, now: Date = new Date()): Promise<ConfirmResult> {
		let result: ConfirmResult = { ok: false, reason: "no_pending" };
		await this.#mutate(file => {
			if (file.pending === null) {
				result = { ok: false, reason: "no_pending" };
				return false;
			}
			if (isExpired(file.pending, now)) {
				file.pending = null;
				result = { ok: false, reason: "expired" };
				return true;
			}
			const check = verifyTotpCode(file.pending.secret, code, { nowMs: now.getTime(), lastUsedStep: 0 });
			if (!check.ok) {
				result = { ok: false, reason: "invalid_code" };
				return false;
			}
			file.secret = file.pending.secret;
			file.enrolledAt = now.toISOString();
			file.lastUsedStep = 0;
			file.recoveryCodeHashes = [...file.pending.recoveryCodeHashes];
			file.pending = null;
			result = { ok: true, enrolledAt: now.toISOString() };
			return true;
		});
		return result;
	}

	/**
	 * Verify a TOTP code. Success persists the matched step, so the same code
	 * cannot be replayed even while the ±1 window still accepts its neighbours.
	 */
	async verifyCode(code: string, now: Date = new Date()): Promise<CodeResult> {
		let result: CodeResult = { ok: false, reason: "mismatch" };
		await this.#mutate(file => {
			if (file.secret === null) {
				result = { ok: false, reason: "mismatch" };
				return false;
			}
			const check = verifyTotpCode(file.secret, code, {
				nowMs: now.getTime(),
				lastUsedStep: file.lastUsedStep,
			});
			if (!check.ok) {
				result = check;
				return false;
			}
			file.lastUsedStep = check.step;
			result = check;
			return true;
		});
		return result;
	}

	/**
	 * Consume one recovery code. Returns `true` only for a code that was stored;
	 * the hash is removed in the same write, so a second use cannot succeed.
	 */
	async consumeRecoveryCode(code: string): Promise<boolean> {
		let consumed = false;
		await this.#mutate(file => {
			if (file.secret === null || file.recoveryCodeHashes.length === 0) return false;
			const matched = matchesRecoveryCode(code, file.recoveryCodeHashes);
			if (matched === null) return false;
			file.recoveryCodeHashes = file.recoveryCodeHashes.filter(hash_ => hash_ !== matched);
			consumed = true;
			return true;
		});
		return consumed;
	}

	/** Turn 2FA off and erase the secret, pending enrollment and recovery codes. */
	async disable(): Promise<void> {
		await this.#mutate(file => {
			const changed =
				file.secret !== null ||
				file.pending !== null ||
				file.required ||
				file.recoveryCodeHashes.length > 0 ||
				file.lastUsedStep !== 0;
			file.secret = null;
			file.enrolledAt = null;
			file.required = false;
			file.lastUsedStep = 0;
			file.recoveryCodeHashes = [];
			file.pending = null;
			return changed;
		});
	}

	/**
	 * Toggle the write gate. Enabling without enrollment is refused — there is
	 * no code anyone could present, so it would be a lockout with extra steps.
	 */
	async setRequired(required: boolean): Promise<{ ok: true } | { ok: false; reason: "not_enrolled" }> {
		let result: { ok: true } | { ok: false; reason: "not_enrolled" } = { ok: true };
		await this.#mutate(file => {
			if (required && (file.secret === null || file.enrolledAt === null)) {
				result = { ok: false, reason: "not_enrolled" };
				return false;
			}
			if (file.required === required) return false;
			file.required = required;
			return true;
		});
		return result;
	}

	/** Replace every recovery code; the old hashes are discarded in one write. */
	async regenerateRecoveryCodes(): Promise<
		{ ok: true; recoveryCodes: string[] } | { ok: false; reason: "not_enrolled" }
	> {
		let result: { ok: true; recoveryCodes: string[] } | { ok: false; reason: "not_enrolled" } = {
			ok: false,
			reason: "not_enrolled",
		};
		const codes = generateRecoveryCodes();
		await this.#mutate(file => {
			if (file.secret === null || file.enrolledAt === null) return false;
			file.recoveryCodeHashes = codes.map(hashRecoveryCode);
			result = { ok: true, recoveryCodes: codes };
			return true;
		});
		return result;
	}

	async #mutate(mutation: (file: TwoFactorFile) => boolean): Promise<void> {
		await withFileLock(this.#filePath, async () => {
			const file = await this.read();
			if (!mutation(file)) return;
			await this.#write(file);
		});
	}

	async #write(file: TwoFactorFile): Promise<void> {
		const dir = path.dirname(this.#filePath);
		await fs.mkdir(dir, { recursive: true, mode: 0o700 });
		const tempPath = `${this.#filePath}.${process.pid}.${Date.now().toString(36)}.tmp`;
		let removeTemp = false;
		try {
			const handle = await fs.open(tempPath, "wx", 0o600);
			removeTemp = true;
			try {
				await handle.writeFile(JSON.stringify(file, null, 2), "utf8");
				await handle.sync();
			} finally {
				await handle.close();
			}
			await fs.rename(tempPath, this.#filePath);
			removeTemp = false;
		} finally {
			if (removeTemp) await fs.rm(tempPath, { force: true }).catch(() => {});
		}
	}
}

function isExpired(pending: PendingEnrollment, now: Date): boolean {
	const created = Date.parse(pending.createdAt);
	return Number.isNaN(created) || now.getTime() - created > PENDING_ENROLLMENT_TTL_MS;
}

let shared: TwoFactorStore | undefined;

/** The process-wide 2FA store for the active profile's agent dir. */
export function twoFactorStore(): TwoFactorStore {
	shared ??= new TwoFactorStore();
	return shared;
}

/** Test hook: point handlers at a temp file (or restore with `undefined`). */
export function setTwoFactorStoreForTest(next: TwoFactorStore | undefined): void {
	shared = next;
}
