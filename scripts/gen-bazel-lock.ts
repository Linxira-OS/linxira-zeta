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
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { collectLockDriftInput, findLockDrift } from "./bazel-lock-drift";

const repoRoot = path.join(import.meta.dir, "..");
const check = process.argv.includes("--check");
const inputsOnly = process.argv.includes("--inputs-only");

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * The lock stores sha256 of the file bytes Bazel sees. On Windows a CRLF
 * checkout hashes differently from the LF blob CI checks out, so a worktree
 * hash comparison can pass locally and fail on Linux. Always compare the
 * committed blob (the bytes CI will see), not the checkout.
 */
function recordedInputMismatches(): string[] {
	let text: string;
	try {
		text = fs.readFileSync(path.join(repoRoot, "MODULE.bazel.lock"), "utf8");
	} catch {
		return ["MODULE.bazel.lock is missing or unreadable"];
	}
	const problems: string[] = [];
	for (const file of ["Cargo.toml", "Cargo.lock"]) {
		const recorded = new RegExp(`FILE:@@//${file.replaceAll(".", "\\.")} ([0-9a-f]{64})`).exec(text)?.[1];
		if (!recorded) {
			problems.push(`MODULE.bazel.lock has no recorded hash for ${file}`);
			continue;
		}
		const shown = Bun.spawnSync(["git", "show", `HEAD:${file}`], { cwd: repoRoot, stdout: "pipe", stderr: "pipe" });
		if (shown.exitCode !== 0) {
			problems.push(`cannot read HEAD:${file} (${shown.stderr.toString().trim()})`);
			continue;
		}
		const actual = new Bun.CryptoHasher("sha256").update(shown.stdout).digest("hex");
		if (recorded !== actual) {
			problems.push(
				`MODULE.bazel.lock records ${file} ${recorded} but HEAD has ${actual}; refresh the lock input hash (run bun run gen:bazel-lock)`,
			);
		}
	}
	return problems;
}

/** Prints a coverage failure the way the lock gate reports drift. */
function reportCoverage(problems: string[], heading: string): void {
	console.error(`${heading} Run \`bun run gen:bazel-lock\` and commit the result:`);
	for (const problem of problems) console.error(`  - ${problem}`);
}

// Runs before the bazel lookup: the guard is plain TS, so a stale result is
// reported even where bazelisk is unavailable.
if (check || inputsOnly) {
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
	const inputMismatches = recordedInputMismatches();
	if (inputMismatches.length > 0) {
		for (const problem of inputMismatches) console.error(`gen-bazel-lock: ${problem}`);
		process.exit(1);
	}
	if (inputsOnly) {
		console.log("MODULE.bazel.lock input hashes match HEAD.");
		process.exit(0);
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
//
// `BAZEL_ARGS` lets the Gitea runner pass startup options such as
// `--bazelrc=...`; GitHub leaves it unset and keeps the plain invocation.
const extraArgs = (process.env.BAZEL_ARGS ?? "").trim().split(/\s+/).filter(Boolean);
const args = [...extraArgs, "fetch", "--repo=@crates", `--lockfile_mode=${check ? "error" : "update"}`];

// Windows without Developer Mode cannot create the file symlink cargo-bazel
// uses while splicing workspace crates (`.bazelignore -> %TEMP%/...`). The
// file is not needed for this fetch, so hide it for the duration of the Bazel
// invocation and restore it unconditionally. Linux never enters this path.
let hiddenBazelIgnore: string | undefined;
if (process.platform === "win32") {
	const ignorePath = path.join(repoRoot, ".bazelignore");
	const backupPath = path.join(os.tmpdir(), `.bazelignore.gen-bazel-lock-${process.pid}`);
	try {
		fs.copyFileSync(ignorePath, backupPath);
		fs.unlinkSync(ignorePath);
		hiddenBazelIgnore = backupPath;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			console.warn(`gen-bazel-lock: could not hide .bazelignore (${errorMessage(error)}); continuing`);
		}
	}
}

let code: number;
try {
	const proc = Bun.spawn([bazel, ...args], { cwd: repoRoot, stdio: ["inherit", "inherit", "inherit"] });
	code = await proc.exited;
} finally {
	if (hiddenBazelIgnore) {
		try {
			fs.copyFileSync(hiddenBazelIgnore, path.join(repoRoot, ".bazelignore"));
			fs.unlinkSync(hiddenBazelIgnore);
		} catch (error) {
			console.error(`gen-bazel-lock: failed to restore .bazelignore: ${errorMessage(error)}`);
			process.exitCode = 1;
		}
	}
}
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
