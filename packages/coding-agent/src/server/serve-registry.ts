/**
 * `zeta serve` instance registry — the discovery half of multi-surface
 * coexistence (desktop shell, `zeta serve`, `zeta-d`).
 *
 * Rules, deliberately minimal:
 *
 * - One registration file (`~/.zeta/serve.json`, `0600`, user-private dir)
 *   describes the **most recently started** serve instance:
 *   `{ pid, webUrl, statsUrl, gatewayUrl, version, startedAt, cwd }`.
 * - The file is a *hint*, never the authority: liveness comes from the pid and
 *   identity comes from `GET /api/server/identity` on the instance's own URL
 *   (see `./web-gateway/identity.ts`). A file whose pid is gone is stale and is
 *   removed on the next discovery; a wedged/unresponsive pid is not killed —
 *   the bind failure stays the operator's error to see.
 * - Same version + healthy → the newcomer reuses instead of fighting for the
 *   port. Different version → the newcomer refuses the port with options.
 *   "Healthy" means what the user needs, not just that the gateway answers:
 *   the identity route is served in-process, so the reuse decision also probes
 *   the Web UI page the instance proxies to (see {@link probeWebUiSurface}) and
 *   refuses an instance whose Web UI child is gone instead of adopting it.
 *
 * The Electron shell cannot import this module (separate npm project, no
 * workspace dependency); `desktop/src/serve-discovery.ts` carries the same
 * semantics over the same file and endpoint. Keep the two in step.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getBaseConfigRoot } from "@linxiraos/pi-utils";
import { SERVE_IDENTITY_PATH, type ServeIdentity } from "./web-gateway/identity";

/** Env override for the registry file (tests, portable installs). */
export const SERVE_REGISTRY_ENV = "ZETA_SERVE_REGISTRY";

/** Registry file name inside the config root (`~/.zeta`). */
export const SERVE_REGISTRY_FILE = "serve.json";

/** Probe budget: loopback identity must answer fast or the instance is unwell. */
export const SERVE_PROBE_TIMEOUT_MS = 1500;

/** Path of the surface the user actually needs — the Web UI page, not `/api/*`. */
export const SERVE_WEB_UI_PROBE_PATH = "/";

/**
 * Budget for the Web UI page probe (attempts, and the delay between them).
 * The identity route answers from process facts as soon as the listeners bind,
 * while the Web UI child may still be compiling its first page, so one refused
 * request must not condemn a healthy, booting instance; a genuinely dead child
 * (the v1.2.1 `npm error 404` shape) fails every attempt.
 */
export const SERVE_WEB_UI_PROBE_ATTEMPTS = 2;
export const SERVE_WEB_UI_PROBE_RETRY_MS = 1200;

/**
 * Result of probing an instance's Web UI page.
 *
 * `/api/server/identity` is answered in-process by the gateway, so an instance
 * whose Web UI child died still passes it — the reverse proxy only fails on the
 * page and on the `/api/*` routes Next owns. This probe is the only thing that
 * tells "gateway up, UI alive" from "gateway up, UI dead".
 */
export interface WebUiSurfaceProbe {
	ok: boolean;
	/** URL probed (the instance's Web UI origin plus {@link SERVE_WEB_UI_PROBE_PATH}). */
	url: string;
	/** HTTP status of the answer; null when the request never produced one. */
	status: number | null;
	/** Transport error when the request failed outright. */
	error: string | null;
	/** Attempts spent (1 when the first one passed). */
	attempts: number;
}

/** A published serve instance. */
export interface ServeRegistration {
	pid: number;
	webUrl: string;
	statsUrl: string;
	gatewayUrl: string | null;
	version: string;
	startedAt: string;
	/** Working directory the instance was started in (workspace of its UI). */
	cwd: string;
	/**
	 * One-time open-bridge secret of a desktop-spawned instance. Stored only so
	 * a reusing desktop shell can validate the open tokens the shared gateway
	 * issues; the file is 0600 inside the user's private config root.
	 */
	desktopOpenSecret?: string;
}

/** Where the registry lives unless `ZETA_SERVE_REGISTRY` overrides it. */
export function serveRegistryPath(env: NodeJS.ProcessEnv = process.env): string {
	const override = env[SERVE_REGISTRY_ENV]?.trim();
	return override ? path.resolve(override) : path.join(getBaseConfigRoot(), SERVE_REGISTRY_FILE);
}

/** Structural validation — a hand-edited or half-written file must never be trusted. */
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

/** Read the registration, or null when absent/unreadable/malformed. */
export function readServeRegistration(file: string = serveRegistryPath()): ServeRegistration | null {
	try {
		return parseServeRegistration(JSON.parse(fs.readFileSync(file, "utf8")));
	} catch {
		return null;
	}
}

/**
 * Publish this instance. Written atomically (temp file + rename) so a
 * concurrent reader never sees a half-written document, and `0600` so the
 * desktop open secret inside is not world-readable — on Windows, where `chmod`
 * has no equivalent, the user-private config root is the boundary.
 */
export function writeServeRegistration(
	entry: ServeRegistration,
	file: string = serveRegistryPath(),
): ServeRegistration {
	fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
	const temp = `${file}.${process.pid}.tmp`;
	fs.writeFileSync(temp, `${JSON.stringify(entry, null, "\t")}\n`, { mode: 0o600 });
	fs.renameSync(temp, file);
	try {
		fs.chmodSync(file, 0o600);
	} catch {
		// Windows: no POSIX modes; the user-private directory carries the ACL.
	}
	return entry;
}

/** Remove the registration only when it still describes `pid` (never a successor's). */
export function clearServeRegistration(pid: number = process.pid, file: string = serveRegistryPath()): boolean {
	const current = readServeRegistration(file);
	// An unparsable file is left alone: it may describe an instance of another
	// build, and deleting a foreign registration is worse than a stale byte range.
	if (current ? current.pid !== pid : fs.existsSync(file)) return false;
	try {
		fs.rmSync(file, { force: true });
		return true;
	} catch {
		return false;
	}
}

/** Whether a pid is a live process (EPERM counts: it exists, just not ours). */
export function isPidAlive(pid: number): boolean {
	if (!Number.isSafeInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		return (err as NodeJS.ErrnoException).code === "EPERM";
	}
}

/**
 * URLs to probe for an instance, loopback first: a bind-all (`0.0.0.0`) or
 * specific-interface host is still reachable on `127.0.0.1` in the common
 * case, while a loopback-only instance is not reachable any other way.
 */
export function identityProbeUrls(webUrl: string): string[] {
	try {
		const url = new URL(webUrl);
		const loopback = url.port ? `http://127.0.0.1:${url.port}` : null;
		// A tested bind host is also a valid loopback address; the raw URL covers
		// the specific-interface bind that is not reachable on 127.0.0.1.
		return loopback && loopback !== webUrl.replace(/\/+$/, "") ? [loopback, webUrl] : [webUrl];
	} catch {
		return [webUrl];
	}
}

/** Identity of the instance answering on `url`, or null when it is not ours. */
export async function probeServeIdentity(
	url: string,
	options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<ServeIdentity | null> {
	const doFetch = options.fetchImpl ?? fetch;
	const base = url.replace(/\/+$/, "");
	try {
		const response = await doFetch(`${base}${SERVE_IDENTITY_PATH}`, {
			headers: { accept: "application/json" },
			signal: AbortSignal.timeout(options.timeoutMs ?? SERVE_PROBE_TIMEOUT_MS),
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

/**
 * Probe the Web UI page of an instance that already answered its identity
 * (see {@link WebUiSurfaceProbe} for why the identity answer is not enough).
 * Bounded retry, never fatal: any transport failure is a failed probe.
 */
export async function probeWebUiSurface(
	url: string,
	options: { fetchImpl?: typeof fetch; timeoutMs?: number; sleepImpl?: (ms: number) => Promise<void> } = {},
): Promise<WebUiSurfaceProbe> {
	const doFetch = options.fetchImpl ?? fetch;
	const sleep = options.sleepImpl ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
	const target = `${url.replace(/\/+$/, "")}${SERVE_WEB_UI_PROBE_PATH}`;
	let last: WebUiSurfaceProbe = { ok: false, url: target, status: null, error: "not attempted", attempts: 0 };
	for (let attempt = 1; attempt <= SERVE_WEB_UI_PROBE_ATTEMPTS; attempt++) {
		try {
			const response = await doFetch(target, {
				headers: { accept: "text/html" },
				signal: AbortSignal.timeout(options.timeoutMs ?? SERVE_PROBE_TIMEOUT_MS),
			});
			last = { ok: response.ok, url: target, status: response.status, error: null, attempts: attempt };
		} catch (err) {
			last = {
				ok: false,
				url: target,
				status: null,
				error: err instanceof Error ? err.message : String(err),
				attempts: attempt,
			};
		}
		if (last.ok) return last;
		if (attempt < SERVE_WEB_UI_PROBE_ATTEMPTS) await sleep(SERVE_WEB_UI_PROBE_RETRY_MS);
	}
	return last;
}

/** What the newcomer should do about an instance it found (pure decision). */
export type ServeReuseDecision =
	| { action: "start" }
	| { action: "reuse"; identity: ServeIdentity; registration: ServeRegistration | null }
	| { action: "version-mismatch"; identity: ServeIdentity; registration: ServeRegistration | null };

/**
 * Reuse only a healthy instance running *this* version. A version mismatch is
 * never taken over silently (the older instance keeps its port and sessions;
 * the options are printed by the caller); an unknown/foreign server is not
 * treated as ours at all — the probe already rejected it.
 */
export function decideServeReuse(args: {
	identity: ServeIdentity | null;
	registration: ServeRegistration | null;
	currentVersion: string;
}): ServeReuseDecision {
	const { identity, registration, currentVersion } = args;
	if (!identity) return { action: "start" };
	if (identity.version !== currentVersion) return { action: "version-mismatch", identity, registration };
	return { action: "reuse", identity, registration };
}

/** Outcome of a discovery pass. */
export interface ServeDiscovery {
	/** Healthy Zeta instance found (identity probe answered). */
	identity: ServeIdentity | null;
	/** Registration the answering instance owns; null when absent or not its own. */
	registration: ServeRegistration | null;
	/** A dead-owner registration that was removed during this pass. */
	staleRegistration: ServeRegistration | null;
	/** URL that answered the identity probe (loopback form), null when none did. */
	probedUrl: string | null;
	/**
	 * Web UI page probe of the answering instance; null when none answered.
	 * Carried (not decided) here so the plan stays a pure function.
	 */
	webUiProbe: WebUiSurfaceProbe | null;
}

/**
 * Find the instance to reuse or refuse:
 *
 * 1. read the registry, drop it when its owner pid is gone (stale);
 * 2. probe the caller's own bind URL first (a deleted registry must not hide
 *    the instance actually holding the port), then the recorded URL;
 * 3. report the identity plus the registration only when it belongs to the
 *    instance that answered — the file is not an authority on liveness.
 */
export async function discoverServeInstance(options: {
	targetUrl: string;
	registryFile?: string;
	fetchImpl?: typeof fetch;
	timeoutMs?: number;
	isAlive?: (pid: number) => boolean;
	/** Delay between Web UI probe attempts; tests inject a no-op. */
	sleepImpl?: (ms: number) => Promise<void>;
}): Promise<ServeDiscovery> {
	const file = options.registryFile ?? serveRegistryPath();
	const alive = options.isAlive ?? isPidAlive;
	let registration = readServeRegistration(file);
	let staleRegistration: ServeRegistration | null = null;
	if (registration && !alive(registration.pid)) {
		staleRegistration = registration;
		clearServeRegistration(registration.pid, file);
		registration = null;
	}

	const candidates: string[] = [];
	for (const url of [
		...identityProbeUrls(options.targetUrl),
		...(registration ? identityProbeUrls(registration.webUrl) : []),
	]) {
		if (!candidates.includes(url)) candidates.push(url);
	}
	for (const url of candidates) {
		const identity = await probeServeIdentity(url, options);
		if (!identity) continue;
		// The answering pid is ground truth: a registration naming a different
		// live process is stale metadata, not this instance's record. The page
		// probe runs here (not in the plan) because it needs the fetch seams.
		return {
			identity,
			registration: registration?.pid === identity.pid ? registration : null,
			staleRegistration,
			probedUrl: url,
			webUiProbe: await probeWebUiSurface(url, options),
		};
	}
	return { identity: null, registration, staleRegistration, probedUrl: null, webUiProbe: null };
}

/**
 * What a starting `zeta serve` should do with what discovery found. Every plan
 * carries the dead-owner registration discovery removed, so the caller can
 * report it whichever branch it takes.
 */
export type ServeStartPlan =
	| { action: "start"; stale: ServeRegistration | null; other: ServeIdentity | null }
	| {
			action: "reuse";
			identity: ServeIdentity;
			registration: ServeRegistration | null;
			stale: ServeRegistration | null;
	  }
	| {
			action: "version-mismatch";
			identity: ServeIdentity;
			registration: ServeRegistration | null;
			stale: ServeRegistration | null;
	  }
	| {
			/**
			 * The instance holding the port answers its gateway but not its Web UI
			 * (the identity route is in-process; the page is proxied to the Web UI
			 * child). Reusing it would hand every client a dead UI, so it is refused
			 * with the probe evidence instead.
			 */
			action: "web-ui-unreachable";
			identity: ServeIdentity;
			registration: ServeRegistration | null;
			stale: ServeRegistration | null;
			probe: WebUiSurfaceProbe;
	  };

/**
 * Port-scoped policy for the CLI: only an instance *holding the URL this
 * process is about to bind* is a conflict — that is the case that must be
 * reused or refused instead of failing on `EADDRINUSE`. A same-version
 * instance on another port is a deliberate second listener (an explicit
 * `--web-port`), so it is reported and this one still starts. A same-version
 * instance whose Web UI page does not answer is refused rather than reused
 * (`web-ui-unreachable`), with the probe result the caller prints.
 */
export function planServeStart(args: {
	discovery: ServeDiscovery;
	targetUrl: string;
	currentVersion: string;
}): ServeStartPlan {
	const { discovery, targetUrl, currentVersion } = args;
	const stale = discovery.staleRegistration;
	const identity = discovery.identity;
	const occupiesTarget =
		identity !== null && discovery.probedUrl !== null && identityProbeUrls(targetUrl).includes(discovery.probedUrl);
	if (!identity || !occupiesTarget) {
		return { action: "start", stale, other: identity };
	}
	const { registration } = discovery;
	if (identity.version !== currentVersion) return { action: "version-mismatch", identity, registration, stale };
	// A corpse: gateway up, the Web UI it proxies to down (v1.2.1 npm-404 shape).
	// `reuse` would leave every client pointed at a dead UI, so refuse with the
	// probe evidence — the caller prints the target it tried.
	if (discovery.webUiProbe && !discovery.webUiProbe.ok) {
		return { action: "web-ui-unreachable", identity, registration, stale, probe: discovery.webUiProbe };
	}
	return { action: "reuse", identity, registration, stale };
}
