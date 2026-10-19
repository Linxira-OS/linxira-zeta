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
 *   3. Every mirrored job's command **entry-point set** matches on both sides
 *      (`bun run …`, `bun scripts/…`, `bun test …`, `cargo …`, `bazelisk …`,
 *      `go …`). Set equality, not substring containment: a renamed repo script
 *      cannot leave the mirror calling a ghost, and a command the mirror drops
 *      (or grows on its own) fails too. The only allowed asymmetries are the
 *      deliberate ones recorded in `ENTRY_EXCEPTIONS` with a reason.
 *   4. The local workflow must not be able to publish (no release/publish/tag
 *      commands anywhere in it).
 *
 * Runs in the local-ci `check` job (Gitea) and in the GitHub `check` job, so a
 * merge that desyncs the mirror reddens both.
 */
import { readFileSync } from "node:fs";
import { parse } from "yaml";

const GITHUB = ".github/workflows/ci.yml";
const LOCAL = ".gitea/workflows/local-ci.yml";

type Job = { steps?: Array<{ run?: string; uses?: string }> };
type Workflow = { jobs: Record<string, Job> };

/** ci.yml jobs that must never run locally, with the reason they are cut. */
const EXCLUDED: Record<string, string> = {
	// Back in ci.yml with the built-in editor's payload (2026-10-17), so the
	// job must be classified again; `editor_tests` stays retired (its Go suites
	// went with the TTT tree, and termide_tests covers the Rust payload).
	release_editor_packages: "release chain",
	release_metadata: "release chain",
	release_gate: "release chain",
	release_binary: "release chain",
	release_product_binaries: "release chain",
	release_native_leaves: "release chain",
	release_github: "release chain",
	release_npm: "release chain",
	release_ide_packages: "release chain",
	release_plugin_packages: "release chain",
	release_plugin_packages_manual: "release chain",
	native_addons_cross: "cross-target leg (darwin/win32 arm64)",
};

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
	termide_tests: "termide_tests",
	main_tests: "main_tests",
	// The local desktop_tests job is the mirror of the GitHub job that carries
	// the cheap web/desktop contracts (desktop `npm test` + the launcher/serve
	// reuse suites); the release-only desktop_linux/windows packaging stays out.
	web_desktop_tests: "desktop_tests",
};

/**
 * Local jobs with no ci.yml counterpart, each with the reason it exists.
 * `preflight`/`toolchains` are the mirror's own scaffolding; the rest cover
 * verification GitHub only performs in the release state.
 */
const LOCAL_ONLY: Record<string, string> = {
	preflight: "mirror scaffolding: refuses tag refs / tagged HEAD",
	toolchains: "mirror scaffolding: persistent toolchain + bun install",
};

/**
 * Mirrored-job entry points the two sides are ALLOWED to differ on, keyed by
 * local job id and then by the entry itself, each with the reason it deviates.
 * The entry-point comparison is set equality, so anything the mirror adds or
 * drops must be recorded here — and a stale row is itself a failure (both sides
 * agreeing again means the exception now hides real drift).
 *
 * Keys use the comparison's own shape: the first three whitespace tokens of a
 * matching `run:` line (`bun scripts/x.ts`, `cargo nextest run`, …).
 */
const ENTRY_EXCEPTIONS: Record<string, Record<string, string>> = {
	bazel_lock: {
		"bun scripts/gen-bazel-lock.ts":
			"GitHub auto-refreshes MODULE.bazel.lock on failure (regenerate + upload the artifact); the mirror only reports the refresh hint — it must never write into the persistent shared workspace",
	},
	native_addons: {
		"bun scripts/bazel-natives.ts $NATIVE_TARGETS":
			"the mirror stages the built addon straight into packages/natives/native/ (no artifact plumbing); GitHub installs it from the uploaded artifact through shell-literal invocations this guard's entry-point regex does not count",
	},
	main_tests: {
		"cargo nextest run":
			"nextest ships in the mirror's persistent toolchain store (per-crate parallelism on one box); GitHub has no nextest",
		"cargo test --workspace":
			"the mirror's `cargo nextest run … || cargo test --workspace` fallback half; GitHub runs it as the primary",
	},
};

const problems: string[] = [];

const github = parse(readFileSync(GITHUB, "utf8")) as Workflow;
const local = parse(readFileSync(LOCAL, "utf8")) as Workflow;

for (const jobId of Object.keys(github.jobs)) {
	if (MIRRORED[jobId]) continue;
	if (!(jobId in EXCLUDED)) problems.push(`${GITHUB}:${jobId} is neither mirrored nor an acknowledged exclusion`);
}
for (const jobId of Object.keys(EXCLUDED)) {
	if (!github.jobs[jobId]) problems.push(`${GITHUB}:${jobId} no longer exists — drop it from the exclusion list`);
}
for (const [githubId, localId] of Object.entries(MIRRORED)) {
	if (!github.jobs[githubId]) problems.push(`${GITHUB}:${githubId} no longer exists — drop it from the mirror map`);
	if (!local.jobs[localId]) problems.push(`${LOCAL}:${localId} is missing (mirror of ${githubId})`);
}
for (const jobId of Object.keys(local.jobs)) {
	if (Object.values(MIRRORED).includes(jobId)) continue;
	if (!(jobId in LOCAL_ONLY)) {
		problems.push(`${LOCAL}:${jobId} has no counterpart in ${GITHUB} — add it to MIRRORED or LOCAL_ONLY`);
	}
}
for (const jobId of Object.keys(LOCAL_ONLY)) {
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

/**
 * Command entry points: the mirror must call the same repo scripts — compared
 * as sets, in both directions. `ENTRY_EXCEPTIONS` is the only way to record a
 * deliberate asymmetry, and it must stay live (a row whose two sides agree
 * again is stale).
 */
const ENTRY_POINT = /^\s*(bun (run|scripts|test)|cargo |bazelisk |go (test|build))/u;

const entryPointsOf = (job: Job): Record<string, true> => {
	const entries: Record<string, true> = {};
	for (const step of job.steps ?? []) {
		for (const line of step.run?.split(/\r?\n/) ?? []) {
			if (!ENTRY_POINT.test(line)) continue;
			entries[line.trim().split(/\s+/).slice(0, 3).join(" ")] = true;
		}
	}
	return entries;
};

for (const [githubId, localId] of Object.entries(MIRRORED)) {
	const githubJob = github.jobs[githubId];
	const localJob = local.jobs[localId];
	if (!githubJob || !localJob) continue; // the missing side is reported above
	const exceptions = ENTRY_EXCEPTIONS[localId] ?? {};
	const onGithub = entryPointsOf(githubJob);
	const onLocal = entryPointsOf(localJob);
	for (const entry of Object.keys(onLocal)) {
		if (!Object.hasOwn(onGithub, entry) && !(entry in exceptions)) {
			problems.push(
				`${LOCAL}:${localId} adds the entry point \`${entry}\` (no counterpart in ${GITHUB}:${githubId}) — mirror it there, or record it in ENTRY_EXCEPTIONS with a reason`,
			);
		}
	}
	for (const entry of Object.keys(onGithub)) {
		if (!Object.hasOwn(onLocal, entry) && !(entry in exceptions)) {
			problems.push(
				`${LOCAL}:${localId} is missing the ${githubId} entry point \`${entry}\` — add the same command there, or record it in ENTRY_EXCEPTIONS with a reason`,
			);
		}
	}
	for (const entry of Object.keys(exceptions)) {
		const present = [Object.hasOwn(onGithub, entry), Object.hasOwn(onLocal, entry)];
		if (present[0] === present[1]) {
			problems.push(
				`${LOCAL}:${localId} ENTRY_EXCEPTIONS lists \`${entry}\` but both sides now ${present[0] ? "have" : "lack"} it — drop the stale exception`,
			);
		}
	}
}

if (problems.length > 0) {
	console.error("local-ci parity FAILED:");
	for (const problem of problems) console.error(`  - ${problem}`);
	process.exit(1);
}

console.log(
	`local-ci parity OK: ${Object.keys(MIRRORED).length} mirrored job(s), ${Object.keys(EXCLUDED).length} acknowledged exclusion(s), ${Object.keys(LOCAL_ONLY).length} local-only job(s)`,
);
