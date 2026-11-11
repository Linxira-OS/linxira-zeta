/**
 * Context hot-reload: watch the files a session's system prompt was actually rendered
 * from and hand the turn boundary one signal — "the prompt bytes changed, rebuild".
 *
 * The rebuild itself is not this module's job. `SessionTools.refreshBaseSystemPrompt()`
 * already re-discovers context files, re-reads a discovery-based custom prompt, compares
 * the rendered bytes, and invalidates the inherited prompt-cache key only when they
 * change. This service only decides *when* to call it:
 *
 * - **bounded stat** of the session's discovered files (size, mtimeMs, inode) at the start
 *   of a turn — a file rewritten in place, renamed over, deleted, or (re)appearing is a
 *   change; a byte-identical rewrite is not. Sets larger than the per-turn window rotate
 *   instead of starving their tail, and a change to the set itself counts as a change;
 * - **depth-0 watchers** on the directories of those files plus the session cwd, so a new
 *   file is noticed without walking a tree. A watcher event never rebuilds by itself: it
 *   marks the service dirty and the next turn boundary refreshes;
 * - **generation guard**: every dirty mark bumps a generation, and the refresh commits
 *   only while that generation, `isCurrent`, and `!disposed` still hold, so a slow reload
 *   can never overwrite a newer prompt;
 * - **no mid-turn mutation**: nothing here touches a request that is already streaming.
 *
 * Timers and watchers are unref'd and closed by {@link ContextReloadService.dispose}; the
 * service also disposes itself the first time it observes a disposed session.
 */
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { logger } from "@linxiraos/pi-utils";

/** A file's identity for change detection. */
export interface FileStamp {
	size: number;
	mtimeMs: number;
	ino: number;
}

/** A live directory watcher. */
export interface WatchHandle {
	close(): void;
	unref?(): void;
}

export interface ContextReloadOptions {
	/** The session's actual discovered files (context files + custom prompt files). */
	readWatchPaths: () => readonly string[];
	/** Directories always watched at depth 0; normally the session cwd. */
	watchRoots?: () => readonly string[];
	/** The single existing refresh path; `isCurrent` drops a stale rebuild before it commits. */
	refresh: (isCurrent: () => boolean) => Promise<void>;
	/** Whether the owning session has been disposed (the service then disposes itself). */
	isDisposed?: () => boolean;
	/** Watcher debounce before the service is marked dirty. Default 150ms. */
	debounceMs?: number;
	/** Files stat'ed per turn. Default 64; a larger set rotates so none is starved. */
	maxFiles?: number;
	/** Watch directories at all. Default true; tests turn it off to drive `markDirty`. */
	watch?: boolean;
	/** Test seam for {@link fsp.stat}. */
	statFile?: (filePath: string) => Promise<FileStamp | null>;
	/** Test seam for {@link fs.watch}. */
	watchDirectory?: (directory: string, onChange: () => void) => WatchHandle | undefined;
}

export interface ContextReloadService {
	/** Stat the watch set and refresh when anything changed or a watcher fired. */
	beforeRequest(isCurrent?: () => boolean): Promise<boolean>;
	/** A watcher (or an explicit caller) reports that something may have changed. */
	markDirty(): void;
	dispose(): void;
	readonly dirty: boolean;
	readonly generation: number;
	/** Paths currently considered, for diagnostics and tests. */
	readonly watchPaths: readonly string[];
}

const DEFAULT_DEBOUNCE_MS = 150;
const DEFAULT_MAX_FILES = 64;
/** Hard cap on remembered paths; a larger discovery set is a bug, not a watch target. */
const MAX_TRACKED_PATHS = 512;
/** Directory watchers are capped so a pathological watch set cannot exhaust handles. */
const MAX_WATCHED_DIRECTORIES = 24;

/** Stat a path, or `null` when it is missing/unreadable (both count as "absent"). */
async function defaultStatFile(filePath: string): Promise<FileStamp | null> {
	try {
		const stats = await fsp.stat(filePath);
		if (!stats.isFile()) return null;
		return { size: stats.size, mtimeMs: stats.mtimeMs, ino: stats.ino };
	} catch {
		return null;
	}
}

/** Watch one directory without keeping the process alive. */
function defaultWatchDirectory(directory: string, onChange: () => void): WatchHandle | undefined {
	try {
		const watcher = fs.watch(directory, { persistent: false }, () => onChange());
		return {
			close: () => watcher.close(),
			unref: () => watcher.unref?.(),
		};
	} catch (error) {
		// A directory that vanished or is unwatchable simply reports nothing; the
		// per-turn bounded stat still catches its files.
		logger.debug("context-reload: cannot watch directory", { directory, error: String(error) });
		return undefined;
	}
}

function sameStamp(left: FileStamp | null, right: FileStamp | null): boolean {
	if (left === null || right === null) return left === right;
	return left.size === right.size && left.mtimeMs === right.mtimeMs && left.ino === right.ino;
}

function uniquePaths(paths: Iterable<string>): string[] {
	const seen = new Set<string>();
	const unique: string[] = [];
	for (const candidate of paths) {
		const resolved = path.resolve(candidate);
		if (seen.has(resolved)) continue;
		seen.add(resolved);
		unique.push(resolved);
	}
	return unique;
}

class ContextReload implements ContextReloadService {
	readonly #options: ContextReloadOptions;
	readonly #statFile: (filePath: string) => Promise<FileStamp | null>;
	readonly #watchDirectory: (directory: string, onChange: () => void) => WatchHandle | undefined;
	readonly #debounceMs: number;
	readonly #maxFiles: number;
	readonly #watching: boolean;

	/** Last committed observation per watched path (a slice is refreshed per turn). */
	#stamps = new Map<string, FileStamp | null>();
	/** Sorted path-list digest; a discovered set change (add/remove) is itself a change. */
	#pathListFingerprint: string | undefined;
	/** First index of the next stat window, so a set larger than `maxFiles` rotates. */
	#rotation = 0;
	/** Window start computed for the current turn; advanced only when its result commits. */
	#pendingRotation = 0;
	#watchPaths: readonly string[] = [];
	#watchedDirectories = new Map<string, WatchHandle>();
	#generation = 0;
	#dirty = false;
	#disposed = false;
	#debounceTimer: NodeJS.Timeout | undefined;
	/** Seeding runs once, so the first observation is a baseline and never a "change". */
	#seeded: Promise<void>;

	constructor(options: ContextReloadOptions) {
		this.#options = options;
		this.#statFile = options.statFile ?? defaultStatFile;
		this.#watchDirectory = options.watchDirectory ?? defaultWatchDirectory;
		this.#debounceMs = Math.max(0, options.debounceMs ?? DEFAULT_DEBOUNCE_MS);
		this.#maxFiles = Math.max(1, options.maxFiles ?? DEFAULT_MAX_FILES);
		this.#watching = options.watch !== false;
		this.#seeded = this.#seed().catch(error => {
			logger.debug("context-reload: initial watch baseline failed", { error: String(error) });
		});
	}

	get dirty(): boolean {
		return this.#dirty;
	}

	get generation(): number {
		return this.#generation;
	}

	get watchPaths(): readonly string[] {
		return this.#watchPaths;
	}

	async beforeRequest(isCurrent?: () => boolean): Promise<boolean> {
		if (this.#disposed) return false;
		await this.#seeded;
		if (this.#disposed) return false;
		if (this.#options.isDisposed?.()) {
			this.dispose();
			return false;
		}

		const paths = this.#collectPaths();
		this.#watchPaths = paths;
		const window = this.#statWindow(paths);
		const observed = await this.#observe(window);
		if (this.#disposed) return false;
		const fingerprint = `${paths.length}:${paths.join("\u0000")}`;
		const setChanged = this.#pathListFingerprint !== undefined && this.#pathListFingerprint !== fingerprint;
		const changed = setChanged || this.#hasChanges(observed);
		if (!changed && !this.#dirty) {
			this.#reconcileWatchers(paths);
			return false;
		}

		const generationAtStart = this.#generation;
		const stillCurrent = () => !this.#disposed && this.#generation === generationAtStart && (isCurrent?.() ?? true);
		try {
			await this.#options.refresh(stillCurrent);
		} catch (error) {
			// Keep the dirty bit and the previous stamps: the next boundary retries, and a
			// failed rebuild must not look like an applied one.
			logger.debug("context-reload: refresh failed", { error: String(error) });
			return false;
		}
		if (this.#disposed) return false;
		// A newer change arrived while the rebuild ran; leave it for the next boundary.
		if (this.#generation === generationAtStart) {
			this.#dirty = false;
			this.#commitObservation(paths, window, observed, fingerprint);
		}
		this.#reconcileWatchers(paths);
		return true;
	}

	markDirty(): void {
		if (this.#disposed) return;
		this.#generation++;
		this.#dirty = true;
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		if (this.#debounceTimer !== undefined) {
			clearTimeout(this.#debounceTimer);
			this.#debounceTimer = undefined;
		}
		for (const handle of this.#watchedDirectories.values()) {
			try {
				handle.close();
			} catch {
				// already closed
			}
		}
		this.#watchedDirectories.clear();
		this.#stamps.clear();
	}

	/** Baseline the watched paths and start the directory watchers. */
	async #seed(): Promise<void> {
		if (this.#disposed) return;
		const paths = this.#collectPaths();
		this.#watchPaths = paths;
		const window = this.#statWindow(paths);
		const observed = await this.#observe(window);
		if (this.#disposed) return;
		this.#commitObservation(paths, window, observed, `${paths.length}:${paths.join("\u0000")}`);
		this.#reconcileWatchers(paths);
	}

	#collectPaths(): string[] {
		try {
			return uniquePaths(this.#options.readWatchPaths()).slice(0, MAX_TRACKED_PATHS);
		} catch (error) {
			// A host provider that cannot answer yet is an empty watch set, not a crash.
			logger.debug("context-reload: watch-path provider failed", { error: String(error) });
			return [];
		}
	}

	/**
	 * The slice stat'ed this turn. With more paths than `maxFiles` the window rotates, so
	 * every file is checked within `ceil(size / maxFiles)` turns instead of the tail being
	 * silently stale forever.
	 */
	#statWindow(paths: readonly string[]): string[] {
		if (paths.length <= this.#maxFiles) {
			this.#pendingRotation = 0;
			return [...paths];
		}
		const start = this.#rotation % paths.length;
		const window: string[] = [];
		for (let offset = 0; offset < this.#maxFiles; offset++) {
			window.push(paths[(start + offset) % paths.length]!);
		}
		this.#pendingRotation = (start + this.#maxFiles) % paths.length;
		return window;
	}

	/** Merge this window's stamps, forget paths the set dropped, remember the set digest. */
	#commitObservation(
		paths: readonly string[],
		window: readonly string[],
		observed: ReadonlyMap<string, FileStamp | null>,
		fingerprint: string,
	): void {
		const tracked = new Set(paths);
		for (const filePath of [...this.#stamps.keys()]) {
			if (!tracked.has(filePath)) this.#stamps.delete(filePath);
		}
		for (const [filePath, stamp] of observed) {
			if (tracked.has(filePath)) this.#stamps.set(filePath, stamp);
		}
		if (window.length === 0) this.#stamps.clear();
		else this.#rotation = this.#pendingRotation;
		this.#pathListFingerprint = fingerprint;
	}

	/** Stat every watched path; a missing/unreadable path is recorded as `null`. */
	async #observe(paths: readonly string[]): Promise<Map<string, FileStamp | null>> {
		const stats = await Promise.all(
			paths.map(async filePath => {
				try {
					return await this.#statFile(filePath);
				} catch {
					return null;
				}
			}),
		);
		const observed = new Map<string, FileStamp | null>();
		for (let index = 0; index < paths.length; index++) {
			observed.set(paths[index]!, stats[index] ?? null);
		}
		return observed;
	}

	/**
	 * A path that is new to the set seeds itself (the rebuild that produced the set already
	 * rendered it); every previously known path is compared.
	 */
	#hasChanges(observed: ReadonlyMap<string, FileStamp | null>): boolean {
		for (const [filePath, stamp] of observed) {
			if (!this.#stamps.has(filePath)) continue;
			if (!sameStamp(this.#stamps.get(filePath) ?? null, stamp)) return true;
		}
		return false;
	}

	/** Keep exactly the watchers for the directories the current set needs. */
	#reconcileWatchers(paths: readonly string[]): void {
		if (!this.#watching || this.#disposed) return;
		let roots: readonly string[] = [];
		try {
			roots = this.#options.watchRoots?.() ?? [];
		} catch (error) {
			logger.debug("context-reload: watch-root provider failed", { error: String(error) });
		}
		const directories = uniquePaths([...paths.map(filePath => path.dirname(filePath)), ...roots]).slice(
			0,
			MAX_WATCHED_DIRECTORIES,
		);
		const wanted = new Set(directories);
		for (const [directory, handle] of this.#watchedDirectories) {
			if (wanted.has(directory)) continue;
			try {
				handle.close();
			} catch {
				// already closed
			}
			this.#watchedDirectories.delete(directory);
		}
		for (const directory of directories) {
			if (this.#watchedDirectories.has(directory)) continue;
			const handle = this.#watchDirectory(directory, () => this.#scheduleDirty());
			if (!handle) continue;
			handle.unref?.();
			this.#watchedDirectories.set(directory, handle);
		}
	}

	/** Collapse a burst of filesystem events into one dirty mark for the next turn. */
	#scheduleDirty(): void {
		if (this.#disposed || this.#debounceTimer !== undefined) return;
		this.#debounceTimer = setTimeout(() => {
			this.#debounceTimer = undefined;
			this.markDirty();
		}, this.#debounceMs);
		// Never keep the process alive for a pending debounce.
		this.#debounceTimer.unref();
	}
}

/** Build a context-reload service; call `beforeRequest` at each turn boundary. */
export function createContextReloadService(options: ContextReloadOptions): ContextReloadService {
	return new ContextReload(options);
}
