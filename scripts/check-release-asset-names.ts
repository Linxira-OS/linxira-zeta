#!/usr/bin/env bun
/**
 * Release asset-name contract guard — one rename, four surfaces.
 *
 * The v1.2.0 release run died inside `ci-build-upload.ts`: its table still
 * carried upstream's `omp-*` names while the release builds `zeta-cli-*`, so
 * every file handed to the uploader was rejected ("not an uploaded release
 * asset") and the publish tail went with it. Nothing else can see that rename:
 * the names are ordinary strings to the type gates, and the only place they
 * meet is the release run itself (the release-state-only damage shape of
 * damage classes 7/10/12). The same rename hit the *consumer* side in v1.1.27:
 * `zetacode update` built its fallback download name from `CLI_BIN_NAME`
 * (`zetacode-*`) while releases shipped `zeta-cli-*`, so self-update 404'd on
 * every platform.
 *
 * Four surfaces have to agree:
 *
 *   1. `scripts/ci-release-build-binaries.ts` — every `kind: "cli"` target's
 *      `outfile` basename: what a release can build.
 *   2. `.github/workflows/ci.yml` — the `release_binary` job's `binary_path`
 *      entries: which of those a release actually builds and uploads.
 *   3. `scripts/ci-build-upload.ts`'s `ASSETS` keys: what the build service
 *      (build.stencil.so, consumed by update clients) accepts.
 *   4. `packages/coding-agent/src/cli/update-cli.ts` via
 *      `packages/utils/src/release-assets.ts`: the name `zetacode update`'s
 *      binary fallback downloads. Assets keep the package's *file*-name face,
 *      never the user-visible command name.
 *
 * Assertions:
 *   - the `outfile` scan must find exactly one basename per declared CLI target
 *     (a scan that silently misses is a bug here, never a pass);
 *   - every `ASSETS` key must name a real CLI outfile basename — catches the
 *     stale/renamed table that broke v1.2.0;
 *   - every name the release matrix builds must be an `ASSETS` key — catches a
 *     new leg added to the matrix before a release discovers it mid-flight;
 *   - the updater's names and the CLI outfile basenames must be the same set —
 *     a name only one side knows is a 404 or an unreachable build;
 *   - the updater must delegate to `releaseCliAssetName(` and must not rebuild
 *     the name from `CLI_BIN_NAME`;
 *   - CLI targets that are neither built nor keyed are reported, not failed:
 *     the build matrix is the authority on what ships (macOS left the release
 *     surface on 2026-10-01 while its targets stayed in the table, and the
 *     arm64 legs are keyed ahead of the matrix). They are visible here so the
 *     next release-platform trim is a decision, not an accident.
 *
 * Static and hermetic: reads four files, no network, no build.
 *
 * Usage: bun scripts/check-release-asset-names.ts   (gate mode; exit 0/1)
 */
import * as path from "node:path";
import { releaseCliAssetName } from "../packages/utils/src/release-assets";
import { ASSETS } from "./ci-build-upload";

const ROOT = path.resolve(import.meta.dir, "..");
const BINARIES_DIR = "packages/coding-agent/binaries";
const TARGETS_FILE = "scripts/ci-release-build-binaries.ts";
const UPLOAD_FILE = "scripts/ci-build-upload.ts";
const WORKFLOW_FILE = ".github/workflows/ci.yml";
/** The updater's binary-fallback path: it downloads what a release publishes. */
const UPDATER_FILE = "packages/coding-agent/src/cli/update-cli.ts";
/** Job whose matrix decides which release assets exist. */
const RELEASE_JOB = "release_binary";
/** Declared platforms/arches of the release matrix; every cross product must exist. */
const PLATFORMS = ["darwin", "linux", "win32"] as const;
const ARCHES = ["x64", "arm64"] as const;

const problems: string[] = [];

async function read(rel: string): Promise<string> {
	const file = Bun.file(path.join(ROOT, rel));
	if (!(await file.exists())) {
		console.error(`error: ${rel} is missing — the guard cannot verify the release asset surface`);
		process.exit(1);
	}
	return file.text();
}

// 1. What the release can build: CLI target outfiles.
const targetsSource = await read(TARGETS_FILE);
// The array entries only: the `CliBinaryTarget` interface declares `kind: "cli";`
// too, and that shape must not count as a target.
const declaredCliTargets = [...targetsSource.matchAll(/kind:\s*"cli",\s+id:\s*"[^"]+"/g)].length;
const outfiles = [...targetsSource.matchAll(/outfile:\s*"([^"]+)"/g)].map(match => match[1]);
if (outfiles.length !== declaredCliTargets) {
	problems.push(
		`${TARGETS_FILE}: scanned ${outfiles.length} \`outfile\` basename(s) for ${declaredCliTargets} \`kind: "cli"\` target(s) — the scan and the file disagree`,
	);
}
for (const outfile of outfiles) {
	if (path.dirname(outfile) !== BINARIES_DIR) {
		problems.push(
			`${TARGETS_FILE}: CLI outfile \`${outfile}\` is outside ${BINARIES_DIR}/ — the uploader's glob only covers that directory`,
		);
	}
}
const buildable = new Set(outfiles.map(outfile => path.basename(outfile)));

// 2. What a release actually builds: the release job's matrix binary paths.
const workflowLines = (await read(WORKFLOW_FILE)).split(/\r?\n/);
const jobStart = workflowLines.findIndex(line => line === `   ${RELEASE_JOB}:`);
const jobEnd = workflowLines.findIndex(
	(line, index) => index > jobStart && jobStart !== -1 && /^ {3}[a-z_][a-z0-9_-]*:\s*$/.test(line),
);
if (jobStart === -1) {
	problems.push(
		`${WORKFLOW_FILE}: no \`${RELEASE_JOB}:\` job — the guard cannot tell which CLI binaries a release builds`,
	);
}
const jobSource = workflowLines.slice(jobStart + 1, jobEnd === -1 ? workflowLines.length : jobEnd).join("\n");
const shipped = [...jobSource.matchAll(/binary_path:\s*(\S+)/g)].map(match =>
	path.basename(match[1].replace(/,$/, "")),
);
if (jobStart !== -1 && shipped.length === 0) {
	problems.push(
		`${WORKFLOW_FILE}: \`${RELEASE_JOB}\` declares no \`binary_path\` entry — nothing to upload, or the matrix changed shape`,
	);
}
for (const name of shipped) {
	if (!buildable.has(name)) {
		problems.push(
			`${WORKFLOW_FILE}: \`${RELEASE_JOB}\` builds \`${name}\`, which is not a CLI outfile basename in ${TARGETS_FILE}`,
		);
	}
}

// 3. What the build service accepts: ASSETS keys, both directions.
const accepted = Object.keys(ASSETS);
for (const key of accepted) {
	if (!buildable.has(key)) {
		problems.push(
			`${UPLOAD_FILE}: ASSETS key \`${key}\` is not a CLI outfile basename in ${TARGETS_FILE} (${[...buildable].sort().join(", ")})`,
		);
	}
}
for (const name of shipped) {
	if (!accepted.includes(name)) {
		problems.push(
			`${UPLOAD_FILE}: ASSETS has no key for \`${name}\`, which \`${RELEASE_JOB}\` builds — the uploader rejects unknown names mid-release`,
		);
	}
}

// 4. What the updater asks for: the binary fallback downloads a published
//    asset name, built from the shared convention in
//    packages/utils/src/release-assets.ts. That name is the *file*-name face
//    (`zeta-cli-*`), NOT the user-visible command name (`CLI_BIN_NAME` =
//    `zetacode`): deriving it from the command name made every fallback ask
//    GitHub for `zetacode-<os>-<arch>` while releases carried `zeta-cli-*`, so
//    self-update 404'd on every platform (v1.1.27 / main).
const updaterSource = await read(UPDATER_FILE);
if (!updaterSource.includes("releaseCliAssetName(")) {
	problems.push(
		`${UPDATER_FILE}: no \`releaseCliAssetName(\` call — the updater must derive its download name from ${"packages/utils/src/release-assets.ts"}`,
	);
}
// Source text of the drift itself, assembled so it does not read as a live
// template literal.
if (updaterSource.includes("$" + "{CLI_BIN_NAME}-")) {
	problems.push(
		`${UPDATER_FILE}: builds an asset name from CLI_BIN_NAME — assets keep the package's file-name face (zeta-cli-*), not the command name`,
	);
}
const updaterNames = new Set<string>();
for (const platform of PLATFORMS) {
	for (const arch of ARCHES) {
		updaterNames.add(releaseCliAssetName(platform, arch));
		if (platform === "linux") updaterNames.add(releaseCliAssetName(platform, arch, { musl: true }));
	}
}
for (const name of updaterNames) {
	if (!buildable.has(name)) {
		problems.push(
			`${UPDATER_FILE}: the updater downloads \`${name}\`, which no \`kind: "cli"\` target in ${TARGETS_FILE} builds — that fallback 404s`,
		);
	}
}
for (const name of buildable) {
	if (!updaterNames.has(name)) {
		problems.push(
			`${TARGETS_FILE}: \`${name}\` is built but no updater name maps to it — self-update cannot install that build`,
		);
	}
}

if (problems.length > 0) {
	console.error("Release asset-name contract FAILED:");
	for (const problem of problems) console.error(`  - ${problem}`);
	process.exit(1);
}
const keyedNotShipped = accepted.filter(key => !shipped.includes(key)).sort();
const buildableNotKeyed = [...buildable].filter(name => !accepted.includes(name) && !shipped.includes(name)).sort();
console.log(
	`Release asset names OK: ${accepted.length} ASSETS key(s) ↔ ${buildable.size} CLI target(s) ↔ ${updaterNames.size} updater name(s); ` +
		`${RELEASE_JOB} builds ${shipped.length} (${[...shipped].sort().join(", ")})`,
);
if (keyedNotShipped.length > 0) {
	console.log(`  keyed but not built by ${RELEASE_JOB} today: ${keyedNotShipped.join(", ")}`);
}
if (buildableNotKeyed.length > 0) {
	console.log(`  buildable but neither keyed nor built today: ${buildableNotKeyed.join(", ")}`);
}
