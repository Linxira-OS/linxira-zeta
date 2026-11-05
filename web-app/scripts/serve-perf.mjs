#!/usr/bin/env bun
/**
 * Static server for `dist-perf/` (the `vite.perf.config.ts` build).
 *
 * Loopback only, ephemeral port, no caching, no fallback: the perf page has a
 * single document and never uses history routing.
 *
 *   cd web-app
 *   bun scripts/serve-perf.mjs
 */
import { existsSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../dist-perf/", import.meta.url));

if (!existsSync(join(root, "index.html"))) {
  console.error(`dist-perf/index.html is missing — run \`npx vite build --config vite.perf.config.ts\` first.\n  expected: ${root}`);
  process.exit(1);
}

const prefix = root.endsWith(sep) ? root : `${root}${sep}`;

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    const pathname = decodeURIComponent(url.pathname);
    const relative = pathname === "/" || pathname.endsWith("/") ? `${pathname}index.html` : pathname;
    const file = Bun.file(`${prefix}${relative.replace(/^\/+/u, "")}`);
    const resolved = file.name;
    if (!resolved.startsWith(prefix)) return new Response("Forbidden", { status: 403 });
    if (!(await file.exists())) return new Response("Not found", { status: 404 });
    return new Response(file, {
      headers: { "content-type": file.type || "application/octet-stream", "cache-control": "no-store" },
    });
  },
});

console.log(`perf harness: http://127.0.0.1:${server.port}/`);
