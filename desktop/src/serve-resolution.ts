/**
 * Desktop serve-command resolution — one face of the product-wide binary
 * discovery ruling, in the same order every other surface uses, plus the one
 * packaged-shell rule below:
 *
 *   ① explicit env — `ZETA_SERVE_COMMAND` (full command override) and
 *     `ZETA_BIN_DIR` (delimiter-separated dirs probed before PATH)
 *   ② vendored form — a *packaged* shell prefers its own bundle (complete
 *     bundle only: service binary + Node runtime + staged Web UI standalone)
 *     because that is the only launcher version-locked to the shell and able to
 *     serve the embedded UI offline; then the dev repo checkout (built dist
 *     binary, then Bun-run source)
 *   ③ PATH — native `zetacode`/`zeta-c`/`zeta-cli` as installed (a distro or npm
 *     install puts them here); reached when no bundle is present, with no
 *     cross-component version validation
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
	/**
	 * Windows `cmd`/`bat` launchers (npm shims) cannot be spawned directly:
	 * Node has no PATHEXT resolution, so the spawn needs a shell.
	 */
	needsShell: boolean;
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
	/**
	 * PATH probe for a launcher name (where/which); the resolved absolute path
	 * on a hit, null otherwise. The path (with its `.exe`/`.cmd` suffix) — not
	 * the bare name — is what gets spawned, so a hit is always spawnable.
	 */
	probePath: (name: string) => string | null;
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

/**
 * Spawn shape for a resolved command. Windows `.cmd`/`.bat` launchers cannot
 * be exec'd by spawn (a bare name gives ENOENT with no PATHEXT; the absolute
 * path gives EINVAL — batch files are not PE images). They run through
 * `cmd.exe`, whose `/s /c` strips the outer quote pair — so the whole line is
 * wrapped in `"…"` to keep the shim's own, possibly spaced, path intact.
 */
export function spawnSpec(cmd: ServeCommand): { file: string; args: string[]; windowsVerbatimArguments: boolean } {
	if (!cmd.needsShell) return { file: cmd.file, args: cmd.args, windowsVerbatimArguments: false };
	const parts = [`"${cmd.file}"`, ...cmd.args.map(arg => (/[\s&|<>^"]/.test(arg) ? `"${arg}"` : arg))];
	return {
		file: process.env.ComSpec ?? "cmd.exe",
		args: ["/d", "/s", "/c", `"${parts.join(" ")}"`],
		windowsVerbatimArguments: true,
	};
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

/**
 * The three files the packaged bundle must provide together, in the order the
 * service needs them. Missing-file reporting reuses this list so the failure
 * dialog names the exact path that is absent.
 */
function bundledServeRequirements(deps: ServeResolutionDeps): { label: string; file: string }[] {
	const serviceDir = path.join(deps.resourcesPath, "zeta");
	return [
		{ label: "service binary", file: path.join(serviceDir, deps.serviceBinaryName) },
		{ label: "Node runtime", file: path.join(serviceDir, deps.webRuntimeName) },
		{ label: "Web UI standalone server", file: path.join(serviceDir, "web-ui", ".next", "standalone", "server.js") },
	];
}

/** Packaged-bundle files that are absent (empty when the bundle is complete). */
export function missingBundledServeFiles(deps: ServeResolutionDeps): string[] {
	return bundledServeRequirements(deps)
		.filter(({ file }) => !deps.exists(file))
		.map(({ label, file }) => `${label}: ${file}`);
}

/** Tier ③ (packaged): the desktop's own vendored service + web runtime. */
export function bundledServeCommandIn(deps: ServeResolutionDeps): ServeCommand | null {
	if (!deps.isPackaged) return null;
	if (missingBundledServeFiles(deps).length > 0) return null;

	const serviceDir = path.join(deps.resourcesPath, "zeta");
	const runtime = path.join(serviceDir, deps.webRuntimeName);

	return {
		file: path.join(serviceDir, deps.serviceBinaryName),
		args: ["serve"],
		cwd: serviceDir,
		env: {
			...deps.env,
			ZETA_DESKTOP: "1",
			ZETA_WEB_RUNTIME: runtime,
		},
		needsShell: false,
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
				needsShell: /\.(cmd|bat)$/i.test(file),
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
					return { file: candidate, args: ["serve"], cwd: deps.cwd, env: baseEnv, needsShell: /\.(cmd|bat)$/i.test(candidate) };
				}
			}
		}
	}

	// ② vendored — a packaged shell serves its *own* bundle before PATH.
	//
	// The bundle is the only launcher that ships the staged Web UI and the Node
	// runtime it needs (see `prepare-runtime.mjs`), and it is version-locked to
	// the shell: `scripts/check-version-consistency.ts` pins desktop/package.json
	// to the CLI's version line, so the bundle's serve is always this shell's
	// version. A PATH launcher carries no such guarantee — an npm install ships
	// no Web UI at all (it fetches `@linxiraos/zeta-web` at runtime) and a
	// different version would be refused later by the version-mismatch policy.
	// v1.2.1 evidence: the shell spawned the PATH `zetacode.cmd`, whose Web UI
	// fetch 404'd, and every launch reused the resulting corpse. Explicit
	// overrides (ZETA_SERVE_COMMAND / ZETA_BIN_DIR) still win over this tier.
	const bundled = bundledServeCommandIn(deps);
	if (bundled) return bundled;

	// ③ PATH — installed launchers. The probe returns the resolved absolute path
	// (with suffix); spawning the bare name here was the ENOENT bug — `where`
	// matches `.cmd` shims that Node's shell-less spawn cannot execute.
	for (const name of SERVE_BIN_NAMES) {
		const resolved = deps.probePath(name);
		if (resolved) {
			return { file: resolved, args: ["serve"], cwd: deps.cwd, env: baseEnv, needsShell: /\.(cmd|bat)$/i.test(resolved) };
		}
	}

	// ④ dev repo checkout (unpackaged shells, or a packaged one with no bundle).
	if (repoRoot) {
		const exe = path.join(repoRoot, "packages", "coding-agent", "dist", deps.serviceBinaryName);
		if (deps.exists(exe)) {
			return { file: exe, args: ["serve"], cwd: repoRoot, env: baseEnv, needsShell: false };
		}
		// Dev fallback: run the source CLI with Bun (PATH lookup).
		const cli = path.join(repoRoot, "packages", "coding-agent", "src", "cli.ts");
		if (deps.exists(cli)) {
			return { file: "bun", args: [cli, "serve"], cwd: repoRoot, env: baseEnv, needsShell: false };
		}
	}

	// Dev last resort: rely on spawn-time PATH resolution. On Windows the bare
	// name only resolves through a shell (PATHEXT); POSIX execs it directly.
	if (deps.isPackaged) return null;
	return { file: SERVE_BIN_NAMES[0], args: ["serve"], cwd: deps.cwd, env: baseEnv, needsShell: deps.platform === "win32" };
}

/**
 * Multi-line diagnosis of a failed resolution: every tier that was tried and
 * the path each one consulted, followed by the actionable fix. Wired into the
 * failure dialog so a miss reads as "install the CLI here", never a bare
 * `spawn zetacode ENOENT`.
 */
export function describeServeResolution(deps: ServeResolutionDeps): string {
	const explicitDirs = (deps.env[SERVE_BIN_DIR_ENV] ?? "")
		.split(envListSeparator(deps.platform))
		.map(dir => dir.trim())
		.filter(dir => dir.length > 0);
	const lines = [
		"Zeta could not find a service binary to start. Discovery order:",
		`  ① explicit: ZETA_SERVE_COMMAND=${deps.env.ZETA_SERVE_COMMAND ? "set" : "unset"}; ZETA_BIN_DIR=[${explicitDirs.join(", ") || "unset"}]`,
	];
	if (!deps.isPackaged) {
		lines.push(`  ② vendored: not a packaged build; dev repo checkout at ${findRepoRootIn(deps) ?? "not found"}`);
	} else {
		const missing = missingBundledServeFiles(deps);
		const serviceDir = path.join(deps.resourcesPath, "zeta");
		lines.push(
			missing.length > 0
				? `  ② vendored: bundled runtime at ${serviceDir} is incomplete — ${missing.join("; ")}`
				: `  ② vendored: bundled runtime at ${serviceDir} is complete but was not selected`,
		);
	}
	lines.push(
		`  ③ PATH (${deps.platform === "win32" ? "where" : "which"}): ${SERVE_BIN_NAMES.map(name => `${name} → ${deps.probePath(name) ?? "not found"}`).join("; ")}`,
	);
	lines.push(
		"Fix: install the CLI with `npm install -g @linxiraos/zeta`, or reinstall the Zeta desktop package (run the bundled installer), then relaunch.",
	);
	return lines.join("\n");
}
