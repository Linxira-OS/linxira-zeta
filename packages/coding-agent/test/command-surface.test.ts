/**
 * Command-surface guard: one product, one bin name.
 *
 * The registry (AGENTS.md: CLI bin 命名 / 伴侣产品 bin) declares exactly two
 * commands — `zetacode` and `zetaide`. Every hyphenated compatibility name and
 * the retired editor command were deleted, so a bin map that grows one back
 * silently ships a command the docs, the installers and every resolver no
 * longer know about. (The retired `zetawork` launcher and its bare `zeta`
 * index entry left with the zetawork workbench in 2026-11.)
 *
 * Two layers, because either alone is blind:
 *
 *   1. the product manifests are asserted key-for-key (an added alias and
 *      a dropped canonical name both fail);
 *   2. every `zeta*` bin key in the repository is matched against an explicit
 *      whitelist, so a *new* package cannot introduce one unnoticed — that is
 *      why the retired spellings themselves are never written here: the shape
 *      (`zeta-…`, `zetaeditor`) is what the guard rejects, not a blacklist of
 *      names a future rename could sidestep.
 */
import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..", "..", "..");

/** The published product bins, exact key sets (order-insensitive). */
const PRODUCT_BINS: ReadonlyArray<{ file: string; bins: readonly string[] }> = [
	{ file: "packages/coding-agent/package.json", bins: ["zetacode"] },
	{ file: "termide/npm/ide/package.json", bins: ["zetaide"] },
	// The reserved editor distribution (`@linxiraos/editor`) is deliberately
	// absent: it declares no command either way — the editor is a built-in
	// pane, not a bin.
];

/** Every `zeta*` bin key any package in this repository may declare. */
const ALLOWED_ZETA_BINS: Record<string, true> = {
	zetacode: true,
	zetaide: true,
	"zeta-web": true,
	"zeta-stats": true,
};

function manifest(rel: string): { bin?: Record<string, string> } {
	return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf-8")) as { bin?: Record<string, string> };
}

/** package.json files that can carry a bin map, shallow and deepest-first-safe. */
function packageJsons(): string[] {
	const found: string[] = [];
	const visit = (rel: string): void => {
		for (const entry of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			if (entry.name === "node_modules" || entry.name === "target" || entry.name.startsWith(".")) continue;
			const child = rel === "." ? entry.name : `${rel}/${entry.name}`;
			if (fs.existsSync(path.join(ROOT, child, "package.json"))) found.push(`${child}/package.json`);
			visit(child);
		}
	};
	visit(".");
	return found;
}

describe("published bin maps", () => {
	for (const { file, bins } of PRODUCT_BINS) {
		it(`${file} declares exactly ${bins.length ? bins.join(", ") : "no command"}`, () => {
			const declared = Object.keys(manifest(file).bin ?? {}).sort();
			expect(declared).toEqual([...bins].sort());
		});
	}

	it("no package declares a zeta command outside the allowed set", () => {
		// `zeta-web` / `zeta-stats` are separate tools (the Web UI server and
		// the stats dashboard), not aliases of the product commands: they
		// are allowed by name, not by shape. Anything else — including a
		// hyphenated alias that came back — is a violation.
		const violations: string[] = [];
		for (const file of packageJsons()) {
			for (const key of Object.keys(manifest(file).bin ?? {})) {
				if (!key.startsWith("zeta")) continue;
				if (!ALLOWED_ZETA_BINS[key]) violations.push(`${file}: ${key}`);
			}
		}
		expect(violations).toEqual([]);
	});

	it("the publish driver swaps the coding CLI to its one published bin", () => {
		const source = fs.readFileSync(path.join(ROOT, "scripts/ci-release-publish.ts"), "utf-8");
		const override = /publishBin:\s*\{([^}]*)\}/.exec(source)?.[1] ?? "";
		expect(override.replaceAll(/\s+/g, " ").trim()).toBe('zetacode: "dist/cli.js"');
	});
});
