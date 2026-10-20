#!/usr/bin/env bun
/**
 * Release asset-name contract guard — one rename, three surfaces.
 *
 * A release-asset rename is invisible until a release runs: the names are
 * ordinary strings to the type gates, and the only place they meet is the
 * release run itself (the release-state-only damage shape of damage classes
 * 7/10/12). The consumer side died once too: `zetacode update` built its
 * fallback download name from `CLI_BIN_NAME` (`zetacode-*`) while releases
 * shipped `zeta-cli-*`, so self-update 404'd on every platform (v1.1.27 / main).
 *
 * Three surfaces have to agree:
 *
 *   1. `scripts/ci-release-build-binaries.ts` — every `kind: "cli"` target's
 *      `outfile` basename: what a release can build.
 *   2. `.github/workflows/ci.yml` — the `release_binary` job's `binary_path`
 *      entries: which of those a release actually builds and uploads.
 *   3. `packages/coding-agent/src/cli/update-cli.ts` via
 *      `packages/utils/src/release-assets.ts`: the name `zetacode update`'s
 *      binary fallback downloads. Assets keep the package's *file*-name face,
 *      never the user-visible command name.
 *
 * The former fourth surface — the upstream build-server `ASSETS` table in the
 * retired `scripts/ci-build-upload.ts` — is gone. Zeta no longer publishes to
 * build.stencil.so (the fork is permanently 403 there); binaries ship only in
 * our own GitHub Release. `scripts/check-ci-surface.ts` bans the upload step
 * from returning and `scripts/check-shared-infra.ts` bans the endpoint.
 *
 * Assertions:
 *   - the `outfile` scan must find exactly one basename per declared CLI target
 *     (a scan that silently misses is a bug here, never a pass);
 *   - every `outfile` basename must live in `packages/coding-agent/binaries/`;
 *   - every `binary_path` the release matrix builds must be a CLI outfile
 *     basename;
 *   - the updater's shipped names (`SHIPPED_CLI_ASSETS`) and the release
 *     matrix's `binary_path` basenames must be the same set — a name only one
 *     side knows is a 404 or an unreachable build;
 *   - every candidate name the updater could compute (each platform × arch,
 *     musl included) must resolve through `shippedCliAssetName(` to a shipped
 *     asset or to nothing — an unshipped name must never reach a URL, or
 *     `zetacode update` downloads a 404 (darwin/arm64 after the 2026-10-01
 *     trim);
 *   - the updater must delegate to `releaseCliAssetName(` /
 *     `shippedCliAssetName(` and must not rebuild the name from `CLI_BIN_NAME`;
 *   - CLI targets the matrix does not build today are reported, not failed:
 *     the build matrix is the authority on what ships (macOS left the release
 *     surface on 2026-10-01; the arm64 targets stay buildable so a future
 *     platform decision is one matrix edit). They are visible here so the next
 *     release-platform trim is a decision, not an accident.
 *
 * Static and hermetic: reads three files, no network, no build.
 *
 * Usage: bun scripts/check-release-asset-names.ts   (gate mode; exit 0/1)
 */
import * as path from "node:path";
import { releaseCliAssetName, SHIPPED_CLI_ASSETS, shippedCliAssetName } from "../packages/utils/src/release-assets";

const ROOT = path.resolve(import.meta.dir, "..");
const BINARIES_DIR = "packages/coding-agent/binaries";
const TARGETS_FILE = "scripts/ci-release-build-binaries.ts";
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
			`${TARGETS_FILE}: CLI outfile \`${outfile}\` is outside ${BINARIES_DIR}/ — release assets are collected from that directory`,
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
		`${WORKFLOW_FILE}: \`${RELEASE_JOB}\` declares no \`binary_path\` entry — nothing is built, or the matrix changed shape`,
	);
}
for (const name of shipped) {
	if (!buildable.has(name)) {
		problems.push(
			`${WORKFLOW_FILE}: \`${RELEASE_JOB}\` builds \`${name}\`, which is not a CLI outfile basename in ${TARGETS_FILE}`,
		);
	}
}

// 3. What the updater asks for: the binary fallback downloads a published
//    asset name, built from the shared convention in
//    packages/utils/src/release-assets.ts. That name is the *file*-name face
//    (`zeta-cli-*`), NOT the user-visible command name (`CLI_BIN_NAME` =
//    `zetacode`): deriving it from the command name made every fallback ask
//    GitHub for `zetacode-<os>-<arch>` while releases carried `zeta-cli-*`, so
//    self-update 404'd on every platform (v1.1.27 / main).
const updaterSource = await read(UPDATER_FILE);
// The updater asks for a name only through the shipped gate: a bare
// `releaseCliAssetName(` call can produce darwin/arm64 names the matrix never
// builds (the 404 this guard exists for).
if (updaterSource.includes("releaseCliAssetName(")) {
	problems.push(
		`${UPDATER_FILE}: calls \`releaseCliAssetName(\` directly — go through \`shippedCliAssetName(\` so an unshipped platform yields no download name at all`,
	);
}
if (!updaterSource.includes("shippedCliAssetName(")) {
	problems.push(
		`${UPDATER_FILE}: no \`shippedCliAssetName(\` call — the updater must gate its fallback on the shipped matrix, not on a name it can compute`,
	);
}
// Source text of the drift itself, assembled so it does not read as a live
// template literal.
if (updaterSource.includes("$" + "{CLI_BIN_NAME}-")) {
	problems.push(
		`${UPDATER_FILE}: builds an asset name from CLI_BIN_NAME — assets keep the package's file-name face (zeta-cli-*), not the command name`,
	);
}
if (!updaterSource.includes("shippedCliAssetName(")) {
	problems.push(
		`${UPDATER_FILE}: no \`shippedCliAssetName(\` call — the updater must gate its fallback on the shipped matrix, not on a name it can compute`,
	);
}
// Every name the updater could ask for, per platform × arch, then through the
// shipped gate. An unshipped name resolving to a string is the 404 bug: the
// release built no such asset (darwin/arm64 after the 2026-10-01 trim).
for (const platform of PLATFORMS) {
	for (const arch of ARCHES) {
		for (const musl of [false, true]) {
			if (musl && platform !== "linux") continue;
			const candidate = releaseCliAssetName(platform, arch, { musl });
			const gated = shippedCliAssetName(platform, arch, { musl });
			if (gated !== undefined && !buildable.has(gated)) {
				problems.push(
					`${UPDATER_FILE}: the updater downloads \`${gated}\`, which no \`kind: "cli"\` target in ${TARGETS_FILE} builds — that fallback 404s`,
				);
			}
			if (gated === undefined && shipped.includes(candidate)) {
				problems.push(
					`packages/utils/src/release-assets.ts: \`${candidate}\` is shipped but the shipped gate drops it — the updater would never download it`,
				);
			}
			if (gated !== undefined && !shipped.includes(gated)) {
				problems.push(
					`${UPDATER_FILE}: the updater offers \`${gated}\`, which the ${RELEASE_JOB} matrix never builds — that fallback 404s`,
				);
			}
		}
	}
}
// The single source of truth and the matrix must be the same set, both ways.
const shippedSet = new Set(shipped);
for (const name of SHIPPED_CLI_ASSETS) {
	if (!shippedSet.has(name)) {
		problems.push(
			`${WORKFLOW_FILE}: \`${RELEASE_JOB}\` does not build \`${name}\`, but the updater lists it as shipped (packages/utils/src/release-assets.ts)`,
		);
	}
	if (!buildable.has(name)) {
		problems.push(`${TARGETS_FILE}: \`${name}\` is listed as shipped but no \`kind: "cli"\` target builds it`);
	}
}
for (const name of shipped) {
	if (!SHIPPED_CLI_ASSETS.includes(name)) {
		problems.push(
			`${WORKFLOW_FILE}: \`${RELEASE_JOB}\` builds \`${name}\`, but the updater's shipped set does not list it — self-update cannot install that build`,
		);
	}
}

if (problems.length > 0) {
	console.error("Release asset-name contract FAILED:");
	for (const problem of problems) console.error(`  - ${problem}`);
	process.exit(1);
}
const buildableNotShipped = [...buildable].filter(name => !shipped.includes(name)).sort();
console.log(
	`Release asset names OK: ${buildable.size} CLI target(s), ${shipped.length} shipped ↔ ${SHIPPED_CLI_ASSETS.length} updater name(s); ` +
		`${RELEASE_JOB} builds ${shipped.length} (${[...shipped].sort().join(", ")})`,
);
if (buildableNotShipped.length > 0) {
	console.log(`  buildable but not built by ${RELEASE_JOB} today: ${buildableNotShipped.join(", ")}`);
}
