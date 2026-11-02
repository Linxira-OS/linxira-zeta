#!/usr/bin/env bun
/**
 * Shared release helpers plus the CI watch and dependency-refresh commands.
 *
 * Releases live in `scripts/release-v2.ts`. This entry point is kept only for
 * `watch`, `deps`, and the helpers v2 imports; a version or bump invocation is
 * forwarded to v2 so the retired v1 pipeline cannot run by accident.
 *
 * Usage:
 *   bun scripts/release.ts <version|major|minor|patch>   Forwarded to release-v2
 *   bun scripts/release.ts watch                         Watch CI for current commit
 *   bun scripts/release.ts deps                          Full third-party dependency refresh (bun.lock + Cargo.lock);
 *                                                        land it via PR/main CI before the next release
 */
import { $ } from "bun";
import * as path from "node:path";
import { generateNixBunDeps, resolveNixBunDepsGenerator } from "./gen-nix-bun";

/**
 * Pick the newest Zeta product tag from `git tag --list` output, or null when
 * there is none.
 *
 * ZETA release baselines (v17.2.11, …) live in main history as sync markers —
 * they are integration baselines, never Zeta versions (Zeta semver is
 * decoupled from ZETA's, which currently rides the 17.x line), so they must not
 * gate a Zeta release. Zeta tags are the lightweight tags this script stamps
 * on `chore: bump version to …` commits; filter on that peeled commit subject.
 *
 * Raw ZETA tags fetched for a sync keep upstream's own
 * `chore: bump version to 17.3.x` subject, which matches the bump pattern, so
 * candidates are also rejected by version: anything at major ≥ 10 is upstream's
 * line, never a Zeta product tag.
 *
 * The caller must sort with `--sort=-v:refname` so the first match is the
 * newest.
 */
export function selectLatestZetaTag(tagListOutput: string): string | null {
	for (const line of tagListOutput.split("\n")) {
		if (!line) continue;
		// git's `%00` format emits a real NUL byte; tests also feed literal
		// "%00" strings. Accept either so callers can't be tripped by the
		// shell/git rendering difference.
		const nulSep = line.indexOf("\0");
		const literalSep = line.indexOf("%00");
		const isNul = nulSep !== -1 && (literalSep === -1 || nulSep < literalSep);
		const separator = isNul ? nulSep : literalSep;
		if (separator === -1) continue;
		const name = line.slice(0, separator);
		const rest = isNul ? line.slice(separator + 1) : line.slice(separator + 3);
		// The line is `name%00subject` (lightweight tags) or
		// `name%00subject%00peeledSubject` (annotated tags, where %(subject)
		// is the tag annotation and %(*subject) is the peeled commit subject).
		// A Zeta bump tag is recognized by its commit subject, so match
		// either field.
		const fields = isNul ? rest.split("\0") : rest.split("%00");
		const subject = fields[0] ?? "";
		const peeled = fields[1] ?? "";
		if (/^chore: bump version to v?\d/.test(subject) || /^chore: bump version to v?\d/.test(peeled)) {
			// Raw ZETA tags fetched for a sync carry upstream's own bump subject;
			// reject upstream's version line (major >= 10) so only Zeta tags match.
			const major = Number(name.replace(/^v/, "").split(".")[0]);
			if (Number.isFinite(major) && major < 10) return name;
		}
	}
	return null;
}
/**
 * Strict explicit-version guard: three numeric dot-segments with an optional
 * leading `v` and NO prerelease suffix. Prereleases are rejected because the
 * downstream publish (`scripts/ci-release-publish.ts`) runs `npm publish` with
 * no `--tag`, which would promote a prerelease to the npm `latest` dist-tag —
 * hitting every unqualified install and the `/latest` endpoint `zetacode update`
 * reads. Bump keywords (major/minor/patch) are handled separately and must not
 * be routed through this check.
 *
 * Returns the normalized bare version (leading `v` stripped) when accepted, or
 * `null` when rejected. Callers must use the returned value for all writes so
 * no downstream manifest (package.json, Cargo.toml, tag) ever sees a `v`
 * prefix — Cargo rejects `version = "v17.2.8"`.
 */
export function validateExplicitVersion(version: string): string | null {
	const match = /^v?((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/.exec(version);
	return match ? match[1] : null;
}

function git(args: readonly string[]) {
	return $`git -c core.fsmonitor=false -c core.untrackedCache=false -c fetch.pruneTags=false ${args}`;
}

// =============================================================================
// Shared functions
// =============================================================================

export async function watchCI(commitShaOverride?: string): Promise<boolean> {
	const commitSha = commitShaOverride ?? (await git(["rev-parse", "HEAD"]).text()).trim();
	console.log(`  Commit: ${commitSha.slice(0, 8)}`);

	while (true) {
		const runsOutput = await $`gh run list --commit ${commitSha} --json databaseId,status,conclusion,name`.text();
		const runs: Array<{ databaseId: number; status: string; conclusion: string | null; name: string }> =
			JSON.parse(runsOutput);

		if (runs.length === 0) {
			console.log("  Waiting for CI to start...");
			await Bun.sleep(3000);
			continue;
		}

		// Check job-level status for in-progress runs (fail fast on first job failure)
		const failedJobs: Array<{ workflow: string; job: string; jobId: number; conclusion: string }> = [];
		const inProgressRuns = runs.filter(r => r.status === "in_progress" || r.status === "queued");

		for (const run of inProgressRuns) {
			const jobsOutput = await $`gh run view ${run.databaseId} --json jobs`.quiet().nothrow().text();
			try {
				const { jobs } = JSON.parse(jobsOutput) as {
					jobs: Array<{ name: string; databaseId: number; status: string; conclusion: string | null }>;
				};
				for (const job of jobs) {
					if (job.status === "completed" && job.conclusion !== "success" && job.conclusion !== "skipped") {
						failedJobs.push({
							workflow: run.name,
							job: job.name,
							jobId: job.databaseId,
							conclusion: job.conclusion ?? "unknown",
						});
					}
				}
			} catch {
				// Ignore parse errors
			}
		}

		if (failedJobs.length > 0) {
			console.error("\nCI job failed:");
			for (const f of failedJobs) {
				console.error(`  - ${f.workflow} / ${f.job} (job ${f.jobId}): ${f.conclusion}`);
				// Tail the failed job's log
				const log = await $`gh run view --job ${f.jobId} --log-failed`.quiet().nothrow().text();
				if (log.trim()) {
					const lines = log.trimEnd().split("\n");
					const tail = lines.slice(-20).join("\n");
					console.error(`\n--- Last 20 lines of ${f.job} ---\n${tail}\n`);
				}
			}
			return false;
		}

		// Check workflow-level status
		const pending = runs.filter(r => r.status !== "completed");
		const failed = runs.filter(r => r.status === "completed" && r.conclusion !== "success");
		const passed = runs.filter(r => r.status === "completed" && r.conclusion === "success");

		console.log(`  ${passed.length} passed, ${pending.length} pending, ${failed.length} failed`);

		if (failed.length > 0) {
			console.error("\nCI failed:");
			for (const r of failed) {
				console.error(`  - ${r.name}: ${r.conclusion}`);
				// Fetch failed jobs and tail their logs
				const jobsOutput = await $`gh run view ${r.databaseId} --json jobs`.quiet().nothrow().text();
				try {
					const { jobs } = JSON.parse(jobsOutput) as {
						jobs: Array<{ name: string; databaseId: number; status: string; conclusion: string | null }>;
					};
					for (const job of jobs) {
						if (job.conclusion !== "success" && job.conclusion !== "skipped") {
							const log = await $`gh run view --job ${job.databaseId} --log-failed`.quiet().nothrow().text();
							if (log.trim()) {
								const lines = log.trimEnd().split("\n");
								const tail = lines.slice(-20).join("\n");
								console.error(`\n--- Last 20 lines of ${job.name} (job ${job.databaseId}) ---\n${tail}\n`);
							}
						}
					}
				} catch {
					// Ignore parse errors
				}
			}
			return false;
		}

		if (pending.length === 0) {
			console.log("  All CI checks passed!\n");
			return true;
		}

		await Bun.sleep(5000);
	}
}

// =============================================================================
// Subcommands
// =============================================================================

async function cmdWatch(): Promise<void> {
	console.log("\n=== Watching CI ===\n");
	const success = await watchCI();
	process.exit(success ? 0 : 1);
}

async function cmdDeps(): Promise<void> {
	console.log("\n=== Full dependency refresh ===\n");
	await $`rm -f bun.lock`;
	await $`bun install`;
	await $`cargo generate-lockfile`;
	await generateNixBunDeps(resolveNixBunDepsGenerator());
	await $`bun scripts/gen-clippy-bazelrc.ts`;
	// Cargo.lock changed, so the crate_universe entry in MODULE.bazel.lock is
	// stale; without a refresh every fresh CI bazel server re-splices (~4 min).
	await $`bun scripts/gen-bazel-lock.ts`;
	console.log("\nDependencies refreshed. Land these lockfile changes through a PR (or push to main) and");
	console.log("let CI go green BEFORE the next release; `release` no longer refreshes third-party deps.");
}

/**
 * Run the real release script with the caller's arguments, preserving its exit
 * code. Kept as a child process (rather than a dynamic import) so v2's CLI
 * behavior, output, and `process.exit` calls stay identical to invoking it
 * directly.
 */
async function forwardToV2(args: readonly string[]): Promise<never> {
	const proc = Bun.spawn([process.execPath, path.join(import.meta.dir, "release-v2.ts"), ...args], {
		stdio: ["inherit", "inherit", "inherit"],
	});
	process.exit(await proc.exited);
}

// =============================================================================
// Main
// =============================================================================

if (import.meta.main) {
	const args = process.argv.slice(2);
	const arg = args[0];
	const usage = () => {
		console.error("Usage:");
		console.error("  bun scripts/release.ts <version|major|minor|patch>   Forwarded to release-v2");
		console.error("  bun scripts/release.ts watch                         Watch CI for current commit");
		console.error("  bun scripts/release.ts deps                          Full third-party dependency refresh");
	};

	if (!arg) {
		usage();
		process.exit(1);
	}

	if (arg === "watch") {
		await cmdWatch();
	} else if (arg === "deps") {
		await cmdDeps();
	} else if (arg === "--help" || arg === "-h") {
		usage();
	} else {
		// Everything else is a release request: hand it to the canonical script.
		// v2 validates the version and refuses bump keywords on its own.
		await forwardToV2(args);
	}
}
