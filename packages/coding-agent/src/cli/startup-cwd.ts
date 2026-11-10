import * as os from "node:os";
import * as path from "node:path";
import { directoryExists, getProjectDir, normalizePathForComparison, setProjectDir } from "@linxiraos/pi-utils";
import type { Args } from "./args";

export interface StartupCwdResult {
	/**
	 * Set when a launch from the home directory (or the OS temp directory) was
	 * moved off it. The interactive UI shows it as a startup notice so the
	 * directory in the status line is not a surprise; the launch itself is
	 * unchanged (zetacode never runs in the home directory).
	 */
	autoChdir?: { from: string; to: string };
}

async function maybeAutoChdir(parsed: Args): Promise<StartupCwdResult> {
	if (parsed.allowHome || parsed.cwd) {
		return {};
	}

	const home = os.homedir();
	if (!home) {
		return {};
	}

	const normalizePath = normalizePathForComparison;

	const cwd = normalizePath(getProjectDir());
	const normalizedHome = normalizePath(home);
	if (cwd !== normalizedHome) {
		return {};
	}

	const candidates =
		process.platform === "win32" ? [path.join(home, "tmp")] : [path.join(home, "tmp"), "/tmp", "/var/tmp"];
	for (const candidate of candidates) {
		try {
			if (!(await directoryExists(candidate))) {
				continue;
			}
			setProjectDir(candidate);
			return { autoChdir: { from: home, to: candidate } };
		} catch {
			// Try next candidate.
		}
	}

	try {
		const fallback = os.tmpdir();
		if (fallback && normalizePath(fallback) !== cwd && (await directoryExists(fallback))) {
			setProjectDir(fallback);
			return { autoChdir: { from: home, to: fallback } };
		}
	} catch {
		// Ignore fallback errors.
	}
	return {};
}

export async function applyStartupCwd(parsed: Args): Promise<StartupCwdResult> {
	if (parsed.cwd) {
		try {
			setProjectDir(parsed.cwd);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			// Permission denials are the macOS TCC case; a plain ENOENT typo
			// should not be told to grant Full Disk Access.
			const code = (error as NodeJS.ErrnoException | null)?.code;
			const hint =
				code === "EACCES" || code === "EPERM"
					? " On macOS, grant zeta Files & Folders or Full Disk Access permission for the target directory."
					: "";
			throw new Error(`Cannot change working directory to ${parsed.cwd}: ${reason}.${hint}`);
		}
		// setProjectDir resolves the (possibly relative) target against the launch
		// cwd and chdirs into it. Re-sync parsed.cwd to the resolved absolute path
		// so downstream consumers (buildSessionOptions, settings/discovery, session
		// persistence) don't re-resolve a relative string against the new cwd.
		parsed.cwd = getProjectDir();
		return {};
	}
	return maybeAutoChdir(parsed);
}
