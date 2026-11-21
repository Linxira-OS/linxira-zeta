#!/usr/bin/env bun
/**
 * Deterministic Studio brand overlay.
 *
 * `studio:sync` applies upstream source changes; this pass rewrites the
 * upstream product/version tokens that survive in user-visible renderer text.
 * It is intentionally narrow: frozen storage keys, import names, and license
 * attribution are not touched. Run it after every Studio tag sync, then run
 * `web-app/scripts/check-studio-naming.ts`.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");
const STUDIO = join(ROOT, "web-app", "src", "studio");
const apply = process.argv.includes("--apply");

const replacements: ReadonlyArray<readonly [RegExp, string]> = [
	[/Z Work (?:Z Work )+/g, "Z Work "],
	[/OMP-Studio-Setup-0\.2\.0\.exe/g, "zeta-workstudio-setup.exe"],
	[/OMP-Studio-0\.2\.0-arm64\.dmg/g, "zeta-workstudio-arm64.dmg"],
	[/OMP Studio\.app/g, "Z Work Studio.app"],
	[/OMP Studio\.exe/g, "z-work-studio.exe"],
	[/OMP Studio/g, "Z Work Studio"],
	[/OMP-Studio/g, "Z-Work-Studio"],
	[/OMP 18\.20\.2 或更高/g, "Zeta runtime 或更高"],
	[/OMP 18\.20\.2 or newer/g, "Zeta runtime or newer"],
	[/OMP 18\.20\.2/g, "Zeta runtime"],
	[/OMP 18\.19\.0/g, "Zeta runtime"],
	[/\bOMP\b/g, "Zeta"],
	[/(?<!Z Work )Studio embedded/g, "Z Work Studio embedded"],
	[/(?<!Z Work )Studio gateway/g, "Z Work Studio gateway"],
	[/(?<!Z Work )Studio workspace key/g, "Z Work Studio workspace key"],
	[/(?<!Z Work )Studio Bridge/g, "Z Work Studio Bridge"],
	[/(?<!Z Work )Studio workspace/g, "Z Work Studio workspace"],
	[/无法通过 Studio/g, "无法通过 Z Work Studio"],
	[/无法由 Studio/g, "无法由 Z Work Studio"],
	[/in Studio/g, "in Z Work Studio"],
	[/by Studio/g, "by Z Work Studio"],
	[/for Studio/g, "for Z Work Studio"],
	[/(?<!Z Work )Studio 相关/g, "Z Work Studio 相关"],
	[/No Studio client/g, "No Z Work Studio client"],
	[/无 Studio client/g, "无 Z Work Studio client"],
	[/the-snowpear\/omp-studio/g, "Linxira-OS/linxira-zeta"],
	[/upgrade\/omp-18\.19\.0/g, "upgrade/zeta-runtime"],
	[/omp-studio-archive/g, "z-work-studio-archive"],
	[/apps\/renderer\/public\/omp-mark\.png/g, "apps/renderer/public/zeta-mark.png"],
	[/\bomp-studio\b/g, "z-work-studio"],
	[/omp-web/g, "zeta-web"],
];

function walk(dir: string): string[] {
	return readdirSync(dir).flatMap(name => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return walk(path);
		return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
	});
}

let changed = 0;
for (const path of walk(STUDIO)) {
	const before = readFileSync(path, "utf8");
	let after = before;
	for (const [pattern, replacement] of replacements) after = after.replace(pattern, replacement);
	if (after === before) continue;
	changed += 1;
	if (apply) writeFileSync(path, after);
	else console.error(`${relative(ROOT, path)}: would rewrite upstream brand tokens`);
}
if (!apply && changed > 0) {
	console.error(`studio-assets: ${changed} file(s) need the overlay; rerun with --apply`);
	process.exit(1);
}
console.log(`studio-assets: ${apply ? "updated" : "clean"} ${changed} file(s)`);
