import * as path from "node:path";
import { isEnoent, PLUGINS_LOCKFILE_LEGACY, pluginsLockfileReadOrder } from "@linxiraos/pi-utils";
import type { PluginRuntimeConfig } from "./types";

/** Normalizes persisted plugin runtime config across legacy lockfile shapes. */
export function normalizePluginRuntimeConfig(config: Partial<PluginRuntimeConfig>): PluginRuntimeConfig {
	return {
		plugins: config.plugins ?? {},
		settings: config.settings ?? {},
	};
}

/**
 * What reading a plugins root's runtime config produced.
 *
 * `empty` with an `error` means no spelling of the lockfile could be read and
 * something other than "it is not there" went wrong — the caller decides
 * whether that is fatal (the loader skips a sandboxed plugin root) or a
 * warning (the manager reports the path and carries on with no state).
 */
export type PluginRuntimeConfigRead =
	| { status: "read"; path: string; config: PluginRuntimeConfig; legacy: boolean }
	| { status: "empty"; error?: { path: string; error: unknown } };

/**
 * Read the plugin runtime config recorded beside `lockfilePath`.
 *
 * Read-old / write-new: the canonical Zeta name is asked for first, the
 * pre-rename one second, so an install that has not been migrated yet keeps its
 * enabled flags and feature selection. A path outside the two known spellings
 * (a caller- or test-supplied path) reads exactly that path.
 *
 * The read is lenient by design: a candidate that cannot be read at all
 * (absent, a directory, EACCES) does not stop the next spelling from being
 * tried, because losing the user's plugin state is worse than a stale
 * filename. Nothing is written here — migration belongs to whoever owns the
 * lockfile (see the loader).
 */
export async function readPluginRuntimeConfig(lockfilePath: string): Promise<PluginRuntimeConfigRead> {
	let failure: { path: string; error: unknown } | undefined;
	for (const candidate of pluginsLockfileReadOrder(lockfilePath)) {
		try {
			const config = normalizePluginRuntimeConfig(
				(await Bun.file(candidate).json()) as Partial<PluginRuntimeConfig>,
			);
			return {
				status: "read",
				path: candidate,
				config,
				legacy: path.basename(candidate) === PLUGINS_LOCKFILE_LEGACY,
			};
		} catch (err) {
			if (failure === undefined && !isEnoent(err)) failure = { path: candidate, error: err };
		}
	}
	return { status: "empty", ...(failure ? { error: failure } : {}) };
}
