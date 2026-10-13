/**
 * GET /api/server/identity — the lightweight "is this port a Zeta serve, and
 * which version is it" probe that backs serve discovery and reuse
 * (`../serve-registry.ts`, plus the desktop shell's own copy).
 *
 * The gateway answers from process facts (version/pid/start time) plus the URLs
 * the hosting `ZetaServer` registers once its listeners are up. No new
 * transport and no new auth model: it is a read-only identity probe reached
 * through the same `/api/*` surface, so the gateway's existing loopback/token
 * access gate and CSRF Origin guard apply unchanged.
 */

import { VERSION } from "@linxiraos/pi-utils";

/** Value of `app` — a non-Zeta server on the port must not be mistaken for ours. */
export const SERVE_IDENTITY_APP = "zeta";

/** Identity endpoint path, shared by the CLI and the desktop shell. */
export const SERVE_IDENTITY_PATH = "/api/server/identity";

/** URLs the hosting server publishes for discovery. */
export interface ServeInstanceUrls {
	/** User-facing proxy URL (Web UI + `/api/*`). */
	webUrl: string;
	/** Stats Dashboard URL. */
	statsUrl: string;
	/** Standalone gateway listener URL (null when it did not bind). */
	gatewayUrl: string | null;
}

/** The identity payload served on {@link SERVE_IDENTITY_PATH}. */
export interface ServeIdentity {
	app: string;
	version: string;
	pid: number;
	/** ISO timestamp the serving process started (registered start when known). */
	startedAt: string;
	webUrl?: string;
	statsUrl?: string;
	gatewayUrl?: string | null;
}

let instanceUrls: ServeInstanceUrls | null = null;
let registeredStartedAt: string | null = null;

/**
 * Publish (or clear, with `null`) the hosting server's URLs. Called by
 * `ZetaServer.start()` once the listeners are bound and by `shutdown()`.
 */
export function registerServeInstanceUrls(urls: ServeInstanceUrls | null, startedAt: Date = new Date()): void {
	instanceUrls = urls;
	registeredStartedAt = urls ? startedAt.toISOString() : null;
}

/** The identity this process serves. */
export function serveIdentity(): ServeIdentity {
	// Before any registration (dev, tests) fall back to this process's real
	// start time rather than "now", so a probe never reads a fresh boot.
	const startedAt = registeredStartedAt ?? new Date(Date.now() - process.uptime() * 1000).toISOString();
	return {
		app: SERVE_IDENTITY_APP,
		version: VERSION,
		pid: process.pid,
		startedAt,
		...(instanceUrls
			? { webUrl: instanceUrls.webUrl, statsUrl: instanceUrls.statsUrl, gatewayUrl: instanceUrls.gatewayUrl }
			: {}),
	};
}

/** Handles the identity route (already access-gated by the caller). */
export function handleServeIdentityGet(_req?: Request): Response {
	return Response.json(serveIdentity(), { headers: { "Cache-Control": "no-store" } });
}
