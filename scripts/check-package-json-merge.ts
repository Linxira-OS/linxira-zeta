#!/usr/bin/env bun
/**
 * package.json merge-drop guard.
 *
 * `.gitattributes` binds `package.json` and `packages/&#42;/package.json` to
 * `merge=zeta-package` (`scripts/merge-package-json.ts`). That driver is a
 * three-way merge: `ZETA_OWNED_PATHS` leaves and Zeta-only leaves (present on
 * the branch side, absent at the base) always keep the branch side's value, and
 * every other leaf follows the base→theirs delta. So the invariant this guard
 * asserts is exact and complete: **no branch-side leaf change may vanish**,
 * outside the documented upstream-wins cases below.
 *
 * It is a real regression detector, not decoration. The 2026-10-15 v18.10.0
 * sync merge (`6f89e908c67`, driver before this rewrite) silently erased:
 *
 *   - `workspaces.packages[1]` = `"plugins/*"` (reverted to the pre-branch list)
 *   - the six Zeta-only scripts `check:nix-bun`, `check:relay-assets`,
 *     `ci:release:publish-web-ui`, `ci:release:publish-plugin`,
 *     `gen:relay-assets`, `gen:brand-art`
 *   - `devDependencies.figlet`
 *   - the exact catalog pins (`@types/bun` `1.4.3` → `^1.3.14`, …)
 *   - `packageManager` `bun@1.4.3` → `bun@>=1.4` (the same regression the v18.9.1
 *     merge produced, and which `chore(release): prepare the 1.2.1 release` had
 *     to restore by hand)
 *   - `scripts.test:py` / `scripts.robomp:install` → the merged-in side's Python
 *     SDK targets, which this tree does not have
 *
 * and reverted the deliberate `tsgo`→`tsc` type-check switch in 17 package
 * manifests besides. A `scripts`-only check cannot see the pin, the catalog or
 * the dependencies; this guard therefore checks *every* leaf, including the
 * leaves inside the sections the driver merges itself (dependency sections, the
 * catalog, the workspace lists) — which is what makes it non-vacuous against the
 * incident above. It shares the driver's policy instead of re-declaring it:
 * `manifestLeaves` and `sameJson` come from `scripts/merge-package-json.ts`, and
 * importing a second hand-maintained copy of either is what would turn this
 * guard into a green no-op.
 *
 * For every merge commit in `<base>..HEAD` this guard compares each manifest's
 * leaves before and after that merge and reports a leaf the FIRST parent added
 * or changed relative to the two parents' merge-base whose branch-side value is
 * still missing (`dropped`) or back to the pre-branch value (`reverted`) at
 * HEAD. A later commit that carries the branch's value at HEAD clears the
 * report: the gate cares about what ships, not about the merge commit itself.
 *
 * Leaves the branch did not touch are never reported — a merge taking the
 * upstream rename/removal of a key is the driver's documented behavior. A leaf
 * *both* sides edited, where upstream's value wins, is likewise accepted: it is
 * indistinguishable from a driver overwrite, so restore it by hand when it
 * happens (see `document/merge-playbook.md`).
 *
 * Usage: bun scripts/check-package-json-merge.ts                       (base: origin/main)
 *        bun scripts/check-package-json-merge.ts --base <ref>
 *        bun scripts/check-package-json-merge.ts --repo <dir>          (default: this repo)
 *        `--repo` points the scan at another checkout — a scratch repo that carries
 *        a reproduction of the incident, or another worktree.
 */

import * as path from "node:path";
import { $ } from "bun";
import { type Manifest, manifestLeaves, sameJson } from "./merge-package-json";

/** A leaf that is genuinely absent, distinct from a leaf whose value is `null`. */
const ABSENT = "<absent>";

/** A manifest leaf whose branch-side state did not survive into HEAD. */
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
 * Leaves where the first parent and the merge-base disagree whose branch-side
 * state did not survive into HEAD:
 *
 * - `dropped` — the branch side has the leaf, the merge left it out and HEAD
 *   still lacks it.
 * - `reverted` — the merge put the pre-branch value back, either undoing an edit
 *   or undoing a deletion (the branch side lacks a leaf the merge-base has).
 *   A later commit carrying the branch-side state at HEAD clears the report.
 */
export function manifestViolations(parts: MergeStates): ManifestViolation[] {
	const branch = manifestLeaves(parts.branch);
	const ancestor = manifestLeaves(parts.ancestor);
	const merged = manifestLeaves(parts.merged);
	const head = manifestLeaves(parts.head);
	const violations: ManifestViolation[] = [];

	// The union, not just the branch's leaves: a branch-side *deletion* is only
	// visible through the merge-base side (the 2026-10-15 merge brought back both
	// `devDependencies.@typescript/native-preview` and its catalog pin, which
	// `chore(toolchain): TypeScript 7 stable tsc + bun 1.4.3` had removed).
	for (const path of new Set([...branch.keys(), ...ancestor.keys()])) {
		const branchValue = branch.get(path);
		const ancestorValue = ancestor.get(path);
		if (sameJson(branchValue, ancestorValue)) continue; // the branch never touched this leaf

		if (branchValue === undefined) {
			// A branch-side deletion survives when the merge keeps the leaf out or
			// takes an upstream value. Bringing the pre-branch value back is the
			// revert; a later commit deleting it again clears it.
			if (!merged.has(path) || !sameJson(merged.get(path), ancestorValue)) continue;
			if (!head.has(path)) continue;
			violations.push({
				kind: "reverted",
				path,
				branchValue: ABSENT,
				mergedValue: JSON.stringify(merged.get(path)) ?? ABSENT,
			});
			continue;
		}

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
		if (sameJson(mergedValue, ancestorValue) && !sameJson(mergedValue, branchValue)) {
			if (sameJson(head.get(path), branchValue)) continue;
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

/** The value of `--flag <value>`, or undefined when the flag is absent. */
function flagValue(flag: string): string | undefined {
	const index = process.argv.indexOf(flag);
	return index === -1 ? undefined : process.argv[index + 1];
}

const repoRoot = path.resolve(flagValue("--repo") ?? path.resolve(import.meta.dir, ".."));

/** Whether `rev`'s commit *and* tree objects are present in this clone. */
async function hasTree(rev: string): Promise<boolean> {
	return (await $`git rev-parse --verify --quiet ${`${rev}^{tree}`}`.cwd(repoRoot).quiet().nothrow()).exitCode === 0;
}

/**
 * Report an unreadable merge and stop, naming the shallow cause when the clone
 * is shallow — the one shape where the missing objects are expected rather than
 * a sign of a broken checkout.
 */
function unreadable(what: string, shallow: boolean): void {
	console.error(
		`package.json merge guard FAILED: ${what}\n` +
			(shallow
				? "  this repository is shallow and the objects above are not present locally — run `git fetch --unshallow` first\n"
				: "  the objects above are missing from this clone — fetch the missing history and re-run\n"),
	);
	process.exitCode = 1;
}

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
	const base = await resolveBase(flagValue("--base"));
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

	// The guard's requirement is that every merge in range and both of its
	// parents are readable *here* — not that the repository is unshallow. A
	// shallow clone that carries the range (this repo's worktrees are exactly
	// that: `temp/sync-*` advertises `--is-shallow-repository` yet holds every
	// object the merge needs) can be checked in full; the 2026-10-16 rung-4 gate
	// turned the old blanket refusal into a red no-op on a runnable guard. An
	// entry whose parents or merge-base are genuinely missing still fails loud
	// below, naming the shallow cause.
	const shallow = (await git("rev-parse", "--is-shallow-repository")).trim() === "true";

	const head = (await git("rev-parse", "HEAD")).trim();
	const violations: Array<{ merge: string; subject: string; file: string; found: ManifestViolation[] }> = [];
	for (const merge of merges) {
		const [parents, subject] = await Promise.all([
			git("rev-list", "--parents", "-n", "1", merge),
			git("log", "-1", "--format=%s", merge),
		]);
		const [, branch, mergedIn] = parents.trim().split(" ");
		if (!branch || !mergedIn) {
			return unreadable(`${merge.slice(0, 12)} does not carry both parents`, shallow);
		}
		const ancestor = (await git("merge-base", branch, mergedIn)).trim();
		// A readable commit is not enough: `manifestAt` reads `rev:<file>` and
		// reports a missing object the same way it reports an absent file, so a
		// truncated clone would compare against "absent" and stay green. Every
		// revision this merge is judged by must carry its tree locally.
		for (const rev of [head, branch, mergedIn, ancestor]) {
			if (!(await hasTree(rev))) {
				return unreadable(`the tree of ${rev.slice(0, 12)} (needed to judge ${merge.slice(0, 12)}) is missing`, shallow);
			}
		}
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
			"\nEvery branch-side leaf outside the upstream-wins cases must survive `merge=zeta-package`\n" +
				"(scripts/merge-package-json.ts: Zeta-owned paths and Zeta-only leaves keep the branch side's\n" +
				"value, everything else follows the base→theirs delta). A leaf reported above means the merge\n" +
				"erased or reverted it: restore it at HEAD with the branch's value — see\n" +
				"document/merge-playbook.md step 4.",
		);
		process.exitCode = 1;
		return;
	}

	console.log(
		`package.json merge guard OK: ${merges.length} merge commit(s) in ${base}..HEAD, no branch-side leaf dropped or reverted`,
	);
}

if (import.meta.main) await main();
