import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isEnoent } from "@linxiraos/pi-utils";
import { replaceFileAtomically } from "../../utils/atomic-file";
import type { PluginRuntimeConfig } from "./types";

/** Normalizes persisted plugin runtime config across legacy lockfile shapes. */
export function normalizePluginRuntimeConfig(config: Partial<PluginRuntimeConfig>): PluginRuntimeConfig {
	return {
		plugins: config.plugins ?? {},
		settings: config.settings ?? {},
	};
}

/**
 * Write a plugin runtime lockfile readable only by its owner.
 *
 * The lockfile holds plugin settings, and a setting a plugin marks `secret` is
 * a credential the user asked to be masked. The config is staged in a fresh
 * 0600 sibling and renamed over the lockfile, so the credential never lands in
 * an older, wider-mode inode another account may already hold open.
 */
export async function writePluginRuntimeConfig(lockPath: string, config: PluginRuntimeConfig): Promise<void> {
	await fs.mkdir(path.dirname(lockPath), { recursive: true });
	const tmpPath = `${lockPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
	try {
		await fs.writeFile(tmpPath, JSON.stringify(config, null, 2), { mode: 0o600, flag: "wx" });
		await replaceFileAtomically(tmpPath, lockPath);
	} finally {
		await fs.rm(tmpPath, { force: true }).catch(() => {});
	}
}

/**
 * What reading a plugins root's runtime config produced.
 *
 * `empty` with an `error` means the lockfile could not be read and something
 * other than "it is not there" went wrong — the caller decides whether that is
 * fatal (the loader skips a sandboxed plugin root) or a warning (the manager
 * reports the path and carries on with no state).
 */
export type PluginRuntimeConfigRead =
	| { status: "read"; path: string; config: PluginRuntimeConfig }
	| { status: "empty"; error?: { path: string; error: unknown } };

/**
 * Read the plugin runtime config at `lockfilePath`.
 *
 * The read is lenient by design: an absent, unreadable or malformed lockfile
 * yields `empty` so plugin loading carries on; losing the user's plugin state
 * is worse than reporting no state.
 */
export async function readPluginRuntimeConfig(lockfilePath: string): Promise<PluginRuntimeConfigRead> {
	try {
		const config = normalizePluginRuntimeConfig(
			(await Bun.file(lockfilePath).json()) as Partial<PluginRuntimeConfig>,
		);
		return { status: "read", path: lockfilePath, config };
	} catch (err) {
		return { status: "empty", ...(isEnoent(err) ? {} : { error: { path: lockfilePath, error: err } }) };
	}
}
