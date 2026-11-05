#!/usr/bin/env node
"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getUnsupportedNodeVersionMessage, isNodeVersionSupported } = require("./node-version");

if (!isNodeVersionSupported(process.versions.node)) {
  console.error(getUnsupportedNodeVersionMessage(process.versions.node));
  process.exit(1);
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn } = require("child_process");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseLaunchOptions, resolveGatewayUrl } = require("./zeta-web-options");

const pkgDir = path.join(__dirname, "..");
const nextDir = path.join(pkgDir, ".next");

// Resolve next's CLI entry directly to avoid relying on .bin symlinks (which
// may not exist when installed via npx).
let nextBin;
try {
  nextBin = require.resolve("next/dist/bin/next", { paths: [pkgDir] });
} catch {
  // Fallback: locate next package root and derive the bin path manually.
  try {
    const nextPkg = require.resolve("next/package.json", { paths: [pkgDir] });
    nextBin = path.join(path.dirname(nextPkg), "dist", "bin", "next");
  } catch {
    nextBin = path.join(pkgDir, "node_modules", "next", "dist", "bin", "next");
  }
}

const options = parseLaunchOptions();
const { port, hostname, openBrowser, gatewayUrl } = options;
const loopbackHostnames = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

if (!fs.existsSync(nextDir)) {
  console.error(
    "Build artifacts not found. Run `npm run build` first, or install via `npm install -g zeta-web` to get a pre-built package.",
  );
  process.exit(1);
}

if (!loopbackHostnames.has(hostname)) {
  console.warn(
    `Warning: zeta-web is listening on ${hostname} without authentication. Only use this on a trusted network.`,
  );
}

/**
 * Verify an existing `zeta serve` before serving anything.
 *
 * This package is browser-only by design: it renders the UI and proxies every
 * `/api/*` call to the agent kernel the user already started. If that kernel is
 * missing, starting a static server that 502s every request is worse than
 * stopping — so the launcher probes `/api/server/identity`, insists on the
 * `zeta` app marker (another OMP instance on the same port must not pass), and
 * prints the exact command to run.
 */
async function probeGateway(url, timeoutMs = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${url}/api/server/identity`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` };
    const body = await response.json().catch(() => null);
    if (!body || body.app !== "zeta") {
      return { ok: false, reason: `unexpected identity payload (app=${body && body.app})` };
    }
    return { ok: true, version: body.version, pid: body.pid };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

function serveCommand() {
  return `zetacode serve --web-only --gateway-port ${new URL(gatewayUrl).port}`;
}

async function main() {
  const probe = await probeGateway(gatewayUrl);
  if (!probe.ok) {
    console.error(
      [
        `zeta-web needs a running Zeta agent kernel at ${gatewayUrl} (${probe.reason}).`,
        "",
        "Start it first:",
        "",
        `  ${serveCommand()}`,
        "",
        "Or point the UI at one you already run:",
        "",
        "  ZETA_WEB_GATEWAY_URL=http://127.0.0.1:<port> zeta-web",
      ].join("\n"),
    );
    process.exit(2);
  }
  console.log(`> Gateway ${gatewayUrl} (zeta ${probe.version ?? "unknown"}, pid ${probe.pid ?? "?"})`);

  const nextArgs = ["start", "-p", port, "-H", hostname];

  // Always run next's JS entry with node directly — avoids .bin symlink issues
  // and path-with-spaces problems on Windows when shell: true is used.
  const child = spawn(process.execPath, [nextBin, ...nextArgs], {
    cwd: pkgDir,
    stdio: ["inherit", "pipe", "inherit"],
    // The verified origin is handed to Next so its rewrites and the
    // request-time `/api/git` proxies target the kernel the user actually runs.
    env: { ...process.env, ZETA_WEB_GATEWAY_URL: gatewayUrl },
  });

  let browserOpened = false;
  const url = `http://${hostname}:${port}`;

  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    process.stdout.write(text);
    if (text.includes("Ready")) {
      console.log(`\n> Zeta Web is ready at ${url}\n`);
    }
    if (openBrowser && !browserOpened && text.includes("Ready")) {
      browserOpened = true;
      const isWindows = process.platform === "win32";
      const isMac = process.platform === "darwin";
      const openCmd = isWindows ? "start" : isMac ? "open" : "xdg-open";
      const opener = spawn(openCmd, [url], {
        shell: isWindows,
        stdio: "ignore",
        detached: true,
      });

      opener.on("error", (error) => {
        console.warn(`Could not open browser automatically: ${error.message}`);
      });

      opener.unref();
    }
  });

  child.on("exit", (code) => process.exit(code ?? 0));
}

main();
