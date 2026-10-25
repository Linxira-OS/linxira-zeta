/**
 * Recover standalone sessions from backend attach replicas.
 *
 * `BackendAttachLink` writes its mirror to `<config>/backend` on purpose: a
 * live replica must not be visible to the normal resume scanner, because the
 * backend owns the conversation and the local file is only a renderer copy.
 * When the backend stops, however, that copy is the only complete transcript
 * and must become a normal resumable session. This module imports those
 * replicas idempotently, keeping the backend session id as the local id and
 * refusing to overwrite a local transcript that contains entries the replica
 * does not have.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getConfigRootDir, logger } from "@linxiraos/pi-utils";
import { getSessionsDir } from "@linxiraos/pi-utils/dirs";
import { computeDefaultSessionDir } from "./session-paths";
import { FileSessionStorage, type SessionStorage } from "./session-storage";
import { workspaceBranch } from "./workspace-branch";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const REPLICA_NAME = new RegExp(`^(${UUID})-(${UUID})\\.jsonl$`, "i");

interface JsonObject {
	[key: string]: unknown;
}

interface ParsedFile {
	objects: JsonObject[];
	header?: JsonObject;
	title?: string;
	messageIds: Set<string>;
	messageCount: number;
	lastTimestamp?: string;
}

export interface BackendReplicaRecoveryResult {
	imported: number;
	updated: number;
	skipped: number;
	failed: number;
}

export interface BackendReplicaRecoveryOptions {
	replicaDir?: string;
	sessionsRoot?: string;
	storage?: SessionStorage;
}

function parseFile(text: string): ParsedFile {
	const objects: JsonObject[] = [];
	for (const line of text.split(/\r?\n/)) {
		if (!line.trim()) continue;
		try {
			const parsed: unknown = JSON.parse(line);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) objects.push(parsed as JsonObject);
		} catch {
			// A torn tail is ignored; the remaining entries are still usable.
		}
	}
	let header: JsonObject | undefined;
	let title: string | undefined;
	const messageIds = new Set<string>();
	let messageCount = 0;
	let lastTimestamp: string | undefined;
	for (const object of objects) {
		if (object.type === "session" && !header) header = object;
		if (object.type === "title" && typeof object.title === "string" && object.title.length > 0) title = object.title;
		if (object.type === "message") {
			messageCount++;
			if (typeof object.id === "string") messageIds.add(object.id);
		}
		if (typeof object.timestamp === "string" && (!lastTimestamp || object.timestamp > lastTimestamp)) {
			lastTimestamp = object.timestamp;
		}
	}
	return { objects, header, title, messageIds, messageCount, lastTimestamp };
}

function fileStamp(timestamp: string | undefined, fallbackMs: number): string {
	const iso = timestamp ?? new Date(fallbackMs).toISOString();
	return iso.replace(/[:.]/g, "-");
}

function epochMs(timestamp: string | undefined): number | undefined {
	if (!timestamp) return undefined;
	const parsed = Date.parse(timestamp);
	return Number.isFinite(parsed) ? parsed : undefined;
}

async function findLocalSession(sessionsRoot: string, backendId: string): Promise<string | undefined> {
	let buckets: import("node:fs").Dirent[];
	try {
		buckets = await fs.readdir(sessionsRoot, { withFileTypes: true });
	} catch {
		return undefined;
	}
	const suffix = `_${backendId}.jsonl`;
	for (const bucket of buckets) {
		if (!bucket.isDirectory()) continue;
		const dir = path.join(sessionsRoot, bucket.name);
		let entries: string[];
		try {
			entries = await fs.readdir(dir);
		} catch {
			continue;
		}
		const match = entries.find(name => name.endsWith(suffix));
		if (match) return path.join(dir, match);
	}
	return undefined;
}

async function writeAtomic(target: string, text: string): Promise<void> {
	const dir = path.dirname(target);
	await fs.mkdir(dir, { recursive: true, mode: 0o700 });
	const temp = path.join(dir, `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
	try {
		await fs.writeFile(temp, text, { mode: 0o600 });
		try {
			await fs.rename(temp, target);
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code !== "EEXIST" && code !== "EPERM") throw error;
			await fs.rm(target, { force: true });
			await fs.rename(temp, target);
		}
	} finally {
		await fs.rm(temp, { force: true }).catch(() => undefined);
	}
}

function serialize(objects: readonly JsonObject[]): string {
	return `${objects.map(object => JSON.stringify(object)).join("\n")}\n`;
}

/**
 * Import every non-empty backend replica that has no complete local session.
 * Idempotent; safe to run when the backend is stopped or after a crash.
 */
export async function recoverBackendReplicas(
	options: BackendReplicaRecoveryOptions = {},
): Promise<BackendReplicaRecoveryResult> {
	const replicaDir = options.replicaDir ?? path.join(getConfigRootDir(), "backend");
	const sessionsRoot = options.sessionsRoot ?? getSessionsDir();
	const storage = options.storage ?? new FileSessionStorage();
	const result: BackendReplicaRecoveryResult = { imported: 0, updated: 0, skipped: 0, failed: 0 };

	let names: string[];
	try {
		names = (await fs.readdir(replicaDir)).filter(name => name.endsWith(".jsonl"));
	} catch {
		return result;
	}

	for (const name of names) {
		const match = REPLICA_NAME.exec(name);
		if (!match) {
			result.skipped++;
			continue;
		}
		const backendId = match[1]!.toLowerCase();
		const sourcePath = path.join(replicaDir, name);
		let source: ParsedFile;
		try {
			source = parseFile(await fs.readFile(sourcePath, "utf8"));
		} catch (error) {
			result.failed++;
			logger.warn("Failed to read backend session replica", { path: sourcePath, error: String(error) });
			continue;
		}
		const cwd = typeof source.header?.cwd === "string" ? source.header.cwd : undefined;
		if (!source.header || !cwd || source.messageCount === 0) {
			result.skipped++;
			continue;
		}

		const localPath = await findLocalSession(sessionsRoot, backendId);
		let local: ParsedFile | undefined;
		if (localPath) {
			try {
				local = parseFile(await fs.readFile(localPath, "utf8"));
			} catch (error) {
				result.failed++;
				logger.warn("Failed to read local session before replica recovery", {
					path: localPath,
					error: String(error),
				});
				continue;
			}
			// Never replace a local transcript that has a message the replica lacks;
			// that would silently drop work performed after the mirror stopped.
			const localIsSubset = [...local.messageIds].every(id => source.messageIds.has(id));
			if (!localIsSubset || local.messageCount > source.messageCount) {
				result.skipped++;
				continue;
			}
			if (local.messageCount === source.messageCount) {
				result.skipped++;
				continue;
			}
		}

		const header: JsonObject = { ...source.header, id: backendId };
		if (typeof header.branch !== "string" || header.branch.length === 0) {
			const branch = (typeof local?.header?.branch === "string" && local.header.branch) || workspaceBranch(cwd);
			if (branch) header.branch = branch;
		}
		const objects = source.objects.map(object => (object.type === "session" ? header : object));
		if (!source.title && local?.title) objects.unshift({ type: "title", title: local.title });
		// Keep local-only non-message markers (session_exit, custom state) that
		// the backend snapshot does not carry; message entries are all present.
		if (local) {
			for (const object of local.objects) {
				const id = typeof object.id === "string" ? object.id : undefined;
				if (!id || source.objects.some(candidate => candidate.id === id)) continue;
				if (object.type === "title" || object.type === "session") continue;
				objects.push(object);
			}
		}

		const target =
			localPath ??
			path.join(
				computeDefaultSessionDir(cwd, storage, sessionsRoot),
				`${fileStamp(source.header.timestamp as string | undefined, (await fs.stat(sourcePath)).mtimeMs)}_${backendId}.jsonl`,
			);
		try {
			await writeAtomic(target, serialize(objects));
			const mtime = epochMs(source.lastTimestamp) ?? epochMs(source.header.timestamp as string | undefined);
			if (mtime !== undefined) await fs.utimes(target, mtime / 1000, mtime / 1000);
			if (localPath) result.updated++;
			else result.imported++;
		} catch (error) {
			result.failed++;
			logger.warn("Failed to import backend session replica", { source: sourcePath, target, error: String(error) });
		}
	}
	return result;
}
