/**
 * Hot-reload watcher for TypeScript custom commands.
 *
 * Editing `commands/<name>/index.*` reloads that command without restarting the
 * session. The structure mirrors the settings config watcher
 * (`config/settings.ts`): directories are watched rather than files so an atomic
 * rename-over write stays observable, events are debounced, the watch set is
 * reconciled with discovery after every reload, and a failed reload keeps the
 * last good state instead of tearing the watch down.
 *
 * Watching is intentionally shallow: each command root catches command
 * directories appearing or disappearing, and each command directory catches its
 * depth-1 `index.*` entry. Files a command imports are not watched — a command
 * graph is re-read through its own entry only.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { isEnoent, logger } from "@linxiraos/pi-utils";
import { CUSTOM_COMMAND_INDEX_FILENAMES, type DiscoverCustomCommandsResult, discoverCustomCommands } from "./loader";

/** Debounce window that collapses a burst of writes into one reload. */
export const CUSTOM_COMMAND_WATCH_DEBOUNCE_MS = 200;

export interface CustomCommandWatcherOptions {
	/**
	 * Command discovery root. Default: from the loader's `getProjectDir()`.
	 * Fixed for the watcher's lifetime, so every reload re-reads the same command
	 * directories the caller discovered (not a cwd the session may have moved to).
	 */
	cwd?: string;
	/** Agent config directory. Default: from the loader's `getAgentDir()`. */
	agentDir?: string;
	/** Debounce window in ms. Default: {@link CUSTOM_COMMAND_WATCH_DEBOUNCE_MS}. */
	debounceMs?: number;
	/**
	 * Reload callback, run after the debounce window settles. Awaited before the
	 * watcher re-targets itself, so the watch set follows the reload it caused.
	 * Throwing is contained: the watcher logs and re-targets without stopping.
	 */
	onChange: () => void | Promise<void>;
}

interface WatchedDir {
	watcher: fs.FSWatcher;
	/** Filenames that trigger a reload, or `null` when any entry in the directory does. */
	names: ReadonlySet<string> | null;
}

export class CustomCommandWatcher {
	readonly #cwd: string | undefined;
	readonly #agentDir: string | undefined;
	readonly #debounceMs: number;
	readonly #onChange: () => void | Promise<void>;
	readonly #watchers = new Map<string, WatchedDir>();
	/** Tail of the serialized reload chain, so overlapping edits apply in order. */
	#reload: Promise<void> = Promise.resolve();
	#timer: NodeJS.Timeout | undefined;
	#started = false;
	#stopped = false;

	constructor(options: CustomCommandWatcherOptions) {
		this.#cwd = options.cwd;
		this.#agentDir = options.agentDir;
		this.#debounceMs = options.debounceMs ?? CUSTOM_COMMAND_WATCH_DEBOUNCE_MS;
		this.#onChange = options.onChange;
	}

	/**
	 * Arm directory watchers for the current custom-command set. Never rejects:
	 * a directory this process cannot watch is skipped, and a discovery failure
	 * leaves the existing watch set in place.
	 *
	 * Arming also queues one reload. The caller's command set was read before
	 * this watch existed and Bun arms platform watchers asynchronously, so a write
	 * in between (or any edit during startup) raises no event; one discovery
	 * afterwards settles the window, and its own re-sync arms nothing new.
	 */
	async start(): Promise<void> {
		if (this.#started || this.#stopped) return;
		this.#started = true;
		await this.#sync();
	}

	/** Stop watching and drop every pending reload. Idempotent. */
	stop(): void {
		this.#stopped = true;
		if (this.#timer !== undefined) {
			clearTimeout(this.#timer);
			this.#timer = undefined;
		}
		for (const { watcher } of this.#watchers.values()) watcher.close();
		this.#watchers.clear();
	}

	/**
	 * Reconcile the watch set with the current command directories. New watchers
	 * queue a reload, because a directory that just joined the watch set may
	 * already hold the edit (or the new command) that put it there.
	 */
	async #sync(): Promise<void> {
		let discovered: DiscoverCustomCommandsResult;
		try {
			discovered = await discoverCustomCommands({ cwd: this.#cwd, agentDir: this.#agentDir });
		} catch (error) {
			// Discovery itself failed (an unexpected filesystem error, since
			// per-directory read failures are contained): keep the last watch set.
			logger.warn("Custom commands: command directory scan failed", { error: String(error) });
			return;
		}
		if (this.#stopped) return;

		const targets = this.#targets(discovered);
		for (const [dir, entry] of this.#watchers) {
			if (targets.has(dir)) continue;
			entry.watcher.close();
			this.#watchers.delete(dir);
		}

		let armed = false;
		for (const [dir, names] of targets) {
			const existing = this.#watchers.get(dir);
			if (existing) {
				existing.names = names;
				continue;
			}
			let watcher: fs.FSWatcher;
			try {
				watcher = fs.watch(dir, { persistent: false }, (_event, filename) => {
					const entry = this.#watchers.get(dir);
					if (!entry || entry.watcher !== watcher) return;
					if (entry.names && filename && !entry.names.has(path.basename(filename.toString()))) return;
					this.#schedule();
				});
			} catch (error) {
				if (!isEnoent(error)) {
					logger.debug("Custom commands: cannot watch command directory", { path: dir, error: String(error) });
				}
				continue;
			}
			watcher.on("error", error => {
				logger.debug("Custom commands: command directory watcher failed", { path: dir, error: String(error) });
				watcher.close();
				if (this.#watchers.get(dir)?.watcher === watcher) this.#watchers.delete(dir);
			});
			this.#watchers.set(dir, { watcher, names });
			armed = true;
		}
		if (armed) this.#schedule();
	}

	/** Watch targets: directory → triggering filenames (`null` = any entry). */
	#targets(discovered: DiscoverCustomCommandsResult): Map<string, ReadonlySet<string> | null> {
		const targets = new Map<string, ReadonlySet<string> | null>();
		// A command root reports command directories being added or removed; the
		// root itself never holds a module.
		for (const { path: dir } of discovered.dirs) {
			if (!targets.has(dir)) targets.set(dir, null);
		}
		// Each discovered module watches the directory that holds it, filtered to
		// `index.*` so unrelated files in that directory do not trigger reloads.
		for (const { path: file } of discovered.paths) {
			const dir = path.dirname(file);
			if (!targets.has(dir)) targets.set(dir, new Set<string>(CUSTOM_COMMAND_INDEX_FILENAMES));
		}
		return targets;
	}

	#schedule(): void {
		if (this.#stopped) return;
		clearTimeout(this.#timer);
		this.#timer = setTimeout(() => {
			this.#timer = undefined;
			void this.#run();
		}, this.#debounceMs);
		// A pending reload must never keep the process alive.
		this.#timer.unref();
	}

	async #run(): Promise<void> {
		const run = this.#reload
			.catch(() => {})
			.then(async () => {
				if (this.#stopped) return;
				try {
					await this.#onChange();
				} catch (error) {
					logger.warn("Custom commands: failed to apply on-disk command change", { error: String(error) });
				}
				if (this.#stopped) return;
				// Command directories may have appeared or vanished; re-target.
				await this.#sync();
			});
		this.#reload = run;
		await run;
	}
}
