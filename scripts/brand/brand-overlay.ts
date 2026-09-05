/**
 * Brand overlay (apply mode). Rewrites the mechanical OMP→Zeta markers listed
 * in brand-rules.ts across tracked product sources. Run on a sync branch
 * immediately after a complete tag merge and the structural (scope/catalog/
 * lockfile) repair, BEFORE per-bucket test triage: the sweep removes the
 * brand-caused test noise so the remaining failures are all judgment calls.
 *
 * The sweep is idempotent and deliberately narrow — it only rewrites tokens
 * whose Zeta canonical form is unambiguous. Anything semantic (test contracts,
 * upstream interop surfaces) is left for the manual per-file resolve; run
 * `bun scripts/brand/brand-check.ts` afterwards to see what still needs hands.
 *
 * Usage: bun scripts/brand/brand-overlay.ts [--dry]
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { SKIP_PREFIXES } from "./brand-rules";

const ROOT = path.resolve(import.meta.dir, "../..");
const dry = process.argv.includes("--dry");

/** Mechanical token rewrites: upstream form → Zeta canonical form. */
const REWRITES: Array<{ name: string; from: RegExp; to: string; exclude?: RegExp }> = [
	{
		name: "user-agent",
		from: /USER_AGENT = `omp\/\$\{VERSION\}`/g,
		to: "USER_AGENT = `zeta/${" + "VERSION}`",
	},
	{ name: "preview-title", from: /const PREVIEW_TITLE = "omp"/g, to: 'const PREVIEW_TITLE = "ζ"' },
	{ name: "init-xdg-app-name", from: /const APP_NAME = "omp"/g, to: 'const APP_NAME = "zeta"' },
	{
		name: "profile-alias-command",
		from: /(display|posix|fish|powerShell): "omp"/g,
		to: '$1: "zeta"',
	},
	{
		name: "zai-key-name",
		from: /name: "oh-my-pi"/g,
		to: 'name: "zeta"',
		exclude: /legacy-pi-compat|uploaders-legacy|oauth-flow|harmony-leak/,
	},
	{
		name: "omp-path-fixture",
		from: /(path\.join\([^)]*?)\.omp(?=\s*,\s*"(?:skills|agent|agents|plugins|cache)")/g,
		to: "$1.zeta",
		exclude: /discovery\/(helpers|omp-plugins|claude-plugins)|omp-extension-roots|legacy-pi/,
	},
	{
		name: "mcp-schema-url",
		from: /https:\/\/raw\.githubusercontent\.com\/can1357\/oh-my-pi\/main\/packages\/coding-agent\/src\/config\/mcp-schema\.json/g,
		to: "https://raw.githubusercontent.com/Linxira-OS/linxira-zeta/main/packages/coding-agent/src/config/mcp-schema.json",
	},
	{
		name: "theme-schema-url",
		from: /https:\/\/raw\.githubusercontent\.com\/can1357\/oh-my-pi\/main\/packages\/coding-agent\/theme-schema\.json/g,
		to: "https://raw.githubusercontent.com/Linxira-OS/linxira-zeta/main/packages/coding-agent/src/modes/theme/theme-schema.json",
	},
	{
		// Doc comments and non-interop strings describing paths that actually
		// resolve under the zeta config root (dirs.ts docs, log paths, etc.).
		name: "omp-doc-path",
		from: /(\W|^)\.omp(?![\w.\-])/g,
		to: "$1.zeta",
		exclude:
			/discovery\/(helpers|omp-plugins|claude-plugins)|omp-extension-roots|legacy-pi|title-generator|export\/share|browser-relay|plugins\/|loader\.ts/,
	},
	{
		name: "omp-xdg-doc",
		from: /(\$XDG_[A-Z_]+_HOME)\/omp\//g,
		to: "$1/zeta/",
		exclude:
			/discovery\/(helpers|omp-plugins|claude-plugins)|omp-extension-roots|legacy-pi|title-generator|export\/share|browser-relay|plugins\/|loader\.ts/,
	},
	{
		name: "omp-win-path",
		from: /(\W|^)\.omp\\/g,
		to: "$1.zeta\\",
		exclude:
			/discovery\/(helpers|omp-plugins|claude-plugins)|omp-extension-roots|legacy-pi|title-generator|export\/share|browser-relay|plugins\/|loader\.ts/,
	},
];

const SCAN_EXT = /\.(ts|tsx|rs|json|md|toml|kdl|sh|ps1)$/;
let changedFiles = 0;
let changedLines = 0;

const out = Bun.spawnSync(["git", "ls-files"], { cwd: ROOT, stdout: "pipe" });
for (const line of out.stdout.toString().split("\n")) {
	const file = line.trim();
	if (!file || !SCAN_EXT.test(file)) continue;
	if (SKIP_PREFIXES.some(prefix => file.startsWith(prefix))) continue;
	const abs = path.resolve(ROOT, file);
	if (!abs.startsWith(ROOT + path.sep)) continue; // containment guard for index paths
	const text = fs.readFileSync(abs, "utf8");
	let next = text;
	let fileHits = 0;
	for (const rule of REWRITES) {
		if (rule.exclude?.test(file)) continue;
		const matches = next.match(new RegExp(rule.from.source, rule.from.flags.replace("g", "")));
		if (!matches) continue;
		// Function callbacks receive captures positionally: expand $N in the
		// replacement against this match's captures before returning it.
		next = next.replace(rule.from, (...args) => {
			fileHits++;
			const captures: Record<string, string> = {};
			for (let i = 1; i < args.length - 2; i++) {
				if (typeof args[i] === "string") captures[`$${i}`] = args[i] as string;
			}
			return rule.to.replace(/\$(\d)/g, (_, n: string) => captures[`$${n}`] ?? "");
		});
	}
	if (next !== text) {
		changedFiles++;
		changedLines += fileHits;
		console.log(`${dry ? "would fix" : "fix"} ${file} (${fileHits} token(s))`);
		if (!dry) fs.writeFileSync(abs, next);
	}
}

console.log(`\n${changedFiles} file(s), ${changedLines} token(s) ${dry ? "would be" : ""} rewritten`.trim());
console.log(
	"Now run: bun scripts/brand/brand-check.ts — resolve remaining hits by hand (see document/merge-playbook.md).",
);
