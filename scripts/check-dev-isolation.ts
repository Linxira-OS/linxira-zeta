#!/usr/bin/env bun
/**
 * Guard for the developer isolation profile.
 *
 * Resolves the profile twice: from `scripts/dev-isolation.ts` (the launcher's
 * definition) and from the real `packages/utils/src/dirs.ts` resolver in a
 * child process with the dev environment applied. Both must agree, every
 * resolved path must stay inside `~/.zeta-dev`, and no path may land inside
 * the installed `~/.zeta`.
 *
 * Usage: `bun scripts/check-dev-isolation.ts [--json]` (exit 0/1).
 */
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import {
	applyDevIsolationEnv,
	isInside,
	PRODUCTION_CONFIG_DIR,
	resolveDevIsolation,
	verifyDevIsolation,
} from "./dev-isolation";

interface ResolvedPaths {
	baseRoot: string;
	configRoot: string;
	profileRoot: string;
	agentDir: string;
	statsDb: string;
	teamDb: string;
	daemonRuntimeRoot: string;
	sessionOwnersDir: string;
	pluginsDir: string;
}

const REPO_ROOT = path.resolve(import.meta.dir, "..");
const json = process.argv.includes("--json");
const isolation = resolveDevIsolation({ repoRoot: REPO_ROOT });

function resolveWithRealResolver(): ResolvedPaths {
	const dirsUrl = pathToFileURL(path.join(REPO_ROOT, "packages", "utils", "src", "dirs.ts")).href;
	const teamDbUrl = pathToFileURL(path.join(REPO_ROOT, "packages", "coding-agent", "src", "team", "db.ts")).href;
	const probe = [
		`import { getAgentDir, getBaseConfigRoot, getConfigRootDir, getGlobalDaemonRuntimeRoot, getPluginsDir, getProfileRootDir, getSessionOwnersDir, getStatsDbPath } from ${JSON.stringify(dirsUrl)};`,
		`import { resolveTeamDbPath } from ${JSON.stringify(teamDbUrl)};`,
		"console.log(JSON.stringify({",
		"  baseRoot: getBaseConfigRoot(),",
		"  configRoot: getConfigRootDir(),",
		"  profileRoot: getProfileRootDir('dev'),",
		"  agentDir: getAgentDir(),",
		"  statsDb: getStatsDbPath(),",
		"  teamDb: resolveTeamDbPath(),",
		"  daemonRuntimeRoot: getGlobalDaemonRuntimeRoot(),",
		"  sessionOwnersDir: getSessionOwnersDir(),",
		"  pluginsDir: getPluginsDir(),",
		"}));",
	].join("\n");
	const child = Bun.spawnSync({
		cmd: [process.execPath, "-e", probe],
		cwd: REPO_ROOT,
		env: applyDevIsolationEnv(isolation),
		stdout: "pipe",
		stderr: "pipe",
	});
	if (child.exitCode !== 0) {
		throw new Error(`resolver probe failed (exit ${child.exitCode}):\n${child.stderr.toString()}`);
	}
	return JSON.parse(child.stdout.toString().trim()) as ResolvedPaths;
}

const failures = verifyDevIsolation(isolation);
const productionRoot = path.join(isolation.homeDir, PRODUCTION_CONFIG_DIR);
const resolved = resolveWithRealResolver();

const expected: Array<[string, string, string]> = [
	["base config root", resolved.baseRoot, isolation.configRoot],
	["profile root", resolved.configRoot, isolation.profileRoot],
	["agent dir", resolved.agentDir, isolation.agentDir],
	["stats db", resolved.statsDb, isolation.statsDb],
	["team db", resolved.teamDb, isolation.teamDb],
];
for (const [label, actual, wanted] of expected) {
	if (path.resolve(actual) !== path.resolve(wanted)) {
		failures.push(`${label} resolved by dirs.ts is ${actual}, expected ${wanted}`);
	}
}

const derived: Array<[string, string]> = [
	["base config root", resolved.baseRoot],
	["profile root", resolved.configRoot],
	["agent dir", resolved.agentDir],
	["stats db", resolved.statsDb],
	["team db", resolved.teamDb],
	["daemon runtime root", resolved.daemonRuntimeRoot],
	["session owners dir", resolved.sessionOwnersDir],
	["plugins dir", resolved.pluginsDir],
];
for (const [label, value] of derived) {
	if (!isInside(value, isolation.configRoot)) failures.push(`${label} escapes the dev root: ${value}`);
	if (isInside(value, productionRoot)) failures.push(`${label} is inside the production root: ${value}`);
}

if (failures.length > 0) {
	if (json) console.log(JSON.stringify({ ok: false, failures }, null, 2));
	else for (const failure of failures) console.error(`check-dev-isolation: ${failure}`);
	process.exit(1);
}

if (json) {
	console.log(JSON.stringify({ ok: true, resolved }, null, 2));
} else {
	console.log(
		`check-dev-isolation: ok (root ${isolation.configRoot}; ports ${isolation.ports.web}/${isolation.ports.gateway}/${isolation.ports.stats}; production ${productionRoot} untouched)`,
	);
}
