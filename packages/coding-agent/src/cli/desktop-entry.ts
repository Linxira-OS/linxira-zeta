/**
 * `zeta-d` desktop entry dispatch.
 *
 * Command resolution contract (see docs/zeta-serve-web.md):
 * - bare `zeta` always belongs to the npm/source install;
 * - `zeta-d` (no args) runs the desktop bundle's CLI/TUI;
 * - `zeta-d -d` opens the desktop GUI in the current working directory;
 * - `zeta --desktop [cwd]` opens the desktop GUI from any install.
 *
 * The desktop installer puts only the `zeta-d` shim on PATH; it re-enters the
 * bundled zeta binary with `ZETA_DESKTOP_ENTRY=1`, and this module translates
 * that into spawning the Electron GUI. Different names ⇒ zero PATH conflicts
 * and no arbitration logic.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const GUI_LAUNCH_FLAG_PREFIX = "--cwd=";

function isFile(p: string): boolean {
	try {
		return fs.statSync(p).isFile();
	} catch {
		return false;
	}
}

/**
 * GUI executable candidates relative to the running bundled binary's
 * directory. The desktop layout nests the CLI at
 * `<install>/resources/zeta/<zetaBinary>` (electron-builder extraResources),
 * so the install root is two directories up.
 */
function bundledGuiCandidates(): string[] {
	const exeDir = path.dirname(process.execPath);
	const installRoot = path.resolve(exeDir, "..", "..");
	switch (process.platform) {
		case "win32":
			return [path.join(installRoot, "Zeta.exe")];
		case "darwin":
			// Packaged: <install>/Zeta.app/Contents/{Resources,zeta}/... — the app
			// bundle root is three levels up from resources/zeta.
			return [path.resolve(exeDir, "..", "..", "..", "MacOS", "Zeta")];
		default:
			return [path.join(installRoot, "zeta-desktop")];
	}
}

/** Well-known desktop install locations probed when the bundle-relative path misses. */
export function desktopGuiProbePaths(): string[] {
	switch (process.platform) {
		case "win32": {
			const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
			return [path.join(localAppData, "Programs", "Zeta", "Zeta.exe")];
		}
		case "darwin":
			return [
				"/Applications/Zeta.app/Contents/MacOS/Zeta",
				path.join(os.homedir(), "Applications/Zeta.app/Contents/MacOS/Zeta"),
			];
		default:
			return ["/opt/zeta-desktop/zeta-desktop", path.join(os.homedir(), ".local/lib/zeta-desktop/zeta-desktop")];
	}
}

/** All GUI candidates in probe order (bundle-relative first). */
export function desktopGuiCandidates(): string[] {
	return [...bundledGuiCandidates(), ...desktopGuiProbePaths()];
}

function findDesktopGui(): string | undefined {
	return desktopGuiCandidates().find(isFile);
}

/**
 * True when this process runs from the desktop bundle's staged CLI
 * (`<install>/resources/zeta/<binary>` with the GUI beside the resources dir)
 * or was entered through the `zeta-d` shim. Used by the updater to refuse
 * self-updates that would corrupt the bundle layout.
 */
export function isDesktopBundledRuntime(): boolean {
	if (process.env.ZETA_DESKTOP_ENTRY === "1") return true;
	const exeDir = path.dirname(process.execPath);
	if (path.basename(exeDir) !== "zeta" || path.basename(path.dirname(exeDir)) !== "resources") return false;
	return isFile(path.resolve(exeDir, "..", "..", process.platform === "win32" ? "Zeta.exe" : "zeta-desktop"));
}

export interface DesktopDispatchDeps {
	/** GUI executable resolver; defaults to the probe list. */
	resolve?: () => string | undefined;
	/** GUI spawner; defaults to a detached Bun.spawn. */
	spawn?: (gui: string, cwdFlag: string) => void;
}

/**
 * Handle `-d` / `--desktop` GUI launch requests. Returns false when the argv
 * is a normal CLI invocation and processing should continue. On success the
 * GUI has been spawned detached and the caller should return (exit 0); when
 * no GUI install is found the probe list is printed and the process exits 1.
 */
export async function dispatchDesktopEntry(argv: readonly string[], deps: DesktopDispatchDeps = {}): Promise<boolean> {
	const entryMode = process.env.ZETA_DESKTOP_ENTRY === "1";
	const first = argv[0];
	const wantsGui = (entryMode && (first === "-d" || first === "--desktop")) || argv.includes("--desktop");
	if (!wantsGui) return false;

	// Optional cwd token directly after the flag (`zeta --desktop <cwd>`).
	let cwd = process.cwd();
	if (first !== undefined && (first === "-d" || first === "--desktop")) {
		const next = argv[1];
		if (next !== undefined && !next.startsWith("-")) cwd = path.resolve(next);
	}

	const gui = deps.resolve ? deps.resolve() : findDesktopGui();
	if (!gui) {
		process.stderr.write(
			`Error: Zeta desktop app not found. Looked in:\n${desktopGuiCandidates()
				.map(p => `  - ${p}`)
				.join("\n")}\nInstall the desktop app first, then retry.\n`,
		);
		process.exitCode = 1;
		return true;
	}

	try {
		const cwdFlag = `${GUI_LAUNCH_FLAG_PREFIX}${cwd}`;
		if (deps.spawn) {
			deps.spawn(gui, cwdFlag);
		} else {
			const child = Bun.spawn([gui, cwdFlag], {
				stdin: "ignore",
				stdout: "ignore",
				stderr: "ignore",
			});
			child.unref?.();
		}
	} catch (error) {
		process.stderr.write(
			`Error: failed to launch Zeta desktop at ${gui}: ${error instanceof Error ? error.message : String(error)}\n`,
		);
		process.exitCode = 1;
	}
	return true;
}
