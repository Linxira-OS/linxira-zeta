/**
 * Default loopback ports for Zeta's local services.
 *
 * OMP installs on the same machine use 30141/30142/3847, and common developer
 * tools squat on 3000/8080/8787/3847. Zeta therefore owns a dedicated block:
 * uncommon ports, at least two apart, so a side-by-side OMP install and
 * unrelated services cannot take the gateway, stats dashboard, or browser
 * relay away.
 *
 * Every default in the repository derives from these constants. The standalone
 * Electron shell (`desktop/src/main.ts`, not a Bun workspace package) carries
 * literals that must match; its serve-discovery test asserts the values.
 */
export const ZETA_WEB_PORT = 43141;
export const ZETA_GATEWAY_PORT = 43143;
export const ZETA_STATS_PORT = 43147;
export const ZETA_BROWSER_RELAY_PORT = 43153;
