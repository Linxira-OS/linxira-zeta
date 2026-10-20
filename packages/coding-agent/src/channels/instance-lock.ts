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
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ChannelId } from "@linxiraos/pi-channels";

export const CHANNEL_LOCK_FILENAME = "channels.lock";

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
		};
	}
	return { metadata, alive: (options.isAlive ?? isProcessAlive)(metadata.pid) };
}

/**
 * Take the lock. `instanceId` is generated unless a caller supplies one (tests
 * and the serve host pass their own). A stale or malformed lock is replaced.
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
	await fs.mkdir(path.dirname(options.lockPath), { recursive: true });

	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			const handle = await fs.open(options.lockPath, "wx", 0o600);
			try {
				await handle.writeFile(`${JSON.stringify(metadata, null, 2)}\n`, "utf8");
			} finally {
				await handle.close();
			}
			return {
				ok: true,
				lock: {
					path: options.lockPath,
					metadata,
					async update(patch) {
						Object.assign(metadata, patch);
						await fs.writeFile(options.lockPath, `${JSON.stringify(metadata, null, 2)}\n`, {
							encoding: "utf8",
							mode: 0o600,
						});
					},
					async release() {
						const current = await readChannelLock(options.lockPath, options);
						if (current?.metadata.instanceId !== metadata.instanceId) return;
						await fs.unlink(options.lockPath).catch(() => {});
					},
				},
			};
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			const holder = await readChannelLock(options.lockPath, options);
			if (holder === null) continue; // raced with a release; retry
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
			await fs.unlink(options.lockPath).catch(() => {});
		}
	}
	return {
		ok: false,
		holder: null,
		message: `Could not acquire the IM channel lock at ${options.lockPath}; another process keeps replacing it.`,
	};
}
