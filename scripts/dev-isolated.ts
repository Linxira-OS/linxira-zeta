#!/usr/bin/env bun
/**
 * Launch the source checkout under the developer isolation profile.
 *
 *   bun scripts/dev-isolated.ts                 # CLI/TUI in the dev profile
 *   bun scripts/dev-isolated.ts serve           # dev web/stats/gateway stack
 *   bun scripts/dev-isolated.ts stats           # dev stats dashboard only
 *   bun scripts/dev-isolated.ts desktop         # Electron shell on dev state
 *   bun scripts/dev-isolated.ts --print         # resolved paths/ports/env
 *   bun scripts/dev-isolated.ts --check         # guard (exit 1 on drift)
 *
 * Everything after the mode is forwarded to the CLI (`serve` flags included).
 * The profile is defined in `scripts/dev-isolation.ts`; `docs/dev-isolation.md`
 * documents the env matrix, ports, reset steps and audited gaps.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import {
	applyDevIsolationEnv,
	GAPS,
	resolveDevIsolation,
	verifyDevIsolation,
	type DevIsolation,
} from "./dev-isolation";

type Mode = "cli" | "tui" | "serve" | "stats" | "desktop";

const MODES: readonly Mode[] = ["cli", "tui", "serve", "stats", "desktop"];

const USAGE = `Usage: bun scripts/dev-isolated.ts [--print|--check|--json|--help] [mode] [args...]

Modes:
  cli        Interactive CLI/TUI with the dev profile (default)
  tui        Alias for cli
  serve      Dev Web UI + stats dashboard + web gateway on dev ports
  stats      Dev stats dashboard only
  desktop    Electron desktop shell using dev state (requires a running dev serve)

Isolation flags:
  --print    Print resolved paths, ports and environment; do not launch
  --check    Verify the resolution guard and exit
  --json     With --print/--check, emit JSON
  --help     Show this help`;

const CLI_ENTRY = path.join("packages", "coding-agent", "src", "cli.ts");
const DESKTOP_DIR = "desktop";

interface ParsedArgs {
	mode: Mode;
	print: boolean;
	check: boolean;
	json: boolean;
	passthrough: string[];
}

function fail(message: string): never {
	console.error(`dev-isolated: ${message}`);
	process.exit(1);
}

function parseArgs(argv: string[]): ParsedArgs {
	let mode: Mode = "cli";
	let print = false;
	let check = false;
	let json = false;
	let index = 0;
	while (index < argv.length) {
		const arg = argv[index]!;
		if (arg === "--help" || arg === "-h") {
			console.log(USAGE);
			process.exit(0);
		}
		if (arg === "--print") print = true;
		else if (arg === "--check") check = true;
		else if (arg === "--json") json = true;
		else if ((MODES as readonly string[]).includes(arg)) {
			mode = arg as Mode;
			index++;
			break;
		} else {
			fail(`unknown option before mode: ${arg}\n\n${USAGE}`);
		}
		index++;
	}
	return { mode, print, check, json, passthrough: argv.slice(index) };
}

function describeIsolation(isolation: DevIsolation): Record<string, string> {
	return {
		"config root": isolation.configRoot,
		profile: isolation.profileRoot,
		"agent dir": isolation.agentDir,
		"team db": isolation.teamDb,
		"serve registry": isolation.serveRegistry,
		"stats db": isolation.statsDb,
		"trash dir": isolation.trashDir,
		workspace: isolation.workspaceDir,
		"desktop user data": isolation.desktopUserData,
		"web app dir": isolation.webAppDir,
		"web port": String(isolation.ports.web),
		"gateway port": String(isolation.ports.gateway),
		"stats port": String(isolation.ports.stats),
		"web url": isolation.urls.web,
		"gateway url": isolation.urls.gateway,
		"stats url": isolation.urls.stats,
	};
}

function printIsolation(isolation: DevIsolation, json: boolean): void {
	const fields = describeIsolation(isolation);
	if (json) {
		console.log(
			JSON.stringify(
				{
					...fields,
					env: isolation.env,
					clearedEnv: isolation.clearedEnv,
					gaps: GAPS.map(gap => gap.key),
				},
				null,
				2,
			),
		);
		return;
	}
	console.log("Development isolation profile");
	for (const [label, value] of Object.entries(fields)) console.log(`  ${label.padEnd(20)} ${value}`);
	console.log("\nExported environment");
	for (const [key, value] of Object.entries(isolation.env)) console.log(`  ${key}=${value}`);
	console.log("\nCleared from the child environment");
	console.log(`  ${isolation.clearedEnv.join(", ")}`);
	console.log("\nAudited gaps (see docs/dev-isolation.md)");
	for (const gap of GAPS) console.log(`  [${gap.key}] ${gap.summary}`);
}

function verify(isolation: DevIsolation, json: boolean): boolean {
	const failures = verifyDevIsolation(isolation);
	if (json) {
		console.log(JSON.stringify({ ok: failures.length === 0, failures }, null, 2));
	} else if (failures.length === 0) {
		console.log(
			`check-dev-isolation: ok (root ${isolation.configRoot}; ports ${isolation.ports.web}/${isolation.ports.gateway}/${isolation.ports.stats})`,
		);
	} else {
		for (const failure of failures) console.error(`check-dev-isolation: ${failure}`);
	}
	return failures.length === 0;
}

function warnAboutRenderer(isolation: DevIsolation): void {
	const index = path.join(isolation.webAppDir, "index.html");
	if (!fs.existsSync(index)) {
		console.warn(
			`dev-isolated: web-app renderer is not built at ${isolation.webAppDir}; ` +
				`run \`npm ci && npm run build\` in web-app, or serve shows the placeholder page.`,
		);
	}
}

async function spawnInherited(cmd: string[], env: NodeJS.ProcessEnv, cwd: string): Promise<never> {
	const child = Bun.spawn({ cmd, env, cwd, stdio: ["inherit", "inherit", "inherit"] });
	const code = await child.exited;
	process.exit(code ?? 0);
}

function cliCommand(isolation: DevIsolation, args: string[]): string[] {
	return [process.execPath, path.join(isolation.repoRoot, CLI_ENTRY), ...args];
}

function serveArgs(isolation: DevIsolation): string[] {
	return [
		"serve",
		"--web-port",
		String(isolation.ports.web),
		"--gateway-port",
		String(isolation.ports.gateway),
		"--stats-port",
		String(isolation.ports.stats),
		"--no-browser",
	];
}

function findElectron(desktopDir: string): string | null {
	const candidates =
		process.platform === "win32"
			? [path.join(desktopDir, "node_modules", "electron", "dist", "electron.exe")]
			: process.platform === "darwin"
				? [
						path.join(
							desktopDir,
							"node_modules",
							"electron",
							"dist",
							"Electron.app",
							"Contents",
							"MacOS",
							"Electron",
						),
					]
				: [path.join(desktopDir, "node_modules", "electron", "dist", "electron")];
	return candidates.find(candidate => fs.existsSync(candidate)) ?? null;
}

interface RegistryRecord {
	webUrl?: string;
}

async function devServeIsRunning(isolation: DevIsolation): Promise<boolean> {
	let record: RegistryRecord;
	try {
		record = (await Bun.file(isolation.serveRegistry).json()) as RegistryRecord;
	} catch {
		return false;
	}
	const url = record.webUrl || isolation.urls.web;
	try {
		const response = await fetch(`${url.replace(/\/+$/, "")}/api/server/identity`, {
			signal: AbortSignal.timeout(2_500),
		});
		return response.ok;
	} catch {
		return false;
	}
}

async function launchDesktop(isolation: DevIsolation, env: NodeJS.ProcessEnv, args: string[]): Promise<never> {
	const desktopDir = path.join(isolation.repoRoot, DESKTOP_DIR);
	const mainJs = path.join(desktopDir, "dist", "main.js");
	if (!fs.existsSync(mainJs)) {
		fail(`desktop shell is not built (${mainJs}); run \`npm ci && npm run build\` in ${desktopDir}`);
	}
	const electron = findElectron(desktopDir);
	if (!electron) {
		fail(`Electron is not installed in ${desktopDir}; run \`npm ci\` there`);
	}
	if (!(await devServeIsRunning(isolation))) {
		fail(
			`no dev serve instance answers at ${isolation.urls.web}. Start one first:\n` +
				`  bun scripts/dev-isolated.ts serve\n` +
				`The desktop shell reuses a running dev instance; it must not spawn a service on the installed ports.`,
		);
	}
	const serveCommand = [process.execPath, path.join(isolation.repoRoot, "scripts", "dev-isolated.ts"), "serve"]
		.map(part => (/[\s"']/.test(part) ? `"${part}"` : part))
		.join(" ");
	return spawnInherited(
		[electron, `--user-data-dir=${isolation.desktopUserData}`, ...args, desktopDir],
		{ ...env, ZETA_SERVE_COMMAND: serveCommand },
		desktopDir,
	);
}

const parsed = parseArgs(process.argv.slice(2));
const isolation = resolveDevIsolation();

if (parsed.check) {
	process.exit(verify(isolation, parsed.json) ? 0 : 1);
}
if (parsed.print) {
	printIsolation(isolation, parsed.json);
	process.exit(0);
}

if (parsed.mode === "serve" || parsed.mode === "desktop") warnAboutRenderer(isolation);
const env = applyDevIsolationEnv(isolation);

if (parsed.mode === "desktop") {
	await launchDesktop(isolation, env, parsed.passthrough);
}

const command =
	parsed.mode === "serve"
		? cliCommand(isolation, [...serveArgs(isolation), ...parsed.passthrough])
		: parsed.mode === "stats"
			? cliCommand(isolation, ["stats", "--port", String(isolation.ports.stats), ...parsed.passthrough])
			: cliCommand(isolation, parsed.passthrough);

await spawnInherited(command, env, process.cwd());
