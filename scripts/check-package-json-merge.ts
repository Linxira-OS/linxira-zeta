#!/usr/bin/env bun
/**
 * package.json merge-drop guard.
 *
 * `.gitattributes` binds `package.json` and `packages/&#42;/package.json` to
 * `merge=zeta-package` (`scripts/merge-package-json.ts`). That driver rebuilds
 * the merged manifest **from the side being merged in**: the result starts as
 * `other` and only Zeta identity fields, the four dependency sections and
 * `workspaces.catalog` come from `current`. `scripts` therefore arrive
 * wholesale from the merged-in side — so every `scripts` entry a branch added
 * or edited is silently dropped by `git merge main`.
 *
 * 2026-10-14: `check:nix-bun`, `check:relay-assets` and `gen:relay-assets` were
 * lost that way on `chore/nix-bun-freshness-check`; only the workflow's
 * "script not found" error surfaced it, after the push.
 *
 * For every merge commit in `<base>..HEAD` this guard compares each manifest's
 * `scripts` keys before and after that merge and reports a key that the FIRST
 * parent added or changed relative to the two parents' merge-base and that is
 * still absent at HEAD. A later commit that restores the key clears the report:
 * the gate cares about what ships, not about the merge commit itself.
 *
 * Keys the branch did not touch are never reported — a merge taking the
 * upstream rename/removal of a script is the driver's documented behavior, as
 * is upstream winning a key both sides edited. A branch-side *value* edit that
 * the merge reverts is a known blind spot of this guard (see
 * `document/merge-playbook.md`); restore it by hand when it happens.
 *
 * Usage: bun scripts/check-package-json-merge.ts            (base: origin/main)
 *        bun scripts/check-package-json-merge.ts --base <ref>
 */

import * as path from "node:path";
import { $ } from "bun";

const repoRoot = path.resolve(import.meta.dir, "..");

/** A manifest's `scripts` table. */
export type Scripts = Record<string, string>;

/**
 * Keys the first parent changed relative to the merge-base and that neither the
 * merge commit nor HEAD carries — i.e. script entries a merge dropped.
 */
export function droppedScriptKeys(parts: {
	branch: Scripts | undefined;
	ancestor: Scripts | undefined;
	merged: Scripts | undefined;
	head: Scripts | undefined;
}): string[] {
	const branch = parts.branch ?? {};
	const ancestor = parts.ancestor ?? {};
	const merged = parts.merged ?? {};
	const head = parts.head ?? {};
	const dropped: string[] = [];
	for (const [key, value] of Object.entries(branch)) {
		if (ancestor[key] === value) continue; // the branch never touched this key
		if (merged[key] !== undefined) continue; // the merge kept it (driver or manual resolve)
		if (head[key] !== undefined) continue; // a later commit restored it
		dropped.push(key);
	}
	return dropped.sort();
}

interface ManifestScripts {
	/** Repo-relative manifest path. */
	file: string;
	branch: Scripts | undefined;
	ancestor: Scripts | undefined;
	merged: Scripts | undefined;
	head: Scripts | undefined;
}

const MANIFEST = /^(?:packages\/[^/]+\/)?package\.json$/;

async function git(...args: string[]): Promise<string> {
	const result = await $`git ${args}`.cwd(repoRoot).quiet().nothrow();
	if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString().trim()}`);
	return result.stdout.toString();
}

/** `scripts` of `rev:<file>`, or undefined when the manifest (or table) is absent. */
async function scriptsAt(rev: string, file: string): Promise<Scripts | undefined> {
	const result = await $`git show ${`${rev}:${file}`}`.cwd(repoRoot).quiet().nothrow();
	if (result.exitCode !== 0) return undefined;
	try {
		const manifest = JSON.parse(result.stdout.toString()) as { scripts?: Scripts };
		return manifest.scripts ?? {};
	} catch {
		return undefined; // unparseable at this revision: nothing to compare
	}
}

/** Manifests the merge commit carries at the repo root and one level under `packages/`. */
async function manifestsAt(rev: string): Promise<string[]> {
	const tree = await git("ls-tree", "-r", "--name-only", rev);
	return tree
		.split("\n")
		.filter(line => MANIFEST.test(line))
		.sort();
}

/** The ref whose history bounds the scan; `--base` wins, then the PR base ref, then `origin/main`. */
async function resolveBase(explicit: string | undefined): Promise<string | undefined> {
	const candidates = [
		explicit,
		process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : undefined,
		"origin/main",
	];
	for (const [index, candidate] of candidates.entries()) {
		if (!candidate) continue;
		const resolves =
			(await $`git rev-parse --verify --quiet ${candidate}`.cwd(repoRoot).quiet().nothrow()).exitCode === 0;
		if (resolves) return candidate;
		// An explicit `--base` that does not resolve is a typo, not a reason to
		// scan nothing: fail loudly instead of reporting a green no-op.
		if (index === 0) throw new Error(`--base ${candidate} does not resolve to a commit`);
	}
	return undefined;
}

async function main(): Promise<void> {
	const baseIndex = process.argv.indexOf("--base");
	const base = await resolveBase(baseIndex === -1 ? undefined : process.argv[baseIndex + 1]);
	if (!base) {
		console.log(
			"package.json merge guard: no base ref resolved (no --base, no GITHUB_BASE_REF, no origin/main) — nothing to scan",
		);
		return;
	}

	// Merge commits only reachable from HEAD: the merges this branch performed
	// locally before pushing. GitHub's server-side PR merge runs no driver, and
	// merges already in the base were checked when they were proposed.
	const merges = (await git("rev-list", "--merges", `${base}..HEAD`)).split("\n").filter(Boolean);
	if (merges.length === 0) {
		console.log(`package.json merge guard OK: no merge commit in ${base}..HEAD`);
		return;
	}

	// Fail loud instead of reporting a green no-op: a shallow clone hides a
	// merge's parents, and a merge whose parents are unknown cannot be checked.
	// Only reachable once there is something to check, so ordinary local runs in
	// a shallow clone stay green.
	if ((await git("rev-parse", "--is-shallow-repository")).trim() === "true") {
		console.error(
			"package.json merge guard FAILED: shallow repository — run `git fetch --unshallow` first\n" +
				"  (the merges in range cannot be compared against their parents while history is truncated)",
		);
		process.exitCode = 1;
		return;
	}

	const head = (await git("rev-parse", "HEAD")).trim();
	const violations: Array<{ merge: string; subject: string; file: string; keys: string[] }> = [];
	for (const merge of merges) {
		const [parents, subject] = await Promise.all([
			git("rev-list", "--parents", "-n", "1", merge),
			git("log", "-1", "--format=%s", merge),
		]);
		const [, branch, mergedIn] = parents.trim().split(" ");
		if (!branch || !mergedIn) continue;
		const ancestor = (await git("merge-base", branch, mergedIn)).trim();
		for (const file of await manifestsAt(merge)) {
			const parts: ManifestScripts = {
				file,
				branch: await scriptsAt(branch, file),
				ancestor: await scriptsAt(ancestor, file),
				merged: await scriptsAt(merge, file),
				head: await scriptsAt(head, file),
			};
			const keys = droppedScriptKeys(parts);
			if (keys.length > 0) violations.push({ merge: merge.slice(0, 12), subject: subject.trim(), file, keys });
		}
	}

	if (violations.length > 0) {
		console.error("package.json merge guard FAILED:");
		for (const violation of violations) {
			console.error(
				`  - ${violation.merge} "${violation.subject}" dropped ${violation.keys.join(", ")} from ${violation.file}`,
			);
		}
		console.error(
			"\nThe `merge.zeta-package` driver (scripts/merge-package-json.ts) rebuilds the merged manifest from the\n" +
				"merged-in side, so branch-side `scripts` entries do not survive `git merge main`. Restore them\n" +
				"(they must be present at HEAD) — see document/merge-playbook.md step 4.",
		);
		process.exitCode = 1;
		return;
	}

	console.log(
		`package.json merge guard OK: ${merges.length} merge commit(s) in ${base}..HEAD, no branch-side script key dropped`,
	);
}

if (import.meta.main) await main();
