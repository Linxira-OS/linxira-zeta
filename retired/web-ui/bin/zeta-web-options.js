"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseArgs } = require("util");

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

/**
 * Gateway default. Must match `DEFAULT_GATEWAY_PORT` in `lib/proxy-targets.ts`
 * and `ZETA_GATEWAY_PORT` in `packages/utils/src/ports.ts`; this file is the
 * CommonJS copy the launcher needs before any TypeScript is resolvable.
 */
const DEFAULT_GATEWAY_PORT = "43143";

function isEnabled(value) {
  return typeof value === "string" && TRUE_VALUES.has(value.trim().toLowerCase());
}

/**
 * Origin of the `zeta serve` kernel this UI renders.
 *
 * Precedence matches `resolveGatewayUrl()` in `lib/proxy-targets.ts`:
 * `ZETA_WEB_GATEWAY_URL` wins, then `--gateway`, then `ZETA_WEB_GATEWAY_PORT`,
 * then the default port. `zeta-web` never starts that process.
 */
function resolveGatewayUrl(cliUrl, env = process.env) {
  const configured = cliUrl || env.ZETA_WEB_GATEWAY_URL;
  if (configured && configured.trim()) return configured.trim().replace(/\/+$/, "");
  const port = (env.ZETA_WEB_GATEWAY_PORT || "").trim() || DEFAULT_GATEWAY_PORT;
  return `http://127.0.0.1:${port}`;
}

function parseLaunchOptions(args = process.argv.slice(2), env = process.env) {
  const { values: cliArgs } = parseArgs({
    args,
    options: {
      port: { type: "string", short: "p" },
      hostname: { type: "string", short: "H" },
      gateway: { type: "string", short: "g" },
      "no-open": { type: "boolean" },
    },
    strict: false,
  });

  return {
    port: cliArgs.port ?? env.PORT ?? "30141",
    hostname: cliArgs.hostname ?? env.ZETA_WEB_HOSTNAME ?? env.OMP_WEB_HOSTNAME ?? "127.0.0.1",
    openBrowser: !cliArgs["no-open"] && !isEnabled(env.ZETA_WEB_NO_OPEN ?? env.OMP_WEB_NO_OPEN),
    gatewayUrl: resolveGatewayUrl(cliArgs.gateway, env),
  };
}

module.exports = { DEFAULT_GATEWAY_PORT, parseLaunchOptions, resolveGatewayUrl };
