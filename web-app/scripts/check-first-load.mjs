#!/usr/bin/env bun
/**
 * First-load guard: the diagram renderer must never ride the boot path.
 *
 * Mermaid is reached only through `import("mermaid")` (LazyMermaid.tsx,
 * markdown.tsx), yet a chunking mistake can turn it into a static dependency of
 * the entry chunk. When that happens Vite emits a `modulepreload` for it and the
 * desktop renderer parses ~3 MB it does not need before first paint (the 7.06 MB
 * → 3.70 MB regression fixed in 1.5.2).
 *
 * The guard reads the built `dist/` output, so it catches the regression no
 * matter which bundler rule caused it:
 *   - `index.html` must not preload a `mermaid-*` or `katex-*` chunk;
 *   - the entry chunk must not import one statically;
 *   - a lazy `mermaid-*` chunk must exist (merging it into the entry would
 *     otherwise pass the first two checks while bloating the boot payload);
 *   - the total first-load JS must stay under the budget below.
 *
 *   cd web-app
 *   npm run build && bun scripts/check-first-load.mjs
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = fileURLToPath(new URL("../dist/", import.meta.url));

/** Everything `index.html` fetches before the app can mount, in bytes. */
const FIRST_LOAD_BUDGET = 4_000_000;

/** Chunks that must stay off the boot path. */
const LAZY_CHUNKS = ["mermaid", "katex"];

const kb = (bytes) => `${(bytes / 1000).toFixed(1)} kB`;

function fail(problems) {
  console.error("First-load guard failed:\n");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error("\nSee web-app/vite.config.ts (codeSplitting.groups).");
  process.exit(1);
}

const htmlPath = join(DIST, "index.html");
if (!existsSync(htmlPath)) fail([`${htmlPath} is missing — run \`npm run build\` in web-app first.`]);

const html = readFileSync(htmlPath, "utf8");
const firstLoad = [];
for (const tag of html.match(/<link\b[^>]*>/g) ?? []) {
  if (!/\brel="modulepreload"/.test(tag)) continue;
  const href = /\bhref="([^"]+)"/.exec(tag)?.[1];
  if (href) firstLoad.push({ kind: "modulepreload", file: basename(href), path: join(DIST, href.replace(/^\.\//, "")) });
}
for (const tag of html.match(/<script\b[^>]*>/g) ?? []) {
  if (!/\btype="module"/.test(tag)) continue;
  const src = /\bsrc="([^"]+)"/.exec(tag)?.[1];
  if (src) firstLoad.push({ kind: "entry", file: basename(src), path: join(DIST, src.replace(/^\.\//, "")) });
}

const problems = [];
const assets = readdirSync(join(DIST, "assets"));
for (const name of LAZY_CHUNKS) {
  if (!assets.some((file) => new RegExp(`^${name}-[^/]+\\.js$`).test(file))) {
    problems.push(`no lazy \`${name}-*.js\` chunk in dist/assets — it was merged into an always-loaded chunk.`);
  }
  const preloaded = firstLoad.filter(({ file }) => new RegExp(`^${name}-`).test(file));
  for (const item of preloaded) {
    problems.push(`index.html ${item.kind === "entry" ? "loads" : "modulepreloads"} ${item.file}; \`${name}\` must stay behind import().`);
  }
}

const entry = firstLoad.find((item) => item.kind === "entry");
if (entry === undefined) {
  problems.push("index.html has no `<script type=\"module\">` entry.");
} else {
  const code = readFileSync(entry.path, "utf8");
  // `import{…}from"./mermaid-x.js"` / `import"./mermaid-x.js"` are static;
  // `import("./mermaid-x.js")` is the lazy form and does not match.
  for (const name of LAZY_CHUNKS) {
    const staticImport = new RegExp(`(?:from|import)\\s*["']\\./${name}-`).exec(code);
    if (staticImport !== null) {
      problems.push(`${entry.file} statically imports a \`${name}\` chunk (${staticImport[0]}…) — entry graphs must reach it through import().`);
    }
  }
}

const total = firstLoad.reduce((sum, item) => sum + statSync(item.path).size, 0);
if (total > FIRST_LOAD_BUDGET) {
  problems.push(`first-load JS is ${kb(total)}, over the ${kb(FIRST_LOAD_BUDGET)} budget.`);
}

if (problems.length > 0) fail(problems);

const mermaid = assets.find((file) => /^mermaid-.*\.js$/.test(file));
console.log(`first-load JS: ${kb(total)} in ${firstLoad.length} files`);
for (const item of firstLoad) console.log(`  ${item.kind.padEnd(13)} ${item.file.padEnd(34)} ${kb(statSync(item.path).size)}`);
console.log(`lazy mermaid:  ${kb(statSync(join(DIST, "assets", mermaid)).size)} (kept off the boot path)`);
