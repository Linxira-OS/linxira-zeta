#!/usr/bin/env bun
/**
 * Release script v2 for Zeta — explicit-manifest bump, single fixed-subject
 * commit, atomic tag push.
 *
 * Usage:
 *   bun scripts/release-v2.ts <version>              Full release (preflight, bump, changelog, check, commit, tag, push)
 *   bun scripts/release-v2.ts <version> --watch      Release, then watch CI
 *   bun scripts/release-v2.ts watch                  Watch CI for current commit
 *
 * Example: bun scripts/release-v2.ts 1.0.6
 *
 * v1 vs v2: the old release.ts bumped every public package, every
 * `@linxiraos/*` catalog key, the Rust workspace version, and the pi-natives
 * sentinel via blind regexes — which wrongly moved the three native leaves
 * (natives/omptype/wire), Cargo.toml, and the sentinel to the release version
 * despite the leaves pinning 1.0.2. It also finalized CHANGELOGs for leaf
 * packages and skipped changelogs lacking a `## [Unreleased]` header. v2 uses
 * an explicit package manifest (10 core packages), asserts the 3 leaf packages
 * stay pinned (omptype/wire at 1.0.2, natives at 1.0.4 — the 1.0.2 npm
 * publish predates the v17.3.5 pdfToMarkdown export, so natives rides
 * 1.0.4), maps the root catalog explicitly (10 keys → release version,
 * 3 leaf keys → 1.0.2/1.0.4, exactly 13 keys), leaves Cargo/sentinel
 * untouched, and finalizes CHANGELOGs only for the 10 core packages
 * (creating the Unreleased header when missing). The commit subject is fixed
 * (`chore: bump version to X.Y.Z`) so CI's release-run concurrency group and
 * selectLatestZetaTag both match.
 */
import { $ } from "bun";
import { compareVersions } from "../packages/utils/src/version.ts";
import { runChangelogFixer } from "./fix-changelogs";
import { selectLatestZetaTag, validateExplicitVersion, watchCI } from "./release";

// Explicit package manifest. The 10 core packages ride the release version;
// the 3 native leaves are pinned: pi-natives at 1.0.4 (carries the
// pdfToMarkdown export merged from v17.3.5 that the 1.0.2 npm publish lacked),
// omptype/wire at 1.0.2. package.json, root catalog keys, Cargo.toml
// workspace version, and the __piNativesV1_0_4 sentinel are all locked to
// those lines.
const CORE_PACKAGES = [
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
] as const;
const LEAF_PACKAGES = ["natives", "omptype", "wire"] as const;
const LEAF_VERSION = "1.0.2";
/** pi-natives rides 1.0.4: the npm 1.0.2 publish predates the pdfToMarkdown export. */
const NATIVES_VERSION = "1.0.4";

// Root catalog key → package dir mapping. Exactly these 13 keys may carry a
// `@linxiraos/*` workspace dependency; any other count is a drift error.
const CATALOG_CORE_KEYS: ReadonlyArray<{ key: string; pkg: string }> = [
	{ key: "@linxiraos/pi-utils", pkg: "utils" },
	{ key: "@linxiraos/pi-agent-core", pkg: "agent" },
	{ key: "@linxiraos/pi-catalog", pkg: "catalog" },
	{ key: "@linxiraos/pi-ai", pkg: "ai" },
	{ key: "@linxiraos/pi-tui", pkg: "tui" },
	{ key: "@linxiraos/pi-hashline", pkg: "hashline" },
	{ key: "@linxiraos/pi-mnemopi", pkg: "mnemopi" },
	{ key: "@linxiraos/pi-snapcompact", pkg: "snapcompact" },
	{ key: "@linxiraos/pi-stats", pkg: "stats" },
	{ key: "@linxiraos/zeta", pkg: "coding-agent" },
];
const CATALOG_LEAF_KEYS = ["@linxiraos/pi-natives", "@linxiraos/pi-omptype", "@linxiraos/pi-wire"] as const;

function git(args: readonly string[]) {
	return $`git -c core.fsmonitor=false -c core.untrackedCache=false -c fetch.pruneTags=false ${args}`;
}

function removeEmptyVersionEntries(content: string): string {
	return content.replace(/## \[\d+\.\d+\.\d+\] - \d{4}-\d{2}-\d{2}\s*\n(?=## \[|\s*$)/g, "");
}

/**
 * Finalize CHANGELOGs for exactly the given package dirs: promote
 * `## [Unreleased]` → `## [version] - <date>`, then re-open a fresh
 * `## [Unreleased]` under the `# Changelog` header. Packages whose changelog
 * lacks the Unreleased header get one created first (a missing header meant
 * the old script silently skipped them, leaving the embedded-changelog
 * fallback asserting a stale latest version). Leaf packages are simply not
 * passed in — their changelogs are never touched.
 */
async function finalizeChangelogsForRelease(version: string, packageDirs: readonly string[]): Promise<void> {
	const date = new Date().toISOString().split("T")[0];

	for (const dir of packageDirs) {
		const changelog = `packages/${dir}/CHANGELOG.md`;
		let content = await Bun.file(changelog).text();

		if (!content.includes("## [Unreleased]")) {
			console.log(`  Creating [Unreleased] header in ${changelog}`);
			content = content.replace(/^(# Changelog\n\n)?/, `# Changelog\n\n## [Unreleased]\n\n`);
		}

		content = removeEmptyVersionEntries(content);
		content = content.replace("## [Unreleased]", `## [${version}] - ${date}`);
		content = content.replace(/^(# Changelog\n\n)/, `$1## [Unreleased]\n\n`);

		await Bun.write(changelog, content);
		console.log(`  Updated ${changelog}`);
	}
}

/** Read root package.json's workspaces.catalog `@linxiraos/*` entries. */
async function readCatalog(): Promise<Record<string, string>> {
	const rootPkg = await Bun.file("package.json").json();
	const catalog = rootPkg.workspaces?.catalog;
	if (!catalog || typeof catalog !== "object") throw new Error("root package.json has no workspaces.catalog");
	const linxiraos = Object.fromEntries(Object.entries(catalog).filter(([key]) => key.startsWith("@linxiraos/")));
	if (Object.keys(linxiraos).length !== 13) {
		throw new Error(
			`Expected exactly 13 @linxiraos/* catalog keys, found ${Object.keys(linxiraos).length}: ${Object.keys(linxiraos).join(", ")}`,
		);
	}
	return linxiraos;
}

/**
 * Rewrite root package.json catalog values for the 10 core keys to `version`
 * and assert the 3 leaf keys are still `1.0.2`. Never touches any other key.
 * Rewrites via structured JSON edit so indentation/order survive; the catalog
 * block is reformatted to 2-space like the rest of the file.
 */
async function updateCatalog(version: string): Promise<void> {
	const rootPkg = await Bun.file("package.json").json();
	const catalog = rootPkg.workspaces.catalog;

	for (const { key } of CATALOG_CORE_KEYS) {
		if (!(key in catalog)) throw new Error(`Missing core catalog key ${key}`);
		catalog[key] = version;
	}
	for (const key of CATALOG_LEAF_KEYS) {
		if (!(key in catalog)) throw new Error(`Missing leaf catalog key ${key}`);
		const expected = key === "@linxiraos/pi-natives" ? NATIVES_VERSION : LEAF_VERSION;
		if (catalog[key] !== expected) {
			throw new Error(`Leaf catalog key ${key} is ${catalog[key]}, expected ${expected}`);
		}
	}
	// Exact-13 check (no other @linxiraos/* key may exist).
	const linxiraosCount = Object.keys(catalog).filter((k: string) => k.startsWith("@linxiraos/")).length;
	if (linxiraosCount !== 13) {
		throw new Error(`Catalog has ${linxiraosCount} @linxiraos/* keys, expected exactly 13`);
	}

	await Bun.write("package.json", `${JSON.stringify(rootPkg, null, 2)}\n`);
}

/** Verify bun.lock resolves all 13 @linxiraos/* packages to the catalog versions. */
async function verifyLockfile(catalog: Record<string, string>): Promise<void> {
	const lock = Bun.JSON5.parse(await Bun.file("bun.lock").text());
	const pkgs = lock.workspaces ?? lock.packages ?? lock;
	const packageDirs: ReadonlyArray<{ dir: string; key: string }> = [
		...CATALOG_CORE_KEYS.map(({ key, pkg }) => ({ dir: `packages/${pkg}`, key })),
		{ dir: "packages/natives", key: "@linxiraos/pi-natives" },
		{ dir: "packages/omptype", key: "@linxiraos/pi-omptype" },
		{ dir: "packages/wire", key: "@linxiraos/pi-wire" },
	];
	for (const { dir, key } of packageDirs) {
		const entry = pkgs[dir];
		if (!entry) throw new Error(`bun.lock missing entry for ${dir}`);
		if (entry.version !== catalog[key]) {
			throw new Error(`bun.lock ${dir} version ${entry.version} != catalog ${key} ${catalog[key]}`);
		}
	}
	console.log("  bun.lock: 13 @linxiraos/* entries match catalog");
}

/**
 * Pre-commit consistency gate. Every failure aborts the release before
 * anything reaches git history.
 */
async function assertConsistency(version: string): Promise<void> {
	const problems: string[] = [];

	for (const pkg of CORE_PACKAGES) {
		const pkgJson = await Bun.file(`packages/${pkg}/package.json`).json();
		if (pkgJson.version !== version) problems.push(`packages/${pkg}: ${pkgJson.version} != ${version}`);
	}
	for (const pkg of LEAF_PACKAGES) {
		const pkgJson = await Bun.file(`packages/${pkg}/package.json`).json();
		const expected = pkg === "natives" ? NATIVES_VERSION : LEAF_VERSION;
		if (pkgJson.version !== expected) problems.push(`packages/${pkg}: ${pkgJson.version} != ${expected}`);
	}
	for (const manifestPath of ["desktop/package.json", "desktop/package-lock.json"]) {
		const manifest = await Bun.file(manifestPath).json();
		if (manifest.version !== version) problems.push(`${manifestPath}: ${manifest.version} != ${version}`);
	}

	const catalog = await readCatalog();
	for (const { key } of CATALOG_CORE_KEYS) {
		if (catalog[key] !== version) problems.push(`catalog ${key}: ${catalog[key]} != ${version}`);
	}
	for (const key of CATALOG_LEAF_KEYS) {
		const expected = key === "@linxiraos/pi-natives" ? NATIVES_VERSION : LEAF_VERSION;
		if (catalog[key] !== expected) problems.push(`catalog ${key}: ${catalog[key]} != ${expected}`);
	}

	const cargoToml = await Bun.file("Cargo.toml").text();
	const cargoVersion = cargoToml.match(/^version = "([^"]+)"/m)?.[1];
	if (cargoVersion !== NATIVES_VERSION) problems.push(`Cargo.toml workspace: ${cargoVersion} != ${NATIVES_VERSION}`);

	for (const sentinelFile of [
		"crates/pi-natives/src/lib.rs",
		"packages/natives/native/index.d.ts",
		"packages/natives/native/index.js",
	]) {
		const content = await Bun.file(sentinelFile).text();
		if (!content.includes(`__piNativesV${NATIVES_VERSION.replace(/\./g, "_")}`)) {
			problems.push(`${sentinelFile}: missing __piNativesV${NATIVES_VERSION.replace(/\./g, "_")} sentinel`);
		}
	}

	const tagExists = (
		await git(["rev-parse", "--verify", "--quiet", `refs/tags/v${version}`])
			.nothrow()
			.text()
	).trim();
	if (tagExists) problems.push(`tag v${version} already exists`);

	if (problems.length > 0) {
		console.error("Consistency check failed:");
		for (const p of problems) console.error(`  - ${p}`);
		process.exit(1);
	}
	console.log(
		`  Consistency: 10 core == version, omptype/wire == 1.0.2, natives == ${NATIVES_VERSION}, desktop/catalog/Cargo/sentinel OK, tag absent`,
	);
}

async function cmdRelease(versionArg: string, watch: boolean): Promise<void> {
	console.log("\n=== Release v2 ===\n");

	// Step 1: strict explicit-version guard (bump keywords and prereleases rejected).
	const version = validateExplicitVersion(versionArg);
	if (version === null) {
		console.error(
			`Error: Invalid version "${versionArg}". Expected a semver like 1.0.6 or v1.0.6 (prereleases such as 1.0.6-rc.1 are not supported; bump keywords are handled by the old release.ts).`,
		);
		process.exit(1);
	}

	// Step 0: pre-flight.
	console.log("Pre-flight checks...");
	const branch = (await git(["branch", "--show-current"]).text()).trim();
	if (branch !== "main") {
		console.error(`Error: Must be on main branch (currently on '${branch}')`);
		process.exit(1);
	}
	const status = (await git(["status", "--porcelain"]).text()).trim();
	if (status) {
		console.error("Error: Uncommitted changes detected. Commit or stash first.");
		console.error(status);
		process.exit(1);
	}
	const latestTag =
		selectLatestZetaTag(
			(
				await git([
					"tag",
					"--list",
					"--format",
					"%(refname:short)%00%(subject)%00%(*subject)",
					"--sort=-v:refname",
					"v*",
				]).text()
			).trim(),
		) ?? "";
	if (!latestTag) {
		console.error("Error: No Zeta release tag found.");
		process.exit(1);
	}
	if (compareVersions(version, latestTag) <= 0) {
		console.error(`Error: Version ${version} must be greater than latest tag ${latestTag}`);
		process.exit(1);
	}
	console.log(`  Version ${version} > ${latestTag}\n`);

	// Step 2: bump the 10 core packages.
	console.log(`Updating 10 core packages to ${version}…`);
	for (const pkg of CORE_PACKAGES) {
		const pkgPath = `packages/${pkg}/package.json`;
		await $`sd '"version": "[^"]+"' ${`"version": "${version}"`} ${pkgPath}`;
	}
	// Step 2b: assert the 3 leaf packages stayed pinned (natives 1.0.4,
	// omptype/wire 1.0.2).
	for (const pkg of LEAF_PACKAGES) {
		const pkgJson = await Bun.file(`packages/${pkg}/package.json`).json();
		const expected = pkg === "natives" ? NATIVES_VERSION : LEAF_VERSION;
		if (pkgJson.version !== expected) {
			console.error(`Error: leaf package ${pkg} is ${pkgJson.version}, expected ${expected}`);
			process.exit(1);
		}
		console.log(`  ${pkg}: ${pkgJson.version} (leaf, unchanged)`);
	}

	// Step 3: desktop shell (package.json + package-lock.json root version).
	console.log("Updating desktop version...");
	for (const manifestPath of ["desktop/package.json", "desktop/package-lock.json"]) {
		const manifest = await Bun.file(manifestPath).json();
		manifest.version = version;
		// package-lock.json also embeds the version at packages[""]; npm ci
		// only reads the root, but keeping both in sync avoids drift.
		if (manifestPath === "desktop/package-lock.json" && manifest.packages?.[""]) {
			manifest.packages[""].version = version;
		}
		await Bun.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
	}

	// Step 4: root catalog explicit mapping.
	console.log("Updating root catalog...");
	await updateCatalog(version);
	await readCatalog(); // re-validates 13 keys
	console.log(`  Root catalog: 10 core keys -> ${version}, 3 leaf keys == ${LEAF_VERSION}`);

	// Step 5: regenerate lockfile and verify.
	console.log("Regenerating lockfile...");
	await $`rm -f bun.lock`;
	await $`bun install`;
	await verifyLockfile(await readCatalog());
	console.log();

	// Step 6: changelogs for exactly the 10 core packages.
	console.log("Updating CHANGELOGs (10 core packages)...");
	const fixResult = await runChangelogFixer({});
	for (const fixed of fixResult.changedFiles) {
		console.log(
			`  Fixed ${fixed.path}: ${fixed.promotedItems} promoted, ${fixed.mergedDuplicateHeadings} duplicate heading(s) merged, ${fixed.removedEmptyHeadings} empty heading(s) removed`,
		);
	}
	await finalizeChangelogsForRelease(version, [...CORE_PACKAGES]);
	console.log();

	// Step 7: pre-commit consistency gate.
	console.log("Verifying consistency before commit...");
	await assertConsistency(version);

	// Step 8: full checks. `bun run check` also runs check:rs (Rust
	// tests/clippy), which is environment-blocked on hosts without an MSVC
	// linker/SDK (see document/upstream-sync.md); the pushed commit triggers CI
	// which runs the full gate on Linux runners. Run the TS gate locally.
	console.log("Running checks (check:ts locally; check:rs via CI)...");
	await $`bun run check:ts`;
	console.log();

	// Step 9: single commit, fixed subject, no body.
	console.log("Committing...");
	await git(["add", "."]);
	await git(["commit", "-m", `chore: bump version to ${version}`]);
	console.log();

	// Step 10: tag + atomic push by SHA refspec (survives git-maintenance tag
	// pruning; see release.ts for the race this avoids).
	console.log("Tagging and pushing to remote...");
	const tagRef = `v${version}`;
	const sha = (await git(["rev-parse", "HEAD"]).text()).trim();
	await git(["tag", "-f", tagRef]);
	await git(["push", "--atomic", "origin", "refs/heads/main:refs/heads/main", `${sha}:refs/tags/${tagRef}`]);
	console.log();

	// Step 11: dispatch hint.
	console.log("Dispatch the release CI run:");
	console.log("  gh workflow run ci.yml --ref main");
	if (watch) {
		console.log("\nWatching CI...");
		const success = await watchCI();
		if (success) {
			console.log(`=== Released v${version} ===`);
		} else {
			console.log("\nTo retry after fixing (repeat until CI passes):");
			console.log(`  git commit -m "chore: bump version to ${version}" -m "<what was fixed>"`);
			console.log(`  git tag -f v${version}`);
			console.log(
				`  git push --atomic origin refs/heads/main:refs/heads/main "+$(git rev-parse HEAD):refs/tags/v${version}"`,
			);
			console.log("  bun scripts/release-v2.ts watch");
			process.exit(1);
		}
	}
}

if (import.meta.main) {
	const args = process.argv.slice(2);

	if (args[0] === "watch") {
		await watchCI();
		process.exit(0);
	}

	if (!args[0]) {
		console.error("Usage:");
		console.error("  bun scripts/release-v2.ts <version> [--watch]   Full release");
		console.error("  bun scripts/release-v2.ts watch                 Watch CI for current commit");
		process.exit(1);
	}

	await cmdRelease(args[0], args.includes("--watch"));
}
