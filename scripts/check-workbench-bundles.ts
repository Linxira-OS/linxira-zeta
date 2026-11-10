#!/usr/bin/env bun
/**
 * Product bundle guard — the release must stage, pin and upload the commands
 * it advertises (zetacode and zetaide), in every install shape.
 *
 * Nothing else notices when a pin or one of the steps that carries it
 * disappears: every manifest still parses, every test still passes, and the
 * damage only shows up as a user with a product whose command is missing.
 * This guard holds the install shapes:
 *
 *   1. **npm leaves** — `termide/npm/ide/package.json` pins its two `os`-gated
 *      platform leaves at its own version; each leaf manifest exists at that
 *      version, ships `bin/` with a stamped payload, and resolves its binary
 *      from its own platform gate (`@linxiraos/ide-<plat>-x64/bin/…`), so a
 *      Linux install never drags a Windows payload.
 *   2. **Staged runtime** — `scripts/ci-release-build-binaries.ts` stages one
 *      binary per shipped command (`zeta-cli-*` → zetacode, `zeta-ide-*` →
 *      zetaide) for linux and win32 into `packages/coding-agent/binaries/`,
 *      and every product target it declares is actually built by the
 *      `release_product_binaries` matrix. A `work`/`gui` product target (the
 *      retired zetawork legs) is named in `UNSHIPPED_COMMANDS`, so a staged
 *      leg for one fails this guard.
 *   3. **Release archives** — `release_github` uploads the shipped families
 *      after `release_npm` (zetacode) and `release_ide_packages` (zetaide): a
 *      release that uploads product binaries while the npm line lags is a
 *      half-release.
 *
 * Also asserts this guard runs in both CI mirrors (GitHub + Gitea), so a
 * mirror edit cannot quietly drop it.
 *
 * Payload freshness: the leaves ship committed binaries whose manifest version
 * moves with each release, so existence alone proved nothing — a leaf could
 * publish the previous release's binary under the new version. Each binary
 * now carries a `bin/<binary>.stamp.json` (`version` + `sha256`, written by
 * `bun scripts/stamp-workbench-leaves.ts`); this guard fails on a missing
 * stamp, a stamp older than the manifest, or a hash that no longer matches the
 * committed bytes. It also holds the three release-asset surfaces (upload,
 * checksums, preflight) to one list, so the example-plugin zip and the relay
 * extension cannot fall out of one of them.
 *
 * Static and hermetic: reads manifests, two scripts and two workflows. No
 * network, no build.
 *
 * Usage: bun scripts/check-workbench-bundles.ts   (gate mode; exit 0/1)
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "yaml";
import { leafStampProblem, STAMP_SUFFIX } from "./workbench-leaves";

const ROOT = path.resolve(import.meta.dir, "..");
const BUILD_BINARIES_REL = "scripts/ci-release-build-binaries.ts";
const GITHUB_WORKFLOW_REL = ".github/workflows/ci.yml";
const LOCAL_WORKFLOW_REL = ".gitea/workflows/local-ci.yml";
const STAGED_DIR = "packages/coding-agent/binaries";

/**
 * The workbench distributions and the release binary base name each one
 * carries. This is the contract the launchers encode
 * (`termide/npm/ide/bin/zetaide.js` `EXE`) and the leaf packages ship.
 */
const WORKBENCH_LEAVES: Record<string, string> = {
	"termide/npm/ide": "termide",
};

/** Release product (`kind: "product"`) → the command it produces. */
const PRODUCT_COMMANDS: Record<string, string> = {
	ide: "zetaide",
	// The retired zetawork legs stay mapped so a leftover target fails loudly
	// instead of staging a binary nothing advertises.
	work: "zetawork",
	gui: "zetawork-desktop",
};

const PLATFORMS = ["linux", "win32"] as const;
/**
 * The commands the release stages for both platforms: zetacode and zetaide.
 * The list, the product legs in `ci-release-build-binaries.ts` and the
 * `release_product_binaries` matrix move together.
 */
const COMMANDS = ["zetacode", "zetaide"] as const;
/** Products this release does NOT ship; a staged leg for one is a failure. */
const UNSHIPPED_COMMANDS = ["zetawork", "zetawork-desktop"] as const;

interface Manifest {
	name?: string;
	version?: string;
	bin?: Record<string, string>;
	files?: unknown;
	os?: string[];
	optionalDependencies?: Record<string, string>;
}

interface WorkflowStep {
	name?: string;
	run?: string;
	with?: { files?: unknown };
}

interface WorkflowJob {
	needs?: string[];
	steps?: WorkflowStep[];
	strategy?: { matrix?: { include?: Array<{ target_id?: string }> } };
}

interface Workflow {
	jobs?: Record<string, WorkflowJob>;
}

const problems: string[] = [];

function read(rel: string): string {
	return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function manifest(rel: string): Manifest {
	try {
		return JSON.parse(read(rel)) as Manifest;
	} catch {
		problems.push(`${rel}: unreadable or invalid JSON`);
		return {};
	}
}

const ideLine = manifest("termide/npm/ide/package.json").version;
/** Leaves the ide launcher resolves its binaries from. */
const leafPins: ReadonlyArray<{ dir: string; name: string }> = [
	{ dir: "termide/npm/ide-windows-x64", name: "@linxiraos/ide-windows-x64" },
	{ dir: "termide/npm/ide-linux-x64", name: "@linxiraos/ide-linux-x64" },
];

// 1. Platform leaves: one payload per (product, platform), os-gated so npm
// never materializes a foreign binary, pinned at the line version.
for (const leaf of leafPins) {
	const rel = `${leaf.dir}/package.json`;
	if (!fs.existsSync(path.join(ROOT, rel))) {
		problems.push(`${rel}: missing — a launcher resolves ${leaf.name}`);
		continue;
	}
	const leafManifest = manifest(rel);
	if (ideLine && leafManifest.version !== ideLine) {
		problems.push(`${rel}: ${leafManifest.version ?? "<missing>"} != ${ideLine} (workbench line)`);
	}
	if (Object.keys(leafManifest.optionalDependencies ?? {}).length > 0) {
		// A leaf is a payload, never a launcher: a nested pin would move the
		// binary one package down and the launcher's path walk would stop
		// seeing it.
		problems.push(`${rel}: a platform leaf must not declare optionalDependencies`);
	}
	const os = leafManifest.os ?? [];
	if (os.length !== 1 || (os[0] !== "win32" && os[0] !== "linux")) {
		problems.push(`${rel}: os is [${os.join(", ")}] — a leaf must gate exactly one platform`);
	}
	const parentDir = Object.keys(WORKBENCH_LEAVES).find(dir => leaf.dir.startsWith(`${dir}-`));
	if (!parentDir) {
		problems.push(`${rel}: belongs to no workbench distribution — the guard cannot check its pin or payload name`);
		continue;
	}
	const exe = os[0] === "win32" ? `${WORKBENCH_LEAVES[parentDir]}.exe` : `${WORKBENCH_LEAVES[parentDir]}-linux-x64`;
	const binaryPath = path.join(ROOT, leaf.dir, "bin", exe);
	if (!fs.existsSync(binaryPath)) {
		problems.push(`${leaf.dir}/bin/${exe}: missing — the leaf ships no binary for its platform`);
	} else {
		// Freshness, not existence: the manifest version moves on every release
		// bump, the committed binary does not. A leaf published without a
		// rebuild hands that platform the previous release's binary under a
		// new version number, and nothing on npm's side notices.
		// `bun scripts/stamp-workbench-leaves.ts` writes the stamp beside the
		// binary it hashed.
		const stampPath = `${binaryPath}${STAMP_SUFFIX}`;
		if (!fs.existsSync(stampPath)) {
			problems.push(
				`${leaf.dir}/bin/${exe}${STAMP_SUFFIX}: missing — rebuild the binary and run bun scripts/stamp-workbench-leaves.ts`,
			);
		} else {
			let stamp: { version?: string; sha256?: string } | undefined;
			try {
				stamp = JSON.parse(fs.readFileSync(stampPath, "utf8")) as typeof stamp;
			} catch {
				problems.push(`${leaf.dir}/bin/${exe}${STAMP_SUFFIX}: unreadable JSON`);
			}
			if (stamp) {
				const actual = new Bun.CryptoHasher("sha256").update(fs.readFileSync(binaryPath)).digest("hex");
				const stale = leafStampProblem(stamp, leafManifest.version ?? "", actual);
				if (stale) problems.push(`${leaf.dir}/bin/${exe}: ${stale}`);
			}
		}
	}
	if (!Array.isArray(leafManifest.files) || !leafManifest.files.includes("bin")) {
		problems.push(`${rel}: files does not include "bin" — npm would publish the leaf without its binary`);
	}
	const parent = manifest(`${parentDir}/package.json`);
	if (ideLine && parent.optionalDependencies?.[leaf.name] !== ideLine) {
		problems.push(
			`${parentDir}/package.json: optionalDependencies ${leaf.name} is ${parent.optionalDependencies?.[leaf.name] ?? "<missing>"}, expected ${ideLine}`,
		);
	}
}

// 2. Staged runtime + release archives — the build step stages one binary per
// command for both platforms, and the matrix builds every product leg.
const buildSource = read(BUILD_BINARIES_REL);
const productTargets = [
	...buildSource.matchAll(/kind:\s*"product",\s*id:\s*"([^"]+)",\s*product:\s*"([^"]+)",\s*platform:\s*"([^"]+)"/g),
].map(match => ({ id: match[1], product: match[2], platform: match[3] }));
const cliPlatforms = [...buildSource.matchAll(/kind:\s*"cli",\s*id:\s*"[^"]+",\s*platform:\s*"([^"]+)"/g)].map(
	match => match[1],
);
const stagedPlatforms: Record<string, string[]> = { zetacode: cliPlatforms };
for (const target of productTargets) {
	const command = PRODUCT_COMMANDS[target.product];
	if (!command) {
		problems.push(`${BUILD_BINARIES_REL}: product "${target.product}" (${target.id}) maps to no workbench command`);
		continue;
	}
	if ((UNSHIPPED_COMMANDS as readonly string[]).includes(command)) {
		problems.push(
			`${BUILD_BINARIES_REL}: product target ${target.id} stages ${command}, which this release does not ship`,
		);
		continue;
	}
	(stagedPlatforms[command] ??= []).push(target.platform);
}
for (const command of COMMANDS) {
	for (const platform of PLATFORMS) {
		if (!stagedPlatforms[command]?.includes(platform)) {
			problems.push(
				`${BUILD_BINARIES_REL}: no ${platform} release target stages ${command} — the staged runtime and the release would miss it`,
			);
		}
	}
}
if (!buildSource.includes("path.join(binariesDir, target.id")) {
	problems.push(
		`${BUILD_BINARIES_REL}: product targets are no longer staged into ${STAGED_DIR}/ (one directory beside zetacode)`,
	);
}

const github = parse(read(GITHUB_WORKFLOW_REL)) as Workflow;
const githubJobs = github.jobs ?? {};
const matrixTargets = (githubJobs.release_product_binaries?.strategy?.matrix?.include ?? []).map(
	entry => entry.target_id ?? "",
);
for (const target of productTargets) {
	if (!matrixTargets.includes(target.id)) {
		problems.push(
			`${GITHUB_WORKFLOW_REL}: release_product_binaries does not build ${target.id} — ${BUILD_BINARIES_REL} declares a leg the release never stages`,
		);
	}
}

// 3. Release archives — every family uploads.
const uploadSpec = githubJobs.release_github?.steps?.find(step => step.name === "Create GitHub Release")?.with?.files;
const uploaded = typeof uploadSpec === "string" ? uploadSpec : "";

// 3b. The three release-asset surfaces must agree: what `Create GitHub
// Release` uploads, what "Generate checksums" hashes, and what
// "Preflight release assets" refuses to start without. A family missing from
// one of them is invisible until the release run itself: an upload with no
// checksum ships an unverifiable asset, and a preflight that does not name it
// lets the release proceed with a half-built tree.
const checksumStep = githubJobs.release_github?.steps?.find(step => step.name === "Generate checksums")?.run ?? "";
const preflightStep =
	githubJobs.release_github?.steps?.find(step => step.name === "Preflight release assets")?.run ?? "";
const RELEASE_ASSET_SURFACES: ReadonlyArray<{ family: string; checksum: string; preflight: string }> = [
	{ family: `${STAGED_DIR}/zeta-cli-*`, checksum: `${STAGED_DIR}/zeta-cli-*`, preflight: `${STAGED_DIR}/zeta-cli-*` },
	{ family: `${STAGED_DIR}/zeta-ide-*`, checksum: `${STAGED_DIR}/zeta-ide-*`, preflight: `${STAGED_DIR}/zeta-ide-*` },
	{
		family: "packages/browser-relay/dist/zeta-browser-relay-extension.zip",
		checksum: "packages/browser-relay/dist/zeta-browser-relay-extension.zip",
		preflight: "packages/browser-relay/dist/zeta-browser-relay-extension.zip",
	},
	// The example-plugin environment ships as a release asset (a runnable
	// teaching artifact, not a source tarball) and is produced by
	// scripts/build-example-plugin-zip.ts as `zeta-plugin-example-<version>.zip`.
	{
		family: "plugins/dist/zeta-plugin-example-*.zip",
		checksum: "plugins/dist/zeta-plugin-example-*.zip",
		preflight: "plugins/dist/zeta-plugin-example-*.zip",
	},
	{ family: "LICENSE", checksum: "LICENSE", preflight: "LICENSE" },
	{ family: "THIRD-PARTY-NOTICES.txt", checksum: "THIRD-PARTY-NOTICES.txt", preflight: "THIRD-PARTY-NOTICES.txt" },
];
for (const asset of RELEASE_ASSET_SURFACES) {
	if (!uploaded.includes(asset.family)) {
		problems.push(`${GITHUB_WORKFLOW_REL}: Create GitHub Release does not upload ${asset.family}`);
	}
	if (!checksumStep.includes(asset.checksum)) {
		problems.push(
			`${GITHUB_WORKFLOW_REL}: Generate checksums does not hash ${asset.checksum} — the uploaded asset ships without a SHA256SUMS entry`,
		);
	}
	if (!preflightStep.includes(asset.preflight)) {
		problems.push(
			`${GITHUB_WORKFLOW_REL}: Preflight release assets does not check ${asset.preflight} — a missing asset is only discovered after checksums`,
		);
	}
}

// The product binaries ship next to their npm lines, so those jobs must stay
// present: a release that uploads the binaries while an npm line lags is a
// half-release.
for (const companionJob of ["release_npm", "release_ide_packages"]) {
	if (!githubJobs[companionJob]) {
		problems.push(`${GITHUB_WORKFLOW_REL}: the companion publish job ${companionJob} is missing`);
	}
}

// 4. The guard itself must run in both CI mirrors, like check-license-map.ts.
const mirrors: Array<[string, Workflow]> = [
	[GITHUB_WORKFLOW_REL, github],
	[LOCAL_WORKFLOW_REL, parse(read(LOCAL_WORKFLOW_REL)) as Workflow],
];
for (const [workflowRel, workflow] of mirrors) {
	const checkRuns = (workflow.jobs?.check?.steps ?? []).map(step => step.run ?? "").join("\n");
	if (!checkRuns.includes("bun scripts/check-workbench-bundles.ts")) {
		problems.push(`${workflowRel}: the check job does not run \`bun scripts/check-workbench-bundles.ts\``);
	}
}

if (problems.length > 0) {
	console.error("Workbench bundle contract FAILED:");
	for (const problem of problems) console.error(`  - ${problem}`);
	process.exit(1);
}
console.log(
	`Workbench bundles OK: ${leafPins.length} platform leaves pinned and stamped at ${ideLine}, ` +
		`${COMMANDS.length} commands × ${PLATFORMS.length} platforms staged in ${STAGED_DIR}/ and uploaded; ` +
		`${RELEASE_ASSET_SURFACES.length} release assets consistent across upload/checksums/preflight; ` +
		`publish ordered after both companion legs`,
);
