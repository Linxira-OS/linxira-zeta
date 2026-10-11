#!/usr/bin/env bun
import { $, Glob } from "bun";
import { compareVersions } from "../packages/utils/src/version.ts";
import { runChangelogFixer } from "./fix-changelogs";
/**
 * Release script v2 for Zeta — explicit-manifest bump, single fixed-subject
 * commit, atomic tag push.
 *
 * Usage:
 *   bun scripts/release-v2.ts <version>              Full release (preflight, bump, changelog, check, commit, tag, push)
 *   bun scripts/release-v2.ts <version> --watch      Release, then watch CI
 *   bun scripts/release-v2.ts watch                  Watch CI for current commit
 *
 * Example: bun scripts/release-v2.ts 1.0.8
 *
 * v2 (unified version line): every published @linxiraos/* package rides the
 * release version (see ALL_PACKAGES below — core packages plus the native
 * leaves natives/omptype/wire all become `X.Y.Z`). The root catalog
 * (CATALOG_KEYS), Cargo.toml workspace version, and the
 * `__piNativesVX_Y_Z` sentinel follow in lock-step, so npm installs never
 * mix version lines (the 1.0.6/1.0.7
 * releases shipped natives@1.0.2/1.0.4 while zeta rode 1.0.6/1.0.7, and
 * `zeta update` failed with ETARGET because it pinned every package to the
 * release version). The commit subject is fixed (`chore: bump version to
 * X.Y.Z`) so CI's release-run concurrency group and selectLatestZetaTag both
 * match.
 */
import { generateNixBunDeps, normalizeLockfileVersion } from "./gen-nix-bun";
import { selectLatestZetaTag, validateExplicitVersion, watchCI } from "./release";

// All published packages ride the release version in lock-step.
const ALL_PACKAGES = [
	"utils",
	"agent",
	"catalog",
	"ai",
	"tui",
	"mnemopi",
	"snapcompact",
	"stats",
	"coding-agent",
	"channels",
	"natives",
	"omptype",
	"wire",
] as const;

// Root catalog key → package dir mapping. Exactly these keys may carry a
// `@linxiraos/*` workspace dependency; any other count is a drift error.
const CATALOG_KEYS: ReadonlyArray<{ key: string; pkg: string }> = [
	{ key: "@linxiraos/pi-utils", pkg: "utils" },
	{ key: "@linxiraos/pi-agent-core", pkg: "agent" },
	{ key: "@linxiraos/pi-catalog", pkg: "catalog" },
	{ key: "@linxiraos/pi-ai", pkg: "ai" },
	{ key: "@linxiraos/pi-tui", pkg: "tui" },
	{ key: "@linxiraos/pi-mnemopi", pkg: "mnemopi" },
	{ key: "@linxiraos/pi-snapcompact", pkg: "snapcompact" },
	{ key: "@linxiraos/pi-stats", pkg: "stats" },
	{ key: "@linxiraos/zeta", pkg: "coding-agent" },
	{ key: "@linxiraos/pi-channels", pkg: "channels" },
	{ key: "@linxiraos/pi-natives", pkg: "natives" },
	{ key: "@linxiraos/pi-omptype", pkg: "omptype" },
	{ key: "@linxiraos/pi-wire", pkg: "wire" },
];

/** Files carrying the pi-natives version sentinel, kept in lock-step with the release version. */
const SENTINEL_FILES = [
	"crates/pi-natives/src/lib.rs",
	"packages/natives/native/index.d.ts",
	"packages/natives/native/index.js",
] as const;

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
 * fallback asserting a stale latest version).
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
		// Re-open a fresh [Unreleased] for the next cycle. Most package
		// changelogs have no `# Changelog` title, so anchoring the insert on
		// that header alone left them without an [Unreleased] section at all
		// (check-version-consistency then flagged the drift).
		content = /^# Changelog\n\n/.test(content)
			? content.replace(/^(# Changelog\n\n)/, () => `$1## [Unreleased]\n\n`)
			: `## [Unreleased]\n\n${content}`;

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
	if (Object.keys(linxiraos).length !== CATALOG_KEYS.length) {
		throw new Error(
			`Expected exactly ${CATALOG_KEYS.length} @linxiraos/* catalog keys, found ${Object.keys(linxiraos).length}: ${Object.keys(linxiraos).join(", ")}`,
		);
	}
	return linxiraos;
}

/**
 * Rewrite all root catalog keys to `version`. Never touches any other key.
 * Rewrites via structured JSON edit so indentation/order survive; the catalog
 * block is reformatted to 2-space like the rest of the file.
 */
async function updateCatalog(version: string): Promise<void> {
	const rootPkg = await Bun.file("package.json").json();
	const catalog = rootPkg.workspaces.catalog;

	for (const { key } of CATALOG_KEYS) {
		if (!(key in catalog)) throw new Error(`Missing catalog key ${key}`);
		catalog[key] = version;
	}
	// Exact-count check (no other @linxiraos/* key may exist).
	const linxiraosCount = Object.keys(catalog).filter((k: string) => k.startsWith("@linxiraos/")).length;
	if (linxiraosCount !== CATALOG_KEYS.length) {
		throw new Error(`Catalog has ${linxiraosCount} @linxiraos/* keys, expected exactly ${CATALOG_KEYS.length}`);
	}

	await Bun.write("package.json", `${JSON.stringify(rootPkg, null, 2)}\n`);
}

/** Verify bun.lock resolves all @linxiraos/* packages to the catalog versions. */
async function verifyLockfile(catalog: Record<string, string>): Promise<void> {
	const lock = Bun.JSON5.parse(await Bun.file("bun.lock").text());
	const pkgs = lock.workspaces ?? lock.packages ?? lock;
	const packageDirs = CATALOG_KEYS.map(({ key, pkg }) => ({ dir: `packages/${pkg}`, key }));
	for (const { dir, key } of packageDirs) {
		const entry = pkgs[dir];
		if (!entry) throw new Error(`bun.lock missing entry for ${dir}`);
		if (entry.version !== catalog[key]) {
			throw new Error(`bun.lock ${dir} version ${entry.version} != catalog ${key} ${catalog[key]}`);
		}
	}
	console.log(`  bun.lock: ${CATALOG_KEYS.length} @linxiraos/* entries match catalog`);
}

/**
 * Pre-commit consistency gate. Every failure aborts the release before
 * anything reaches git history.
 */
async function assertConsistency(version: string): Promise<void> {
	const problems: string[] = [];

	for (const pkg of ALL_PACKAGES) {
		const pkgJson = await Bun.file(`packages/${pkg}/package.json`).json();
		if (pkgJson.version !== version) problems.push(`packages/${pkg}: ${pkgJson.version} != ${version}`);
	}
	for (const manifestPath of ["desktop/package.json", "desktop/package-lock.json"]) {
		const manifest = await Bun.file(manifestPath).json();
		if (manifest.version !== version) problems.push(`${manifestPath}: ${manifest.version} != ${version}`);
	}

	const catalog = await readCatalog();
	for (const { key } of CATALOG_KEYS) {
		if (catalog[key] !== version) problems.push(`catalog ${key}: ${catalog[key]} != ${version}`);
	}

	const cargoToml = await Bun.file("Cargo.toml").text();
	const cargoVersion = cargoToml.match(/^\s*version = "([^"]+)"/m)?.[1];
	if (cargoVersion !== version) problems.push(`Cargo.toml workspace: ${cargoVersion} != ${version}`);

	// v18.3.3+ mechanism: no per-release sentinel name — verify the stamp
	// mechanism symbols instead (same list as the Step-2c check below).
	for (const [file, needle] of [
		["crates/pi-natives/src/lib.rs", "pub fn pi_natives_build_version()"],
		["packages/natives/native/index.js", "__piNativesBuildVersion"],
		["packages/natives/native/index.d.ts", "__piNativesBuildVersion"],
	]) {
		const content = await Bun.file(file).text();
		if (!content.includes(needle)) {
			problems.push(`${file}: missing pi-natives version-stamp symbol "${needle}"`);
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
		`  Consistency: ${ALL_PACKAGES.length} packages == ${version}, desktop/catalog/Cargo/sentinel OK, tag absent`,
	);
}

/**
 * Body text between a `## [Header]` line and the next `## `-level header (or
 * end of file). Returns undefined when the header is absent. indexOf-based so
 * it is immune to `$`/`\s*$` lookahead pitfalls that match line ends under
 * the `m` flag (which would wrongly report a populated section as empty).
 */
function extractSectionBody(content: string, header: string): string | undefined {
	const start = content.indexOf(header);
	if (start === -1) return undefined;
	const afterHeader = content.indexOf("\n", start);
	if (afterHeader === -1) return "";
	const bodyStart = afterHeader + 1;
	const nextHeader = content.slice(bodyStart).search(/^## /m);
	const body = nextHeader === -1 ? content.slice(bodyStart) : content.slice(bodyStart, bodyStart + nextHeader);
	return body;
}

/**
 * Pre-tag log gate — refuse to release while any package CHANGELOG carries an
 * upstream OMP version section ([15.x]–[18.x]), any package [Unreleased] is
 * empty, or UPDATE-LOG's Unreleased section is empty. See AGENTS.md "Release
 * log completeness (pre-tag gate)".
 */
/**
 * CI-wait constants for the bump-commit push run. The workflow is dual-mode:
 * a run whose HEAD carries the release tag SKIPS the test-type jobs, so the
 * tests must be proven green on the identical SHA before the tag is pushed.
 */
const CI_WAIT_POLL_MS = 60_000;
const CI_WAIT_TIMEOUT_MS = 90 * 60_000;

/**
 * Locate the push-event CI run for `sha` (`gh run list` by headSha + event).
 * Returns the run database id, or null while the run has not registered yet
 * (GitHub lags the push by a few seconds).
 */
async function findPushRunId(sha: string): Promise<string | null> {
	const out = await $`gh run list --commit ${sha} --event push --workflow ci.yml --limit 5 --json databaseId`.text();
	const runs = JSON.parse(out) as Array<{ databaseId: number }>;
	return runs.length > 0 ? String(runs[0].databaseId) : null;
}

/**
 * Wait (poll ≥60 s, max 90 min) for the bump-commit push run to finish, via
 * `gh run watch <id> --exit-status`. True only on a green run.
 */
async function waitForBumpCommitCI(sha: string): Promise<boolean> {
	console.log(
		`Waiting for CI on bump commit ${sha} (poll ${CI_WAIT_POLL_MS / 1000}s, max ${CI_WAIT_TIMEOUT_MS / 60_000}min)...`,
	);
	const deadline = Date.now() + CI_WAIT_TIMEOUT_MS;

	let runId: string | null = null;
	while ((runId = await findPushRunId(sha)) === null) {
		if (Date.now() > deadline) {
			console.error("Timed out waiting for the push run to register on GitHub.");
			return false;
		}
		await Bun.sleep(CI_WAIT_POLL_MS);
	}
	// `gh run watch` needs the URL for the link anyway; resolve once here:
	const origin = (await git(["remote", "get-url", "origin"]).text())
		.trim()
		.replace(/^git@github\.com:/, "https://github.com/")
		.replace(/\.git$/, "");
	console.log(`  Run: ${origin}/actions/runs/${runId}`);

	const proc = Bun.spawn(
		["gh", "run", "watch", runId, "--exit-status", "--interval", String(CI_WAIT_POLL_MS / 1000)],
		{
			stdin: "ignore",
			stdout: "inherit",
			stderr: "inherit",
		},
	);
	const timer = setTimeout(() => {
		console.error("\nTimed out after 90 minutes waiting for the push run.");
		proc.kill();
	}, deadline - Date.now());
	const exitCode = await proc.exited;
	clearTimeout(timer);
	if (exitCode !== 0) {
		console.error(`Push run ${runId} did not succeed (exit ${exitCode}).`);
		return false;
	}
	return true;
}

async function assertReleaseLogs(): Promise<void> {
	const problems: string[] = [];

	for (const pkg of ALL_PACKAGES) {
		const changelogPath = `packages/${pkg}/CHANGELOG.md`;
		const content = await Bun.file(changelogPath).text();
		const upstreamMatch = content.match(/^## \[1[5-8]\./m);
		if (upstreamMatch) {
			problems.push(`${changelogPath}: upstream OMP version section ${upstreamMatch[0].trim()}`);
		}
		const unreleasedBody = extractSectionBody(content, "## [Unreleased]");
		if (unreleasedBody === undefined) {
			problems.push(`${changelogPath}: missing [Unreleased] section`);
		} else if (!unreleasedBody.trim()) {
			problems.push(`${changelogPath}: [Unreleased] is empty — add user-visible entries`);
		}
	}

	const updateLog = await Bun.file("UPDATE-LOG.md").text();
	const updateLogBody = extractSectionBody(updateLog, "## 下一版本（Unreleased）");
	if (updateLogBody === undefined || !updateLogBody.trim()) {
		problems.push("UPDATE-LOG.md: ## 下一版本（Unreleased） is empty — add the release entry + sync baseline");
	}

	if (problems.length > 0) {
		console.error("Error: release log preflight failed:");
		for (const p of problems) console.error(`  - ${p}`);
		process.exit(1);
	}
	console.log("  Log gate: no upstream OMP sections, all [Unreleased] non-empty, UPDATE-LOG updated");
}

async function cmdRelease(versionArg: string, watch: boolean, noCiWait: boolean): Promise<void> {
	console.log("\n=== Release v2 ===\n");

	// Step 0: pre-tag log gate — see assertReleaseLogs above.
	await assertReleaseLogs();

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
					// 'Latest' must mean the most recent release in time, not the
					// highest version segment: retired 3.x/9.x lines sort above
					// the live 1.1.x line under version sort. Sort by the tag's
					// commit date (descending) so the newest real release wins.
					"--sort=-*committerdate",
					"--format",
					"%(refname:short)%00%(subject)%00%(*subject)",
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

	// Step 2: bump all published packages to the release version.
	console.log(`Updating ${ALL_PACKAGES.length} packages to ${version}…`);
	for (const pkg of ALL_PACKAGES) {
		const pkgPath = `packages/${pkg}/package.json`;
		await $`sd '"version": "[^"]+"' ${`"version": "${version}"`} ${pkgPath}`;
	}
	// Step 2b: Cargo workspace version follows the release version. The
	// version lives under `[workspace.package]` (indented per standard Cargo
	// formatting), so allow leading whitespace.
	console.log(`Updating Cargo.toml workspace to ${version}...`);
	await $`sd '^ *version = "[^"]+"' ${`version = "${version}"`} Cargo.toml`;
	// Step 2c: pi-natives version sentinel follows the release version
	// (js_name in lib.rs plus the committed bindings in index.js/index.d.ts;
	// gen-enums.ts regenerates the same names on the next napi build). The
	// loader derives the expected sentinel from package.json at runtime, so
	// the Rust symbol must move in lock-step or loaded .node files from other
	// releases are rejected at validateLoadedBindings.
	// v18.3.3+ mechanism: the per-release __piNativesVX_Y_Z sentinel export
	// is gone — the addon carries a single __piNativesBuildVersion whose
	// value is stamped post-link (scripts/stamp-native-version.ts) from
	// package.json#version. Bumping the line therefore needs no source edit;
	// verify the mechanism symbols instead (mirror of
	// check-version-consistency.ts).
	console.log("Verifying pi-natives version-stamp mechanism symbols...");
	const mechanismChecks: Array<[string, string]> = [
		["crates/pi-natives/src/lib.rs", "pub fn pi_natives_build_version()"],
		["packages/natives/native/index.js", "__piNativesBuildVersion"],
		["packages/natives/native/index.d.ts", "__piNativesBuildVersion"],
	];
	for (const [file, needle] of mechanismChecks) {
		const content = await Bun.file(file).text();
		if (!content.includes(needle)) {
			console.error(`Error: pi-natives version-stamp mechanism missing "${needle}" in ${file}.`);
			process.exit(1);
		}
	}
	// Step 2d: Cargo.lock workspace members (pi-*) carry the release version
	// too — keep them in lock-step so `cargo deny --locked` (CI Lint job)
	// doesn't fail with "cannot update the lock file" after the Cargo.toml
	// bump (Cargo.toml at the new version vs a stale Cargo.lock).
	const cargoLock = await Bun.file("Cargo.lock").text();
	const updatedLock = cargoLock.replace(/^(name = "pi-[^"]+"\r?\n\s*version = ")[^"]+/gm, `$1${version}`);
	await Bun.write("Cargo.lock", updatedLock);
	console.log(`  Cargo.lock: pi-* members -> ${version}`);

	// Step 2d-bis: MODULE.bazel.lock caches the crate_universe (@crates)
	// extension result, keyed by Cargo.toml/Cargo.lock hashes - so every
	// release bump invalidates it, and a stale lock fails the `Check
	// MODULE.bazel.lock freshness` job, which release_gate depends on. Refresh
	// it here when bazel is available; without bazel on PATH, say so loudly
	// instead of shipping a known-stale lock (the failing CI job uploads a
	// refreshed lockfile as an artifact - harvest it, commit, re-tag).
	const bazel = Bun.which("bazelisk") ?? Bun.which("bazel");
	if (bazel) {
		console.log("Refreshing MODULE.bazel.lock for the bumped Cargo inputs...");
		await $`bun scripts/gen-bazel-lock.ts`;
		await $`git add MODULE.bazel.lock`;
	} else {
		console.warn("WARNING: bazel/bazelisk not on PATH - MODULE.bazel.lock left as is.");
		console.warn('         If the release run fails "Check MODULE.bazel.lock freshness", harvest the');
		console.warn("         refreshed lockfile from that job's uploaded artifact, commit it, then re-tag.");
	}

	// Step 2e: bazel-face crate versions — the hand-written crates/*/BUILD.bazel
	// rust targets carry a `version` attr printed in bazel logs and cache keys;
	// check-version-consistency.ts fails the release while they lag the line.
	console.log("Updating crates/*/BUILD.bazel bazel-face versions...");
	for (const buildFile of await Array.fromAsync(new Glob("crates/*/BUILD.bazel"))) {
		await $`sd '^(\s{4}version = ")[^"]+(")' ${"$1" + version + "$2"} ${buildFile}`;
	}

	// Step 2f: editor npm distribution packages (vendored TTT editor; not a
	// Bun workspace — bumped here so the CI trusted-publishing job releases
	// them on the same release version). The launcher pins platform leaves
	// exactly, so their dependency refs move in the same pass.
	console.log(`Updating editor npm packages to ${version}...`);
	for (const editorDir of ["editor/npm/editor", "editor/npm/editor-windows-x64", "editor/npm/editor-linux-x64"]) {
		await $`sd '"version": "[^"]+"' ${`"version": "${version}"`} ${editorDir}/package.json`;
	}
	for (const editorLeaf of ["editor-windows-x64", "editor-linux-x64"]) {
		await $`sd '"@linxiraos/${editorLeaf}": "[^"]+"' ${`"@linxiraos/${editorLeaf}": "${version}"`} editor/npm/editor/package.json`;
	}

	// Step 2f-2: termide (zeta-ide) npm distribution — same pattern as the
	// editor trio; the launcher pins its platform leaves exactly.
	console.log(`Updating ide npm packages to ${version}...`);
	for (const ideDir of ["termide/npm/ide", "termide/npm/ide-windows-x64", "termide/npm/ide-linux-x64"]) {
		await $`sd '"version": "[^"]+"' ${`"version": "${version}"`} ${ideDir}/package.json`;
	}
	for (const ideLeaf of ["ide-windows-x64", "ide-linux-x64"]) {
		await $`sd '"@linxiraos/${ideLeaf}": "[^"]+"' ${`"@linxiraos/${ideLeaf}": "${version}"`} termide/npm/ide/package.json`;
	}

	// Step 2f-3: the zeta workspace (main) npm distribution — same pattern.
	console.log(`Updating main npm packages to ${version}...`);
	for (const mainDir of ["main/npm/main", "main/npm/main-windows-x64", "main/npm/main-linux-x64"]) {
		await $`sd '"version": "[^"]+"' ${`"version": "${version}"`} ${mainDir}/package.json`;
	}
	for (const mainLeaf of ["main-windows-x64", "main-linux-x64"]) {
		await $`sd '"@linxiraos/${mainLeaf}": "[^"]+"' ${`"@linxiraos/${mainLeaf}": "${version}"`} main/npm/main/package.json`;
	}

	// Step 2f-4: the main workbench is a separate Cargo workspace whose
	// version stamps the published workbench binary (`zeta --version`) — it
	// rides the same release line (mirror of Step 2b/2d for main/).
	console.log("Updating main workbench Cargo workspace...");
	await $`sd '^ *version = "[^"]+"' ${`version = "${version}"`} main/Cargo.toml`;
	const mainCargoLock = await Bun.file("main/Cargo.lock").text();
	const updatedMainLock = mainCargoLock.replace(/^(name = "zeta-main"\r?\n\s*version = ")[^"]+/gm, `$1${version}`);
	await Bun.write("main/Cargo.lock", updatedMainLock);

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

	// Step 4: root catalog explicit mapping (workspace deps resolve to the
	// release version — without this, catalog stays on the old version and
	// `bun install` fails resolving `@linxiraos/*@catalog:` against npm).
	console.log("Updating root catalog...");
	await updateCatalog(version);
	await readCatalog(); // re-validates catalog key count
	console.log(`  Root catalog: ${CATALOG_KEYS.length} keys -> ${version}`);

	// Step 4b: README shields.io version badge stays in lock-step with the
	// release (see scripts/set-version.ts — keep both replacements identical).
	console.log("Updating README version badge...");
	await $`sd 'badge/zeta-[0-9.]+-' ${`badge/zeta-${version}-`} README.md`;
	console.log(`  README badge: zeta-${version}`);

	// Step 5: regenerate lockfile and verify. The install runs with the
	// canonical npmjs registry — a local mirror override (e.g. ~/.npmrc
	// registry=npmmirror.com) would otherwise leak mirror URLs into the
	// committed lockfile and break the flake's bun2nix diff (v1.1.10 sync).
	console.log("Regenerating lockfile (registry pinned to npmjs.org)...");
	await $`rm -f bun.lock`.env({ ...process.env, npm_config_registry: "https://registry.npmjs.org/" });
	await $`bun install`.env({ ...process.env, npm_config_registry: "https://registry.npmjs.org/" });
	// bun 1.4+ writes lockfileVersion 2, but bun2nix (the flake's bun.lock
	// consumer) hard-requires v1 — and Bun's v1→v2 change adds parse-time
	// strictness only, never content. Restamp so the flake check stays green.
	const lockPath = "bun.lock";
	const restamped = normalizeLockfileVersion(await Bun.file(lockPath).text());
	const registryLeak = [...restamped.matchAll(/registry\.[a-z0-9.-]+/g)]
		.map(m => m[0])
		.filter(host => host !== "registry.npmjs.org");
	if (registryLeak.length > 0) {
		console.error(
			`Error: regenerated bun.lock carries non-canonical registry hosts: ${[...new Set(registryLeak)].join(", ")}`,
		);
		process.exit(1);
	}
	await Bun.write(lockPath, restamped);
	await $`git add bun.lock`;
	await verifyLockfile(await readCatalog());
	// The flake's bun-lock check regenerates nix/bun.nix from bun.lock with
	// the pinned bun2nix and diffs — a stale file (dependency set or format)
	// fails the tag run. Regenerate here so the bump commit always carries a
	// matching nix/bun.nix.
	console.log("Regenerating nix/bun.nix from bun.lock...");
	await generateNixBunDeps();
	await $`git add nix/bun.nix`;
	console.log();

	// Step 6: changelogs for all published packages.
	console.log(`Updating CHANGELOGs (${ALL_PACKAGES.length} packages)...`);
	const fixResult = await runChangelogFixer({});
	for (const fixed of fixResult.changedFiles) {
		console.log(
			`  Fixed ${fixed.path}: ${fixed.promotedItems} promoted, ${fixed.mergedDuplicateHeadings} duplicate heading(s) merged, ${fixed.removedEmptyHeadings} empty heading(s) removed`,
		);
	}
	await finalizeChangelogsForRelease(version, [...ALL_PACKAGES]);
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

	// Step 10: push the bump commit, WAIT for its push-run CI to go green
	// (unless --no-ci-wait), and only then tag. Dual-mode CI skips the
	// test-type jobs on a release run, so the tag must not land until the
	// identical SHA has a green full-test run — that greenness is the
	// precondition the skipped release-state tests rely on. The tag push uses
	// the SHA refspec (survives git-maintenance tag pruning; see release.ts
	// for the race this avoids).
	const sha = (await git(["rev-parse", "HEAD"]).text()).trim();
	const tagRef = `v${version}`;
	if (noCiWait) {
		// Escape hatch: old atomic behavior (branch + tag in one push).
		console.log("Tagging and pushing to remote (--no-ci-wait: no CI wait)...");
		await git(["tag", "-f", tagRef]);
		await git(["push", "--atomic", "origin", "refs/heads/main:refs/heads/main", `${sha}:refs/tags/${tagRef}`]);
	} else {
		console.log("Pushing bump commit (tag follows after CI)...");
		await git(["push", "origin", "refs/heads/main:refs/heads/main"]);
		console.log();
		const ok = await waitForBumpCommitCI(sha);
		console.log();
		if (!ok) {
			console.error("Aborting: not tagging a bump commit whose push run is not green.");
			console.error("To skip this wait (at your own risk), re-run with --no-ci-wait:");
			console.error(`  bun scripts/release-v2.ts ${versionArg} --no-ci-wait`);
			process.exit(1);
		}
		console.log("Push-run green. Tagging and pushing the tag...");
		await git(["tag", "-f", tagRef]);
		await git(["push", "origin", `${sha}:refs/tags/${tagRef}`]);
	}
	console.log();
	console.log(`Tag ${tagRef} is on ${sha.slice(0, 12)}.`);
	console.log("Dispatch the release CI run (it SKIPS the test jobs and goes straight to build+publish):");
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
		console.error("  bun scripts/release-v2.ts <version> [--watch] [--no-ci-wait]   Full release");
		console.error("  bun scripts/release-v2.ts watch                 Watch CI for current commit");
		console.error("");
		console.error("  --no-ci-wait  Push branch+tag atomically without waiting for the");
		console.error("                bump-commit push run to go green first (escape hatch).");
		process.exit(1);
	}

	await cmdRelease(args[0], args.includes("--watch"), args.includes("--no-ci-wait"));
}
