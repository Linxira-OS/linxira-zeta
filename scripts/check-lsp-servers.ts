#!/usr/bin/env bun
/**
 * LSP registry freshness guard.
 *
 * `lsp/servers.json` is the single source of truth for both language-server
 * registries: the coding-agent's TypeScript table and termide's Rust table are
 * generated from it by `scripts/gen-lsp-servers.ts`. This guard regenerates both
 * in memory and fails if either file on disk differs, so a hand edit to a
 * generated file (or a canonical change that was never regenerated) cannot land.
 *
 * Validity of the canonical file itself is checked by the generator, which the
 * check exercises: duplicate language ids, missing required fields and empty
 * candidate lists all fail here too.
 *
 * Usage: bun scripts/check-lsp-servers.ts   (exit 0 fresh, 1 stale)
 */
import * as path from "node:path";
import {
	RUST_OUTPUT_PATH,
	REPO_ROOT,
	TS_OUTPUT_PATH,
	loadCanonical,
	renderRust,
	renderTypescript,
} from "./gen-lsp-servers";

const registry = await loadCanonical();
const expected = [
	{ path: TS_OUTPUT_PATH, content: renderTypescript(registry) },
	{ path: RUST_OUTPUT_PATH, content: renderRust(registry) },
];

const problems: string[] = [];
for (const { path: file, content } of expected) {
	const actual = await Bun.file(file)
		.text()
		.catch(() => null);
	const relative = path.relative(REPO_ROOT, file);
	if (actual === null) {
		problems.push(`${relative} is missing`);
		continue;
	}
	if (actual !== content) problems.push(`${relative} is out of date`);
}

if (problems.length > 0) {
	console.error("lsp servers FAILED:");
	for (const problem of problems) console.error(`  - ${problem}`);
	console.error("Regenerate with: bun scripts/gen-lsp-servers.ts");
	process.exit(1);
}

console.log(
	`lsp servers OK: ${Object.keys(registry.servers).length} builtin(s), ${expected.length} generated file(s) up to date`,
);
