#!/usr/bin/env bun
/**
 * `nix/bun.nix` freshness guard — the local, nix-free half of the flake's
 * `bun-lock` check (`flake.nix` → `checks.<system>.bun-lock`, run by the
 * "Verify generated Bun dependencies" step of `.github/workflows/nix.yml`).
 *
 * `nix/bun.nix` is a generated file: it must be produced from `bun.lock` by the
 * pinned bun2nix. The flake check proves that, but only inside a nix store
 * (minutes, and impossible without nix installed) — PR #181 shipped a stale
 * `nix/bun.nix` and only learned it from a red `Zeta Nix` job.
 *
 * This guard re-runs the SAME generator (`scripts/gen-nix-bun.ts`, including
 * its `bunx bun2nix@2.1.2` fallback) into a temp directory — the tracked files
 * are never touched — and compares bytes with the checked-in expression.
 *
 * Usage: bun run check:nix-bun        (gate mode; exit 0/1)
 * Fix:   bun run gen:nix              (regenerates nix/bun.nix from bun.lock)
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { generateNixBunDeps, normalizeLockfileVersion, resolveNixBunDepsGenerator } from "./gen-nix-bun";
import { reportStale, sameBytes, trackedDiff } from "./generated-freshness";

const repoRoot = path.resolve(import.meta.dir, "..");
/** The tracked lockfile/expression pair this guard compares. */
const LOCKFILE = "bun.lock";
const EXPRESSION = "nix/bun.nix";
const HEADLINE = "nix/bun.nix freshness FAILED:";
const FIX =
	"Fix: bun run gen:nix  (regenerates nix/bun.nix from bun.lock; needs no nix — it falls back to bunx bun2nix@2.1.2)";

/** State of the checked-in lockfile's `lockfileVersion` stamp. */
export type LockfileStamp =
	/** Version ≤ 1: the pinned bun2nix reads it as-is. */
	| { kind: "current" }
	/** Version 2: `bun run gen:nix` restamps it back to 1 before generating. */
	| { kind: "restampable"; reason: string }
	/** Version 3+ or no stamp: nothing in the toolchain can consume it. */
	| { kind: "unstampable"; reason: string };

/** Classify the lockfile stamp the way `generateNixBunDeps` treats it. */
export function lockfileStampState(contents: string): LockfileStamp {
	let normalized: string;
	try {
		normalized = normalizeLockfileVersion(contents);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { kind: "unstampable", reason: `${LOCKFILE} cannot be read by the pinned bun2nix: ${message}` };
	}
	if (normalized === contents) return { kind: "current" };
	return {
		kind: "restampable",
		reason: `${LOCKFILE} is lockfileVersion 2, which the pinned bun2nix rejects (the flake's bun-lock check would fail); \`bun run gen:nix\` restamps it to 1`,
	};
}

/** Read the tracked pair, naming whichever file is missing. */
async function readTracked(): Promise<{ lock: string; expression: Uint8Array }> {
	const lockFile = Bun.file(path.join(repoRoot, LOCKFILE));
	const expressionFile = Bun.file(path.join(repoRoot, EXPRESSION));
	if (!(await lockFile.exists())) throw new Error(`${LOCKFILE} is missing`);
	if (!(await expressionFile.exists())) throw new Error(`${EXPRESSION} is missing`);
	return { lock: await lockFile.text(), expression: await expressionFile.bytes() };
}

async function main(): Promise<void> {
	let committed: { lock: string; expression: Uint8Array };
	try {
		committed = await readTracked();
	} catch (error) {
		return reportStale({
			headline: HEADLINE,
			problems: [error instanceof Error ? error.message : String(error)],
			fix: FIX,
		});
	}

	const stamp = lockfileStampState(committed.lock);
	if (stamp.kind === "unstampable") return reportStale({ headline: HEADLINE, problems: [stamp.reason], fix: FIX });
	const problems: string[] = stamp.kind === "restampable" ? [stamp.reason] : [];

	// Regenerate through the pinned generator into a temp dir. The lockfile copy
	// carries the stamp `bun run gen:nix` would write, so the tracked files stay
	// untouched while the comparison is exactly what the flake check performs.
	const dir = await mkdtemp(path.join(tmpdir(), "zeta-nix-bun-freshness-"));
	const freshLock = path.join(dir, LOCKFILE);
	const freshExpression = path.join(dir, "bun.nix");
	try {
		await Bun.write(freshLock, normalizeLockfileVersion(committed.lock));
		await generateNixBunDeps(resolveNixBunDepsGenerator(), { lockfile: freshLock, output: freshExpression });
		const generated = await Bun.file(freshExpression).bytes();
		if (!sameBytes(committed.expression, generated)) {
			problems.push(
				`${EXPRESSION} does not match what the pinned bun2nix generates from ${LOCKFILE} (checked in: ${committed.expression.byteLength} bytes, generated: ${generated.byteLength} bytes)`,
			);
			const diff = await trackedDiff(repoRoot, EXPRESSION, freshExpression);
			return reportStale({ headline: HEADLINE, problems, fix: FIX, diff: diff || undefined });
		}
	} catch (error) {
		problems.push(`the pinned generator could not run: ${error instanceof Error ? error.message : String(error)}`);
		return reportStale({ headline: HEADLINE, problems, fix: FIX });
	} finally {
		await rm(dir, { recursive: true, force: true });
	}

	if (problems.length > 0) return reportStale({ headline: HEADLINE, problems, fix: FIX });

	console.log(
		`nix/bun.nix is fresh: byte-identical to the pinned bun2nix output for ${LOCKFILE} (${committed.expression.byteLength} bytes)`,
	);
}

if (import.meta.main) await main();
