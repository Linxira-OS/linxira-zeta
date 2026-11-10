/**
 * Per-device credentials for remote Studio access.
 *
 * One machine-wide `remote.token` (see `utils/remote-token.ts`) is the bootstrap
 * secret a phone gets from the pairing QR, but it cannot be revoked for one
 * phone without locking out every other client. This registry adds the missing
 * layer: a paired device receives its own high-entropy token (`zdt_…`), stored
 * only as a SHA-256 hash, listed by label, and revoked individually.
 *
 * Contract (see `local://qfa-device-auth.md`):
 * - the file lives at `<agentDir>/auth/devices.json`, mode 0600, written
 *   atomically under the shared file lock (`WebConfig` uses the same helper);
 * - a missing file means "no devices yet" — the legacy `remote.token` keeps
 *   working exactly as before, so an upgrade changes no existing behavior;
 * - a corrupt file is treated as empty (fail closed for device tokens, while
 *   loopback and the legacy token keep working, so nobody is locked out);
 * - revoked records are kept as tombstones (capped) and their token can never
 *   resolve again; tokens are never reused;
 * - no token or hash ever leaves this module except the one-time plaintext a
 *   caller returns to the client that just paired.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getAgentDir, logger } from "@linxiraos/pi-utils";
import { withFileLock } from "@linxiraos/pi-utils/file-lock";
import { type } from "@linxiraos/zeta-schema";

/** Prefix that identifies a device token (and keeps it out of legacy-token parsing). */
export const DEVICE_TOKEN_PREFIX = "zdt_";

/** Directory (under the agent dir) that holds auth state. Created 0700. */
export const AUTH_DIR_NAME = "auth";

/** Registry file name under {@link AUTH_DIR_NAME}. */
export const DEVICES_FILE_NAME = "devices.json";

/** Schema version; a bump means a migration is required. */
export const DEVICES_SCHEMA_VERSION = 1;

/** Revoked tombstones kept for the list view; older ones are pruned. */
export const MAX_REVOKED_DEVICES = 50;

/** Persisted `lastSeenAt` granularity: at most one write per device per minute. */
export const TOUCH_INTERVAL_MS = 60_000;

export type DevicePlatform = "android" | "ios" | "web" | "desktop" | "tui" | "unknown";

/** `read` = bootstrap/query/events, `write` = commands + device management. */
export type DeviceScope = "read" | "write";

/** One stored device. `tokenHash` never leaves the module. */
export interface DeviceRecord {
	readonly id: string;
	label: string;
	platform: DevicePlatform;
	machineId?: string;
	scopes: DeviceScope[];
	tokenHash: string;
	createdAt: string;
	lastSeenAt: string | null;
	/** Last successful TOTP step-up (P1); never a code. */
	totpVerifiedAt: string | null;
	revokedAt: string | null;
}

/** Public projection: no token, no hash. */
export interface PublicDevice {
	readonly id: string;
	readonly label: string;
	readonly platform: DevicePlatform;
	readonly scopes: DeviceScope[];
	readonly createdAt: string;
	readonly lastSeenAt: string | null;
	readonly revokedAt: string | null;
}

/** What `GET /api/remote/devices` answers. */
export interface DeviceInventory {
	readonly devices: PublicDevice[];
	/** The device whose token authenticated this request, or null (legacy/local). */
	readonly currentDeviceId: string | null;
	/** Whether the machine-wide `remote.token` is still configured. */
	readonly legacyTokenActive: boolean;
}

/** Input for issuing a device token. Everything but `id` is operator/client supplied. */
export interface IssueDeviceInput {
	label?: string;
	/** Client-supplied; normalized by {@link normalizePlatform}. */
	platform?: string;
	machineId?: string;
	scopes?: DeviceScope[];
}

export interface IssuedDevice {
	readonly device: PublicDevice;
	/** Plaintext token — returned exactly once, never persisted. */
	readonly token: string;
}

interface DeviceFile {
	version: number;
	devices: DeviceRecord[];
}

const EMPTY_FILE: DeviceFile = { version: DEVICES_SCHEMA_VERSION, devices: [] };

const PLATFORMS: Record<DevicePlatform, true> = {
	android: true,
	ios: true,
	web: true,
	desktop: true,
	tui: true,
	unknown: true,
};

const SCOPES: Record<DeviceScope, true> = { read: true, write: true };

/** Default label per platform, used when the client sends none. */
const DEFAULT_LABELS: Record<DevicePlatform, string> = {
	android: "Android device",
	ios: "iOS device",
	web: "Browser",
	desktop: "Desktop app",
	tui: "Terminal",
	unknown: "Device",
};

const LABEL_MAX = 64;

/** Absolute path of the registry for the active profile. */
export function devicesFilePath(): string {
	return path.join(getAgentDir(), AUTH_DIR_NAME, DEVICES_FILE_NAME);
}

/** Mint a fresh token; 256 bits of entropy, prefixed so it is recognisable. */
export function generateDeviceToken(): string {
	return `${DEVICE_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/** SHA-256 of a device token, hex. The token itself is never stored. */
export function hashDeviceToken(token: string): string {
	return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Strip an `Authorization: Bearer …` prefix and surrounding whitespace.
 * Returns `""` for a missing header so callers never compare against null.
 */
export function bearerValue(provided: string | null | undefined): string {
	return (provided ?? "").replace(/^Bearer\s+/iu, "").trim();
}

/** Whether a value looks like a device token (vs the legacy machine token). */
export function looksLikeDeviceToken(value: string): boolean {
	return value.startsWith(DEVICE_TOKEN_PREFIX);
}

/** Normalize a client-supplied platform string; unknown values become `unknown`. */
export function normalizePlatform(value: string | undefined): DevicePlatform {
	const key = (value ?? "").trim().toLowerCase();
	return key in PLATFORMS ? (key as DevicePlatform) : "unknown";
}

/** Infer a platform from a User-Agent; never throws. */
export function inferPlatform(userAgent: string | null | undefined): DevicePlatform {
	const ua = (userAgent ?? "").toLowerCase();
	if (ua === "") return "unknown";
	if (ua.includes("android")) return "android";
	if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ios")) return "ios";
	if (ua.includes("electron")) return "desktop";
	if (ua.includes("mozilla") || ua.includes("safari") || ua.includes("chrome")) return "web";
	return "unknown";
}

/**
 * Normalize an operator/client label: strip control characters, collapse
 * whitespace, cap the length, and fall back to the platform default.
 */
export function normalizeLabel(label: string | undefined, platform: DevicePlatform): string {
	const cleaned = (label ?? "")
		// Control characters would break logs and the list view.
		.replace(/[\u0000-\u001f\u007f]/gu, " ")
		.replace(/\s+/gu, " ")
		.trim()
		.slice(0, LABEL_MAX);
	return cleaned === "" ? DEFAULT_LABELS[platform] : cleaned;
}

/** Public projection of one record. */
export function publicDevice(record: DeviceRecord): PublicDevice {
	return {
		id: record.id,
		label: record.label,
		platform: record.platform,
		scopes: [...record.scopes],
		createdAt: record.createdAt,
		lastSeenAt: record.lastSeenAt,
		revokedAt: record.revokedAt,
	};
}

/**
 * Persisted record schema. Parsed per entry so one corrupt row drops out
 * instead of disabling the whole registry.
 */
const deviceRecordSchema = type({
	id: "string > 0",
	"label?": "string",
	"platform?": "string",
	"machineId?": "string",
	"scopes?": "string[]",
	tokenHash: "string",
	"createdAt?": "string",
	"lastSeenAt?": "string | null",
	"totpVerifiedAt?": "string | null",
	"revokedAt?": "string | null",
});

const deviceFileSchema = type({
	"version?": "number",
	devices: "unknown[]",
});

/** Defensive parse of one stored record; `null` for anything malformed. */
function parseRecord(raw: unknown): DeviceRecord | null {
	const parsed = deviceRecordSchema(raw);
	if (parsed instanceof type.errors) return null;
	const tokenHash = parsed.tokenHash.trim();
	if (!/^[0-9a-f]{64}$/u.test(tokenHash)) return null;
	const platform: DevicePlatform =
		parsed.platform !== undefined && parsed.platform in PLATFORMS ? (parsed.platform as DevicePlatform) : "unknown";
	const scopes = (parsed.scopes ?? []).filter((scope): scope is DeviceScope => scope in SCOPES);
	return {
		id: parsed.id.trim(),
		label: normalizeLabel(parsed.label, platform),
		platform,
		...(parsed.machineId !== undefined && parsed.machineId.trim() !== ""
			? { machineId: parsed.machineId.trim() }
			: {}),
		scopes: scopes.length > 0 ? [...new Set(scopes)] : ["read", "write"],
		tokenHash,
		createdAt: parsed.createdAt ?? new Date(0).toISOString(),
		lastSeenAt: parsed.lastSeenAt ?? null,
		totpVerifiedAt: parsed.totpVerifiedAt ?? null,
		revokedAt: parsed.revokedAt ?? null,
	};
}

function parseFile(raw: unknown): DeviceFile {
	const parsed = deviceFileSchema(raw);
	if (parsed instanceof type.errors) return { version: DEVICES_SCHEMA_VERSION, devices: [] };
	const devices: DeviceRecord[] = [];
	for (const entry of parsed.devices) {
		const record = parseRecord(entry);
		// Duplicate ids are impossible to disambiguate: keep the first.
		if (record !== null && !devices.some(existing => existing.id === record.id)) devices.push(record);
	}
	return { version: DEVICES_SCHEMA_VERSION, devices };
}

/** Keep every active record and only the newest {@link MAX_REVOKED_DEVICES} tombstones. */
function prune(devices: DeviceRecord[]): DeviceRecord[] {
	const active = devices.filter(record => record.revokedAt === null);
	const revoked = devices
		.filter(record => record.revokedAt !== null)
		.sort((a, b) => (a.revokedAt ?? "").localeCompare(b.revokedAt ?? ""));
	const keep = revoked.slice(Math.max(0, revoked.length - MAX_REVOKED_DEVICES));
	return [...active, ...keep];
}

/**
 * The device registry for one file. Instances are cheap; the module-level
 * {@link deviceRegistry} is what request handlers use.
 */
export class DeviceRegistry {
	readonly #filePath: string;
	/** In-memory throttle for `lastSeenAt` writes, keyed by device id. */
	readonly #touchedAt = new Map<string, number>();
	/**
	 * Damage kinds already reported for this file. `read()` runs on every remote
	 * request, so an unrepaired file must not warn once per request.
	 */
	readonly #warned = new Set<"read" | "parse">();

	constructor(filePath: string = devicesFilePath()) {
		this.#filePath = filePath;
	}

	get filePath(): string {
		return this.#filePath;
	}

	/** Read the registry; a missing or corrupt file yields an empty one. */
	async read(): Promise<DeviceFile> {
		let text: string;
		try {
			text = await fs.readFile(this.#filePath, "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !this.#warned.has("read")) {
				this.#warned.add("read");
				logger.warn("Failed to read device registry; treating it as empty", {
					filePath: this.#filePath,
					error: error instanceof Error ? error.message : String(error),
				});
			}
			return { ...EMPTY_FILE, devices: [] };
		}
		try {
			return parseFile(JSON.parse(text) as unknown);
		} catch (error) {
			// Fail closed for device tokens, but never for loopback / legacy token:
			// the operator must always be able to re-pair from the machine itself.
			if (!this.#warned.has("parse")) {
				this.#warned.add("parse");
				logger.warn("Ignoring malformed device registry; device tokens are suspended until it is repaired", {
					filePath: this.#filePath,
					error: error instanceof Error ? error.message : String(error),
				});
			}
			return { ...EMPTY_FILE, devices: [] };
		}
	}

	/** Every record (active and revoked), in file order. */
	async records(): Promise<DeviceRecord[]> {
		return (await this.read()).devices;
	}

	/** Public list, active first then most-recently revoked. */
	async list(): Promise<PublicDevice[]> {
		const devices = await this.records();
		const active = devices.filter(record => record.revokedAt === null);
		const revoked = devices
			.filter(record => record.revokedAt !== null)
			.sort((a, b) => (b.revokedAt ?? "").localeCompare(a.revokedAt ?? ""));
		return [...active, ...revoked].map(publicDevice);
	}

	/** One record by id (including revoked). */
	async get(id: string): Promise<DeviceRecord | undefined> {
		return (await this.records()).find(record => record.id === id);
	}

	/**
	 * Issue a new device token. Returns the plaintext token once; the file keeps
	 * only its hash. A failed write propagates — a caller must never hand out a
	 * token the registry did not record (it would be unrevocable).
	 */
	async issue(input: IssueDeviceInput = {}, now: Date = new Date()): Promise<IssuedDevice> {
		const platform = normalizePlatform(input.platform);
		const token = generateDeviceToken();
		const id = `dev_${randomBytes(16).toString("base64url")}`;
		const record: DeviceRecord = {
			id,
			label: normalizeLabel(input.label, platform),
			platform,
			...(input.machineId !== undefined && input.machineId.trim() !== ""
				? { machineId: input.machineId.trim() }
				: {}),
			scopes:
				input.scopes !== undefined && input.scopes.length > 0
					? [...new Set(input.scopes.filter(scope => scope in SCOPES))]
					: ["read", "write"],
			tokenHash: hashDeviceToken(token),
			createdAt: now.toISOString(),
			lastSeenAt: now.toISOString(),
			totpVerifiedAt: null,
			revokedAt: null,
		};
		await this.#mutate(file => {
			file.devices = prune([...file.devices, record]);
			return true;
		});
		// The record was just written, so the first resolve inside the throttle
		// window must not rewrite it.
		this.#touchedAt.set(id, now.getTime());
		return { device: publicDevice(record), token };
	}

	/**
	 * Resolve a presented token to an active record. Compares against every
	 * stored hash (constant work regardless of which record matches) and never
	 * resolves a revoked device.
	 */
	async findByToken(token: string): Promise<DeviceRecord | undefined> {
		const candidate = bearerValue(token);
		if (!looksLikeDeviceToken(candidate)) return undefined;
		const digest = Buffer.from(hashDeviceToken(candidate), "utf8");
		let match: DeviceRecord | undefined;
		for (const record of (await this.read()).devices) {
			const stored = Buffer.from(record.tokenHash, "utf8");
			if (stored.length === digest.length && timingSafeEqual(stored, digest) && record.revokedAt === null) {
				match = record;
			}
		}
		return match;
	}

	/** {@link findByToken} plus a throttled `lastSeenAt` write. */
	async resolve(token: string, now: Date = new Date()): Promise<DeviceRecord | undefined> {
		const record = await this.findByToken(token);
		if (record === undefined) return undefined;
		const last = this.#touchedAt.get(record.id) ?? 0;
		if (now.getTime() - last < TOUCH_INTERVAL_MS) return record;
		this.#touchedAt.set(record.id, now.getTime());
		const seenAt = now.toISOString();
		try {
			await this.#mutate(file => {
				const target = file.devices.find(entry => entry.id === record.id);
				if (target === undefined || target.revokedAt !== null) return false;
				target.lastSeenAt = seenAt;
				return true;
			});
		} catch (error) {
			// A failed touch must not fail the authenticated request.
			logger.warn("Could not persist device lastSeenAt", {
				deviceId: record.id,
				error: error instanceof Error ? error.message : String(error),
			});
		}
		return { ...record, lastSeenAt: seenAt };
	}

	/**
	 * Revoke one device. Idempotent: revoking an already-revoked (or unknown)
	 * id answers `found: false` without inventing a tombstone.
	 */
	async revoke(
		id: string,
		now: Date = new Date(),
	): Promise<{ found: boolean; revoked: boolean; device?: PublicDevice }> {
		let result: { found: boolean; revoked: boolean; device?: PublicDevice } = { found: false, revoked: false };
		const revokedAt = now.toISOString();
		await this.#mutate(file => {
			const target = file.devices.find(entry => entry.id === id);
			if (target === undefined) return false;
			result = { found: true, revoked: false, device: publicDevice(target) };
			if (target.revokedAt !== null) return false;
			target.revokedAt = revokedAt;
			result = { found: true, revoked: true, device: publicDevice(target) };
			file.devices = prune(file.devices);
			return true;
		});
		return result;
	}

	/**
	 * Revoke every active device. `keepId` exempts one (the caller's own, when
	 * the operator asked to keep this session); the legacy `remote.token` is
	 * not touched by this operation.
	 */
	async revokeAll(
		options: { keepId?: string } = {},
		now: Date = new Date(),
	): Promise<{ revoked: number; ids: string[] }> {
		const revokedAt = now.toISOString();
		const ids: string[] = [];
		await this.#mutate(file => {
			for (const record of file.devices) {
				if (record.revokedAt !== null) continue;
				if (options.keepId !== undefined && record.id === options.keepId) continue;
				record.revokedAt = revokedAt;
				ids.push(record.id);
			}
			if (ids.length === 0) return false;
			file.devices = prune(file.devices);
			return true;
		});
		return { revoked: ids.length, ids };
	}

	/** Count of active devices (used by rotation warnings and tests). */
	async activeCount(): Promise<number> {
		return (await this.records()).filter(record => record.revokedAt === null).length;
	}

	/** Test hook: forget the in-memory touch throttle. */
	resetTouchThrottle(): void {
		this.#touchedAt.clear();
	}

	/** Read-modify-write under the shared file lock; writes only when asked. */
	async #mutate(mutation: (file: DeviceFile) => boolean): Promise<void> {
		await withFileLock(this.#filePath, async () => {
			const file = await this.#readForWrite();
			if (!mutation(file)) return;
			await this.#write(file);
		});
	}

	async #readForWrite(): Promise<DeviceFile> {
		// Under the lock the file cannot change between read and write; a corrupt
		// file is replaced by an empty one on the next successful mutation.
		return this.read();
	}

	async #write(file: DeviceFile): Promise<void> {
		const dir = path.dirname(this.#filePath);
		await fs.mkdir(dir, { recursive: true, mode: 0o700 });
		const tempPath = `${this.#filePath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
		let removeTemp = false;
		try {
			const handle = await fs.open(tempPath, "wx", 0o600);
			removeTemp = true;
			try {
				await handle.writeFile(
					JSON.stringify({ version: DEVICES_SCHEMA_VERSION, devices: file.devices }, null, 2),
					"utf8",
				);
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

let shared: DeviceRegistry | undefined;

/** The process-wide registry for the active profile's agent dir. */
export function deviceRegistry(): DeviceRegistry {
	shared ??= new DeviceRegistry();
	return shared;
}

/** Test hook: point request handlers at a temp file (or restore with `undefined`). */
export function setDeviceRegistryForTest(next: DeviceRegistry | undefined): void {
	shared = next;
}
