#!/usr/bin/env bun
/**
 * Workbench bundle guard — installing zetawork must install zetacode and
 * zetaide, in every install shape, without reaching for a system-wide install.
 *
 * The three products are one suite but three packages: `@linxiraos/main`
 * (bin `zetawork`) pins `@linxiraos/zeta` (bin `zetacode`) and
 * `@linxiraos/ide` (bin `zetaide`) as same-line **companions** in its
 * `optionalDependencies`. Optional for the same reasons as the platform
 * leaves: the pins are exact (one version line), the binaries stay platform-
 * gated in each product's own leaf, and a companion that is unavailable for
 * the host degrades to one resolver message instead of failing the whole
 * install. A companion therefore can never be "fixed" by copying a binary
 * into another leaf — the pin is the bundle.
 *
 * Nothing else notices when that pin or one of the steps that carries it
 * disappears: every manifest still parses, every test still passes, and the
 * damage only shows up as a user with a workbench and two missing commands.
 * This guard holds all three install shapes:
 *
 *   1. **npm install** — `main/npm/main/package.json` declares both
 *      companions at its own version; each companion manifest exists at that
 *      version, declares its command bin, and resolves its binary from its own
 *      `os`-gated platform leaves (`@linxiraos/{main,ide}-<plat>-x64/bin/…`),
 *      so `node_modules/@linxiraos/` holds the whole suite and a Linux
 *      install never drags a Windows payload.
 *   2. **Staged runtime** — `scripts/ci-release-build-binaries.ts` stages one
 *      binary per command (`zeta-work-*` → zetawork, `zeta-cli-*` →
 *      zetacode, `zeta-ide-*` → zetaide) for linux and win32 into
 *      `packages/coding-agent/binaries/`, and every product target it declares
 *      is actually built by the `release_product_binaries` matrix — so the
 *      staged directory the GUI unpacks holds all three beside `zetawork`.
 *   3. **Release archives** — `release_github` uploads all three families,
 *      and `release_main_packages` runs after `release_npm` (zetacode) and
 *      `release_ide_packages` (zetaide): a launcher published before its
 *      companions only ever exists as an install with two missing commands.
 *
 * Also asserts this guard runs in both CI mirrors (GitHub + Gitea), so a
 * mirror edit cannot quietly drop it.
 *
 * Static and hermetic: reads manifests, two scripts and two workflows. No
 * network, no build.
 *
 * Usage: bun scripts/check-workbench-bundles.ts   (gate mode; exit 0/1)
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "yaml";

const ROOT = path.resolve(import.meta.dir, "..");
const LAUNCHER_REL = "main/npm/main/package.json";
const BUILD_BINARIES_REL = "scripts/ci-release-build-binaries.ts";
const PUBLISH_REL = "scripts/ci-release-publish.ts";
const GITHUB_WORKFLOW_REL = ".github/workflows/ci.yml";
const LOCAL_WORKFLOW_REL = ".gitea/workflows/local-ci.yml";
const MAIN_PUBLISH_REL = ".github/workflows/main-publish.yml";
const STAGED_DIR = "packages/coding-agent/binaries";

/**
 * The workbench distributions and the release binary base name each one
 * carries. This is the contract the launchers encode
 * (`main/npm/main/bin/launch.js` `EXE`, `termide/npm/ide/bin/zetaide.js`
 * `EXE`) and the leaf packages ship.
 */
const WORKBENCH_LEAVES: Record<string, string> = {
	"main/npm/main": "zeta",
	"termide/npm/ide": "termide",
};

/** Release product (`kind: "product"`) → the command it produces. */
const PRODUCT_COMMANDS: Record<string, string> = {
	work: "zetawork",
	ide: "zetaide",
};

const PLATFORMS = ["linux", "win32"] as const;
const COMMANDS = ["zetawork", "zetacode", "zetaide"] as const;

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

const launcher = manifest(LAUNCHER_REL);
const lineVersion = launcher.version;
if (typeof lineVersion !== "string") {
	problems.push(`${LAUNCHER_REL}: no version — the guard cannot anchor the companion pins`);
}

/** Companion pins are the bundle's spec, not read back from the registry. */
const companionPins: ReadonlyArray<{ dir: string; name: string }> = [
	{ dir: "packages/coding-agent", name: "@linxiraos/zeta" },
	{ dir: "termide/npm/ide", name: "@linxiraos/ide" },
];
/** Leaves the two workbench launchers resolve their binaries from. */
const leafPins: ReadonlyArray<{ dir: string; name: string }> = [
	{ dir: "main/npm/main-windows-x64", name: "@linxiraos/main-windows-x64" },
	{ dir: "main/npm/main-linux-x64", name: "@linxiraos/main-linux-x64" },
	{ dir: "termide/npm/ide-windows-x64", name: "@linxiraos/ide-windows-x64" },
	{ dir: "termide/npm/ide-linux-x64", name: "@linxiraos/ide-linux-x64" },
];

// 1. npm install shape — the companions are declared, pinned and resolvable.
if (lineVersion) {
	for (const pin of companionPins) {
		const pinned = launcher.optionalDependencies?.[pin.name];
		if (pinned !== lineVersion) {
			problems.push(
				`${LAUNCHER_REL}: optionalDependencies ${pin.name} is ${pinned ?? "<missing>"}, expected ${lineVersion} — ` +
					"installing zetawork would not install that companion",
			);
		}
		const companionRel = `${pin.dir}/package.json`;
		if (!fs.existsSync(path.join(ROOT, companionRel))) {
			problems.push(`${companionRel}: missing — companion ${pin.name} has no package`);
			continue;
		}
		const companion = manifest(companionRel);
		if (companion.name !== pin.name) {
			problems.push(`${companionRel}: name is ${companion.name ?? "<missing>"}, expected ${pin.name}`);
		}
		if (companion.version !== lineVersion) {
			problems.push(`${companionRel}: ${companion.version ?? "<missing>"} != ${lineVersion} (workbench line)`);
		}
		if (Object.keys(companion.bin ?? {}).length === 0) {
			problems.push(`${companionRel}: no bin — the installed companion could not be launched as a command`);
		}
	}
}

// 1b. Platform leaves: one payload per (product, platform), os-gated so npm
// never materializes a foreign binary, pinned at the line version.
for (const leaf of leafPins) {
	const rel = `${leaf.dir}/package.json`;
	if (!fs.existsSync(path.join(ROOT, rel))) {
		problems.push(`${rel}: missing — a launcher resolves ${leaf.name}`);
		continue;
	}
	const leafManifest = manifest(rel);
	if (lineVersion && leafManifest.version !== lineVersion) {
		problems.push(`${rel}: ${leafManifest.version ?? "<missing>"} != ${lineVersion} (workbench line)`);
	}
	if (Object.keys(leafManifest.optionalDependencies ?? {}).length > 0) {
		// A leaf is a payload, never a launcher: a nested pin would move the
		// binary one package down and the GUI's path walk would stop seeing it.
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
	if (!fs.existsSync(path.join(ROOT, leaf.dir, "bin", exe))) {
		problems.push(`${leaf.dir}/bin/${exe}: missing — the leaf ships no binary for its platform`);
	}
	if (!Array.isArray(leafManifest.files) || !leafManifest.files.includes("bin")) {
		problems.push(`${rel}: files does not include "bin" — npm would publish the leaf without its binary`);
	}
	const parent = manifest(`${parentDir}/package.json`);
	if (lineVersion && parent.optionalDependencies?.[leaf.name] !== lineVersion) {
		problems.push(
			`${parentDir}/package.json: optionalDependencies ${leaf.name} is ${parent.optionalDependencies?.[leaf.name] ?? "<missing>"}, expected ${lineVersion}`,
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
	(stagedPlatforms[command] ??= []).push(target.platform);
}
for (const command of COMMANDS) {
	for (const platform of PLATFORMS) {
		if (!stagedPlatforms[command]?.includes(platform)) {
			problems.push(
				`${BUILD_BINARIES_REL}: no ${platform} release target stages ${command} — the staged runtime and the archives would miss it`,
			);
		}
	}
}
if (!buildSource.includes("path.join(binariesDir, target.id")) {
	problems.push(
		`${BUILD_BINARIES_REL}: product targets are no longer staged into ${STAGED_DIR}/ (one directory beside zetawork)`,
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

// 3. Release archives — every family uploads, after the companions publish.
const uploadSpec = githubJobs.release_github?.steps?.find(step => step.name === "Create GitHub Release")?.with?.files;
const uploaded = typeof uploadSpec === "string" ? uploadSpec : "";
for (const family of [`${STAGED_DIR}/zeta-cli-*`, `${STAGED_DIR}/zeta-work-*`, `${STAGED_DIR}/zeta-ide-*`]) {
	if (!uploaded.includes(family))
		problems.push(`${GITHUB_WORKFLOW_REL}: Create GitHub Release does not upload ${family}`);
}

const mainNeeds = githubJobs.release_main_packages?.needs ?? [];
for (const companionJob of ["release_npm", "release_ide_packages"]) {
	if (!mainNeeds.includes(companionJob)) {
		problems.push(
			`${GITHUB_WORKFLOW_REL}: release_main_packages does not wait for ${companionJob} — the workbench launcher could publish before its companions exist`,
		);
	}
	if (!githubJobs[companionJob]) {
		problems.push(`${GITHUB_WORKFLOW_REL}: the companion publish job ${companionJob} is missing`);
	}
}
if (!read(MAIN_PUBLISH_REL).includes("ci-release-publish.ts --main")) {
	problems.push(
		`${MAIN_PUBLISH_REL}: no \`ci-release-publish.ts --main\` — the workbench npm distribution has no publish step`,
	);
}
const publishSource = read(PUBLISH_REL);
for (const pin of companionPins) {
	if (!publishSource.includes(`"${pin.name}"`)) {
		problems.push(`${PUBLISH_REL}: MAIN_COMPANIONS no longer names ${pin.name} — the --main leg would not verify it`);
	}
}
if (!publishSource.includes(`"main/npm/main"`)) {
	problems.push(`${PUBLISH_REL}: the --main payload no longer includes main/npm/main`);
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
	`Workbench bundles OK: zetawork ${lineVersion} installs ${companionPins.map(pin => pin.name).join(" + ")}; ` +
		`${leafPins.length} platform leaves pinned, ${COMMANDS.length} commands × ${PLATFORMS.length} platforms staged in ${STAGED_DIR}/ and uploaded; ` +
		"publish ordered after both companion legs",
);
