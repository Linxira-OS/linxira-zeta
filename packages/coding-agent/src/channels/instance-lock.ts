/**
 * Single-instance guard for the IM channel runtime.
 *
 * A bot credential can be bound by exactly one process: two long-pollers on
 * the same WeChat/Telegram connection steal each other's updates (and WeChat
 * replies need the peer's latest context token, which only one process sees).
 * The guard is a lock file next to `web.yml` holding the hosting pid, whether
 * the host is `zetacode serve` or a normal CLI/TUI session, and which channels
 * started. A second process treats a live holder as a hard refusal; a lock
 * left by a dead pid is removed and re-acquired.
 *
 * The same file is the observation point for `zetacode channels status`, so
 * the command does not need a second live registry (and the gateway continues
 * to read the in-process runtime).
 *
 * Publishing is atomic (the payload is written to a private temp file and
 * hard-linked into place), so a reader never observes a half-written lock and
 * mistakes it for a stale one; a lock that does read as unparseable is retried
 * briefly before it is replaced.
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ChannelId } from "@linxiraos/pi-channels";

export const CHANNEL_LOCK_FILENAME = "channels.lock";

/** Attempts (15 ms apart) while a contender keeps replacing the lock file. */
const MAX_ACQUIRE_ATTEMPTS = 40;
/** Attempts (15 ms apart) to wait out a lock file that is momentarily unparseable. */
const MALFORMED_RETRIES = 5;
const RETRY_DELAY_MS = 15;

export interface ChannelLockMetadata {
	version: 1;
	/** Unique per host instance, so a stopped host never deletes its successor's lock. */
	instanceId: string;
	pid: number;
	/** Which surface hosts the runtime; used by `channels status` and human output. */
	host: "serve" | "cli";
	startedAt: string;
	/** Session/subcommand working directory at start. */
	cwd: string;
	/** Session id when the host has a persisted session. */
	sessionId?: string;
	/** Channels that actually started (empty while a start is in flight). */
	channels: ChannelId[];
}

export interface ChannelLockSnapshot {
	metadata: ChannelLockMetadata;
	/** False for a lock left behind by a dead process (status reports it as stale). */
	alive: boolean;
	/** The file could not be parsed (mid-write by an older writer, or corrupt). */
	malformed?: boolean;
}

export interface ChannelLockHandle {
	readonly path: string;
	readonly metadata: ChannelLockMetadata;
	/** Replace the live metadata (e.g. after channels finish starting). */
	update(patch: Partial<Pick<ChannelLockMetadata, "channels" | "sessionId" | "cwd">>): Promise<void>;
	/** Remove the file only when this instance still owns it. */
	release(): Promise<void>;
}

export type AcquireChannelLockResult =
	| { ok: true; lock: ChannelLockHandle }
	| { ok: false; holder: ChannelLockSnapshot | null; message: string };

/** Default lock location for a config root: `<agent dir>/run/channels.lock`. */
export function channelLockPath(agentDir: string): string {
	return path.join(agentDir, "run", CHANNEL_LOCK_FILENAME);
}

/** A pid exists when signalling it is permitted (EPERM means a live pid we do not own). */
export function isProcessAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

function parseMetadata(text: string): ChannelLockMetadata | null {
	try {
		const value = JSON.parse(text) as Partial<ChannelLockMetadata>;
		if (
			value.version !== 1 ||
			typeof value.instanceId !== "string" ||
			typeof value.pid !== "number" ||
			(value.host !== "serve" && value.host !== "cli") ||
			typeof value.startedAt !== "string" ||
			typeof value.cwd !== "string" ||
			!Array.isArray(value.channels)
		) {
			return null;
		}
		return {
			version: 1,
			instanceId: value.instanceId,
			pid: value.pid,
			host: value.host,
			startedAt: value.startedAt,
			cwd: value.cwd,
			...(typeof value.sessionId === "string" ? { sessionId: value.sessionId } : {}),
			channels: value.channels.filter((id): id is ChannelId => typeof id === "string"),
		};
	} catch {
		return null;
	}
}

/** Read the lock without taking it. A malformed file is reported as stale. */
export async function readChannelLock(
	lockPath: string,
	options: { isAlive?: (pid: number) => boolean } = {},
): Promise<ChannelLockSnapshot | null> {
	let text: string;
	try {
		text = await fs.readFile(lockPath, "utf8");
	} catch {
		return null;
	}
	const metadata = parseMetadata(text);
	if (!metadata) {
		return {
			metadata: {
				version: 1,
				instanceId: "invalid",
				pid: 0,
				host: "cli",
				startedAt: "",
				cwd: "",
				channels: [],
			},
			alive: false,
			malformed: true,
		};
	}
	return { metadata, alive: (options.isAlive ?? isProcessAlive)(metadata.pid) };
}

/** Error codes a filesystem without hard links reports for `link`. */
const NO_HARD_LINK_CODES: Record<string, true> = {
	EPERM: true,
	ENOTSUP: true,
	EOPNOTSUPP: true,
	ENOSYS: true,
	EXDEV: true,
};

/**
 * Publish a complete lock payload at `lockPath`, atomically and only when no
 * lock exists. The payload is written and fsync'd in a private temp file that
 * is then hard-linked into place: `link` refuses with EEXIST when another
 * process already published, and readers never observe a partial file (which
 * they would otherwise misjudge as stale and steal).
 *
 * Filesystems without hard links (exFAT, some network mounts) fall back to an
 * exclusive create — still race-free, but readers can briefly see the empty
 * file, which the acquisition loop's unparseable retry absorbs.
 */
async function publishLockFile(lockPath: string, payload: string): Promise<boolean> {
	const tempPath = `${lockPath}.${process.pid}.${randomUUID()}.tmp`;
	try {
		const handle = await fs.open(tempPath, "wx", 0o600);
		try {
			await handle.writeFile(payload, "utf8");
			await handle.sync();
		} finally {
			await handle.close();
		}
		try {
			await fs.link(tempPath, lockPath);
			return true;
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code === "EEXIST") return false;
			if (code === undefined || !Object.hasOwn(NO_HARD_LINK_CODES, code)) throw error;
		}
	} finally {
		await fs.rm(tempPath, { force: true }).catch(() => {});
	}
	// Reached only when this filesystem cannot hard-link: exclusive create is
	// the only atomic primitive left.
	try {
		await fs.writeFile(lockPath, payload, { encoding: "utf8", mode: 0o600, flag: "wx" });
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
		throw error;
	}
}

/** Replace an existing lock payload atomically (readers see old or new, never a mix). */
async function replaceLockFile(lockPath: string, payload: string): Promise<void> {
	const tempPath = `${lockPath}.${process.pid}.${randomUUID()}.tmp`;
	try {
		const handle = await fs.open(tempPath, "wx", 0o600);
		try {
			await handle.writeFile(payload, "utf8");
			await handle.sync();
		} finally {
			await handle.close();
		}
		await fs.rename(tempPath, lockPath);
	} finally {
		await fs.rm(tempPath, { force: true }).catch(() => {});
	}
}

/**
 * Take the lock. `instanceId` is generated unless a caller supplies one (tests
 * and the serve host pass their own). A lock held by a dead pid is replaced;
 * a lock that reads as unparseable is retried briefly first, because it may be
 * another process's in-flight publish rather than garbage.
 */
export async function acquireChannelLock(options: {
	lockPath: string;
	metadata: Omit<ChannelLockMetadata, "version" | "instanceId" | "startedAt"> &
		Partial<Pick<ChannelLockMetadata, "version" | "instanceId" | "startedAt">>;
	isAlive?: (pid: number) => boolean;
}): Promise<AcquireChannelLockResult> {
	const metadata: ChannelLockMetadata = {
		version: 1,
		instanceId: options.metadata.instanceId ?? randomUUID(),
		pid: options.metadata.pid,
		host: options.metadata.host,
		startedAt: options.metadata.startedAt ?? new Date().toISOString(),
		cwd: options.metadata.cwd,
		...(options.metadata.sessionId ? { sessionId: options.metadata.sessionId } : {}),
		channels: [...options.metadata.channels],
	};
	const payload = `${JSON.stringify(metadata, null, 2)}\n`;
	await fs.mkdir(path.dirname(options.lockPath), { recursive: true });

	for (let attempt = 0; attempt < MAX_ACQUIRE_ATTEMPTS; attempt++) {
		if (await publishLockFile(options.lockPath, payload)) {
			return {
				ok: true,
				lock: {
					path: options.lockPath,
					metadata,
					async update(patch) {
						Object.assign(metadata, patch);
						await replaceLockFile(options.lockPath, `${JSON.stringify(metadata, null, 2)}\n`);
					},
					async release() {
						const current = await readChannelLock(options.lockPath, options);
						if (current?.metadata.instanceId !== metadata.instanceId) return;
						await fs.unlink(options.lockPath).catch(() => {});
					},
				},
			};
		}
		const holder = await readChannelLock(options.lockPath, options);
		if (holder === null) {
			// Raced with a release between the publish attempt and the read.
			await Bun.sleep(RETRY_DELAY_MS);
			continue;
		}
		if (holder.alive) {
			return {
				ok: false,
				holder,
				message:
					`IM channels are already hosted by pid ${holder.metadata.pid} (${holder.metadata.host}` +
					`${holder.metadata.startedAt ? `, started ${holder.metadata.startedAt}` : ""}). ` +
					"Stop that process first; two hosts would double-bind the same bot.",
			};
		}
		if (holder.malformed && attempt < MALFORMED_RETRIES) {
			// Possibly a lock still being published by an older writer: wait it
			// out instead of unlinking a lock another process is taking.
			await Bun.sleep(RETRY_DELAY_MS);
			continue;
		}
		await fs.unlink(options.lockPath).catch(() => {});
	}
	return {
		ok: false,
		holder: null,
		message: `Could not acquire the IM channel lock at ${options.lockPath}; another process keeps replacing it.`,
	};
}
