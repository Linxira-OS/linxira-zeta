#!/usr/bin/env bun

import * as path from "node:path";
import { $ } from "bun";
import { $which } from "../packages/utils/src/which";

const repoRoot = path.join(import.meta.dir, "..");

/** Pinned npm package matching flake.lock's bun2nix revision (`0f2a1f…`). */
export const BUN2NIX_NPM_SPEC = "bun2nix@2.1.2";
/**
 * Restamp a `bun.lock` whose `lockfileVersion` is 2 back to 1 so the pinned
 * bun2nix (which rejects anything but version 1) can parse it.
 *
 * Sound because Bun's own writer documents v1→v2 as "only added parse-time
 * strictness on identical content" (src/install/lockfile/bun.lock.rs): the
 * two versions share a byte-identical content format, and Bun never silently
 * upgrades a loaded v1 lockfile. Version 3+ (scoped override objects) does
 * change content, so it throws instead of downgrading.
 */
export function normalizeLockfileVersion(contents: string): string {
	const stamp = /^(\s*"lockfileVersion":\s*)(\d+)(,)/m.exec(contents);
	if (!stamp) throw new Error("bun.lock is missing a lockfileVersion stamp");
	const version = Number(stamp[2]);
	if (version <= 1) return contents;
	if (version > 2) {
		throw new Error(
			`bun.lock is lockfileVersion ${version}, which changes content (scoped overrides) and cannot be downgraded for bun2nix`,
		);
	}
	return `${contents.slice(0, stamp.index)}${stamp[1]}1${stamp[3]}${contents.slice(stamp.index + stamp[0].length)}`;
}

/** Canonicalize generated Nix output to exactly one trailing LF. */
export function normalizeGeneratedNix(contents: string): string {
	return `${contents.replace(/[\r\n]+$/, "")}\n`;
}

/** Rewrite a lockfile in place when Bun 1.4+ stamped it lockfileVersion 2. */
async function normalizeBunLock(lockfile: string): Promise<void> {
	const lockPath = path.resolve(repoRoot, lockfile);
	const contents = await Bun.file(lockPath).text();
	const normalized = normalizeLockfileVersion(contents);
	if (normalized !== contents) await Bun.write(lockPath, normalized);
}

type FindExecutable = (command: string) => string | null;

/** The executable path and invocation mode for the pinned Bun dependency generator. */
export type NixBunDepsGenerator =
	| { kind: "bun2nix"; executable: string }
	| { kind: "nix"; executable: string }
	| { kind: "bunx"; package: typeof BUN2NIX_NPM_SPEC };

/** Resolve the generator needed by releases before they mutate repository state. */
export function resolveNixBunDepsGenerator(findExecutable: FindExecutable = $which): NixBunDepsGenerator {
	const bun2nix = findExecutable("bun2nix");
	if (bun2nix) return { kind: "bun2nix", executable: bun2nix };

	const nix = findExecutable("nix");
	if (nix) return { kind: "nix", executable: nix };

	return { kind: "bunx", package: BUN2NIX_NPM_SPEC };
}

/**
 * The lockfile/expression pair the generator reads and writes. Both default to
 * the checked-in pair; `scripts/check-nix-bun-freshness.ts` points them at a
 * temp directory so it can regenerate without touching tracked files.
 */
export interface NixBunDepsPaths {
	/** Lockfile handed to bun2nix (repo-relative, or absolute). Default `bun.lock`. */
	lockfile?: string;
	/** Expression bun2nix writes (repo-relative, or absolute). Default `nix/bun.nix`. */
	output?: string;
}

/**
 * Regenerate the checked-in Bun dependency expression with the pinned bun2nix
 * input. `-c ../` (copy prefix for workspace/file packages) is fixed: it is
 * what `nix/package.nix` consumes, and it is independent of `output`.
 */
export async function generateNixBunDeps(
	generator: NixBunDepsGenerator = resolveNixBunDepsGenerator(),
	paths: NixBunDepsPaths = {},
): Promise<void> {
	const lockfile = paths.lockfile ?? "bun.lock";
	const output = paths.output ?? "nix/bun.nix";
	await normalizeBunLock(lockfile);
	if (generator.kind === "bun2nix") {
		await $`${generator.executable} -l ${lockfile} -c ../ -o ${output}`.cwd(repoRoot);
	} else if (generator.kind === "nix") {
		await $`${generator.executable} --extra-experimental-features ${"nix-command flakes"} --accept-flake-config develop --command bun2nix -l ${lockfile} -c ../ -o ${output}`.cwd(
			repoRoot,
		);
	} else {
		await $`bunx ${generator.package} -l ${lockfile} -c ../ -o ${output}`.cwd(repoRoot);
	}

	const outputPath = path.resolve(repoRoot, output);
	const contents = await Bun.file(outputPath).text();
	const normalized = normalizeGeneratedNix(contents);
	if (normalized !== contents) await Bun.write(outputPath, normalized);
}

if (import.meta.main) await generateNixBunDeps();
