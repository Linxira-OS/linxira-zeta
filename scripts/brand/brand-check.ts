/**
 * CI brand-residue guard. Scans tracked product sources for upstream OMP
 * markers that the brand registry forbids; exits 1 on any unresolved hit so a
 * merge cannot silently regress the Zeta product surface.
 *
 * Usage: bun scripts/brand/brand-check.ts            (gate mode; exit 0/1)
 *        bun scripts/brand/brand-check.ts --json     (machine-readable report)
 *
 * Judgment calls (semantic divergences, test contracts) are NOT this script's
 * job — see document/merge-playbook.md for the per-bucket resolve procedure.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
	MUST_CONTAIN,
	MUST_NOT_CONTAIN,
	OH_MY_PI_ALLOW_FILES,
	OH_MY_PI_ALLOW_PATTERNS,
	OMP_PATH_ALLOW,
	PI_FAMILY,
	PI_FREE_FILES,
	SKIP_PREFIXES,
} from "./brand-rules";

const ROOT = path.resolve(import.meta.dir, "../..");
const SCAN_EXT = /\.(ts|tsx|rs|json|md|toml|kdl|sh|ps1)$/;

function* trackedFiles(): Generator<string> {
	const out = Bun.spawnSync(["git", "ls-files"], { cwd: ROOT, stdout: "pipe" });
	for (const line of out.stdout.toString().split("\n")) {
		const file = line.trim();
		if (!file || !SCAN_EXT.test(file)) continue;
		if (SKIP_PREFIXES.some(prefix => file.startsWith(prefix))) continue;
		yield file;
	}
}

interface Hit {
	file: string;
	line: number;
	text: string;
	rule: string;
}

const hits: Hit[] = [];
const missing: Array<{ file: string; needle: string; why: string }> = [];

for (const file of trackedFiles()) {
	const rel = file.replaceAll("\\", "/");
	const abs = path.resolve(ROOT, file);
	if (!abs.startsWith(ROOT + path.sep)) continue; // containment guard for index paths
	const text = fs.readFileSync(abs, "utf8");
	const lines = text.split("\n");

	const relPath = rel.replaceAll("\\", "/");
	// MUST_NOT_CONTAIN: whole-tree token bans.
	for (const rule of MUST_NOT_CONTAIN) {
		lines.forEach((line, index) => {
			if (rule.needle.test(line)) {
				hits.push({ file: relPath, line: index + 1, text: line.trim().slice(0, 120), rule: rule.why });
			}
		});
	}

	// oh-my-pi outside provenance/interop allow-lists. Entries ending with "/"
	// are directory prefixes; the rest are exact file matches. Changelogs are
	// exempt wholesale: released sections are immutable and entries describe
	// the residue itself.
	if (!relPath.endsWith("CHANGELOG.md") && !OH_MY_PI_ALLOW_FILES.includes(relPath)) {
		lines.forEach((line, index) => {
			if (!line.includes("oh-my-pi")) return;
			if (OH_MY_PI_ALLOW_PATTERNS.some(pattern => pattern.test(line))) return;
			const prefixed = OH_MY_PI_ALLOW_FILES.some(entry => entry.endsWith("/") && relPath.startsWith(entry));
			if (prefixed) return;
			hits.push({ file: relPath, line: index + 1, text: line.trim().slice(0, 120), rule: "oh-my-pi brand token" });
		});
	}

	// .omp path segments outside the interop allow-list. Allow patterns match
	// against "file ⟶ line" so entries may scope by file path or by content.
	// Lookbehind keeps property access (pkg.omp, theme.icon.omp) out; test
	// fixtures are exempt.
	lines.forEach((line, index) => {
		if (!/(?<![\w])\.omp\b/.test(line)) return;
		if (/\/test\//.test(relPath)) return;
		const hay = `${relPath} ⟶ ${line}`;
		if (OMP_PATH_ALLOW.some(pattern => pattern.test(hay) || pattern.test(relPath))) return;
		hits.push({ file: relPath, line: index + 1, text: line.trim().slice(0, 120), rule: ".omp path token" });
	});

	// π family must stay out of brand char-art surfaces.
	if (PI_FREE_FILES.includes(relPath)) {
		lines.forEach((line, index) => {
			if (PI_FAMILY.test(line)) {
				hits.push({
					file: relPath,
					line: index + 1,
					text: line.trim().slice(0, 120),
					rule: "π family in brand surface",
				});
			}
		});
	}
}

// MUST_CONTAIN: merge-protected exact forms.
for (const rule of MUST_CONTAIN) {
	const abs = path.resolve(ROOT, rule.file);
	if (!abs.startsWith(ROOT + path.sep)) continue; // containment guard
	const text = fs.readFileSync(abs, "utf8");
	if (!text.includes(rule.needle)) missing.push({ file: rule.file, needle: rule.needle, why: rule.why });
}

if (process.argv.includes("--json")) {
	console.log(JSON.stringify({ hits, missing }, null, 2));
} else {
	for (const hit of hits) console.log(`✗ ${hit.file}:${hit.line} [${hit.rule}] ${hit.text}`);
	for (const rule of missing) console.log(`✗ ${rule.file} missing: ${rule.needle} — ${rule.why}`);
	console.log(`\n${hits.length} hit(s), ${missing.length} missing assertion(s)`);
}
process.exit(hits.length > 0 || missing.length > 0 ? 1 : 0);
