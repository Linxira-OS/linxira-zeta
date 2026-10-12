#!/usr/bin/env bun
/**
 * Wait for CI on an explicit commit SHA to converge green.
 *
 * Usage:
 *   bun scripts/watch-ci.ts <sha>
 *
 * Thin CLI over `watchCI` (scripts/release.ts). It polls *every* workflow run
 * for the commit — not a single run — and only reports success once all of them
 * are completed with no failing run/job. That all-runs convergence is what
 * stops a lone single-job flake evaluator (which may finish green first) from
 * being mistaken for a fully green commit. The only difference from
 * `bun scripts/release.ts watch` is the explicit SHA: `watchCI` otherwise
 * resolves `HEAD` itself.
 */
import { watchCI } from "./release";

const commitSha = process.argv[2];
if (!commitSha) {
	console.error("usage: bun scripts/watch-ci.ts <sha>");
	process.exit(2);
}

const success = await watchCI(commitSha);
process.exit(success ? 0 : 1);
