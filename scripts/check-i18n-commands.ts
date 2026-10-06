#!/usr/bin/env bun
/**
 * Gate: slash-command descriptions must be i18n-backed, never static English.
 *
 * Scans packages/coding-agent/src/slash-commands/*.ts for `description:` sites:
 * - RED: value starts with a string literal (static English text) — any file.
 * - RED (builtin-* spec tables): value references neither `M.*` nor a thunk
 *   call — i.e. the description is not locale-resolved on read.
 *
 * Out of gate scope (descriptions flow from M-sourced specs at runtime):
 * builtin-registry.ts and builtin-completions.ts materialize/resolve
 * descriptions via resolveCommandDescription; types.ts declares the field.
 *
 * Usage: bun scripts/check-i18n-commands.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";

const repoRoot = path.join(import.meta.dir, "..");
const dir = path.join(repoRoot, "packages/coding-agent/src/slash-commands");

/** Files that materialize/resolve descriptions instead of declaring them. */
const NON_SPEC_FILES = new Set(["builtin-registry.ts", "builtin-completions.ts", "types.ts"]);

const files = fs
	.readdirSync(dir)
	.filter(file => file.endsWith(".ts"))
	.sort();

let failed = 0;
let sites = 0;
const report = (file: string, line: number, message: string): void => {
	console.error(`${file}:${line}: ${message}`);
	failed++;
};

for (const file of files) {
	const lines = (await Bun.file(path.join(dir, file)).text()).split("\n");
	for (let i = 0; i < lines.length; i++) {
		const site = /\bdescription\s*:\s*/.exec(lines[i]);
		if (!site) continue;
		sites++;
		// Join continuation lines until the value expression terminates: depth
		// back to zero at a `,` or `;`. Keeps multiline ternaries/strings intact.
		let expr = lines[i].slice(site.index + site[0].length);
		let j = i;
		let depth = 0;
		let terminated = false;
		const isOpen = (ch: string): boolean => ch === "(" || ch === "[" || ch === "{";
		const isClose = (ch: string): boolean => ch === ")" || ch === "]" || ch === "}";
		for (;;) {
			for (let c = 0; c < expr.length; c++) {
				const ch = expr[c];
				if (isOpen(ch)) depth++;
				else if (isClose(ch)) depth--;
				else if (depth === 0 && (ch === "," || ch === ";")) {
					expr = expr.slice(0, c);
					terminated = true;
					break;
				}
			}
			if (terminated || j >= lines.length - 1) break;
			j++;
			expr += `\n${lines[j]}`;
		}
		const trimmed = expr.trim();
		if (trimmed.length === 0) {
			report(file, i + 1, "description has no value expression");
			continue;
		}
		if (/^["'`]/.test(trimmed)) {
			report(file, i + 1, `static description string (must be M-backed): ${trimmed.split("\n")[0].slice(0, 60)}`);
			continue;
		}
		if (NON_SPEC_FILES.has(file)) continue;
		const isSpecTable = file.startsWith("builtin-");
		const mBacked = /\bM\.[A-Za-z0-9_$]+/.test(trimmed);
		const thunkCall = /\(\)\s*$/.test(trimmed);
		if (isSpecTable && !mBacked && !thunkCall) {
			report(
				file,
				i + 1,
				`description not M-backed (expected () => M.* or thunk): ${trimmed.split("\n")[0].slice(0, 60)}`,
			);
		}
	}
}

console.log(`slash-command descriptions scanned: ${sites} across ${files.length} files, failures: ${failed}`);
if (sites === 0) {
	console.error("no description sites found — scan scope is broken");
	process.exit(1);
}
process.exit(failed === 0 ? 0 : 1);
