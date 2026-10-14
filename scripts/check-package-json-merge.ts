#!/usr/bin/env bun
/**
 * package.json merge-drop guard.
 *
 * `.gitattributes` binds `package.json` and `packages/&#42;/package.json` to
 * `merge=zeta-package` (`scripts/merge-package-json.ts`). That driver rebuilds
 * the merged manifest **from the side being merged in**: the result starts as
 * `other` and only the paths the driver owns come from `current` — the Zeta
 * identity fields, the four dependency sections (merged key-by-key) and
 * `workspaces.catalog`. Every other path therefore arrives from the merged-in
 * side, so a branch-side leaf `main` lacks is silently dropped and a branch-side
 * *value* edit is silently reverted.
 *
 * The keep-list is imported from the driver itself (`ZETA_IDENTITY_FIELDS`,
 * `DEPENDENCY_SECTIONS`, `DRIVER_MERGED_PATHS`) and never re-declared here: a
 * second, hand-maintained copy drifts the moment the driver's ownership
 * changes, which would turn this guard into a green no-op.
 *
 * Both shapes of that damage are real:
 *   - 2026-10-14: `check:nix-bun`, `check:relay-assets` and `gen:relay-assets`
 *     (leaves under `scripts`) were lost that way on
 *     `chore/nix-bun-freshness-check`; only the workflow's "script not found"
 *     error surfaced it, after the push.
 *   - the v18.9.1 upstream merge replaced the top-level `packageManager` pin
 *     with upstream's `bun@>=1.4` floor (`document/upstream-sync.md`), and the
 *     exact pin had to be restored by hand in
 *     `chore(release): prepare the 1.2.1 release`. `packageManager` is not a
 *     `scripts` entry, so a `scripts`-only guard cannot see it.
 *
 * For every merge commit in `<base>..HEAD` this guard compares each manifest's
 * unowned leaves before and after that merge and reports a leaf the FIRST parent
 * added or changed relative to the two parents' merge-base whose branch-side
 * value is still missing or still reverted at HEAD. A later commit that carries
 * the branch's value at HEAD clears the report: the gate cares about what
 * ships, not about the merge commit itself.
 *
 * Leaves the branch did not touch are never reported — a merge taking the
 * upstream rename/removal of a key is the driver's documented behavior. A leaf
 * *both* sides edited, where upstream's value wins, is likewise accepted: it is
 * indistinguishable from a driver overwrite, so restore it by hand when it
 * happens (see `document/merge-playbook.md`).
 *
 * Usage: bun scripts/check-package-json-merge.ts            (base: origin/main)
 *        bun scripts/check-package-json-merge.ts --base <ref>
 */

import * as path from "node:path";
import { $ } from "bun";
import { DEPENDENCY_SECTIONS, DRIVER_MERGED_PATHS, ZETA_IDENTITY_FIELDS } from "./merge-package-json";

const repoRoot = path.resolve(import.meta.dir, "..");

/** A parsed package.json. */
export type Manifest = Record<string, unknown>;

/** A leaf that is genuinely absent, distinct from a leaf whose value is `null`. */
const ABSENT = "<absent>";

/**
 * Value equality for manifest leaves. `JSON.stringify(undefined)` is
 * `undefined`, so an absent leaf compares equal only to another absent leaf —
 * exactly the "the branch never touched it" test below (every call site must
 * agree on that rule).
 */
function sameValue(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Whether `path` (dotted, relative to the manifest root) is owned by
 * `scripts/merge-package-json.ts`, i.e. rebuilt from the branch side. Exported
 * because it is the guard's whole policy: the driver's constants are the only
 * source of truth for what a merge may overwrite.
 */
export function isDriverOwnedPath(path: string): boolean {
	return (
		path in ZETA_IDENTITY_FIELDS ||
		(DEPENDENCY_SECTIONS as readonly string[]).includes(path) ||
		DRIVER_MERGED_PATHS.some(owned => path === owned || path.startsWith(`${owned}.`))
	);
}

/**
 * Flatten a manifest into its unowned leaves: dotted path → value, stopping at
 * the driver-owned paths. Scalars and arrays are leaves (the driver takes them
 * wholesale from the merged-in side); plain objects are recursed into so a
 * dropped `scripts` entry is visible at the same granularity as a dropped
 * top-level key.
 */
export function manifestLeaves(manifest: Manifest | undefined): Map<string, unknown> {
	const leaves = new Map<string, unknown>();
	const walk = (value: unknown, prefix: string): void => {
		if (value === null || typeof value !== "object" || Array.isArray(value)) {
			leaves.set(prefix, value);
			return;
		}
		for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
			const child = prefix === "" ? key : `${prefix}.${key}`;
			if (isDriverOwnedPath(child)) continue;
			walk(nested, child);
		}
	};
	walk(manifest ?? {}, "");
	return leaves;
}

/** An unowned manifest leaf whose branch-side change did not survive into HEAD. */
export interface ManifestViolation {
	/** `dropped`: the leaf is gone. `reverted`: the leaf carries the pre-branch value again. */
	kind: "dropped" | "reverted";
	/** Dotted path from the manifest root, e.g. `packageManager` or `scripts.check:nix-bun`. */
	path: string;
	/** Branch-side value — the change that was lost (JSON, or `<absent>`). */
	branchValue: string;
	/** What the merge left behind (JSON, or `<absent>`). */
	mergedValue: string;
}

/** The four revisions a merge is judged by. */
export interface MergeStates {
	/** First parent — the branch that performed the merge. */
	branch: Manifest | undefined;
	/** Merge-base of the two parents. */
	ancestor: Manifest | undefined;
	/** The merge commit itself. */
	merged: Manifest | undefined;
	/** HEAD, where a later commit may have restored the leaf. */
	head: Manifest | undefined;
}

/**
 * Leaves the first parent added or changed relative to the merge-base whose
 * branch-side value is absent (`dropped`) or back to the pre-branch value
 * (`reverted`) at HEAD.
 */
export function manifestViolations(parts: MergeStates): ManifestViolation[] {
	const branch = manifestLeaves(parts.branch);
	const ancestor = manifestLeaves(parts.ancestor);
	const merged = manifestLeaves(parts.merged);
	const head = manifestLeaves(parts.head);
	const violations: ManifestViolation[] = [];
	for (const [path, branchValue] of branch) {
		if (sameValue(branchValue, ancestor.get(path))) continue; // the branch never touched this leaf
		if (!merged.has(path)) {
			// The merge dropped the leaf; a later commit carrying it at HEAD clears it.
			if (!head.has(path)) {
				violations.push({
					kind: "dropped",
					path,
					branchValue: JSON.stringify(branchValue) ?? ABSENT,
					mergedValue: ABSENT,
				});
			}
			continue;
		}
		const mergedValue = merged.get(path);
		// branchValue !== ancestorValue (the `continue` above), so a merged value
		// equal to the ancestor's is the pre-branch value restored by the merge.
		// A later commit putting the branch's value back at HEAD clears it.
		if (sameValue(mergedValue, ancestor.get(path)) && !sameValue(mergedValue, branchValue)) {
			if (sameValue(head.get(path), branchValue)) continue;
			violations.push({
				kind: "reverted",
				path,
				branchValue: JSON.stringify(branchValue) ?? ABSENT,
				mergedValue: JSON.stringify(mergedValue) ?? ABSENT,
			});
		}
	}
	return violations.sort((a, b) => a.path.localeCompare(b.path) || a.kind.localeCompare(b.kind));
}

interface MergeManifests {
	/** Repo-relative manifest path. */
	file: string;
	branch: Manifest | undefined;
	ancestor: Manifest | undefined;
	merged: Manifest | undefined;
	head: Manifest | undefined;
}

const MANIFEST = /^(?:packages\/[^/]+\/)?package\.json$/;

async function git(...args: string[]): Promise<string> {
	const result = await $`git ${args}`.cwd(repoRoot).quiet().nothrow();
	if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString().trim()}`);
	return result.stdout.toString();
}

/** The manifest at `rev:<file>`, or undefined when the file is absent or unparseable. */
async function manifestAt(rev: string, file: string): Promise<Manifest | undefined> {
	const result = await $`git show ${`${rev}:${file}`}`.cwd(repoRoot).quiet().nothrow();
	if (result.exitCode !== 0) return undefined;
	try {
		return JSON.parse(result.stdout.toString()) as Manifest;
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
	const violations: Array<{ merge: string; subject: string; file: string; found: ManifestViolation[] }> = [];
	for (const merge of merges) {
		const [parents, subject] = await Promise.all([
			git("rev-list", "--parents", "-n", "1", merge),
			git("log", "-1", "--format=%s", merge),
		]);
		const [, branch, mergedIn] = parents.trim().split(" ");
		if (!branch || !mergedIn) continue;
		const ancestor = (await git("merge-base", branch, mergedIn)).trim();
		for (const file of await manifestsAt(merge)) {
			const parts: MergeManifests = {
				file,
				branch: await manifestAt(branch, file),
				ancestor: await manifestAt(ancestor, file),
				merged: await manifestAt(merge, file),
				head: await manifestAt(head, file),
			};
			const found = manifestViolations(parts);
			if (found.length > 0) violations.push({ merge: merge.slice(0, 12), subject: subject.trim(), file, found });
		}
	}

	if (violations.length > 0) {
		console.error("package.json merge guard FAILED:");
		for (const violation of violations) {
			for (const entry of violation.found) {
				const detail =
					entry.kind === "dropped"
						? `dropped "${entry.path}" from ${violation.file} (branch had ${entry.branchValue})`
						: `reverted "${entry.path}" in ${violation.file} (branch had ${entry.branchValue}, merge left ${entry.mergedValue})`;
				console.error(`  - ${violation.merge} "${violation.subject}" ${detail}`);
			}
		}
		console.error(
			"\nThe `merge.zeta-package` driver (scripts/merge-package-json.ts) rebuilds the merged manifest from\n" +
				"the merged-in side, so only the paths it owns (Zeta identity fields, the four dependency sections,\n" +
				"`workspaces.catalog`) survive a `git merge main` from the branch side. Restore the leaf with the\n" +
				"branch's value and keep it at HEAD — see document/merge-playbook.md step 4.",
		);
		process.exitCode = 1;
		return;
	}

	console.log(
		`package.json merge guard OK: ${merges.length} merge commit(s) in ${base}..HEAD, no branch-side leaf dropped or reverted`,
	);
}

if (import.meta.main) await main();
