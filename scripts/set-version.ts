#!/usr/bin/env bun

/**
 * Quick lockstep version bump for Zeta.
 *
 * Rewrites every hard-coded release version to <version> in one pass:
 *   - all 14 published @linxiraos packages (packages/{pkg}/package.json)
 *   - Cargo.toml workspace version
 *   - the __piNativesVX_Y_Z sentinel (lib.rs + committed bindings)
 *   - desktop/package.json + desktop/package-lock.json
 *   - the root workspaces.catalog @linxiraos keys
 *   - web-ui/package.json (zeta-web) version AND its @linxiraos/* dependency
 *     ranges (kept as ^<version>, so a lockstep publish always resolves)
 *
 * It deliberately does NOT touch CHANGELOGs, commit, tag, or push — that is
 * `bun scripts/release-v2.ts <version>`'s job. Use this when you need the
 * version line moved (e.g. a local test build) without running a release.
 * After a real run, regenerate the lockfile (`bun install`) or let
 * release-v2.ts do it — a stale bun.lock is the usual npm-publish hazard.
 *
 * Usage:
 *   bun scripts/set-version.ts <version>          apply and write
 *   bun scripts/set-version.ts <version> --dry-run  preview only
 */

import * as fs from "node:fs";
import * as path from "node:path";

const repoRoot = path.join(import.meta.dir, "..");
const DRY_RUN = process.argv.includes("--dry-run");

// Mirrors scripts/release-v2.ts ALL_PACKAGES. Keep in lock-step.
const ALL_PACKAGES = [
	"utils",
	"agent",
	"catalog",
	"ai",
	"tui",
	"hashline",
	"mnemopi",
	"snapcompact",
	"stats",
	"coding-agent",
	"channels",
	"natives",
	"omptype",
	"wire",
] as const;

// Mirrors release-v2.ts CATALOG_KEYS — the exact @linxiraos workspace-catalog keys.
const CATALOG_KEYS = [
	"@linxiraos/pi-utils",
	"@linxiraos/pi-agent-core",
	"@linxiraos/pi-catalog",
	"@linxiraos/pi-ai",
	"@linxiraos/pi-tui",
	"@linxiraos/pi-hashline",
	"@linxiraos/pi-mnemopi",
	"@linxiraos/pi-snapcompact",
	"@linxiraos/pi-stats",
	"@linxiraos/zeta",
	"@linxiraos/pi-channels",
	"@linxiraos/pi-natives",
	"@linxiraos/pi-omptype",
	"@linxiraos/pi-wire",
] as const;

// Files carrying the pi-natives sentinel, same set as release-v2.ts.
const SENTINEL_FILES = [
	"crates/pi-natives/src/lib.rs",
	"packages/natives/native/index.js",
	"packages/natives/native/index.d.ts",
];

function readJson(rel: string): unknown {
	return JSON.parse(fs.readFileSync(path.join(repoRoot, rel), "utf8"));
}

function writeJson(rel: string, data: unknown): void {
	if (!DRY_RUN) {
		fs.writeFileSync(path.join(repoRoot, rel), `${JSON.stringify(data, null, 2)}\n`);
	}
}

function replaceInFile(rel: string, pattern: RegExp, replacement: string): boolean {
	const file = path.join(repoRoot, rel);
	const text = fs.readFileSync(file, "utf8");
	const next = text.replace(pattern, replacement);
	if (next !== text && !DRY_RUN) {
		fs.writeFileSync(file, next);
	}
	return next !== text;
}

function fail(msg: string): never {
	console.error(`error: ${msg}`);
	process.exit(1);
}

function hasCatalog(rootPkg: unknown): rootPkg is { workspaces: { catalog: Record<string, string> } } {
	return (
		typeof rootPkg === "object" &&
		rootPkg !== null &&
		"workspaces" in rootPkg &&
		typeof rootPkg.workspaces === "object" &&
		rootPkg.workspaces !== null &&
		"catalog" in rootPkg.workspaces &&
		typeof rootPkg.workspaces.catalog === "object" &&
		rootPkg.workspaces.catalog !== null
	);
}

async function main(): Promise<void> {
	const versionArg = process.argv[2];
	if (!versionArg) {
		console.error("Usage: bun scripts/set-version.ts <version> [--dry-run]");
		process.exit(1);
	}
	const version = versionArg.replace(/^v/, "");
	if (!/^\d+\.\d+\.\d+$/.test(version)) {
		fail(`Invalid version "${versionArg}". Expected semver like 1.1.0.`);
	}

	const changed: string[] = [];
	const unchanged: string[] = [];

	// 1. All published packages.
	for (const pkg of ALL_PACKAGES) {
		const rel = `packages/${pkg}/package.json`;
		const manifest = readJson(rel) as { version?: string };
		if (manifest.version === version) {
			unchanged.push(rel);
			continue;
		}
		manifest.version = version;
		writeJson(rel, manifest);
		changed.push(rel);
	}

	// 2. Cargo workspace version.
	const cargoRel = "Cargo.toml";
	if (replaceInFile(cargoRel, /^version = "[^"]+"/m, `version = "${version}"`)) {
		changed.push(cargoRel);
	} else {
		unchanged.push(cargoRel);
	}

	// 3. pi-natives version sentinel.
	const sentinelJsId = version.replace(/[^A-Za-z0-9]/g, "_");
	const sentinelName = `__piNativesV${sentinelJsId}`;
	for (const rel of SENTINEL_FILES) {
		if (replaceInFile(rel, /__piNativesV[A-Za-z0-9_]+/g, sentinelName)) {
			changed.push(rel);
		} else {
			unchanged.push(rel);
		}
	}

	// 4. Desktop shell.
	for (const rel of ["desktop/package.json", "desktop/package-lock.json"]) {
		const manifest = readJson(rel) as { version?: string; packages?: Record<string, { version?: string }> };
		let touched = false;
		if (manifest.version !== version) {
			manifest.version = version;
			touched = true;
		}
		const rootPkg = manifest.packages?.[""];
		if (rootPkg && rootPkg.version !== version) {
			rootPkg.version = version;
			touched = true;
		}
		if (touched) {
			writeJson(rel, manifest);
			changed.push(rel);
		} else {
			unchanged.push(rel);
		}
	}

	// 5. Root catalog @linxiraos keys.
	const rootPkg = readJson("package.json");
	if (!hasCatalog(rootPkg)) {
		fail("Root package.json has no workspaces.catalog");
	}
	const catalog = rootPkg.workspaces.catalog;
	for (const key of CATALOG_KEYS) {
		if (key in catalog) {
			if (catalog[key] !== version) {
				catalog[key] = version;
				changed.push(`workspaces.catalog.${key}`);
			} else {
				unchanged.push(`workspaces.catalog.${key}`);
			}
		} else {
			console.warn(`  (warn) catalog key ${key} missing — skipped`);
		}
	}
	writeJson("package.json", rootPkg);

	// 7. README version badge (shields.io `badge/zeta-<version>-…`), kept in
	// lock-step so the product front door shows the release version.
	const readmeRel = "README.md";
	if (replaceInFile(readmeRel, /badge\/zeta-\d+\.\d+\.\d+-/, `badge/zeta-${version}-`)) {
		changed.push(readmeRel);
	} else {
		unchanged.push(readmeRel);
	}

	console.log(`${DRY_RUN ? "[dry-run] " : ""}Version ${version} applied:`);
	console.log(`  changed (${changed.length}):`);
	for (const rel of changed) console.log(`    ${rel}`);
	console.log(`  already at ${version} (${unchanged.length}):`);
	for (const rel of unchanged.slice(0, 10)) console.log(`    ${rel}`);
	if (unchanged.length > 10) console.log(`    … and ${unchanged.length - 10} more`);
	console.log();
	if (DRY_RUN) {
		console.log("Dry run — nothing written.");
	} else {
		console.log("Next: regenerate the lockfile (bun install), then either commit directly");
		console.log("or run the full release: bun scripts/release-v2.ts <version>");
	}
}

await main();
