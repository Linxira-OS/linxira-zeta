#!/usr/bin/env bun
/**
 * Damage class 3, executable form: every `@linxiraos/*` specifier in code must
 * resolve to something real.
 *
 * The v18.9.1 merge cost two rounds on this. A plain `@oh-my-pi/` → `@linxiraos/`
 * sweep looks right and is wrong wherever the leaf name is not ours:
 *   - `@oh-my-pi/pi-coding-agent` → our package is `@linxiraos/zeta`
 *     (registry: pi-coding-agent → zeta) — the one workspace member that is
 *     NOT linked under its upstream leaf name, so nothing resolved.
 *   - `@oh-my-pi/snapcompact` → `@linxiraos/pi-snapcompact` (stale bare name).
 * Both produced specifiers that resolve nowhere at runtime and in tsc, while
 * brand-check stayed green because the scope itself was correct.
 *
 * So: resolve each specifier with Bun's own resolver, from the importing file's
 * directory. Anything that throws must either be fixed or named in ALLOW below
 * with a reason. Published leaves that are not workspace members (platform
 * binaries, companion products) are the only expected entries.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");

/** Specifiers that legitimately do not resolve from this checkout. */
const ALLOW: Array<{ pattern: RegExp; why: string }> = [
	{
		pattern: /^@linxiraos\/pi-natives-/,
		why: "platform binary leaves, published to npm, installed only for the matching os/cpu",
	},
	{
		pattern: /^@linxiraos\/(editor|ide|main)(-|$)/,
		why: "companion products (editor/ide/workbench), separate repos and workspaces",
	},
	{
		pattern: /^@linxiraos\/zeta-web$/,
		why: "the frozen web-ui snapshot; its own package manager, not a root workspace member",
	},
	{
		pattern: /^@linxiraos\/(exa|pi-messenger|pi-newcomer|swarm-extension)$/,
		why: "published third-party-side packages referenced by plugins/scripts",
	},
	{
		pattern: /^@linxiraos\/pi-utils\/virtual-fixture$/,
		why: "a virtual module that exists only inside the fixture text of legacy-pi-bundled-virtual.test.ts",
	},
];

const SPECIFIER_RE = /(?:from|import|require)\s*\(?\s*["'](@linxiraos\/[^"']+)["']/g;

function* walk(dir: string): Generator<string> {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "node_modules" || entry.name === "dist") continue;
			yield* walk(full);
		} else if (/\.(ts|tsx|mts|cts)$/.test(entry.name)) {
			yield full;
		}
	}
}

function roots(): string[] {
	const out: string[] = [path.join(ROOT, "scripts")];
	const packages = path.join(ROOT, "packages");
	for (const pkg of fs.readdirSync(packages)) {
		for (const sub of ["src", "test", "scripts", "bench"]) {
			const dir = path.join(packages, pkg, sub);
			if (fs.existsSync(dir)) out.push(dir);
		}
	}
	return out;
}

const failures: Array<{ specifier: string; file: string; line: number }> = [];
let checked = 0;

for (const root of roots()) {
	for (const file of walk(root)) {
		const text = fs.readFileSync(file, "utf8");
		if (!text.includes("@linxiraos/")) continue;
		for (const match of text.matchAll(SPECIFIER_RE)) {
			const specifier = match[1];
			if (ALLOW.some(a => a.pattern.test(specifier))) continue;
			checked++;
			try {
				Bun.resolveSync(specifier, path.dirname(file));
			} catch {
				const line = text.slice(0, match.index).split("\n").length;
				failures.push({ specifier, file: path.relative(ROOT, file), line });
			}
		}
	}
}

if (failures.length > 0) {
	console.error(`✗ ${failures.length} unresolvable @linxiraos/* specifier occurrence(s) (${checked} checked):`);
	for (const { specifier, file, line } of failures.sort(
		(a, b) => a.specifier.localeCompare(b.specifier) || a.file.localeCompare(b.file),
	)) {
		console.error(`  ${specifier}  ← ${file}:${line}`);
	}
	console.error(
		"\nFix the specifier (workspace member names live in packages/*/package.json; our product\n" +
			"package is @linxiraos/zeta, NOT @linxiraos/pi-coding-agent) or add an ALLOW entry with a reason.",
	);
	process.exit(1);
}
console.log(`Scope imports OK: ${checked} @linxiraos/* specifier(s) resolve (${ALLOW.length} allow patterns).`);
