/**
 * Developer isolation profile: resolution and guards.
 *
 * A source checkout must never read or write the state of an installed Zeta.
 * This module owns the single definition of the dev profile so the launcher
 * (`scripts/dev-isolated.ts`), the guard (`scripts/check-dev-isolation.ts`)
 * and its test all agree:
 *
 * - config root `~/.zeta-dev` (`ZETA_CONFIG_DIR`; a *relative* dirname under
 *   home — it cannot point at the checkout, see `getConfigDirName()`)
 * - named profile `dev` (`ZETA_PROFILE`), agent dir `<root>/profiles/dev/agent`
 * - Team DB (`ZETA_TEAM_DB`), serve registry (`ZETA_SERVE_REGISTRY`), session
 *   trash (`ZETA_TRASH_DIR`), default workspace (`ZETA_DEFAULT_WORKSPACE`) all
 *   inside the dev root
 * - own web/gateway/stats ports so browser origins and local services do not
 *   collide with an installed instance
 * - `ZETA_WEB_APP_DIR` -> the checkout's `web-app/dist`
 * - Electron `--user-data-dir` and `ZETA_SERVE_COMMAND` for the desktop shell
 *
 * `stats.db` has no dedicated environment override in this release; it is
 * derived from the isolated config root, which still keeps it out of `~/.zeta`.
 * `GAPS` lists every sharing/override gap this profile cannot close by env.
 */
import * as os from "node:os";
import * as path from "node:path";

/** Config-root dirname under `$HOME` used by the dev profile. */
export const DEV_CONFIG_DIR = ".zeta-dev";

/** Named profile activated inside the dev config root. */
export const DEV_PROFILE = "dev";

/** Production config-root dirname under `$HOME`. */
export const PRODUCTION_CONFIG_DIR = ".zeta";

/** Loopback ports owned by the dev profile (production + 1000). */
export const DEV_PORTS = {
	web: 44141,
	gateway: 44143,
	stats: 44147,
} as const;

/** Ports an installed Zeta binds by default (`packages/utils/src/ports.ts`). */
export const PRODUCTION_PORTS = {
	web: 43141,
	gateway: 43143,
	stats: 43147,
	relay: 43153,
} as const;

/**
 * Environment variables removed from the dev child regardless of the caller's
 * environment. Each one would otherwise relocate some state outside the dev
 * root or let a named profile inherit the production root:
 *
 * - `PI_PROFILE`: legacy profile selector; the dev launcher pins `ZETA_PROFILE`
 * - `PI_CONFIG_DIR`: documented legacy config-root name; the resolver reads
 *   `ZETA_CONFIG_DIR`, so clearing this removes two-sources-of-truth confusion
 * - `PI_CODING_AGENT_SESSION_DIR`: would point fresh sessions at another store
 * - `PI_NATIVES_DIR`: would share the native addon/grammar staging root
 * - `ZETA_AUTORESEARCH_DB_DIR`: would relocate per-project research DBs
 * - `ZETA_AUTH_BROKER_SNAPSHOT_CACHE`, `ZETA_GITHUB_CACHE_DB`,
 *   `ZETA_COMMIT_CACHE_DB`, `ZETA_JUDGMENT_CACHE_DB`: explicit cache-file
 *   overrides that could name production files
 * - `ZETA_WORKTREE_DIR`: agent-managed worktrees belong to the dev profile
 * - `ZETA_DAEMON_PROJECT_DIR`, `ZETA_DAEMON_RUNTIME_DIR`: set by a launching
 *   client; a stale inherited value would attach to a production broker
 * - `ZETA_SERVE_HOSTNAME`, `ZETA_SERVE_TLS_CERT`, `ZETA_SERVE_TLS_KEY`: a dev
 *   loopback listener must not inherit a production bind/TLS configuration
 * - `XDG_DATA_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME`: on Linux/macOS the
 *   resolver sends profile-independent roots (daemon sockets, session-owner
 *   leases, plugin data) under the `$XDG_*` roots / `zeta` when that directory
 *   exists, which
 *   is the production root. Clearing them pins those roots to `~/.zeta-dev`.
 */
export const CLEARED_ENV_KEYS = [
	"PI_PROFILE",
	"PI_CONFIG_DIR",
	"PI_CODING_AGENT_SESSION_DIR",
	"PI_NATIVES_DIR",
	"ZETA_AUTORESEARCH_DB_DIR",
	"ZETA_AUTH_BROKER_SNAPSHOT_CACHE",
	"ZETA_GITHUB_CACHE_DB",
	"ZETA_COMMIT_CACHE_DB",
	"ZETA_JUDGMENT_CACHE_DB",
	"ZETA_WORKTREE_DIR",
	"ZETA_DAEMON_PROJECT_DIR",
	"ZETA_DAEMON_RUNTIME_DIR",
	"ZETA_SERVE_HOSTNAME",
	"ZETA_SERVE_TLS_CERT",
	"ZETA_SERVE_TLS_KEY",
	"XDG_DATA_HOME",
	"XDG_STATE_HOME",
	"XDG_CACHE_HOME",
] as const;

/** One state-sharing gap the dev profile cannot close with an env variable. */
export interface IsolationGap {
	/** Stable identifier used by the guard and the docs. */
	key: string;
	/** One-line summary. */
	summary: string;
	/** Where the behavior comes from and what the developer should do. */
	detail: string;
}

/**
 * Audited gaps (see `docs/dev-isolation.md`). Keep this list factual: every
 * entry was verified against the current code, and the guard asserts that the
 * gap is still real (so a future env override forces an update rather than a
 * stale warning).
 */
export const GAPS: readonly IsolationGap[] = [
	{
		key: "stats-db",
		summary: "No `ZETA_STATS_DB` override exists.",
		detail:
			"`getStatsDbPath()` returns `<config root>/stats.db`; it is isolated through the dev config root, but a repo-local stats database cannot be selected directly. Do not invent a `ZETA_STATS_DB` variable.",
	},
	{
		key: "browser-relay-port",
		summary: "The browser relay port is a compile-time constant (43153) with no env override.",
		detail:
			"`ZETA_BROWSER_RELAY_PORT` in `packages/utils/src/ports.ts` is not read from the environment, so a dev and an installed relay cannot both listen. Stop one relay before starting the other.",
	},
	{
		key: "lsp-json-read",
		summary: "The LSP loader reads `~/.zeta/lsp.json` unconditionally (read-only).",
		detail:
			"`loadConfig()` in `packages/coding-agent/src/lsp/config.ts` merges the shared production override. Project-level `.zeta/lsp.*` files win; keep dev-only servers there.",
	},
	{
		key: "browser-state-write",
		summary: "`tab.saveState()` without an explicit path writes `~/.zeta/browser-state/`.",
		detail:
			"`storageStatePath()` has no env override. Always pass a path when saving browser state from the dev profile.",
	},
	{
		key: "home-dotenv",
		summary: "`$env` still reads `~/.env` after the process environment.",
		detail:
			"The dotenv loader reads the home `.env` for keys that are unset. Explicit dev exports win; keep dev overrides in `~/.zeta-dev/.env` instead.",
	},
	{
		key: "provider-auth",
		summary: "Provider credentials are not shared with the dev profile.",
		detail:
			"Auth lives in the profile's `agent.db`, which is isolated on purpose. Run `/login` once in the dev profile, or inherit `ZETA_AUTH_BROKER_*` from the environment to reuse a broker (the broker snapshot cache is relocated into the dev root).",
	},
] as const;

export interface DevIsolationInput {
	/** Home directory to resolve against (defaults to `os.homedir()`). */
	homeDir?: string;
	/** Checkout root (defaults to the parent of `scripts/`). */
	repoRoot?: string;
}

export interface DevIsolation {
	homeDir: string;
	repoRoot: string;
	/** `~/.zeta-dev` */
	configRoot: string;
	/** `~/.zeta-dev/profiles/dev` */
	profileRoot: string;
	/** `~/.zeta-dev/profiles/dev/agent` */
	agentDir: string;
	/** Explicit `ZETA_TEAM_DB`. */
	teamDb: string;
	/** Explicit `ZETA_SERVE_REGISTRY`. */
	serveRegistry: string;
	/** Derived `getStatsDbPath()` target (no env override). */
	statsDb: string;
	/** Explicit `ZETA_TRASH_DIR`. */
	trashDir: string;
	/** Explicit `ZETA_DEFAULT_WORKSPACE`. */
	workspaceDir: string;
	/** Electron `--user-data-dir`. */
	desktopUserData: string;
	/** `ZETA_WEB_APP_DIR` -> `<repo>/web-app/dist`. */
	webAppDir: string;
	ports: { web: number; gateway: number; stats: number };
	urls: { web: string; gateway: string; stats: string };
	/** Environment variables the launcher exports. */
	env: Record<string, string>;
	/** Environment variables the launcher deletes. */
	clearedEnv: string[];
}

/** True when `child` is `parent` or a descendant of it (path-segment safe). */
export function isInside(child: string, parent: string): boolean {
	const relative = path.relative(path.resolve(parent), path.resolve(child));
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Resolve every path, port and environment value of the dev profile. */
export function resolveDevIsolation(input: DevIsolationInput = {}): DevIsolation {
	const homeDir = path.resolve(input.homeDir ?? os.homedir());
	const repoRoot = path.resolve(input.repoRoot ?? path.resolve(import.meta.dir, ".."));
	const configRoot = path.join(homeDir, DEV_CONFIG_DIR);
	const profileRoot = path.join(configRoot, "profiles", DEV_PROFILE);
	const agentDir = path.join(profileRoot, "agent");
	const ports = { ...DEV_PORTS };

	const teamDb = path.join(configRoot, "data", "zeta.db");
	const serveRegistry = path.join(configRoot, "serve.json");
	const statsDb = path.join(profileRoot, "stats.db");
	const trashDir = path.join(configRoot, "trash", "sessions");
	const workspaceDir = path.join(configRoot, "workspace");
	const desktopUserData = path.join(configRoot, "desktop-user-data");
	const webAppDir = path.join(repoRoot, "web-app", "dist");

	const urls = {
		web: `http://127.0.0.1:${ports.web}`,
		gateway: `http://127.0.0.1:${ports.gateway}`,
		stats: `http://127.0.0.1:${ports.stats}`,
	};

	const env: Record<string, string> = {
		ZETA_CONFIG_DIR: DEV_CONFIG_DIR,
		ZETA_PROFILE: DEV_PROFILE,
		ZETA_CODING_AGENT_DIR: agentDir,
		ZETA_DEFAULT_WORKSPACE: workspaceDir,
		ZETA_TEAM_DB: teamDb,
		ZETA_SERVE_REGISTRY: serveRegistry,
		ZETA_TRASH_DIR: trashDir,
		ZETA_WEB_GATEWAY_PORT: String(ports.gateway),
		ZETA_GATEWAY_URL: urls.gateway,
		ZETA_WEB_APP_DIR: webAppDir,
	};

	return {
		homeDir,
		repoRoot,
		configRoot,
		profileRoot,
		agentDir,
		teamDb,
		serveRegistry,
		statsDb,
		trashDir,
		workspaceDir,
		desktopUserData,
		webAppDir,
		ports,
		urls,
		env,
		clearedEnv: [...CLEARED_ENV_KEYS],
	};
}

/** Build the child environment: dev overrides applied, sharing-prone keys removed. */
export function applyDevIsolationEnv(
	isolation: DevIsolation,
	base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...base, ...isolation.env };
	for (const key of isolation.clearedEnv) delete env[key];
	return env;
}

/**
 * Validate a resolved profile. Returns human-readable failures; an empty list
 * means every dev path stays inside the dev root, no port collides with
 * production, and the renderer points at the checkout.
 */
export function verifyDevIsolation(isolation: DevIsolation): string[] {
	const failures: string[] = [];
	const productionRoot = path.join(isolation.homeDir, PRODUCTION_CONFIG_DIR);

	if (path.resolve(isolation.configRoot) === path.resolve(productionRoot)) {
		failures.push(`config root is the production root: ${isolation.configRoot}`);
	}
	if (!isInside(isolation.configRoot, isolation.homeDir)) {
		failures.push(`config root escapes the home directory: ${isolation.configRoot}`);
	}
	if (isInside(isolation.configRoot, productionRoot)) {
		failures.push(`config root is inside the production root: ${isolation.configRoot}`);
	}
	if (isInside(isolation.agentDir, productionRoot)) {
		failures.push(`agent dir is inside the production root: ${isolation.agentDir}`);
	}
	if (!isInside(isolation.agentDir, isolation.configRoot)) {
		failures.push(`agent dir escapes the dev root: ${isolation.agentDir}`);
	}

	const statePaths: Array<[string, string]> = [
		["team db", isolation.teamDb],
		["serve registry", isolation.serveRegistry],
		["stats db", isolation.statsDb],
		["trash dir", isolation.trashDir],
		["default workspace", isolation.workspaceDir],
		["desktop user data", isolation.desktopUserData],
	];
	for (const [label, value] of statePaths) {
		if (!isInside(value, isolation.configRoot)) {
			failures.push(`${label} escapes the dev root: ${value}`);
		}
		if (isInside(value, productionRoot)) {
			failures.push(`${label} is inside the production root: ${value}`);
		}
	}

	if (path.resolve(isolation.webAppDir) !== path.join(isolation.repoRoot, "web-app", "dist")) {
		failures.push(`ZETA_WEB_APP_DIR must point at <repo>/web-app/dist: ${isolation.webAppDir}`);
	}

	const ports = isolation.ports;
	const seen = new Set<number>();
	for (const [name, port] of Object.entries(ports) as Array<[string, number]>) {
		if (!Number.isInteger(port) || port < 1024 || port > 65535) {
			failures.push(`${name} port is not an unprivileged TCP port: ${port}`);
		}
		if (seen.has(port)) failures.push(`dev ports must be distinct: ${name} reuses ${port}`);
		seen.add(port);
		if (port === PRODUCTION_PORTS.web || port === PRODUCTION_PORTS.gateway || port === PRODUCTION_PORTS.stats) {
			failures.push(`${name} port collides with an installed Zeta default: ${port}`);
		}
	}

	const expectedEnv: Record<string, string> = {
		ZETA_CONFIG_DIR: DEV_CONFIG_DIR,
		ZETA_PROFILE: DEV_PROFILE,
		ZETA_CODING_AGENT_DIR: isolation.agentDir,
		ZETA_DEFAULT_WORKSPACE: isolation.workspaceDir,
		ZETA_TEAM_DB: isolation.teamDb,
		ZETA_SERVE_REGISTRY: isolation.serveRegistry,
		ZETA_TRASH_DIR: isolation.trashDir,
		ZETA_WEB_GATEWAY_PORT: String(isolation.ports.gateway),
		ZETA_GATEWAY_URL: isolation.urls.gateway,
		ZETA_WEB_APP_DIR: isolation.webAppDir,
	};
	for (const [key, value] of Object.entries(expectedEnv)) {
		if (isolation.env[key] !== value)
			failures.push(`${key} resolves to ${isolation.env[key] ?? "<unset>"}, expected ${value}`);
	}

	return failures;
}
