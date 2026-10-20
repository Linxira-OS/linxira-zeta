/**
 * Per-workspace directory records.
 *
 * One JSON file per live mesh process (`run/mesh/<workspaceId>.json`), written
 * at start, refreshed on a 10s heartbeat, and removed on clean exit. Enumeration
 * resolves staleness (heartbeat older than 60s or a dead pid) and deletes the
 * stale record — and its endpoint token — so a crashed process cannot keep
 * advertising an endpoint.
 */

import { randomBytes } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { logger } from "@linxiraos/pi-utils";
import { type MeshPaths, meshPaths } from "./paths";
import { MESH_STALE_MS, type MeshDirectoryEntry, type MeshDirectoryRecord } from "./types";

export interface MeshDirectoryOptions {
	paths?: MeshPaths;
	now?: () => number;
	staleMs?: number;
	/** Override liveness probing (tests use a child pid); defaults to `process.kill(pid, 0)`. */
	pidAlive?: (pid: number) => boolean;
}

/** `process.kill(pid, 0)` liveness: ESRCH = gone, EPERM = alive under another user. */
export function isPidAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

/**
 * Owner-only atomic write: temp file in the same directory, then rename.
 *
 * Windows refuses to replace a file while another process holds it open, and
 * peers read these records on every probe. A short retry on the replacement
 * codes turns that race into a delay instead of a lost heartbeat/wait state.
 */
async function writeFileAtomic(file: string, content: string, mode: number): Promise<void> {
	const dir = path.dirname(file);
	await fs.mkdir(dir, { recursive: true, mode: 0o700 });
	const temp = path.join(dir, `.${path.basename(file)}.${randomBytes(6).toString("hex")}.tmp`);
	try {
		await fs.writeFile(temp, content, { mode });
		await fs.chmod(temp, mode).catch(() => {});
		for (let attempt = 0; ; attempt++) {
			try {
				await fs.rename(temp, file);
				return;
			} catch (error) {
				const code = (error as NodeJS.ErrnoException).code;
				const retryable = code === "EPERM" || code === "EACCES" || code === "EBUSY" || code === "EEXIST";
				if (!retryable || attempt >= 20) throw error;
				await new Promise(resolve => setTimeout(resolve, 10 + attempt * 10));
			}
		}
	} catch (error) {
		await fs.rm(temp, { force: true }).catch(() => {});
		throw error;
	}
}

export class MeshDirectory {
	readonly paths: MeshPaths;
	readonly #now: () => number;
	readonly #staleMs: number;
	readonly #pidAlive: (pid: number) => boolean;
	/** Serializes this process's own record writes (heartbeat vs. wait updates). */
	#writeChain: Promise<void> = Promise.resolve();

	constructor(options: MeshDirectoryOptions = {}) {
		this.paths = options.paths ?? meshPaths();
		this.#now = options.now ?? Date.now;
		this.#staleMs = options.staleMs ?? MESH_STALE_MS;
		this.#pidAlive = options.pidAlive ?? isPidAlive;
	}

	/** Write (or refresh) one record. Only the owning process writes its file. */
	async write(record: MeshDirectoryRecord): Promise<void> {
		const file = this.paths.directoryFile(record.workspaceId);
		const content = `${JSON.stringify(record)}\n`;
		const next = this.#writeChain.then(() => writeFileAtomic(file, content, 0o600));
		this.#writeChain = next.catch(() => {});
		await next;
	}

	/** Last record written for `workspaceId`, without staleness filtering. */
	async read(workspaceId: string): Promise<MeshDirectoryRecord | undefined> {
		return this.#readFile(this.paths.directoryFile(workspaceId), workspaceId);
	}

	/** Remove a record and its endpoint token; the caller owns the endpoint file. */
	async remove(workspaceId: string): Promise<void> {
		await fs.rm(this.paths.directoryFile(workspaceId), { force: true }).catch(() => {});
		await fs.rm(this.paths.tokenFile(workspaceId), { force: true }).catch(() => {});
	}

	/**
	 * Enumerate every record. Stale entries are returned with state `gone` and
	 * deleted from disk (record + token + POSIX socket file) so the next
	 * enumeration starts clean. Malformed files are deleted and skipped.
	 */
	async list(): Promise<MeshDirectoryEntry[]> {
		let names: string[];
		try {
			names = await fs.readdir(this.paths.directoryDir);
		} catch {
			return [];
		}
		const entries: MeshDirectoryEntry[] = [];
		for (const name of names) {
			if (!name.endsWith(".json")) continue;
			const workspaceId = name.slice(0, -".json".length);
			const record = await this.#readFile(path.join(this.paths.directoryDir, name), workspaceId);
			if (!record) continue;
			const now = this.#now();
			const stale = now - record.updatedAt > this.#staleMs;
			const deadPid = !this.#pidAlive(record.pid);
			if (stale || deadPid) {
				logger.debug("mesh: cleaning stale directory entry", {
					workspaceId,
					pid: record.pid,
					stale,
					deadPid,
				});
				await this.#removeStale(record);
				entries.push({ record, state: "gone" });
				continue;
			}
			entries.push({ record, state: "live" });
		}
		entries.sort((a, b) => a.record.workspaceId.localeCompare(b.record.workspaceId));
		return entries;
	}

	async #removeStale(record: MeshDirectoryRecord): Promise<void> {
		await this.remove(record.workspaceId);
		if (process.platform !== "win32") {
			await fs.rm(record.endpoint, { force: true }).catch(() => {});
		}
	}

	async #readFile(file: string, workspaceId: string): Promise<MeshDirectoryRecord | undefined> {
		try {
			const parsed = JSON.parse(await fs.readFile(file, "utf8")) as Partial<MeshDirectoryRecord>;
			if (
				parsed.workspaceId !== workspaceId ||
				typeof parsed.pid !== "number" ||
				typeof parsed.endpoint !== "string" ||
				typeof parsed.updatedAt !== "number" ||
				typeof parsed.workspaceRoot !== "string"
			) {
				throw new Error("invalid directory record shape");
			}
			return parsed as MeshDirectoryRecord;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				logger.warn("mesh: dropping unreadable directory record", { file, error: String(error) });
				await fs.rm(file, { force: true }).catch(() => {});
			}
			return undefined;
		}
	}
}
