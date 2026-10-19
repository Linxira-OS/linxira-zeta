/**
 * Shared test isolation for stats Bun tests.
 *
 * The default profile's stats.db is redirected to `$XDG_DATA_HOME/zeta/stats.db`
 * by {@link DirResolver} whenever `agentDirOverride === defaultAgent`. Tests
 * that only set `PI_CONFIG_DIR` + `setAgentDir(<home>/<config>/agent)` resolve
 * to that default and silently share `stats.db` across files when an XDG
 * variable is set (e.g. CI's `XDG_DATA_HOME`), producing the cross-test row
 * pollution that fails `db-range`, `behavior-backfill`, `priority-premium-*`,
 * and `agent-type` runs.
 *
 * `installStatsTestIsolation` snapshots and clears `XDG_*_HOME` plus
 * `PI_CONFIG_DIR` for the test, points the agent directory at a fresh
 * `TempDir`, closes the stats DB handle, and tears everything back down in the
 * matching `afterEach`. It also sets `ZETA_CONFIG_DIR`, the variable
 * `dirs.ts` actually resolves the config root from: without it
 * `getStatsDbPath()` stays on the developer's real `~/.zeta/stats.db` and
 * every test in the process shares it.
 */
import { afterEach, beforeEach } from "bun:test";
import * as os from "node:os";
import * as path from "node:path";
import { closeDb } from "@linxiraos/pi-stats/db";
import { getAgentDir, setAgentDir, TempDir } from "@linxiraos/pi-utils";

const XDG_KEYS = ["XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"] as const;

export interface StatsTestIsolation {
	/** Active per-test `TempDir`. Null between tests. */
	current(): TempDir | null;
}

export function installStatsTestIsolation(prefix: string): StatsTestIsolation {
	const originalAgentDir = getAgentDir();
	let originalConfigDir: string | undefined;
	let originalZetaConfigDir: string | undefined;
	const originalXdg: Record<string, string | undefined> = {};
	let tempDir: TempDir | null = null;

	beforeEach(() => {
		tempDir = TempDir.createSync(prefix);
		originalConfigDir = process.env.PI_CONFIG_DIR;
		originalZetaConfigDir = process.env.ZETA_CONFIG_DIR;
		for (const key of XDG_KEYS) {
			originalXdg[key] = process.env[key];
			delete process.env[key];
		}
		const configDir = path.relative(os.homedir(), tempDir.join("config"));
		process.env.PI_CONFIG_DIR = configDir;
		// `getStatsDbPath()` resolves from the config root, which `dirs.ts` reads
		// from ZETA_CONFIG_DIR (PI_CONFIG_DIR is the legacy name). Without this,
		// every test in a process shares the developer's real `~/.zeta/stats.db`.
		process.env.ZETA_CONFIG_DIR = configDir;
		setAgentDir(path.join(os.homedir(), configDir, "agent"));
	});

	afterEach(() => {
		closeDb();
		// bun:sqlite releases file locks only when the GC finalizes its
		// handles; without this, Windows cannot remove the temp dir.
		Bun.gc(true);
		if (originalConfigDir === undefined) {
			delete process.env.PI_CONFIG_DIR;
		} else {
			process.env.PI_CONFIG_DIR = originalConfigDir;
		}
		if (originalZetaConfigDir === undefined) {
			delete process.env.ZETA_CONFIG_DIR;
		} else {
			process.env.ZETA_CONFIG_DIR = originalZetaConfigDir;
		}
		for (const key of XDG_KEYS) {
			const prior = originalXdg[key];
			if (prior === undefined) delete process.env[key];
			else process.env[key] = prior;
		}
		setAgentDir(originalAgentDir);
		tempDir?.removeSync();
		tempDir = null;
	});

	return {
		current() {
			return tempDir;
		},
	};
}
