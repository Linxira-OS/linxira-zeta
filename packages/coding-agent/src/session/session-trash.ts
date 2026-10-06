/**
 * Session trash — soft-delete staging under `~/.zeta/trash/sessions/`.
 *
 * Deleting a session moves its transcript, sibling artifacts directory, and
 * stale `.bak` backups into a per-entry trash directory
 * (`<fileSafeTimestamp>_<sessionId>/`) plus a `manifest.json` recording the
 * original location, so `/trash` can list entries and `/restore <n>` can move
 * one back. A background sweeper removes entries older than
 * `session.trashRetentionDays` (default 30; 0 keeps entries forever).
 *
 * `ZETA_TRASH_DIR` overrides the trash root (portable installs and tests).
 */
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { Stats } from "node:fs";
import { isEnoent, logger } from "@linxiraos/pi-utils";
// Static cycle check: config/settings imports only AgentStorage and
// compaction-methods from this directory, neither of which reaches back into
// session-trash — and the Settings singleton is only dereferenced at sweep
// time (inside the function body), never at module-eval time.
import { Settings } from "../config/settings";
import { cfgSessionTrashRetentionDays } from "./settings";
import { parseSessionContent } from "./session-loader";

const JSONL_SUFFIX = ".jsonl";
const JSONL_SUFFIX_LENGTH = JSONL_SUFFIX.length;
const TRASH_MANIFEST_FILENAME = "manifest.json";
export const DEFAULT_TRASH_RETENTION_DAYS = 30;
const SWEEP_STARTUP_DELAY_MS = 15_000;
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Recorded next to the moved transcript so restore knows where it came from. */
export interface TrashManifest {
	version: 1;
	sessionId: string;
	/** Absolute transcript path the session was moved from. */
	originalPath: string;
	/** Session title at trash time, when the header carried one. */
	title: string | null;
	trashedAt: string;
	/** Transcript file name inside the entry directory. */
	sessionFileName: string;
	/** Artifacts directory name inside the entry directory, when it existed. */
	artifactsDirName: string | null;
}

/** One trashed session resolved from its manifest. */
export interface TrashEntry {
	/** Trash entry directory (`~/.zeta/trash/sessions/<ts>_<id>/`). */
	dir: string;
	manifest: TrashManifest;
	sessionFile: string;
	artifactsDir: string | null;
}

export interface TrashMoveResult {
	/** False when the session file was already gone (ENOENT counts as success). */
	moved: boolean;
	entry: TrashEntry | null;
}

export interface RestoreTrashResult {
	sessionFile: string;
	artifactsDir: string | null;
}

/** Trash root for session entries. */
export function defaultTrashSessionsDir(): string {
	return process.env.ZETA_TRASH_DIR ?? path.join(os.homedir(), ".zeta", "trash", "sessions");
}

/** `[:.]` → `-` matches the session file-naming convention (`session-manager.ts`). */
function fileSafeTimestamp(iso: string): string {
	return iso.replace(/[:.]/g, "-");
}

function sessionIdFromFileName(sessionFile: string): string {
	const base = path.basename(sessionFile);
	const stem = base.endsWith(JSONL_SUFFIX) ? base.slice(0, -JSONL_SUFFIX_LENGTH) : base;
	const underscore = stem.lastIndexOf("_");
	return underscore >= 0 ? stem.slice(underscore + 1) : stem;
}

/** Light header read (no lock): id + title for the trash manifest. */
function readHeaderInfo(sessionPath: string): { sessionId: string | undefined; title: string | null } {
	try {
		const content = fs.readFileSync(sessionPath, "utf8");
		const { entries } = parseSessionContent(content);
		const header = entries.find(entry => entry.type === "session") as { id?: string; title?: string } | undefined;
		return { sessionId: header?.id, title: header?.title ?? null };
	} catch {
		return { sessionId: undefined, title: null };
	}
}

async function pathExists(target: string): Promise<boolean> {
	try {
		await fsp.stat(target);
		return true;
	} catch {
		return false;
	}
}

/** Move `from` under `toDir`; cross-device (EXDEV) falls back to copy + remove. */
async function moveInto(from: string, toDir: string, toName?: string): Promise<string> {
	const to = path.join(toDir, toName ?? path.basename(from));
	try {
		await fsp.rename(from, to);
		return to;
	} catch (err) {
		if ((err as NodeJS.ErrnoException | null)?.code !== "EXDEV") throw err;
		await fsp.cp(from, to, { recursive: true, errorOnExist: true, force: false });
		await fsp.rm(from, { recursive: true, force: true });
		return to;
	}
}

/**
 * Soft-delete a session: move its transcript, artifacts directory, and stale
 * `.bak` backups into a new trash entry. A missing session file is a no-op
 * (`moved: false`) so callers keep their ENOENT-is-success semantics.
 *
 * The transcript moves first; artifacts and backups are best-effort — a
 * failure there logs a warning instead of failing the delete the user asked
 * for (the transcript is already safely in the trash).
 */
export async function moveSessionToTrash(
	sessionPath: string,
	options?: { trashDir?: string; now?: Date },
): Promise<TrashMoveResult> {
	const resolved = path.resolve(sessionPath);
	let stat: Stats;
	try {
		stat = await fsp.stat(resolved);
	} catch (err) {
		if (isEnoent(err)) return { moved: false, entry: null };
		throw err;
	}
	if (!stat.isFile()) throw new Error(`Session trash expects a .jsonl file, got directory: ${resolved}`);

	const header = readHeaderInfo(resolved);
	const sessionId = header.sessionId ?? sessionIdFromFileName(resolved);
	const trashDir = options?.trashDir ?? defaultTrashSessionsDir();
	await fsp.mkdir(trashDir, { recursive: true });

	const stamp = fileSafeTimestamp((options?.now ?? new Date()).toISOString());
	let entryDir = path.join(trashDir, `${stamp}_${sessionId}`);
	for (let attempt = 1; await pathExists(entryDir); attempt++) {
		entryDir = path.join(trashDir, `${stamp}_${sessionId}-${attempt}`);
	}
	await fsp.mkdir(entryDir, { recursive: true });

	const sessionFileName = path.basename(resolved);
	const sessionFile = await moveInto(resolved, entryDir);

	let artifactsDir: string | null = null;
	const artifactsSource = resolved.slice(0, -JSONL_SUFFIX_LENGTH);
	try {
		if (await pathExists(artifactsSource)) {
			artifactsDir = await moveInto(artifactsSource, entryDir);
		}
	} catch (err) {
		logger.warn("Session trashed but its artifacts directory could not be moved", {
			sessionFile: resolved,
			artifactsDir: artifactsSource,
			error: (err as Error).message,
		});
	}

	// EPERM-rewrite leftovers (`<name>.jsonl.<snowflake>.bak`) belong to the
	// session — move the ones matching its base so restore reunites them.
	const siblingBaks = await listMatchingBaks(path.dirname(resolved), sessionFileName);
	for (const bak of siblingBaks) {
		try {
			await moveInto(bak, entryDir);
		} catch (err) {
			logger.warn("Session trashed but a stale backup could not be moved", {
				backup: bak,
				error: (err as Error).message,
			});
		}
	}

	const manifest: TrashManifest = {
		version: 1,
		sessionId,
		originalPath: resolved,
		title: header.title,
		trashedAt: (options?.now ?? new Date()).toISOString(),
		sessionFileName,
		artifactsDirName: artifactsDir ? path.basename(artifactsDir) : null,
	};
	await fsp.writeFile(path.join(entryDir, TRASH_MANIFEST_FILENAME), `${JSON.stringify(manifest, null, "\t")}\n`, "utf8");

	logger.info("Session moved to trash", { sessionFile: resolved, trashEntry: entryDir });
	return {
		moved: true,
		entry: {
			dir: entryDir,
			manifest,
			sessionFile,
			artifactsDir,
		},
	};
}

async function listMatchingBaks(dir: string, sessionFileName: string): Promise<string[]> {
	try {
		const names = await fsp.readdir(dir);
		return names
			.filter(name => name.startsWith(`${sessionFileName}.`) && name.endsWith(".bak"))
			.map(name => path.join(dir, name));
	} catch {
		return [];
	}
}

async function readManifest(entryDir: string): Promise<TrashManifest | null> {
	try {
		const raw = await fsp.readFile(path.join(entryDir, TRASH_MANIFEST_FILENAME), "utf8");
		const parsed = JSON.parse(raw) as TrashManifest;
		if (parsed?.version !== 1 || typeof parsed.originalPath !== "string" || typeof parsed.sessionFileName !== "string") {
			return null;
		}
		return parsed;
	} catch {
		return null;
	}
}

/** Every trashed session, newest first. Malformed entries are skipped. */
export async function listTrashSessions(options?: { trashDir?: string }): Promise<TrashEntry[]> {
	const trashDir = options?.trashDir ?? defaultTrashSessionsDir();
	let names: string[];
	try {
		names = await fsp.readdir(trashDir);
	} catch (err) {
		if (isEnoent(err)) return [];
		throw err;
	}
	const entries: TrashEntry[] = [];
	for (const name of names) {
		const dir = path.join(trashDir, name);
		const manifest = await readManifest(dir);
		if (!manifest) continue;
		entries.push({
			dir,
			manifest,
			sessionFile: path.join(dir, manifest.sessionFileName),
			artifactsDir: manifest.artifactsDirName ? path.join(dir, manifest.artifactsDirName) : null,
		});
	}
	entries.sort((a, b) =>
		a.manifest.trashedAt < b.manifest.trashedAt ? 1 : a.manifest.trashedAt > b.manifest.trashedAt ? -1 : 0,
	);
	return entries;
}

/**
 * Move a trashed session back to its original directory. When the original
 * transcript path is taken again, the restore lands next to it as
 * `<base>.restored-<timestamp>.jsonl` (artifacts follow the same suffix).
 */
export async function restoreSessionFromTrash(entry: TrashEntry, options?: { now?: Date }): Promise<RestoreTrashResult> {
	const manifest = entry.manifest;
	const originalDir = path.dirname(manifest.originalPath);
	await fsp.mkdir(originalDir, { recursive: true });

	let target = manifest.originalPath;
	if (await pathExists(target)) {
		const ext = target.endsWith(JSONL_SUFFIX) ? JSONL_SUFFIX : "";
		const stem = ext ? target.slice(0, -JSONL_SUFFIX_LENGTH) : target;
		const stamp = fileSafeTimestamp((options?.now ?? new Date()).toISOString());
		target = `${stem}.restored-${stamp}${ext}`;
	}
	const sessionFile = await moveInto(entry.sessionFile, originalDir, path.basename(target));

	let artifactsDir: string | null = null;
	if (manifest.artifactsDirName && entry.artifactsDir && (await pathExists(entry.artifactsDir))) {
		const artifactsTarget = path.basename(target).replace(/\.jsonl$/, "");
		try {
			artifactsDir = await moveInto(entry.artifactsDir, originalDir, artifactsTarget);
		} catch (err) {
			logger.warn("Session restored but its artifacts directory could not be moved back", {
				trashEntry: entry.dir,
				error: (err as Error).message,
			});
		}
	}

	await fsp.rm(entry.dir, { recursive: true, force: true }).catch((err: Error) => {
		logger.warn("Trash entry could not be fully removed after restore", {
			trashEntry: entry.dir,
			error: err.message,
		});
	});

	return { sessionFile, artifactsDir };
}

/**
 * Remove trash entries older than `retentionDays` (0 = keep forever).
 * Manifest-bearing entries expire by `trashedAt`; manifest-less directories
 * (interrupted moves) expire by mtime so they cannot accumulate. Returns the
 * number of removed entries.
 */
export async function sweepExpiredTrash(options?: {
	trashDir?: string;
	retentionDays?: number;
	now?: number;
}): Promise<number> {
	const retentionDays = options?.retentionDays ?? (await resolveTrashRetentionDays());
	if (!Number.isFinite(retentionDays) || retentionDays <= 0) return 0;

	const trashDir = options?.trashDir ?? defaultTrashSessionsDir();
	let names: string[];
	try {
		names = await fsp.readdir(trashDir);
	} catch (err) {
		if (isEnoent(err)) return 0;
		throw err;
	}

	const cutoff = (options?.now ?? Date.now()) - retentionDays * 24 * 60 * 60 * 1000;
	let removed = 0;
	for (const name of names) {
		const dir = path.join(trashDir, name);
		const manifest = await readManifest(dir);
		let expired: boolean;
		if (manifest) {
			const trashedAt = Date.parse(manifest.trashedAt);
			expired = Number.isFinite(trashedAt) ? trashedAt < cutoff : true;
		} else {
			try {
				const { mtimeMs } = await fsp.stat(dir);
				expired = mtimeMs < cutoff;
			} catch {
				continue;
			}
		}
		if (!expired) continue;
		try {
			await fsp.rm(dir, { recursive: true, force: true });
			removed++;
		} catch (err) {
			logger.warn("Trash entry could not be removed during sweep", {
				trashEntry: dir,
				error: (err as Error).message,
			});
		}
	}
	if (removed > 0) logger.info("Session trash sweep removed expired entries", { removed, retentionDays });
	return removed;
}

/**
 * `session.trashRetentionDays` from the global settings singleton, falling
 * back to the default when settings are not initialized (tests, early boot).
 */
async function resolveTrashRetentionDays(): Promise<number> {
	try {
		return cfgSessionTrashRetentionDays.get(Settings.instance);
	} catch {
		return DEFAULT_TRASH_RETENTION_DAYS;
	}
}

let sweepScheduled = false;

/**
 * Schedule the fire-and-forget trash sweeper for this process: once shortly
 * after startup (never blocking it) and then on a long interval. Idempotent;
 * both timers are unref'd so they cannot hold the process open.
 */
export function scheduleTrashSweep(): void {
	if (sweepScheduled) return;
	sweepScheduled = true;
	const run = () => {
		sweepExpiredTrash().catch(err => logger.warn("Session trash sweep failed", { error: (err as Error).message }));
	};
	const startup = setTimeout(run, SWEEP_STARTUP_DELAY_MS);
	startup.unref?.();
	const interval = setInterval(run, SWEEP_INTERVAL_MS);
	interval.unref?.();
}
