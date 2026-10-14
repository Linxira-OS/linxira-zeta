#!/usr/bin/env bun
/**
 * Regenerate the welcome/splash brand art from the standard FIGlet tool.
 *
 *   bun scripts/brand/generate-logo-art.ts          rewrite the constants in place
 *   bun scripts/brand/generate-logo-art.ts --check  verify only; exit 1 on drift
 *
 * The art is rendered from the FIGlet fonts vendored under
 * `scripts/brand/fonts/` (see `scripts/brand/logo-art.ts` for the spec and the
 * ASCII-only rationale). On a system FIGlet install the same output is:
 *
 *   figlet -f "ANSI Shadow" Z
 *   figlet -f "ANSI Shadow" Zeta
 *   figlet -f mini Linxira-Zeta
 *
 * `brand-check.ts` runs the same comparison in CI, so a hand-edited glyph or a
 * merge that reverts the art fails the guard.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { applyBrandArt, BRAND_ART_SPEC, diffBrandArt } from "./logo-art";

const WELCOME = path.resolve(import.meta.dir, "../../packages/tui/src/prompt/welcome.ts");
const checkOnly = process.argv.includes("--check");

const source = fs.readFileSync(WELCOME, "utf8");

if (checkOnly) {
	const drift = diffBrandArt(source);
	if (drift.length === 0) {
		console.log(`logo-art: ${BRAND_ART_SPEC.length} constants match the FIGlet render`);
		process.exit(0);
	}
	for (const { constant } of drift) console.error(`logo-art: ${constant} does not match the FIGlet render`);
	console.error("logo-art: run `bun scripts/brand/generate-logo-art.ts` to regenerate");
	process.exit(1);
}

fs.writeFileSync(WELCOME, applyBrandArt(source));
// The generated rows are long; let the repo formatter decide the line breaks so
// regeneration stays a no-diff operation under the `oxfmt --check` gate.
const formatted = Bun.spawnSync([process.execPath, "x", "oxfmt", WELCOME], { stdout: "ignore", stderr: "inherit" });
if (formatted.exitCode !== 0) console.warn("logo-art: oxfmt failed — run `bun run fmt:tools`");
console.log(`logo-art: rewrote ${BRAND_ART_SPEC.length} constants in ${path.relative(process.cwd(), WELCOME)}`);
