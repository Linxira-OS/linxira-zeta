/**
 * Version-line consistency check for the Zeta monorepo.
 *
 * Zeta rides ONE version line across every published surface: the 14
 * @linxiraos/* packages (13 workspace packages + the `pi-messenger` official
 * plugin, which follows the line even though it lives outside packages/), the
 * root workspaces.catalog keys, the Rust workspace
 * version, the pi-natives build-version mechanism (`pi_natives_build_version()`
 * symbol + the stamped `__piNativesBuildVersion` value — the per-release
 * __piNativesVX_Y_Z sentinel name is gone), the desktop app, the vendored npm
 * distributions (launcher + platform leaves + the launcher's exact
 * optionalDependencies pins), and the README version badge. Any drift is a
 * release-blocking bug (the 1.0.6/1.0.7 era shipped natives at 1.0.2/1.0.4 and
 * broke `zeta update` with ETARGET).
 *
 * Usage:
 *   bun scripts/check-version-consistency.ts
 *
 * Exits non-zero listing every drifted surface. Kept in lock-step with the
 * package/catalog lists and natives mechanism symbols in
 * scripts/release-v2.ts and scripts/set-version.ts (update all three together).
 *
 * web-ui/ is intentionally NOT checked: it aligns to the release version only
 * when the release tooling runs (`set-version.ts`, and `release-v2.ts` whose
 * pre-tag assertConsistency does verify it), so between releases its manifest
 * legitimately still carries the version it last published. This checker runs
 * between releases, which is why it ignores it.
 */

import { Glob } from "bun";
import * as fs from "node:fs";
import * as path from "node:path";
import { distributionManifests, NPM_DISTRIBUTIONS, NPM_MANIFEST_GLOB } from "./npm-distributions";

const root = path.resolve(import.meta.dir, "..");

/**
 * Rust workspace members whose version rides the single Zeta line, so
 * `Cargo.lock` must pin them the same way `Cargo.toml` does. Vendored crates
 * (`crates/vendor/**`) are deliberately absent — they keep their own upstream
 * version, and `brush-core` rides 0.5.0 while we ride 1.1.x.
 */
const RUST_MEMBERS = [
	"crates/pi-edit/Cargo.toml",
	"crates/pi-natives/Cargo.toml",
	"crates/pi-voice/Cargo.toml",
	"crates/pi-predict/Cargo.toml",
	"crates/pi-iso/Cargo.toml",
	"crates/pi-shell/Cargo.toml",
];

// Must match ALL_PACKAGES in scripts/release-v2.ts / set-version.ts. Entries are
// repo-relative package directories — official plugins (plugins/official/<id>)
// ride the same line as the packages even though they live outside packages/.
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
] as const;

// Must match CATALOG_KEYS in scripts/release-v2.ts / set-version.ts.
const CATALOG_KEYS: ReadonlyArray<string> = [
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
];

const problems: string[] = [];

function readVersion(file: string): string {
	try {
		const pkg = JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
		return pkg.version as string;
	} catch {
		problems.push(`${file}: unreadable`);
		return "";
	}
}

function main(): void {
	const versions = new Map<string, string>();
	for (const pkg of ALL_PACKAGES) {
		versions.set(pkg, readVersion(`${pkg}/package.json`));
	}

	const distinct = new Set(versions.values()).size;
	if (distinct !== 1) {
		const baseline = versions.get(ALL_PACKAGES[0]) ?? "";
		for (const [pkg, v] of versions) {
			if (v !== baseline) problems.push(`${pkg}: ${v} != ${baseline}`);
		}
	}

	const expected = versions.get(ALL_PACKAGES[0]) ?? "";

	// Root workspaces.catalog — exactly the 14 @linxiraos/* keys, all at the line version.
	const rootPkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
	const catalog = rootPkg.workspaces?.catalog ?? {};
	const catalogKeys = Object.keys(catalog).filter(k => k.startsWith("@linxiraos/"));
	if (catalogKeys.length !== CATALOG_KEYS.length) {
		problems.push(
			`workspaces.catalog: ${catalogKeys.length} @linxiraos/* keys, expected ${CATALOG_KEYS.length}: ${catalogKeys.join(", ")}`,
		);
	}
	for (const key of CATALOG_KEYS) {
		if (catalog[key] !== expected) problems.push(`workspaces.catalog ${key}: ${catalog[key]} != ${expected}`);
	}

	// Rust workspace version.
	const cargoToml = fs.readFileSync(path.join(root, "Cargo.toml"), "utf8");
	const cargoVersion = cargoToml.match(/^\s*version = "([^"]+)"/m)?.[1];
	if (cargoVersion !== expected) problems.push(`Cargo.toml workspace: ${cargoVersion} != ${expected}`);
	// main/ is an independent Cargo workspace (the zeta workbench) and rides
	// the same release line.
	const mainToml = fs.readFileSync(path.join(root, "main", "Cargo.toml"), "utf8");
	const mainVersion = /\[workspace\.package\][^[]*?version = "([^"]+)"/s.exec(mainToml)?.[1];
	if (mainVersion !== expected) problems.push(`main/Cargo.toml workspace: ${mainVersion} != ${expected}`);

	// Bazel-face crate versions: the hand-written crates/*/BUILD.bazel targets
	// carry a `version` attr printed in bazel logs/cache keys; a stale one is
	// the ghost-version bug (pi_natives v17.1.5 next to a 1.1.x release).
	const cratesDir = path.join(root, "crates");
	if (fs.existsSync(cratesDir)) {
		for (const dir of fs.readdirSync(cratesDir)) {
			const buildFile = path.join(cratesDir, dir, "BUILD.bazel");
			if (!fs.existsSync(buildFile)) continue;
			const content = fs.readFileSync(buildFile, "utf8");
			for (const m of content.matchAll(/^ {4}version = "([^"]+)"/gm)) {
				if (m[1] !== expected) problems.push(`crates/${dir}/BUILD.bazel: ${m[1]} != ${expected}`);
			}
		}
	}

	// pi-natives build-version mechanism (v18.3.3 upstream): the per-release
	// __piNativesVX_Y_Z sentinel name is gone — the addon now exposes a single
	// `__piNativesBuildVersion()` whose VALUE is stamped into the .node after
	// linking (scripts/stamp-native-version.ts) and compared against
	// package.json#version by the loader. The check therefore pins the
	// mechanism symbols, not a version-derived name.
	const mechanism: Array<[string, string]> = [
		["crates/pi-natives/src/lib.rs", "pub fn pi_natives_build_version()"],
		["packages/natives/native/index.js", "__piNativesBuildVersion"],
		["packages/natives/native/index.d.ts", "__piNativesBuildVersion"],
	];
	for (const [file, needle] of mechanism) {
		const content = fs.readFileSync(path.join(root, file), "utf8");
		if (!content.includes(needle)) problems.push(`${file}: missing ${needle} (natives build-version mechanism)`);
	}

	// Cargo.lock workspace members. A merge that takes the lock wholesale brings
	// upstream's version line with it, and `cargo metadata --locked` then refuses
	// to run — which takes `cargo deny --locked --offline` down before it reaches
	// the license check. Nothing above catches it: this file verifies manifests,
	// catalog keys, Cargo.toml and the README badge, and never read the lock.
	// Members come from the manifests, not a `pi-*` pattern, so vendored crates
	// riding their own line (brush-core) are left alone.
	const lockPath = path.join(root, "Cargo.lock");
	if (fs.existsSync(lockPath)) {
		const lock = fs.readFileSync(lockPath, "utf8");
		const lockLines = lock.split(/\r?\n/);
		for (const manifest of RUST_MEMBERS) {
			const manifestPath = path.join(root, manifest);
			if (!fs.existsSync(manifestPath)) continue;
			const name = /^name\s*=\s*"([^"]+)"/m.exec(fs.readFileSync(manifestPath, "utf8"))?.[1];
			if (!name) continue;
			for (let i = 0; i < lockLines.length; i++) {
				if (lockLines[i] !== `name = "${name}"`) continue;
				const pinned = /^version = "([^"]+)"$/.exec(lockLines[i + 1] ?? "")?.[1];
				if (pinned && pinned !== expected) {
					problems.push(`Cargo.lock: ${name} pinned at ${pinned}, expected ${expected}`);
				}
				break;
			}
		}
	}

	// Desktop rides the same line (electron-builder + ZETA_APP_VERSION read it).
	const desktopVersion = readVersion("desktop/package.json");
	if (desktopVersion !== expected) problems.push(`desktop/package.json: ${desktopVersion} != ${expected}`);

	// Vendored npm distributions (scripts/npm-distributions.ts): the launcher
	// package, its platform leaves, and the launcher's exact
	// optionalDependencies pins all ride the one line. A launcher lifted to the
	// new version while its pins stay behind publishes a package that installs
	// the PREVIOUS release's binary and nothing on npm's side complains — the
	// 1.2.0 editor launcher shipped pinning @linxiraos/editor-{windows,linux}-x64
	// at 1.1.28 and had to be hand-fixed (PR #119). That distribution has since
	// retired (TTT payload removed 2026-10-16), so the registry now holds
	// main/ + termide/ only.
	const registeredPins: Record<string, ReadonlySet<string>> = {};
	for (const dist of NPM_DISTRIBUTIONS) {
		const parentRel = `${dist.dir}/package.json`;
		registeredPins[parentRel] = new Set(dist.leaves.map(leaf => leaf.name));
		for (const rel of distributionManifests(dist)) {
			const manifestVersion = readVersion(rel);
			if (manifestVersion !== expected) problems.push(`${rel}: ${manifestVersion} != ${expected}`);
		}
		const parent = JSON.parse(fs.readFileSync(path.join(root, parentRel), "utf8"));
		for (const leaf of dist.leaves) {
			const pinned = parent.optionalDependencies?.[leaf.name];
			if (pinned !== expected) {
				problems.push(`${parentRel} optionalDependencies ${leaf.name}: ${pinned} != ${expected}`);
			}
		}
	}

	// Discovery half: every @linxiraos/* optionalDependency inside the vendored
	// npm tree must belong to a registered distribution, so a new launcher (or
	// a new leaf) cannot silently escape the bump and this check.
	// `Glob#ignore` does not prune nested `node_modules` here, and a sibling
	// worktree checked out under a dot dir (`.worktrees/`) or under `temp/`
	// (this repo's worktree home per AGENTS.md) would otherwise be scanned too —
	// filter all three out explicitly, or a local run reports the copies in
	// `temp/<topic>/main/npm/...` as unregistered distributions.
	const npmManifests = [...new Glob(NPM_MANIFEST_GLOB).scanSync({ cwd: root })]
		.map(rel => rel.replaceAll("\\", "/"))
		.filter(
			rel =>
				!rel
					.split("/")
					.some(segment => segment.startsWith(".") || segment === "node_modules" || segment === "temp"),
		);

	for (const manifestRel of npmManifests) {
		let manifest: { optionalDependencies?: Record<string, string> };
		try {
			manifest = JSON.parse(fs.readFileSync(path.join(root, manifestRel), "utf8"));
		} catch {
			problems.push(`${manifestRel}: unreadable`);
			continue;
		}
		const pins = Object.keys(manifest.optionalDependencies ?? {}).filter(key => key.startsWith("@linxiraos/"));
		if (pins.length === 0) continue;
		const registered = registeredPins[manifestRel];
		if (!registered) {
			problems.push(
				`${manifestRel}: unregistered @linxiraos/* optionalDependencies (${pins.join(", ")}) — add the distribution to scripts/npm-distributions.ts`,
			);
			continue;
		}
		for (const pin of pins) {
			if (!registered.has(pin)) {
				problems.push(`${manifestRel}: unregistered pin ${pin} — add it to scripts/npm-distributions.ts`);
			}
		}
	}

	// README badge: the product front door carries the release version
	// (img.shields.io `badge/zeta-<version>`); a merge that resets it to an
	// upstream number or forgets the bump must fail here, not in the log only.
	const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
	const badge = readme.match(/badge\/zeta-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)-/);
	if (!badge) {
		problems.push("README.md: no zeta version badge (badge/zeta-<version> shield) found");
	} else if (badge[1] !== expected) {
		problems.push(`README.md badge: ${badge[1]} != ${expected}`);
	}

	// upstream OMP version sections ([15.x]–[18.x]) — and has an
	// [Unreleased] header (the release preflight enforces non-empty bodies).
	for (const pkg of ALL_PACKAGES) {
		const changelog = fs.readFileSync(path.join(root, `${pkg}/CHANGELOG.md`), "utf8");
		const upstream = changelog.match(/^## \[1[5-8]\./m);
		if (upstream) problems.push(`${pkg}/CHANGELOG.md: upstream OMP section ${upstream[0].trim()}`);
		if (!changelog.includes("## [Unreleased]")) {
			problems.push(`${pkg}/CHANGELOG.md: missing [Unreleased] header`);
		}
	}

	if (problems.length > 0) {
		console.error(`Version line drift (expected ${expected}):`);
		for (const p of problems) console.error(`  - ${p}`);
		process.exit(1);
	}
	console.log(
		`Version line consistent at ${expected}: ${ALL_PACKAGES.length} packages + ${CATALOG_KEYS.length} catalog keys + Cargo + main workspace + natives stamp + desktop + npm distribution leaf pins + README badge + crates/*/BUILD.bazel + Cargo.lock members (verified)`,
	);
}

main();
