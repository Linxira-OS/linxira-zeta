/**
 * Desktop serve-command resolution — one face of the product-wide binary
 * discovery ruling, in the same order every other surface uses:
 *
 *   ① explicit env — `ZETA_SERVE_COMMAND` (full command override) and
 *     `ZETA_BIN_DIR` (delimiter-separated dirs probed before PATH)
 *   ② PATH — native `zetacode`/`zeta-c`/`zeta-cli` as installed (a distro
 *     or npm install puts them here); a PATH hit is used directly, with no
 *     cross-component version validation
 *   ③ vendored form — the packaged desktop's own resources, then the dev
 *     repo checkout (built dist binary, then Bun-run source)
 *
 * Pure node-builtins only: main.ts supplies the Electron/process seams, so
 * the whole order is unit-testable without Electron.
 *
 * The bare `zeta` bin is deliberately never a serve candidate: it is the
 * Zetawork workbench, which rejects `serve` ("unknown command").
 */

import * as path from "node:path";

/** Explicit discovery override, shared with the other product surfaces. */
export const SERVE_BIN_DIR_ENV = "ZETA_BIN_DIR";

/** Serve-capable launcher names in alias-priority order. */
export const SERVE_BIN_NAMES = ["zetacode", "zeta-c", "zeta-cli"] as const;

export interface ServeCommand {
	file: string;
	args: string[];
	/** Working directory for the service process (web-ui lookup walks cwd). */
	cwd: string;
	env: NodeJS.ProcessEnv;
}

export interface ServeResolutionDeps {
	isPackaged: boolean;
	platform: NodeJS.Platform;
	resourcesPath: string;
	env: NodeJS.ProcessEnv;
	exists: (candidate: string) => boolean;
	/** Package.json reader for the repo-root walk; null when unreadable. */
	readTextFile: (candidate: string) => string | null;
	/** __dirname of the compiled main bundle (dev repo walk starts here). */
	dirname: string;
	cwd: string;
	/** PATH probe for a bare launcher name (where/which); true on hit. */
	probePath: (name: string) => boolean;
	serviceBinaryName: string;
	webRuntimeName: string;
}

export function parseCommand(command: string): string[] {
	return (command.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(part => part.replace(/^("|')|("|')$/g, ""));
}

/** Directory separator for PATH-style env lists on `platform`. */
function envListSeparator(platform: NodeJS.Platform): string {
	return platform === "win32" ? ";" : ":";
}

/** Launcher extensions probed per bin name, native first. */
function binExtensions(platform: NodeJS.Platform): string[] {
	return platform === "win32" ? ["", ".exe", ".cmd"] : [""];
}

/** Repo root above `dirname`: the first ancestor manifest that looks like this monorepo. */
export function findRepoRootIn(deps: ServeResolutionDeps): string | null {
	let dir = deps.dirname;
	for (let i = 0; i < 6; i++) {
		const pkgJson = path.join(dir, "package.json");
		const text = deps.readTextFile(pkgJson);
		if (text !== null) {
			try {
				const pkg = JSON.parse(text) as { workspaces?: unknown; name?: string };
				if (pkg.workspaces || pkg.name === "zeta" || deps.exists(path.join(dir, "packages", "coding-agent"))) {
					return dir;
				}
			} catch {
				// keep walking
			}
		}
		dir = path.dirname(dir);
	}
	return null;
}

/** Tier ③ (packaged): the desktop's own vendored service + web runtime. */
export function bundledServeCommandIn(deps: ServeResolutionDeps): ServeCommand | null {
	if (!deps.isPackaged) return null;

	const serviceDir = path.join(deps.resourcesPath, "zeta");
	const exe = path.join(serviceDir, deps.serviceBinaryName);
	const runtime = path.join(serviceDir, deps.webRuntimeName);
	const standaloneServer = path.join(serviceDir, "web-ui", ".next", "standalone", "server.js");
	if (!deps.exists(exe) || !deps.exists(runtime) || !deps.exists(standaloneServer)) {
		return null;
	}

	return {
		file: exe,
		args: ["serve"],
		cwd: serviceDir,
		env: {
			...deps.env,
			ZETA_DESKTOP: "1",
			ZETA_WEB_RUNTIME: runtime,
		},
	};
}

function serveEnv(deps: ServeResolutionDeps): NodeJS.ProcessEnv {
	return { ...deps.env, ZETA_DESKTOP: "1" };
}

/** The unified discovery order over injected platform seams. */
export function resolveServeCommandIn(deps: ServeResolutionDeps): ServeCommand | null {
	const repoRoot = findRepoRootIn(deps);
	const baseEnv = serveEnv(deps);

	// ① explicit full-command override.
	const fromEnv = deps.env.ZETA_SERVE_COMMAND;
	if (fromEnv) {
		const [file, ...args] = parseCommand(fromEnv);
		if (file) {
			return {
				file,
				args: args.length > 0 ? args : ["serve"],
				cwd: deps.env.ZETA_SERVE_CWD ?? repoRoot ?? deps.cwd,
				env: baseEnv,
			};
		}
	}

	// ① explicit directory override, probed like PATH but first.
	const explicitDirs = (deps.env[SERVE_BIN_DIR_ENV] ?? "")
		.split(envListSeparator(deps.platform))
		.map(dir => dir.trim())
		.filter(dir => dir.length > 0);
	for (const dir of explicitDirs) {
		for (const name of SERVE_BIN_NAMES) {
			for (const ext of binExtensions(deps.platform)) {
				const candidate = path.join(dir, `${name}${ext}`);
				if (deps.exists(candidate)) {
					return { file: candidate, args: ["serve"], cwd: deps.cwd, env: baseEnv };
				}
			}
		}
	}

	// ② PATH — installed launchers win over anything we vendor ourselves.
	for (const name of SERVE_BIN_NAMES) {
		if (deps.probePath(name)) {
			return { file: name, args: ["serve"], cwd: deps.cwd, env: baseEnv };
		}
	}

	// ③ vendored: the packaged bundle first, then the dev repo checkout.
	const bundled = bundledServeCommandIn(deps);
	if (bundled) return bundled;

	if (repoRoot) {
		const exe = path.join(repoRoot, "packages", "coding-agent", "dist", deps.serviceBinaryName);
		if (deps.exists(exe)) {
			return { file: exe, args: ["serve"], cwd: repoRoot, env: baseEnv };
		}
		// Dev fallback: run the source CLI with Bun (PATH lookup).
		const cli = path.join(repoRoot, "packages", "coding-agent", "src", "cli.ts");
		if (deps.exists(cli)) {
			return { file: "bun", args: [cli, "serve"], cwd: repoRoot, env: baseEnv };
		}
	}

	// Dev last resort: rely on spawn-time PATH resolution.
	if (deps.isPackaged) return null;
	return { file: SERVE_BIN_NAMES[0], args: ["serve"], cwd: deps.cwd, env: baseEnv };
}
