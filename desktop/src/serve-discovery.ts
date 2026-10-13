/**
 * Desktop service discovery — decide whether to reuse an already-running Zeta
 * service or spawn our own.
 *
 * The Electron shell cannot import the monorepo's canonical implementation
 * (`packages/coding-agent/src/server/serve-registry.ts`): this is a separate npm
 * project with no workspace dependency, and it bundles the CLI as an opaque
 * binary. So this module carries the *same* semantics over the *same* two
 * artifacts, and must be kept in step with it:
 *
 * - the registration file (`~/.zeta/serve.json`, `0600`) written by `zeta serve`;
 * - the identity endpoint (`GET /api/server/identity`) that the gateway serves.
 *
 * Policy difference from the CLI, on purpose: `zeta serve --web-port X` means
 * "a second listener on X", but the desktop only ever wants *one* service — so
 * any healthy same-version instance is reused and the window points at it,
 * whatever port it listens on. Only a version mismatch refuses to proceed
 * (spawning would just collide on the default port and hide the real cause).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** Explicit registry override, shared with `zeta serve` (`ZETA_SERVE_REGISTRY`). */
export const SERVE_REGISTRY_ENV = "ZETA_SERVE_REGISTRY";

/** Config directory name, honoring the same override the CLI uses. */
const DEFAULT_CONFIG_DIR = ".zeta";

const REGISTRY_FILE_NAME = "serve.json";

const IDENTITY_PATH = "/api/server/identity";

/** Probe budget: loopback identity must answer fast or the instance is unwell. */
export const PROBE_TIMEOUT_MS = 1500;

/** A published service instance (mirror of the CLI's registration shape). */
export interface ServeRegistration {
	pid: number;
	webUrl: string;
	statsUrl: string;
	gatewayUrl: string | null;
	version: string;
	startedAt: string;
	cwd: string;
	desktopOpenSecret?: string;
}

/** Identity payload of the instance answering on a probed URL. */
export interface ServeIdentity {
	app: string;
	version: string;
	pid: number;
	startedAt?: string;
	webUrl?: string;
	statsUrl?: string;
	gatewayUrl?: string | null;
}

export interface ServeDiscoveryDeps {
	env: NodeJS.ProcessEnv;
	readTextFile: (file: string) => string | null;
	removeFile: (file: string) => void;
	isPidAlive: (pid: number) => boolean;
	fetchImpl: typeof fetch;
	timeoutMs: number;
}

/** Production seams; tests inject fakes over a temp directory. */
export function desktopServeDiscoveryDeps(env: NodeJS.ProcessEnv = process.env): ServeDiscoveryDeps {
	return {
		env,
		readTextFile: file => {
			try {
				return fs.readFileSync(file, "utf8");
			} catch {
				return null;
			}
		},
		removeFile: file => {
			try {
				fs.rmSync(file, { force: true });
			} catch {
				// A registry we cannot remove is overwritten by the next serve start.
			}
		},
		isPidAlive: pid => {
			if (!Number.isSafeInteger(pid) || pid <= 0) return false;
			try {
				process.kill(pid, 0);
				return true;
			} catch (err) {
				return (err as NodeJS.ErrnoException).code === "EPERM";
			}
		},
		fetchImpl: fetch,
		timeoutMs: PROBE_TIMEOUT_MS,
	};
}

/** Registry path, resolved exactly like `zeta serve` resolves it. */
export function serveRegistryPathIn(deps: ServeDiscoveryDeps): string {
	const override = deps.env[SERVE_REGISTRY_ENV]?.trim();
	if (override) return path.resolve(override);
	const configDir = deps.env.ZETA_CONFIG_DIR?.trim() || DEFAULT_CONFIG_DIR;
	return path.join(os.homedir(), configDir, REGISTRY_FILE_NAME);
}

/** Structural validation — a hand-edited or half-written file is never trusted. */
export function parseServeRegistration(raw: unknown): ServeRegistration | null {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
	const record = raw as Record<string, unknown>;
	const pid = record.pid;
	if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0) return null;
	if (typeof record.webUrl !== "string" || record.webUrl.length === 0) return null;
	if (typeof record.version !== "string" || record.version.length === 0) return null;
	return {
		pid,
		webUrl: record.webUrl,
		statsUrl: typeof record.statsUrl === "string" ? record.statsUrl : "",
		gatewayUrl: typeof record.gatewayUrl === "string" ? record.gatewayUrl : null,
		version: record.version,
		startedAt: typeof record.startedAt === "string" ? record.startedAt : "",
		cwd: typeof record.cwd === "string" ? record.cwd : "",
		desktopOpenSecret:
			typeof record.desktopOpenSecret === "string" && record.desktopOpenSecret.length > 0
				? record.desktopOpenSecret
				: undefined,
	};
}

/**
 * URLs worth probing for one instance: loopback first (a bind-all or
 * interface-bound host is still normally reachable on `127.0.0.1`), then the
 * recorded URL verbatim (an interface-only bind is not).
 */
export function identityProbeUrls(webUrl: string): string[] {
	try {
		const url = new URL(webUrl);
		const trimmed = webUrl.replace(/\/+$/, "");
		const loopback = url.port ? `http://127.0.0.1:${url.port}` : null;
		return loopback && loopback !== trimmed ? [loopback, webUrl] : [webUrl];
	} catch {
		return [webUrl];
	}
}

/** Rewrite a published URL to its loopback form when the host is not reachable as given. */
export function loopbackUrlFor(url: string): string {
	try {
		const parsed = new URL(url);
		const host = parsed.hostname.toLowerCase();
		if (host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]") return url;
		if (!parsed.port) return url;
		return `http://127.0.0.1:${parsed.port}`;
	} catch {
		return url;
	}
}

/** Identity of the instance answering on `url`, or null when it is not ours. */
export async function probeServeIdentity(url: string, deps: ServeDiscoveryDeps): Promise<ServeIdentity | null> {
	const base = url.replace(/\/+$/, "");
	try {
		const response = await deps.fetchImpl(`${base}${IDENTITY_PATH}`, {
			headers: { accept: "application/json" },
			signal: AbortSignal.timeout(deps.timeoutMs),
		});
		if (!response.ok) return null;
		const body = (await response.json()) as Partial<ServeIdentity> | null;
		if (!body || body.app !== "zeta" || typeof body.version !== "string" || typeof body.pid !== "number") return null;
		return body as ServeIdentity;
	} catch {
		// Connection refused, timeout, HTML from an unrelated server, truncated
		// JSON: all mean "not a healthy Zeta instance here".
		return null;
	}
}

/** What the shell should do at boot. */
export type DesktopServicePlan =
	| { action: "spawn"; stalePid: number | null }
	| {
			action: "reuse";
			/** Loopback URL that answered — the window loads this. */
			webUrl: string;
			statsUrl: string;
			gatewayUrl: string | null;
			identity: ServeIdentity;
			registration: ServeRegistration | null;
			stalePid: number | null;
	  }
	| {
			action: "version-mismatch";
			identity: ServeIdentity;
			registration: ServeRegistration | null;
			stalePid: number | null;
	  };

/**
 * Look for a running service: drop a registration whose owner pid is gone,
 * probe the recorded URL then the shell's own target, and classify the answer.
 * A version mismatch is reported, never taken over — the old instance keeps its
 * port, sessions and workspace.
 */
export async function discoverDesktopService(args: {
	deps: ServeDiscoveryDeps;
	/** The URL the shell would otherwise spawn a service on (`http://127.0.0.1:30141`). */
	targetUrl: string;
	/** Version the shell expects of its service (the bundled CLI's version). */
	expectedVersion: string;
	/** Stats URL to fall back to when the instance publishes none. */
	fallbackStatsUrl: string;
}): Promise<DesktopServicePlan> {
	const { deps, targetUrl, expectedVersion, fallbackStatsUrl } = args;
	const file = serveRegistryPathIn(deps);
	let registration = parseServeRegistration(safeJson(deps.readTextFile(file)));
	let stalePid: number | null = null;
	if (registration && !deps.isPidAlive(registration.pid)) {
		stalePid = registration.pid;
		deps.removeFile(file);
		registration = null;
	}

	const candidates: string[] = [];
	for (const url of [
		...(registration ? identityProbeUrls(registration.webUrl) : []),
		...identityProbeUrls(targetUrl),
	]) {
		if (!candidates.includes(url)) candidates.push(url);
	}

	for (const url of candidates) {
		const identity = await probeServeIdentity(url, deps);
		if (!identity) continue;
		// The answering pid is ground truth: a registration naming a different
		// live process is stale metadata, not this instance's record.
		const owned = registration?.pid === identity.pid ? registration : null;
		if (identity.version !== expectedVersion) {
			return { action: "version-mismatch", identity, registration: owned, stalePid };
		}
		const statsUrl = owned?.statsUrl || identity.statsUrl || fallbackStatsUrl;
		return {
			action: "reuse",
			webUrl: url,
			statsUrl: loopbackUrlFor(statsUrl),
			gatewayUrl: owned?.gatewayUrl ?? identity.gatewayUrl ?? null,
			identity,
			registration: owned,
			stalePid,
		};
	}
	return { action: "spawn", stalePid };
}

function safeJson(text: string | null): unknown {
	if (text === null) return null;
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}
