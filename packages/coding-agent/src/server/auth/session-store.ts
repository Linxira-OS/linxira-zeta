/**
 * Device-bound browser sessions for remote Studio access.
 *
 * A remote browser/WebView cannot attach an `Authorization` header to a
 * WebSocket, and asking page JS to hold the machine token means every XSS is a
 * full compromise. Instead, pairing exchanges a one-time code (or a bootstrap
 * token) for an `HttpOnly` session that is bound to one device record:
 * revoking the device deletes the session, and the cookie carries no secret a
 * page script can read.
 *
 * Persistence: `<agentDir>/auth/sessions.json`, directory `0700`, file `0600`,
 * atomic write under the shared file lock. Only `sha256(sessionId)` is stored,
 * exactly like device tokens. A missing file means "no sessions"; a corrupt
 * file means the same (fail closed) and warns once — the operator re-pairs from
 * the machine, which is always reachable through loopback.
 */

import { createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getAgentDir, logger } from "@linxiraos/pi-utils";
import { withFileLock } from "@linxiraos/pi-utils/file-lock";
import { type } from "@linxiraos/zeta-schema";
import { parseBinding, type DeviceBinding } from "./binding";

/** Schema version; a bump means a migration is required. */
export const SESSIONS_SCHEMA_VERSION = 1;

/**
 * Lifetime of one session, unchanged from the in-memory implementation it
 * replaces (one hour). Persistence exists so a restart does not force every
 * remote client to re-pair, not to lengthen the credential; access slides the
 * window (see {@link SessionStore.touch}), so a session in continuous use stays
 * alive while an idle one expires on the same one-hour clock.
 */
export const SESSION_TTL_MS = 3_600_000;

/** Persisted `lastSeenAt`/expiry granularity: at most one write per minute. */
export const SESSION_TOUCH_INTERVAL_MS = 60_000;

/** Directory (under the agent dir) holding auth state. */
const AUTH_DIR_NAME = "auth";
const SESSIONS_FILE_NAME = "sessions.json";

/** One persisted session. `idHash` is `sha256(sessionId)`; the id is never stored. */
export interface SessionRecord {
	idHash: string;
	deviceId: string;
	csrf: string;
	/** Optional binding scope copied from the device record at pair time. */
	binding?: DeviceBinding;
	createdAt: number;
	expiresAt: number;
	lastSeenAt: number;
}

/** A live session as the host uses it (id is only known to the caller). */
export interface LiveSession {
	readonly id: string;
	readonly deviceId: string;
	readonly csrf: string;
	readonly binding?: DeviceBinding;
	readonly expiresAt: number;
}

interface SessionFile {
	version: number;
	sessions: SessionRecord[];
}

/** Absolute path of the session store for the active profile. */
export function sessionsFilePath(): string {
	return path.join(getAgentDir(), AUTH_DIR_NAME, SESSIONS_FILE_NAME);
}

/** Stable hash of a session id; the id itself never touches disk. */
export function hashSessionId(sessionId: string): string {
	return createHash("sha256").update(sessionId, "utf8").digest("hex");
}

const sessionRecordSchema = type({
	idHash: "string",
	deviceId: "string",
	csrf: "string",
	"binding?": { "sessionId?": "string", "workspaceId?": "string" },
	createdAt: "number",
	expiresAt: "number",
	lastSeenAt: "number",
});

const sessionFileSchema = type({ "version?": "number", sessions: "unknown[]" });

function parseRecord(raw: unknown): SessionRecord | null {
	const parsed = sessionRecordSchema(raw);
	if (parsed instanceof type.errors) return null;
	if (!/^[0-9a-f]{64}$/u.test(parsed.idHash) || parsed.deviceId.trim() === "") return null;
	return {
		idHash: parsed.idHash,
		deviceId: parsed.deviceId,
		csrf: parsed.csrf,
		...(() => {
			// A malformed persisted binding invalidates the session: dropping it
			// forces a re-pair instead of silently widening the scope.
			const binding = parseBinding(parsed.binding);
			if (!binding.ok) throw new Error("invalid_binding");
			return binding.binding !== undefined ? { binding: binding.binding } : {};
		})(),
		createdAt: parsed.createdAt,
		expiresAt: parsed.expiresAt,
		lastSeenAt: parsed.lastSeenAt,
	};
}

function parseFile(raw: unknown): SessionFile {
	const parsed = sessionFileSchema(raw);
	if (parsed instanceof type.errors) return { version: SESSIONS_SCHEMA_VERSION, sessions: [] };
	const sessions: SessionRecord[] = [];
	for (const entry of parsed.sessions) {
		let record: SessionRecord | null;
		try {
			record = parseRecord(entry);
		} catch {
			// Malformed binding: drop the session rather than widen it.
			continue;
		}
		if (record !== null && !sessions.some(existing => existing.idHash === record.idHash)) sessions.push(record);
	}
	return { version: SESSIONS_SCHEMA_VERSION, sessions };
}

/**
 * Sessions for one file. Instances are cheap; request handlers use the
 * process-wide {@link sessionStore}.
 */
export class SessionStore {
	readonly #filePath: string;
	/** In-memory throttle for expiry-extension writes, keyed by idHash. */
	readonly #touchedAt = new Map<string, number>();
	readonly #warned = new Set<"read" | "parse">();

	constructor(filePath: string = sessionsFilePath()) {
		this.#filePath = filePath;
	}

	get filePath(): string {
		return this.#filePath;
	}

	async read(now: number = Date.now()): Promise<SessionRecord[]> {
		let text: string;
		try {
			text = await fs.readFile(this.#filePath, "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !this.#warned.has("read")) {
				this.#warned.add("read");
				logger.warn("Failed to read session store; treating it as empty", {
					filePath: this.#filePath,
					error: error instanceof Error ? error.message : String(error),
				});
			}
			return [];
		}
		let file: SessionFile;
		try {
			file = parseFile(JSON.parse(text) as unknown);
		} catch (error) {
			if (!this.#warned.has("parse")) {
				this.#warned.add("parse");
				logger.warn("Ignoring malformed session store; every remote session must pair again", {
					filePath: this.#filePath,
					error: error instanceof Error ? error.message : String(error),
				});
			}
			return [];
		}
		return file.sessions.filter(record => record.expiresAt > now);
	}

	/** Mint a session for one device. The plaintext id is returned once. */
	async create(input: {
		deviceId: string;
		binding?: DeviceBinding;
		now?: number;
		ttlMs?: number;
	}): Promise<LiveSession> {
		const now = input.now ?? Date.now();
		const ttl = input.ttlMs ?? SESSION_TTL_MS;
		const id = randomBytes(32).toString("base64url");
		const record: SessionRecord = {
			idHash: hashSessionId(id),
			deviceId: input.deviceId,
			csrf: randomBytes(24).toString("base64url"),
			...(() => {
				const binding = parseBinding(input.binding);
				if (!binding.ok) throw new Error("invalid_binding");
				return binding.binding !== undefined ? { binding: binding.binding } : {};
			})(),
			createdAt: now,
			expiresAt: now + ttl,
			lastSeenAt: now,
		};
		await this.#mutate(file => {
			file.sessions = [...file.sessions.filter(entry => entry.expiresAt > now), record];
			return true;
		});
		this.#touchedAt.set(record.idHash, now);
		return {
			id,
			deviceId: record.deviceId,
			csrf: record.csrf,
			...(record.binding !== undefined ? { binding: record.binding } : {}),
			expiresAt: record.expiresAt,
		};
	}

	/** Resolve a cookie value to a live session, or `undefined`. */
	async get(sessionId: string, now: number = Date.now()): Promise<LiveSession | undefined> {
		if (sessionId === "") return undefined;
		const idHash = hashSessionId(sessionId);
		const record = (await this.read(now)).find(entry => entry.idHash === idHash);
		if (record === undefined) return undefined;
		return {
			id: sessionId,
			deviceId: record.deviceId,
			csrf: record.csrf,
			...(record.binding !== undefined ? { binding: record.binding } : {}),
			expiresAt: record.expiresAt,
		};
	}

	/** Slide the expiry forward; persisted at most once per interval. */
	async touch(sessionId: string, now: number = Date.now()): Promise<void> {
		const idHash = hashSessionId(sessionId);
		const last = this.#touchedAt.get(idHash) ?? 0;
		if (now - last < SESSION_TOUCH_INTERVAL_MS) return;
		this.#touchedAt.set(idHash, now);
		try {
			await this.#mutate(file => {
				const target = file.sessions.find(entry => entry.idHash === idHash);
				if (target === undefined || target.expiresAt <= now) return false;
				target.lastSeenAt = now;
				target.expiresAt = now + SESSION_TTL_MS;
				return true;
			});
		} catch (error) {
			// A failed touch must not fail an authenticated request.
			logger.warn("Could not persist session touch", {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	async delete(sessionId: string): Promise<boolean> {
		const idHash = hashSessionId(sessionId);
		let removed = false;
		await this.#mutate(file => {
			const next = file.sessions.filter(entry => entry.idHash !== idHash);
			removed = next.length !== file.sessions.length;
			file.sessions = next;
			return removed;
		});
		return removed;
	}

	/** Delete every session bound to one device; returns how many were removed. */
	async deleteByDevice(deviceId: string): Promise<number> {
		let removed = 0;
		await this.#mutate(file => {
			const next = file.sessions.filter(entry => entry.deviceId !== deviceId);
			removed = file.sessions.length - next.length;
			file.sessions = next;
			return removed > 0;
		});
		return removed;
	}

	/** Delete every session except (optionally) one device's. Returns removed ids' device ids. */
	async deleteAll(exceptDeviceId?: string): Promise<{ removed: number; deviceIds: string[] }> {
		let deviceIds: string[] = [];
		await this.#mutate(file => {
			const keep = exceptDeviceId === undefined ? [] : file.sessions.filter(e => e.deviceId === exceptDeviceId);
			const drop = file.sessions.filter(e => exceptDeviceId === undefined || e.deviceId !== exceptDeviceId);
			if (drop.length === 0) return false;
			deviceIds = [...new Set(drop.map(entry => entry.deviceId))];
			file.sessions = keep;
			return true;
		});
		return { removed: deviceIds.length, deviceIds };
	}

	/** Every live session bound to one device (used by revocation to close sockets). */
	async list(): Promise<SessionRecord[]> {
		return this.read();
	}

	/** Test hook: forget the in-memory touch throttle. */
	resetTouchThrottle(): void {
		this.#touchedAt.clear();
	}

	async #mutate(mutation: (file: SessionFile) => boolean): Promise<void> {
		await withFileLock(this.#filePath, async () => {
			const file = await this.#readForWrite();
			if (!mutation(file)) return;
			await this.#write(file);
		});
	}

	async #readForWrite(): Promise<SessionFile> {
		let text: string;
		try {
			text = await fs.readFile(this.#filePath, "utf8");
		} catch {
			return { version: SESSIONS_SCHEMA_VERSION, sessions: [] };
		}
		try {
			return parseFile(JSON.parse(text) as unknown);
		} catch {
			return { version: SESSIONS_SCHEMA_VERSION, sessions: [] };
		}
	}

	async #write(file: SessionFile): Promise<void> {
		const dir = path.dirname(this.#filePath);
		await fs.mkdir(dir, { recursive: true, mode: 0o700 });
		const tempPath = `${this.#filePath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
		let removeTemp = false;
		try {
			const handle = await fs.open(tempPath, "wx", 0o600);
			removeTemp = true;
			try {
				await handle.writeFile(
					JSON.stringify({ version: SESSIONS_SCHEMA_VERSION, sessions: file.sessions }, null, 2),
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

let shared: SessionStore | undefined;

/** The process-wide session store for the active profile. */
export function sessionStore(): SessionStore {
	shared ??= new SessionStore();
	return shared;
}

/** Test hook: point request handlers at a temp file (or restore with `undefined`). */
export function setSessionStoreForTest(next: SessionStore | undefined): void {
	shared = next;
}
