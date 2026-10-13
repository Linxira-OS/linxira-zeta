/**
 * Origins of the internal services the Next-side `/api/*` proxies target.
 *
 * `zeta serve` owns both ports (`--gateway-port`, `--stats-port`) and injects
 * `ZETA_WEB_GATEWAY_URL` / `NEXT_PUBLIC_STATS_URL` into the web-ui child
 * process (`spawnWebUi`). Standalone `next dev`/`next start` without that
 * injection falls back to the documented defaults, honouring
 * `ZETA_WEB_GATEWAY_PORT` for the gateway when set. The same resolution drives
 * the `beforeFiles` rewrites in `next.config.ts`; the ports are configurable,
 * so no proxy target may hardcode them.
 */

/** Gateway listener default (`ZETA_WEB_GATEWAY_PORT`). Loopback-only. */
export const DEFAULT_GATEWAY_PORT = 30142;

/** Stats Dashboard default (`--stats-port`). */
export const DEFAULT_STATS_PORT = 3847;

/** Resolve the Web Gateway origin (no trailing slash). */
export function resolveGatewayUrl(env: NodeJS.ProcessEnv = process.env): string {
	const configured = env.ZETA_WEB_GATEWAY_URL?.trim();
	if (configured) return configured.replace(/\/+$/, "");
	const port = env.ZETA_WEB_GATEWAY_PORT?.trim() || String(DEFAULT_GATEWAY_PORT);
	return `http://127.0.0.1:${port}`;
}

/** Resolve the Stats Dashboard origin (no trailing slash). */
export function resolveStatsUrl(env: NodeJS.ProcessEnv = process.env): string {
	return (env.NEXT_PUBLIC_STATS_URL?.trim() || `http://127.0.0.1:${DEFAULT_STATS_PORT}`).replace(/\/+$/, "");
}
