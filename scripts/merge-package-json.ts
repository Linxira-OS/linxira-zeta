/**
 * Custom Git merge driver for package.json files.
 *
 * Called by Git with three args: %A (current/target), %O (base), %B (other/source).
 * Zeta keeps its own identity fields (name, version, bin, homepage, repository,
 * bugs, @linxiraos/* scope in deps) but accepts upstream changes to dependencies,
 * scripts, engines, exports, and other structural fields.
 *
 * Setup:
 *   git config merge.zeta-package.driver "bun scripts/merge-package-json.ts %A %O %B"
 *   git config merge.zeta-package.name "Zeta package.json merge driver"
 *
 * The .gitattributes file maps package.json files to this driver:
 *   packages/&#42;/package.json merge=zeta-package
 *   package.json merge=zeta-package
 */

import * as fs from "node:fs";

const ZETA_IDENTITY_FIELDS = new Set([
	"name",
	"version",
	"homepage",
	"bin",
	"repository",
	"bugs",
	"author",
	"contributors",
	"keywords",
]);

const ZETA_SCOPE = "@linxiraos/";

// Upstream workspace packages are named @linxiraos/*. Zeta renames that scope
// to @linxiraos/* (with RENAME_BY_TAIL for renamed packages) and keeps its own
// independent versions (1.x product line), so the driver must map upstream
// keys back to Zeta names before merging.
const OMP_SCOPE = "@linxiraos/";

// Upstream names whose catalog/tail does not equal the Zeta package tail.
const RENAME_BY_TAIL: Record<string, string> = {
	hashline: "pi-hashline",
	"omp-stats": "pi-stats",
	omptype: "pi-omptype",
	"pi-coding-agent": "zeta",
	snapcompact: "pi-snapcompact",
};

function zetaKeyFor(ompKey: string): string | null {
	if (!ompKey.startsWith(OMP_SCOPE)) return null;
	const tail = ompKey.slice(OMP_SCOPE.length);
	return `${ZETA_SCOPE}${RENAME_BY_TAIL[tail] ?? tail}`;
}

function loadJson(path: string): Record<string, unknown> | null {
	try {
		const raw = fs.readFileSync(path, "utf-8");
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

function saveJson(path: string, obj: Record<string, unknown>): void {
	fs.writeFileSync(path, `${JSON.stringify(obj, null, 2)}\n`);
}

function mergeDeps(current: Record<string, string>, other: Record<string, string>): Record<string, string> {
	const result: Record<string, string> = {};

	for (const [key, value] of Object.entries(other)) {
		const zetaKey = zetaKeyFor(key);
		if (zetaKey) {
			// Upstream workspace package: adopt the Zeta name, keep Zeta's own
			// version pin. If Zeta does not have the package yet, keep the
			// upstream entry so the merge is complete (brand it later).
			result[zetaKey] = current[zetaKey] ?? value;
		} else if (key.startsWith(ZETA_SCOPE)) {
			// Already a Zeta-scoped key: keep Zeta's own version if it exists,
			// otherwise use upstream's
			result[key] = current[key] ?? value;
		} else {
			// Third-party dependency: accept upstream
			result[key] = value;
		}
	}

	// Also keep any Zeta deps that upstream doesn't have
	for (const [key, value] of Object.entries(current)) {
		if (key.startsWith(ZETA_SCOPE) && !(key in result)) {
			result[key] = value;
		}
	}

	return result;
}

function main() {
	const [currentPath, basePath, otherPath] = process.argv.slice(2);

	if (!currentPath || !basePath || !otherPath) {
		console.error("Usage: merge-package-json.ts %A %O %B");
		process.exit(1);
	}

	const current = loadJson(currentPath);
	const base = loadJson(basePath);
	const other = loadJson(otherPath);

	if (!current || !base || !other) {
		// If any side is invalid JSON, fall back to current (keep ours)
		if (current) saveJson(currentPath, current);
		process.exit(0);
	}

	const result: Record<string, unknown> = { ...other };

	// Preserve Zeta identity fields from current
	for (const field of ZETA_IDENTITY_FIELDS) {
		if (field in current) {
			result[field] = current[field];
		}
	}

	// Merge dependency sections: keep Zeta scoped deps, accept upstream rest
	const depSections = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;

	for (const section of depSections) {
		const currentDeps = current[section] as Record<string, string> | undefined;
		const otherDeps = other[section] as Record<string, string> | undefined;

		if (currentDeps && otherDeps) {
			result[section] = mergeDeps(currentDeps, otherDeps);
		} else if (otherDeps) {
			result[section] = otherDeps;
		} else if (currentDeps) {
			// Only current has this section: keep it (Zeta identity content).
			result[section] = currentDeps;
		}
	}

	// Handle workspace catalog entries in root package.json
	const catalogKey = "catalog";
	if (catalogKey in result && catalogKey in current) {
		const currentWorkspaces = current.workspaces as Record<string, unknown> | undefined;
		const resultWorkspaces = result.workspaces as Record<string, unknown> | undefined;
		const currentCatalog = currentWorkspaces?.[catalogKey] as Record<string, string> | undefined;
		const resultCatalog = resultWorkspaces?.[catalogKey] as Record<string, string> | undefined;

		if (currentCatalog && resultCatalog) {
			(resultWorkspaces as Record<string, unknown>)[catalogKey] = mergeDeps(currentCatalog, resultCatalog);
		}
	}

	saveJson(currentPath, result);
	console.log("package.json merged: kept Zeta identity, accepted upstream deps");
	process.exit(0);
}

export { mergeDeps, zetaKeyFor };

if (import.meta.main) {
	main();
}
