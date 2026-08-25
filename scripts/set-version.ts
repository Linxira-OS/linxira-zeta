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
 *   - web-ui/package.json (zeta-web)
 *
 * It deliberately does NOT touch CHANGELOGs, commit, tag, or push — that is
 * `bun scripts/release-v2.ts <version>`'s job. Use this when you need the
 * version line moved (e.g. a local test build) without running a release.
 *
 * Usage: bun scripts/set-version.ts <version>
 */

import * as fs from "node:fs";
import * as path from "node:path";

const repoRoot = path.join(import.meta.dir, "..");

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

// Mirrors release-v2.ts CATALOG_KEYS — the exact @linxiraos/* workspace-catalog keys.
const CATALOG_KEYS: ReadonlyArray<{ key: string }> = [
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
].map(key => ({ key }));

// Files carrying the pi-natives sentinel, same set as release-v2.ts.
const SENTINEL_FILES = [
	"crates/pi-natives/src/lib.rs",
	"packages/natives/native/index.js",
	"packages/natives/native/index.d.ts",
];

function readJson(rel: string): Record<string, unknown> {
	return JSON.parse(fs.readFileSync(path.join(repoRoot, rel), "utf8"));
}

function writeJson(rel: string, data: unknown): void {
	fs.writeFileSync(path.join(repoRoot, rel), `${JSON.stringify(data, null, 2)}\n`);
}

function replaceInFile(rel: string, pattern: RegExp, replacement: string): boolean {
	const file = path.join(repoRoot, rel);
	const text = fs.readFileSync(file, "utf8");
	const next = text.replace(pattern, replacement);
	if (next !== text) {
		fs.writeFileSync(file, next);
		return true;
	}
	return false;
}

function fail(msg: string): never {
	console.error(`error: ${msg}`);
	process.exit(1);
}

async function main(): Promise<void> {
	const versionArg = process.argv[2];
	if (!versionArg) {
		console.error("Usage: bun scripts/set-version.ts <version>");
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
		const manifest = readJson(rel);
		if (manifest.version === version) {
			unchanged.push(rel);
			continue;
		}
		manifest.version = version;
		writeJson(rel, manifest);
		changed.push(rel);
	}

	// 2. Cargo workspace version.
	const cargo = path.join(repoRoot, "Cargo.toml");
	const cargoText = fs.readFileSync(cargo, "utf8");
	const cargoNext = cargoText.replace(/^version = "[^"]+"/m, `version = "${version}"`);
	if (cargoNext !== cargoText) {
		fs.writeFileSync(cargo, cargoNext);
		changed.push("Cargo.toml");
	} else {
		unchanged.push("Cargo.toml");
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
		const manifest = readJson(rel);
		let touched = false;
		if (manifest.version !== version) {
			manifest.version = version;
			touched = true;
		}
		const rootPkg = (manifest as { packages?: Record<string, { version?: string }> }).packages?.[""];
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

	// 5. Root catalog @linxiraos/* keys.
	const rootPkgPath = path.join(repoRoot, "package.json");
	const rootPkgRaw = readJson("package.json") as unknown;
	if (
		typeof rootPkgRaw !== "object" ||
		rootPkgRaw === null ||
		!("workspaces" in rootPkgRaw) ||
		typeof rootPkgRaw.workspaces !== "object" ||
		rootPkgRaw.workspaces === null ||
		!("catalog" in rootPkgRaw.workspaces) ||
		typeof rootPkgRaw.workspaces.catalog !== "object" ||
		rootPkgRaw.workspaces.catalog === null
	) {
		fail("Root package.json has no workspaces.catalog");
	}
	const rootPkg = rootPkgRaw as { workspaces: { catalog: Record<string, string> } };
	const catalog = rootPkg.workspaces.catalog;
	for (const { key } of CATALOG_KEYS) {
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

	// 6. Web UI (zeta-web) package version.
	const webUiRel = "web-ui/package.json";
	const webUi = readJson(webUiRel);
	if (webUi.version === version) {
		unchanged.push(webUiRel);
	} else {
		webUi.version = version;
		writeJson(webUiRel, webUi);
		changed.push(webUiRel);
	}

	console.log(`Version ${version} applied:`);
	console.log(`  changed (${changed.length}):`);
	for (const rel of changed) console.log(`    ${rel}`);
	console.log(`  already at ${version} (${unchanged.length}):`);
	for (const rel of unchanged.slice(0, 10)) console.log(`    ${rel}`);
	if (unchanged.length > 10) console.log(`    … and ${unchanged.length - 10} more`);
	console.log();
	console.log("Note: this only moves the version line. CHANGELOGs, bun.lock, commit,");
	console.log("tag and push are handled by: bun scripts/release-v2.ts <version>");
}

await main();
