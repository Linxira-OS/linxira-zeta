#!/usr/bin/env bun
/**
 * Renderer naming guard.
 *
 * The Studio renderer and its two locale bundles must not call the upstream
 * product by name, and must not use bare "Studio" as the product/UI name.
 * Product/UI name: Z Work Studio. Runtime identity: Zeta.
 *
 * Frozen contracts and technical identifiers that never render (storage keys,
 * CSS class names, `omp://` internal links, env vars, DB names) are allowed by
 * the narrow exceptions below. This guard deliberately scans string literals
 * and JSX text, not comments or identifiers; a comment may name the upstream.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");
const STUDIO = join(ROOT, "src", "studio");
const LOCALES = [join(STUDIO, "i18n", "locales", "en.ts"), join(STUDIO, "i18n", "locales", "zh.ts")];

/** Strings that are frozen protocol/storage/plumbing surfaces, never copy. */
const TECHNICAL = [
  /^omp:\/\//,
  /^omp\./,
  /^omp-studio-(ui|backgrounds)$/,
  /^omp-(menu|tip|mermaid|conversation-|copy)/,
  /^OMP_STUDIO_CLIENT$/,
  /^VITE_OMP_/,
  /^__omp_/,
  /^@?omp[-/]/,
  /^omp$/,
  /^ompprurl$/,
  /^\.omp/,
];

/** Raw host labels/statuses that are matched, never rendered as copy. */
const FROZEN_VALUES: Record<string, readonly RegExp[]> = {
  "src/studio/CapabilitiesPage.tsx": [/^OMP$/],
  "src/studio/ModelConfigPage.tsx": [/^OMP 已解析到可用模型$/],
};

/** Third-party product names that legitimately contain "Studio". */
const STUDIO_ALLOW = /LM Studio|Z Work Studio|Work Studio/;

const LOCALE_VALUE = /(?:^|[,{]\s*)["']([^"']+)["']\s*:/; // key, not value
const QUOTED = /(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
const JSX_TEXT = />([^<>{}\n][^<>{}]*)</g;

interface Hit {
  file: string;
  line: number;
  text: string;
  reason: string;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) out.push(...walk(path));
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

function checkText(text: string, file?: string): string | undefined {
  const value = text.trim();
  if (!value || TECHNICAL.some(pattern => pattern.test(value))) return undefined;
  if (file && FROZEN_VALUES[file.replaceAll("\\", "/")]?.some(pattern => pattern.test(value))) return undefined;
  if (/\bOMP\b/.test(value)) return "user-visible OMP";
  if (/\bomp\b/.test(value)) return "user-visible omp";
  if (/(?<!Work )(?<!LM )\bStudio\b/.test(value) && !STUDIO_ALLOW.test(value)) {
    return "bare Studio as product name";
  }
  return undefined;
}

function scanLocale(path: string): Hit[] {
  const hits: Hit[] = [];
  readFileSync(path, "utf8").split("\n").forEach((line, index) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    // Locale strings are values after a colon. Ignore the key itself.
    const valueStart = line.indexOf(":");
    if (valueStart < 0) return;
    const valuePart = line.slice(valueStart + 1);
    for (const match of valuePart.matchAll(QUOTED)) {
      const reason = checkText(match[2] ?? "", relative(ROOT, path));
      if (reason) hits.push({ file: relative(ROOT, path), line: index + 1, text: match[2]!, reason });
    }
  });
  return hits;
}

function scanSource(path: string): Hit[] {
  const hits: Hit[] = [];
  const lines = readFileSync(path, "utf8").split("\n");
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
    // Class names and selectors are plumbing; visible attributes/text still scan.
    if (/className=|closest\(|querySelector|classList|localStorage|sessionStorage|indexedDB/.test(line)) return;
    for (const match of line.matchAll(QUOTED)) {
      const reason = checkText(match[2] ?? "", relative(ROOT, path));
      if (reason) hits.push({ file: relative(ROOT, path), line: index + 1, text: match[2]!, reason });
    }
    for (const match of line.matchAll(JSX_TEXT)) {
      const reason = checkText(match[1] ?? "");
      if (reason) hits.push({ file: relative(ROOT, path), line: index + 1, text: match[1]!, reason });
    }
  });
  return hits;
}

const hits = [...LOCALES.flatMap(scanLocale), ...walk(STUDIO).flatMap(scanSource)];
if (hits.length > 0) {
  console.error("Studio naming guard failed: user-visible upstream/product names\n");
  for (const hit of hits) console.error(`${hit.file}:${hit.line}: ${hit.reason}: ${JSON.stringify(hit.text)}`);
  console.error(`\n${hits.length} hit(s). Use Z Work Studio for the product/UI and Zeta for the runtime;`);
  console.error("allow only frozen contracts/technical identifiers in web-app/scripts/check-studio-naming.ts.");
  process.exit(1);
}
console.log("Studio naming guard: clean");
