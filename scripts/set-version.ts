#!/usr/bin/env bun

/**
 * Quick lockstep version bump for Zeta.
 *
 * Rewrites every hard-coded release version to <version> in one pass:
 *   - all 15 published @linxiraos packages (packages/{pkg}/package.json plus
 *     the official plugin and the standalone web-ui snapshot)
 *   - Cargo.toml workspace version
 *   - desktop/package.json + desktop/package-lock.json
 *   - the root workspaces.catalog @linxiraos keys
 *   - the vendored npm distributions (editor / main / termide): the launcher
 *     package and its platform leaves, plus the launcher's exact
 *     optionalDependencies pins — a stale pin ships the previous release's
 *     binary (scripts/npm-distributions.ts holds the registry)
 *   - web-ui/package.json (@linxiraos/zeta-web) version, so the web UI
 *     publishes in step with the gateway it talks to (release_web_ui_packages
 *     in ci.yml). That manifest declares no @linxiraos/* dependency today, so
 *     there is no range to move; a range added later needs a step here the way
 *     the vendored launcher pins have one.
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
import { NPM_DISTRIBUTIONS } from "./npm-distributions";

const repoRoot = path.join(import.meta.dir, "..");
const DRY_RUN = process.argv.includes("--dry-run");

// Mirrors scripts/release-v2.ts ALL_PACKAGES, plus web-ui: release-v2 keeps
// web-ui in its VERSION_ONLY_PACKAGES list instead, because its ALL_PACKAGES
// doubles as the CHANGELOG set and web-ui ships no CHANGELOG.md — same bump,
// different bookkeeping. Keep the three lists (here, release-v2,
// check-version-consistency) in lock-step. Entries are repo-relative package
// directories: official plugins ride the same line.
const ALL_PACKAGES = [
	"packages/utils",
	"packages/agent",
	"packages/catalog",
	"packages/ai",
	"packages/tui",
	"packages/mnemopi",
	"packages/snapcompact",
	"packages/stats",
	"packages/coding-agent",
	"packages/channels",
	"packages/natives",
	"packages/omptype",
	"packages/wire",
	"plugins/official/pi-messenger",
	// The standalone web-ui snapshot (@linxiraos/zeta-web): not a Bun workspace
	// member, but published by release_web_ui_packages in ci.yml, so its version
	// has to ride the same line as the gateway it serves.
	"web-ui",
] as const;

// Mirrors release-v2.ts CATALOG_KEYS — the exact @linxiraos workspace-catalog keys.
const CATALOG_KEYS = [
	"@linxiraos/pi-utils",
	"@linxiraos/pi-agent-core",
	"@linxiraos/pi-catalog",
	"@linxiraos/pi-ai",
	"@linxiraos/pi-tui",
	"@linxiraos/pi-mnemopi",
	"@linxiraos/pi-snapcompact",
	"@linxiraos/pi-stats",
	"@linxiraos/zeta",
	"@linxiraos/pi-channels",
	"@linxiraos/pi-natives",
	"@linxiraos/pi-omptype",
	"@linxiraos/pi-wire",
] as const;

function readJson(rel: string): unknown {
	return JSON.parse(fs.readFileSync(path.join(repoRoot, rel), "utf8"));
}

function writeJson(rel: string, data: unknown): void {
	if (!DRY_RUN) {
		// Preserve the file's existing indentation and line endings: the
		// manifests are tab-indented with CRLF on Windows checkouts, and a
		// blanket 2-space/LF rewrite shows up as a whole-file diff in every
		// release commit. Only the version value actually changes.
		const abs = path.join(repoRoot, rel);
		const original = fs.readFileSync(abs, "utf8");
		const crlf = original.includes("\r\n");
		const tabIndent = /^\t"/m.test(original);
		const text = tabIndent ? JSON.stringify(data, null, "\t") : JSON.stringify(data, null, 2);
		fs.writeFileSync(abs, crlf ? `${text.replace(/\n/g, "\r\n")}\r\n` : `${text}\n`);
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
	// Semver: numeric x.y.z on the stable line, optional prerelease segment
	// (1.1.0-rc.1) for internal/RC lines. Build metadata is deliberately NOT
	// accepted — it does not compare, so it cannot order a release line.
	// Identifiers must be non-empty dot-separated alphanumeric runs; a numeric
	// identifier may not carry leading zeros (semver §9). "alpha..1" and
	// "rc.01" are rejected here rather than by npm/publisher later.
	if (
		!/^\d+\.\d+\.\d+(-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?$/.test(
			version,
		)
	) {
		fail(`Invalid version "${versionArg}". Expected semver like 1.1.0 or 1.1.0-rc.1.`);
	}

	const changed: string[] = [];
	const unchanged: string[] = [];

	// Fail before writing anything when the leaf-pin registry and the tree
	// disagree: a renamed or removed leaf would otherwise half-apply the bump.
	for (const dist of NPM_DISTRIBUTIONS) {
		const parentRel = `${dist.dir}/package.json`;
		const parent = readJson(parentRel) as { optionalDependencies?: Record<string, string> };
		for (const leaf of dist.leaves) {
			if (!parent.optionalDependencies?.[leaf.name]) {
				fail(`${parentRel}: ${leaf.name} is not pinned in optionalDependencies`);
			}
			if (!fs.existsSync(path.join(repoRoot, `${leaf.dir}/package.json`))) {
				fail(`${leaf.dir}/package.json: missing (registered as a leaf of ${dist.dir})`);
			}
		}
	}

	// Bump one manifest's version, plus any leaf pins it carries. Pins are
	// rewritten even when the version already matches: a stale pin next to a
	// correct version is exactly the drift check-version-consistency.ts gates on.
	const bumpManifest = (rel: string, pins: readonly string[] = []): void => {
		const manifest = readJson(rel) as { version?: string; optionalDependencies?: Record<string, string> };
		let touched = manifest.version !== version;
		manifest.version = version;
		for (const pin of pins) {
			if (!manifest.optionalDependencies?.[pin]) {
				fail(`${rel}: ${pin} is not pinned in optionalDependencies`);
			}
			if (manifest.optionalDependencies[pin] !== version) {
				manifest.optionalDependencies[pin] = version;
				touched = true;
			}
		}
		if (!touched) {
			unchanged.push(rel);
			return;
		}
		writeJson(rel, manifest);
		changed.push(rel);
	};

	// 1. All published packages.
	for (const pkg of ALL_PACKAGES) {
		const rel = `${pkg}/package.json`;
		const manifest = readJson(rel) as { version?: string };
		if (manifest.version === version) {
			unchanged.push(rel);
			continue;
		}
		manifest.version = version;
		writeJson(rel, manifest);
		changed.push(rel);
	}

	// 1a. web-ui's npm lockfile (its own, like desktop's): the root version and
	// the packages[""] entry move with the manifest so the pair never drifts.
	// npm ci only reads the manifest, but a half-moved pair is exactly the kind
	// of stale-lockfile drift the release chain keeps rediscovering.
	{
		const rel = "web-ui/package-lock.json";
		const lock = readJson(rel) as { version?: string; packages?: Record<string, { version?: string }> };
		let touched = false;
		if (lock.version !== version) {
			lock.version = version;
			touched = true;
		}
		const rootEntry = lock.packages?.[""];
		if (rootEntry && rootEntry.version !== version) {
			rootEntry.version = version;
			touched = true;
		}
		if (touched) {
			writeJson(rel, lock);
			changed.push(rel);
		} else {
			unchanged.push(rel);
		}
	}

	// 2. Cargo workspace version.
	const cargoRel = "Cargo.toml";
	if (replaceInFile(cargoRel, /^version = "[^"]+"/m, `version = "${version}"`)) {
		changed.push(cargoRel);
	} else {
		unchanged.push(cargoRel);
	}

	// 2a. Main workbench workspace — a separate Cargo workspace riding the same
	// release line; its version stamps the published workbench binary
	// (`zeta --version`), so it must move in lockstep.
	const mainCargoRel = "main/Cargo.toml";
	if (replaceInFile(mainCargoRel, /^version = "[^"]+"/m, `version = "${version}"`)) {
		changed.push(mainCargoRel);
	} else {
		unchanged.push(mainCargoRel);
	}

	// 3. Desktop shell.
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

	// 3b. Vendored npm distributions (editor / main / termide — published by
	// `ci-release-publish.ts --editor`/`--ide` and the workbench job). Not Bun
	// workspaces: the launcher, its platform leaves, and the launcher's exact
	// leaf pins all ride the release line. The 1.2.0 editor launcher was lifted
	// to the line while its pins stayed at 1.1.28 (hand-fixed in PR #119), so
	// the pins are part of this pass. The editor distribution is registered
	// again: its payload is the built-in editor's termide-editor entry.
	for (const dist of NPM_DISTRIBUTIONS) {
		bumpManifest(
			`${dist.dir}/package.json`,
			dist.leaves.map(leaf => leaf.name),
		);
		for (const leaf of dist.leaves) bumpManifest(`${leaf.dir}/package.json`);
	}

	// 4. Root catalog @linxiraos keys.
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

	// 5. Bazel-face crate versions: the hand-written crates/*/BUILD.bazel
	// rust_library/rust_shared_library targets carry a `version` attr that
	// shows up in bazel build logs and cache keys. Keep it on the line so CI
	// logs stop printing a ghost version next to the real one.
	const cratesDir = path.join(repoRoot, "crates");
	if (fs.existsSync(cratesDir)) {
		for (const dir of fs.readdirSync(cratesDir)) {
			const file = path.join(cratesDir, dir, "BUILD.bazel");
			if (!fs.existsSync(file)) continue;
			const text = fs.readFileSync(file, "utf8");
			// Indentation varies by target nesting (4 spaces for the crate
			// attr, deeper inside generated/macro expansions); the checker
			// greps exactly 4, so mirror that: any leading run of spaces is
			// rewritten. `version` attrs on non-rust targets in the same file
			// are intentionally rewritten too — they ride the same line.
			const next = text.replace(/^([ \t]+version = ")[^"]+(")/gm, `$1${version}$2`);
			if (next !== text) {
				if (!DRY_RUN) fs.writeFileSync(file, next);
				changed.push(`crates/${dir}/BUILD.bazel`);
			} else {
				unchanged.push(`crates/${dir}/BUILD.bazel`);
			}
		}
	}

	// 6. README version badge (shields.io `badge/zeta-<version>-…`), kept in
	// lock-step so the product front door shows the release version.
	const readmeRel = "README.md";
	if (replaceInFile(readmeRel, /badge\/zeta-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?-/, `badge/zeta-${version}-`)) {
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
