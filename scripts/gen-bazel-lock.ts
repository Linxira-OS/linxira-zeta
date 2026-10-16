#!/usr/bin/env bun
/**
 * Refreshes the rules_rust crate_universe entry in `MODULE.bazel.lock`.
 *
 * `@crates` has no crate_universe rendering lock, so its module extension is
 * non-reproducible and Bazel stores the full result in MODULE.bazel.lock,
 * keyed by hashes of Cargo.toml, Cargo.lock, every member manifest, and the
 * crate.* tags. While that entry is current, a fresh bazel server reuses it
 * and never evaluates the extension. Once any of those inputs changes (every
 * release bump, every dependency edit), every fresh server re-runs
 * `cargo-bazel splice` instead: ~240 s per CI job, results still correct.
 *
 * Needs bazelisk (or bazel) on PATH. A refresh evaluates the extension once
 * (~1-4 min on a cold cargo cache); `--check` only compares hashes (seconds).
 *
 * The hash comparison cannot see the recorded *result*, so `--check` also runs
 * the crate-coverage guard (`bazel-lock-drift.ts`): a lock whose `recordedInputs`
 * were refreshed while its rendered `generatedRepoSpecs` stayed stale passes the
 * hash check, yet bazel then reuses the stale result and never runs
 * `cargo-bazel splice` — a crate that has meanwhile become a member dependency
 * gets no alias and fails to compile in the native addon jobs.
 *
 * Usage:
 *   bun scripts/gen-bazel-lock.ts          # re-evaluate @crates, rewrite MODULE.bazel.lock
 *   bun scripts/gen-bazel-lock.ts --check  # exit 1 when MODULE.bazel.lock is stale
 */
import * as path from "node:path";
import { collectLockDriftInput, findLockDrift } from "./bazel-lock-drift";

const repoRoot = path.join(import.meta.dir, "..");
const check = process.argv.includes("--check");

/** Prints a coverage failure the way the lock gate reports drift. */
function reportCoverage(problems: string[], heading: string): void {
	console.error(`${heading} Run \`bun run gen:bazel-lock\` and commit the result:`);
	for (const problem of problems) console.error(`  - ${problem}`);
}

// Runs before the bazel lookup: the guard is plain TS, so a stale result is
// reported even where bazelisk is unavailable.
if (check) {
	const problems = findLockDrift(collectLockDriftInput(repoRoot));
	if (problems.length > 0) {
		reportCoverage(
			problems,
			`MODULE.bazel.lock's @crates result lags the manifests (${problems.length} problem${problems.length === 1 ? "" : "s"}); the input hashes cannot see this:`,
		);
		process.exit(1);
	}
}

const bazel = Bun.which("bazelisk") ?? Bun.which("bazel");
if (!bazel) {
	console.error(
		"gen-bazel-lock: bazelisk (or bazel) not found on PATH. Install bazelisk " +
			"(https://github.com/bazelbuild/bazelisk) to refresh MODULE.bazel.lock.",
	);
	process.exit(1);
}

// `fetch --repo=@crates` evaluates exactly the crate_universe extension (and
// whatever it needs), never the build graph.
const args = ["fetch", "--repo=@crates", `--lockfile_mode=${check ? "error" : "update"}`];
const proc = Bun.spawn([bazel, ...args], { cwd: repoRoot, stdio: ["inherit", "inherit", "inherit"] });
const code = await proc.exited;
if (code === 0) {
	if (check) {
		console.log("MODULE.bazel.lock is up to date.");
	} else {
		// The refresh is only a fix if what bazel recorded actually covers the
		// manifests; a re-run that reused a stale result would look like success.
		const problems = findLockDrift(collectLockDriftInput(repoRoot));
		if (problems.length > 0) {
			reportCoverage(
				problems,
				`the refreshed MODULE.bazel.lock still lags the manifests (${problems.length} problem${problems.length === 1 ? "" : "s"}):`,
			);
			process.exitCode = 1;
		} else {
			console.log("MODULE.bazel.lock refreshed; every workspace dependency is rendered.");
		}
	}
} else if (check) {
	console.error(
		"gen-bazel-lock: check failed. If bazel reported `MODULE.bazel.lock is no longer up-to-date`, " +
			"run `bun run gen:bazel-lock` and commit the result.",
	);
} else {
	console.error(`gen-bazel-lock: \`${path.basename(bazel)} ${args.join(" ")}\` exited ${code}`);
}
process.exitCode = code;
