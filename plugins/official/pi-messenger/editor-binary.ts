/**
 * Editor binary resolution — find `zeta-editor`, install it when missing.
 *
 * The editor ships as its own npm package (`@linxiraos/editor`) with
 * per-platform binary packages, so a fresh zeta install does not have it.
 * Refusing the switch with "install it yourself" is a dead end for the user,
 * so the default behaviour installs the package on demand.
 *
 * The Linux case needs care: a system Node often has a root-owned global
 * prefix, so `npm i -g` fails with EACCES. Retrying under sudo is the
 * documented remedy, but only when we are not already root and sudo exists —
 * silently prompting from a non-interactive spawn would hang.
 */

import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** npm package that carries the editor binary for the current platform. */
const EDITOR_PACKAGE = "@linxiraos/editor";

/** Candidate locations for the `zeta-editor` launcher, most specific first. */
export function editorBinaryCandidates(): string[] {
	const home = os.homedir();
	const binName = process.platform === "win32" ? "zeta-editor.cmd" : "zeta-editor";
	return [
		// npm global install next to the running zeta binary
		path.join(path.dirname(process.execPath), binName),
		// zeta's own plugin tree (the editor can be installed as a plugin dep)
		path.join(home, ".zeta", "plugins", "node_modules", ".bin", binName),
		// project-local install
		path.join(process.cwd(), "node_modules", ".bin", binName),
	];
}

/** Absolute path to the launcher, or null when the package is not installed. */
export function findEditorBinary(): string | null {
	for (const candidate of editorBinaryCandidates()) {
		try {
			fs.accessSync(candidate, fs.constants.X_OK);
			return candidate;
		} catch {
			// not here — keep looking
		}
	}
	// A global install may be on PATH without matching any candidate.
	const probe = process.platform === "win32" ? "where" : "which";
	const result = cp.spawnSync(probe, ["zeta-editor"], { encoding: "utf8" });
	if (result.status === 0 && result.stdout.trim()) {
		return result.stdout.trim().split(/\r?\n/)[0].trim();
	}
	return null;
}

export interface InstallResult {
	ok: boolean;
	/** Human-readable outcome for the status line. */
	message: string;
	/** Set when the install needs elevation the caller should surface. */
	needsSudo?: boolean;
}

/**
 * Install the editor package globally. `npm` is used rather than `bun add -g`
 * because npm is the one guaranteed present wherever zeta itself was installed
 * with npm, and the editor's optionalDependencies resolve identically.
 */
export function installEditorPackage(timeoutMs = 180_000): InstallResult {
	const attempt = (argv: string[]): cp.SpawnSyncReturns<string> =>
		cp.spawnSync(argv[0], argv.slice(1), { encoding: "utf8", timeout: timeoutMs });

	let result = attempt(["npm", "install", "-g", EDITOR_PACKAGE]);
	if (result.status === 0) {
		return { ok: true, message: `Installed ${EDITOR_PACKAGE}` };
	}

	const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`;
	const permissionDenied = /EACCES|EPERM|permission denied|is not in the sudoers/i.test(combined);

	// Linux/macOS with a root-owned global prefix: retry elevated, but only
	// when sudo exists and we are not already root (sudo as root is a no-op
	// that masks the real error).
	if (permissionDenied && process.platform !== "win32" && process.getuid?.() !== 0) {
		const sudoExists = cp.spawnSync("sh", ["-c", "command -v sudo"], { encoding: "utf8" }).status === 0;
		if (sudoExists) {
			result = attempt(["sudo", "-n", "npm", "install", "-g", EDITOR_PACKAGE]);
			if (result.status === 0) {
				return { ok: true, message: `Installed ${EDITOR_PACKAGE} (elevated)` };
			}
			// -n fails when a password would be needed; tell the user the exact
			// command instead of hanging on an invisible prompt.
			return {
				ok: false,
				needsSudo: true,
				message: `Global install needs elevation. Run: sudo npm install -g ${EDITOR_PACKAGE}`,
			};
		}
		return {
			ok: false,
			message: `Global npm prefix is not writable and sudo is unavailable. Run: npm install -g ${EDITOR_PACKAGE} from an account that can write it, or set a user-level prefix (npm config set prefix ~/.npm-global).`,
		};
	}

	const firstError = combined.split(/\r?\n/).find(line => line.trim().length > 0) ?? "unknown npm error";
	return { ok: false, message: `Could not install ${EDITOR_PACKAGE}: ${firstError}` };
}

/**
 * Resolve the editor binary, installing the package first when the caller
 * allows it. Returns the path plus what happened, so the caller can report an
 * install that succeeded (or explain one that did not).
 */
export function ensureEditorBinary(autoInstall: boolean): { binary: string | null; note?: string; error?: string } {
	const existing = findEditorBinary();
	if (existing) return { binary: existing };
	if (!autoInstall) {
		return {
			binary: null,
			error: `The editor is not installed. Run: npm install -g ${EDITOR_PACKAGE} (or enable Editor → Auto-install Editor).`,
		};
	}
	const install = installEditorPackage();
	if (!install.ok) return { binary: null, error: install.message };
	// npm puts the launcher on PATH for new shells; probe the known locations
	// first so we do not depend on the current process's PATH being refreshed.
	const installed = findEditorBinary();
	if (installed) return { binary: installed, note: install.message };
	return { binary: "zeta-editor", note: `${install.message} (launcher resolved via PATH)` };
}
