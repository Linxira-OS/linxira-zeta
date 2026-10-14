#!/usr/bin/env bun
/**
 * Shared plumbing for the committed-generated-file freshness guards
 * (`scripts/check-nix-bun-freshness.ts`, `scripts/check-extension-assets-freshness.ts`).
 *
 * A guard regenerates the file through the SAME derivation the generator uses
 * (into a temp dir — tracked files are never touched) and compares bytes. The
 * pieces that are identical across guards live here: byte equality, the diff
 * the failure report carries, and the report shape.
 *
 * Not a CLI: the two `check-*-freshness.ts` scripts own that.
 */
import { $ } from "bun";
import { $which } from "../packages/utils/src/which";

/** Byte equality — the cheap checks in this family diff bytes, so a text re-encode cannot hide a difference. */
export function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return false;
	return true;
}

/** Line budget for one report: stale output is usually one changed block, not a rewrite. */
const MAX_DIFF_LINES = 80;

/**
 * Unified diff of a tracked file against a freshly generated one, through git
 * (`--no-index` needs no repository state). Returns "" when git is unavailable
 * or the two files share no hunk — the guard still fails, just without a diff.
 */
export async function trackedDiff(repoRoot: string, trackedPath: string, freshPath: string): Promise<string> {
	if (!$which("git")) return "";
	const result = await $`git diff --no-index --no-color --unified=3 -- ${trackedPath} ${freshPath}`
		.cwd(repoRoot)
		.quiet()
		.nothrow();
	// Keep the hunks: git labels them with the temp path (`b/C:\…`), which is
	// noise for the reader, so this header names the tracked file alone.
	const lines = result.stdout
		.toString()
		.split("\n")
		.filter(line => line.length > 0);
	const firstHunk = lines.findIndex(line => line.startsWith("@@"));
	if (firstHunk === -1) return "";
	const hunks = lines.slice(firstHunk);
	const shown =
		hunks.length <= MAX_DIFF_LINES
			? hunks
			: [...hunks.slice(0, MAX_DIFF_LINES), `… ${hunks.length - MAX_DIFF_LINES} more diff line(s)`];
	return [`--- ${trackedPath} (checked in)`, `+++ ${trackedPath} (regenerated)`, ...shown].join("\n");
}

export interface StaleReport {
	/** First line, e.g. `nix/bun.nix freshness FAILED:`. */
	headline: string;
	/** One line per symptom. */
	problems: string[];
	/** The single command that resolves every symptom. */
	fix: string;
	/** Optional unified diff of the tracked file against the regenerated one. */
	diff?: string;
}

/** Print a freshness failure and mark the process failed. */
export function reportStale(report: StaleReport): void {
	console.error(`${report.headline}\n  - ${report.problems.join("\n  - ")}\n${report.fix}`);
	if (report.diff) console.error(`\n${report.diff}`);
	process.exitCode = 1;
}
