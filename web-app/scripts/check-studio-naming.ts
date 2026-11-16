#!/usr/bin/env bun
/**
 * Renderer naming guard.
 *
 * The Studio renderer and its two locale bundles must not call the upstream
 * product by name, and must not use bare "Studio" as the product/UI name.
 * Product/UI name: Z Work Studio. Runtime identity: Zeta.
 *
 * Existing storage/database names and CSS plumbing are allowed only as exact
 * identifiers. String literals, template fragments and JSX text are inspected
 * with the TypeScript parser so copy beside className is never skipped.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const ROOT = join(import.meta.dir, "..");
const STUDIO = join(ROOT, "src", "studio");
/** Persisted formats or non-rendered implementation names; never whole lines. */
const TECHNICAL = [
  /^omp-studio-(?:ui|backgrounds)$/,
  /^\.?omp-(?:menu|tip|mermaid|copy)[\w-]*$/,
  /^omp$/,
  /^ompprurl$/,
  /^omp\.$/,
];

/** Third-party product names that legitimately contain "Studio". */
const STUDIO_ALLOW = /LM Studio|Z Work Studio|Work Studio/;

const MIGRATION_FILES = new Set(["storageMigration.ts", "storageMigration.test.ts"]);

interface Hit {
  file: string;
  line: number;
  text: string;
  reason: string;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !MIGRATION_FILES.has(name) ? [path] : [];
  });
}

function checkText(text: string): string | undefined {
  const value = text.trim();
  if (!value || TECHNICAL.some(pattern => pattern.test(value))) return undefined;
  if (/\bOMP\b/.test(value)) return "user-visible OMP";
  if (/\bomp\b/.test(value)) return "user-visible omp";
  if (/(?<!Work )(?<!LM )\bStudio\b/.test(value) && !STUDIO_ALLOW.test(value)) {
    return "bare Studio as product name";
  }
  return undefined;
}

function scanSource(path: string): Hit[] {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const hits: Hit[] = [];
  function visit(node: ts.Node): void {
    if (ts.isStringLiteral(node) && ts.isJsxAttribute(node.parent) && node.parent.name.getText(source) === "className") return;
    if (ts.isStringLiteralLike(node) || ts.isJsxText(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      const reason = checkText(node.text);
      if (reason) hits.push({ file: relative(ROOT, path), line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, text: node.text, reason });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return hits;
}

const hits = walk(STUDIO).flatMap(scanSource);
if (hits.length > 0) {
  console.error("Studio naming guard failed: user-visible upstream/product names\n");
  for (const hit of hits) console.error(`${hit.file}:${hit.line}: ${hit.reason}: ${JSON.stringify(hit.text)}`);
  console.error(`\n${hits.length} hit(s). Use Z Work Studio for the product/UI and Zeta for the runtime;`);
  console.error("allow only frozen contracts/technical identifiers in web-app/scripts/check-studio-naming.ts.");
  process.exit(1);
}
console.log("Studio naming guard: clean");
