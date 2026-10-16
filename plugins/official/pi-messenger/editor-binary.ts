/**
 * Editor binary resolution — resolve the platform executable of
 * `@linxiraos/editor`, install it when missing.
 *
 * The editor ships as its own npm package (`@linxiraos/editor`) with
 * per-platform binary packages, so a fresh zeta install does not have it.
 * Refusing the switch with "install it yourself" is a dead end for the user,
 * so the default behaviour installs the package on demand.
 *
 * There is no editor *command* to probe: the one command surface is
 * zetawork / zetacode / zetaide, and `@linxiraos/editor` deliberately ships no
 * `bin`. The platform leaf's executable (`<leaf>/bin/termide-editor[.exe]`) is
 * therefore resolved by path — the built-in editor's editor-only entry, which
 * the package's own `launcher.js` resolves the same way.
 *
 * The Linux case needs care: a system Node often has a root-owned global
 * prefix, so `npm i -g` fails with EACCES. Retrying under sudo is the
 * documented remedy, but only when we are not already root and sudo exists —
 * silently prompting from a non-interactive spawn would hang.
 */

import * as cp from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";

/** npm package that carries the editor binary for the current platform. */
const EDITOR_PACKAGE = "@linxiraos/editor";

/** npm names use "windows"; Node's `process.platform` is "win32". */
const PKG_PLATFORM = process.platform === "win32" ? "windows" : process.platform;

/** The platform leaf that carries the executable. */
const LEAF_PACKAGE = `${EDITOR_PACKAGE}-${PKG_PLATFORM}-${process.arch}`;

/** The executable's file name inside the leaf package. */
const LEAF_EXE = process.platform === "win32" ? "termide-editor.exe" : "termide-editor-linux-x64";

/**
 * Node module-resolution roots for the leaf package, most specific first:
 * npm's global prefix (Windows keeps `node_modules` beside `node.exe`, POSIX
 * under `lib/`), zeta's own plugin tree (the editor can be installed as a
 * plugin dependency) and the project.
 */
export function editorLeafRoots(): string[] {
	const home = os.homedir();
	const execDir = path.dirname(process.execPath);
	return [
		path.join(execDir, "node_modules"),
		path.join(execDir, "..", "lib", "node_modules"),
		path.join(home, ".zeta", "plugins", "node_modules"),
		path.join(process.cwd(), "node_modules"),
	];
}

/**
 * Absolute path to the platform editor executable, or null when the package
 * is not installed. Resolution goes through Node's own algorithm so a leaf
 * installed flat or nested both resolve.
 */
export function findEditorBinary(): string | null {
	const require_ = createRequire(import.meta.url);
	try {
		const resolved = require_.resolve(`${LEAF_PACKAGE}/bin/${LEAF_EXE}`, { paths: editorLeafRoots() });
		fs.accessSync(resolved, fs.constants.X_OK);
		return resolved;
	} catch {
		return null;
	}
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
	// Re-resolve right away instead of hoping a fresh shell's PATH catches up:
	// the leaf lands under a known root, and a miss is worth reporting.
	const installed = findEditorBinary();
	if (installed) return { binary: installed, note: install.message };
	return {
		binary: null,
		error: `${install.message}, but ${LEAF_PACKAGE} was not found under ${editorLeafRoots().join(", ")}.`,
	};
}
