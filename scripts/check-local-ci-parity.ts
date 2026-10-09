/**
 * Local-CI parity guard.
 *
 * `.gitea/workflows/local-ci.yml` is a Linux-only mirror of the verification
 * jobs in `.github/workflows/ci.yml`: same command entry points, minus the
 * release chain and minus every Windows/macOS leg. This guard keeps that
 * honest in both directions:
 *
 *   1. Every ci.yml job is classified — mirrored, deliberately excluded
 *      (release chain / release-gated / non-Linux leg), or **unaccounted
 *      for** (a bug: either the mirror drifted or a list went stale).
 *   2. Every local job is either a mirror or an acknowledged local-only job.
 *   3. Every mirrored job's command entry points (`bun run …`, `bun scripts/…`,
 *      `cargo …`, `bazelisk …`, `go …`) must still appear in the local file,
 *      so a renamed repo script cannot leave the mirror calling a ghost.
 *   4. The local workflow must not be able to publish (no release/publish/tag
 *      commands anywhere in it).
 *
 * Runs inside the local-ci `check` job; GitHub CI is untouched.
 */
import { readFileSync } from "node:fs";
import { parse } from "yaml";

const GITHUB = ".github/workflows/ci.yml";
const LOCAL = ".gitea/workflows/local-ci.yml";

type Job = { steps?: Array<{ run?: string; uses?: string }> };
type Workflow = { jobs: Record<string, Job> };

/** ci.yml jobs that must never run locally, with the reason they are cut. */
const EXCLUDED = new Map<string, string>([
	["release_metadata", "release chain"],
	["release_gate", "release chain"],
	["release_binary", "release chain"],
	["release_product_binaries", "release chain"],
	["release_native_leaves", "release chain"],
	["release_github", "release chain"],
	["release_npm", "release chain"],
	["release_editor_packages", "release chain"],
	["release_main_packages", "release chain"],
	["release_ide_packages", "release chain"],
	// GitHub gates both desktop jobs on `is-release == 'true'`; the packaging
	// half (electron-builder + smoke + artifact upload) is release work. The
	// local mirror still covers the desktop contracts through `desktop_tests`.
	["desktop_linux", "release-gated on GitHub (mirrored in part by desktop_tests)"],
	["desktop_windows", "release-gated on GitHub; Windows leg"],
	["native_addons_cross", "cross-target leg (darwin/win32 arm64)"],
]);

/** ci.yml job id → local-ci job id. */
const MIRRORED: Record<string, string> = {
	check: "check",
	web_ui_build: "web_ui_build",
	bazel_lock: "bazel_lock",
	rust_validate: "rust_validate",
	native_addons: "native_addons",
	test_coding_agent_native: "test_coding_agent_native",
	test_workspace: "test_workspace",
	test_coding_agent_singleton: "test_coding_agent_singleton",
	test_ts_native: "test_ts_native",
	test_coding_agent_ui: "test_coding_agent_ui",
	test_coding_agent_runtime: "test_coding_agent_runtime",
	test_smoke: "test_smoke",
	install_methods: "install_methods",
	editor_tests: "editor_tests",
	termide_tests: "termide_tests",
	main_tests: "main_tests",
};

/**
 * Local jobs with no ci.yml counterpart, each with the reason it exists.
 * `preflight`/`toolchains` are the mirror's own scaffolding; the rest cover
 * verification GitHub only performs in the release state.
 */
const LOCAL_ONLY = new Map<string, string>([
	["preflight", "mirror scaffolding: refuses tag refs / tagged HEAD"],
	["toolchains", "mirror scaffolding: persistent toolchain + bun install"],
	[
		"desktop_tests",
		"desktop_linux is release-gated on GitHub; locally we run its test half (desktop npm test) and leave packaging to the release chain",
	],
]);

const problems: string[] = [];

const github = parse(readFileSync(GITHUB, "utf8")) as Workflow;
const local = parse(readFileSync(LOCAL, "utf8")) as Workflow;

for (const jobId of Object.keys(github.jobs)) {
	if (MIRRORED[jobId]) continue;
	if (!EXCLUDED.has(jobId)) problems.push(`${GITHUB}:${jobId} is neither mirrored nor an acknowledged exclusion`);
}
for (const jobId of EXCLUDED.keys()) {
	if (!github.jobs[jobId]) problems.push(`${GITHUB}:${jobId} no longer exists — drop it from the exclusion list`);
}
for (const [githubId, localId] of Object.entries(MIRRORED)) {
	if (!github.jobs[githubId]) problems.push(`${GITHUB}:${githubId} no longer exists — drop it from the mirror map`);
	if (!local.jobs[localId]) problems.push(`${LOCAL}:${localId} is missing (mirror of ${githubId})`);
}
for (const jobId of Object.keys(local.jobs)) {
	if (Object.values(MIRRORED).includes(jobId)) continue;
	if (!LOCAL_ONLY.has(jobId)) {
		problems.push(`${LOCAL}:${jobId} has no counterpart in ${GITHUB} — add it to MIRRORED or LOCAL_ONLY`);
	}
}
for (const jobId of LOCAL_ONLY.keys()) {
	if (!local.jobs[jobId]) problems.push(`${LOCAL}:${jobId} is listed local-only but missing`);
}

// Release semantics must be unreachable from the local workflow.
for (const forbidden of ["release_", "publish", "npm publish", "tag -f", "git push"]) {
	for (const [jobId, job] of Object.entries(local.jobs)) {
		for (const step of job.steps ?? []) {
			if (step.run?.includes(forbidden))
				problems.push(`${LOCAL}:${jobId} references "${forbidden}" — local CI never publishes`);
		}
	}
}

// Command entry points: the mirror must call the same repo scripts.
const commandOf = (job: Job): string[] =>
	(job.steps ?? [])
		.flatMap(step => step.run?.split(/\r?\n/) ?? [])
		.filter(line => /^\s*(bun (run|scripts|test)|cargo |bazelisk |go (test|build))/u.test(line));

for (const [githubId, localId] of Object.entries(MIRRORED)) {
	const githubJob = github.jobs[githubId];
	const localJob = local.jobs[localId];
	if (!githubJob || !localJob) continue;
	const localText = (localJob.steps ?? []).map(step => step.run ?? "").join("\n");
	for (const command of commandOf(githubJob)) {
		const entry = command.trim().split(/\s+/).slice(0, 3).join(" ");
		if (!localText.includes(entry)) {
			problems.push(`${LOCAL}:${localId} is missing the ${githubId} entry point \`${entry}\``);
		}
	}
}

if (problems.length > 0) {
	console.error("local-ci parity FAILED:");
	for (const problem of problems) console.error(`  - ${problem}`);
	process.exit(1);
}

console.log(
	`local-ci parity OK: ${Object.keys(MIRRORED).length} mirrored job(s), ${EXCLUDED.size} acknowledged exclusion(s), ${LOCAL_ONLY.size} local-only job(s)`,
);
