/**
 * Unified suite-binary discovery — the product ruling every surface shares:
 *
 *   ① explicit env   — `ZETA_BIN_DIR` (delimiter-separated dirs, probed
 *                      before PATH; unset/empty = no override)
 *   ② PATH           — native binaries as installed (distro pacman puts
 *                      `/usr/bin/zetawork` & co. here); a PATH hit is used
 *                      directly, with no cross-component version validation
 *   ③ npm-form fallback — the global-bin dirs npm/pnpm/bun install launcher
 *                      shims into (the same set zetawork's Rust prober
 *                      augments Windows PATH with); the npm launcher shim
 *                      itself (`main/npm/main/bin/zeta.js`) resolves the
 *                      vendored platform-leaf binary at this tier
 *
 * The `which`-style probe primitive lives here too so the tier composition
 * and PATH semantics cannot drift between callers.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/** Explicit discovery override: delimiter-separated directories, probed first. */
export const ZETA_BIN_DIR_ENV = "ZETA_BIN_DIR";

/** Injectable process snapshot so probes are testable without a real PATH/fs. */
export interface OpenProbeContext {
	platform: NodeJS.Platform;
	env: NodeJS.ProcessEnv;
	exists: (candidate: string) => boolean;
	now: () => number;
}

export function defaultProbeContext(): OpenProbeContext {
	return {
		platform: process.platform,
		env: process.env,
		exists: candidate => {
			try {
				return fs.existsSync(candidate);
			} catch {
				return false;
			}
		},
		now: () => Date.now(),
	};
}

/** Platform-faithful select so POSIX chains test correctly on a Windows host. */
export function pathImpl(platform: NodeJS.Platform): typeof path.posix {
	return platform === "win32" ? path.win32 : path.posix;
}

// --- which-style PATH probing ---

const WINDOWS_DEFAULT_PATHEXT = [".com", ".exe", ".bat", ".cmd"];

function windowsPathext(env: NodeJS.ProcessEnv): string[] {
	const raw = env.PATHEXT;
	if (raw) {
		const parsed = raw
			.split(";")
			.map(ext => ext.trim().toLowerCase())
			.filter(ext => /^\.[a-z0-9]+$/.test(ext));
		if (parsed.length > 0) return ["", ...parsed];
	}
	return ["", ...WINDOWS_DEFAULT_PATHEXT];
}

/**
 * `which`-style lookup across PATH. Windows tries each dir with the bare name
 * first, then every PATHEXT-style extension (npm shims are `.cmd`, native
 * tools `.exe`); other platforms take the bare name. Returns the absolute
 * path of the first match, or null.
 */
export function whichCommand(command: string, ctx: OpenProbeContext): string | null {
	const name = command.trim();
	if (!name || name.includes("\0") || /[/\\]/.test(name)) return null;
	const extensions = ctx.platform === "win32" ? windowsPathext(ctx.env) : [""];
	for (const dir of (ctx.env.PATH ?? "").split(ctx.platform === "win32" ? ";" : ":")) {
		if (!dir) continue;
		for (const ext of extensions) {
			const candidate = pathImpl(ctx.platform).join(dir, name + ext);
			if (ctx.exists(candidate)) return candidate;
		}
	}
	return null;
}

// --- unified tier composition ---

function pathSeparator(platform: NodeJS.Platform): string {
	return platform === "win32" ? ";" : ":";
}

/** Tier ①: `ZETA_BIN_DIR` entries in order; unset/empty yields nothing. */
export function explicitBinDirs(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): string[] {
	const raw = env[ZETA_BIN_DIR_ENV];
	if (!raw) return [];
	return raw
		.split(pathSeparator(platform))
		.map(dir => dir.trim())
		.filter(dir => dir.length > 0);
}

/**
 * Tier ③: the npm/pnpm/bun global-bin dirs — where the npm form installs
 * launcher shims. Mirrors zetawork's Rust `augmented_windows_dirs` set;
 * POSIX keeps only the bun dir because npm/distro global bins live on PATH
 * there by convention (tier ② already covers them).
 */
export function npmFormBinDirs(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): string[] {
	if (platform === "win32") {
		return [
			...(env.APPDATA ? [path.win32.join(env.APPDATA, "npm")] : []),
			...(env.LOCALAPPDATA ? [path.win32.join(env.LOCALAPPDATA, "pnpm")] : []),
			...(env.USERPROFILE ? [path.win32.join(env.USERPROFILE, ".bun", "bin")] : []),
		];
	}
	const home = env.HOME ?? env.USERPROFILE;
	return home ? [path.posix.join(home, ".bun", "bin")] : [];
}

/**
 * First hit for `names` across the unified tiers: ① explicit env, ② PATH,
 * ③ npm-form dirs. Alias-major within a tier (the first bin name wins
 * everywhere before the next alias is tried), tier-major across. Returns the
 * resolved absolute path, or null when no tier has the binary.
 */
export function discoverBin(
	names: readonly string[],
	opts: { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; exists?: (candidate: string) => boolean } = {},
): string | null {
	const platform = opts.platform ?? process.platform;
	const env = opts.env ?? process.env;
	const base = defaultProbeContext();
	const ctx: OpenProbeContext = {
		platform,
		env,
		exists: opts.exists ?? base.exists,
		now: base.now,
	};
	const separator = pathSeparator(platform);
	for (const dirs of [
		explicitBinDirs(env, platform),
		(env.PATH ?? "").split(separator),
		npmFormBinDirs(env, platform),
	]) {
		if (dirs.length === 0) continue;
		// Reuse the primitive over a synthetic PATH so PATHEXT/dir-order
		// semantics stay identical in every tier.
		const tierCtx: OpenProbeContext = { ...ctx, env: { ...env, PATH: dirs.filter(Boolean).join(separator) } };
		for (const name of names) {
			const found = whichCommand(name, tierCtx);
			if (found) return found;
		}
	}
	return null;
}
