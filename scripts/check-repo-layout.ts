#!/usr/bin/env bun
/**
 * Repository layout guard.
 *
 * ADR-0080 retired the historical Zetawork workbench and the frozen OMP Web
 * renderer. The active tree must not grow those paths back, and product code
 * must not import from the one-way retired boundary.
 *
 * This is a path/layout check only. License, brand, release and CI surface
 * checks are separate gates.
 */
import * as fs from "node:fs";
import { Glob } from "bun";

const root = Bun.fileURLToPath(new URL("..", import.meta.url));
const problems: string[] = [];

const retiredPaths = ["retired/zetawork", "retired/web-ui"] as const;
const forbiddenActivePaths = ["main", "web-ui"] as const;

for (const path of forbiddenActivePaths) {
	if (fs.existsSync(`${root}/${path}`)) problems.push(`${path}/ must not exist in the active tree (ADR-0080)`);
}
for (const path of retiredPaths) {
	if (!fs.existsSync(`${root}/${path}`)) problems.push(`${path}/ is missing; the retired boundary must retain it`);
}

const activeFiles = [...new Glob("**/*").scanSync({ cwd: root })]
	.map(path => path.replaceAll("\\", "/"))
	.filter(
		path => !path.split("/").some(segment => segment === "node_modules" || segment === "temp" || segment === ".git"),
	)
	.filter(path => !path.startsWith("retired/"));

// A source/config/release file outside retired/ must never read the retired
// tree. The boundary is a recovery archive, not a dependency source.
for (const path of activeFiles) {
	if (!/\.(?:ts|tsx|js|mjs|cjs|json|sh|ps1|yml|yaml|toml|md)$/.test(path)) continue;
	const text = fs.readFileSync(`${root}/${path}`, "utf8");
	const match = /(?:from\s+|import\s*\(|require\s*\()\s*["'`]([^"'`]*retired\/[^"'`]*)["'`]/.exec(text);
	if (match) problems.push(`${path}: active code imports the retired boundary (${match[1]})`);
}

// The retired workflow is archived, never a root workflow.
const retiredWorkflow = `${root}/retired/zetawork/.github/workflows/main-publish.yml`;
if (!fs.existsSync(retiredWorkflow)) problems.push("retired/zetawork/.github/workflows/main-publish.yml is missing");
if (fs.existsSync(`${root}/.github/workflows/main-publish.yml`)) {
	problems.push(".github/workflows/main-publish.yml must stay retired");
}

if (problems.length > 0) {
	console.error("Repository layout guard failed:");
	for (const problem of problems) console.error(`  - ${problem}`);
	process.exit(1);
}
console.log(
	`Repository layout guard: clean (${activeFiles.length} active paths, ${retiredPaths.length} retired trees)`,
);
