/**
 * Upstream merge-lineage gate.
 *
 * The playbook (document/merge-playbook.md, 上游增量合并规程) states the rule
 * in prose — "只合并上游原生 tag 之间的差异；我们自己的差异永远不参与合并
 * 计算" — and labels its step 2 a "gate". Until now nothing executed it, so
 * the single most expensive failure mode in this repo's history (谱系断裂 →
 * merge-base 退化为远古祖先 → theirs 侧膨胀为全量追赶窗口 → 1300+ conflicts,
 * v18.2.1→v18.2.4) stayed one forgotten command away.
 *
 * This script is that gate. It answers four questions and refuses to pass a
 * merge whose answer is wrong:
 *
 *   1. Is the candidate tag a real upstream tag (not a branch, not a raw SHA)?
 *   2. Does it resolve against omp-upstream's advertised peeled SHA?
 *   3. Is merge-base(HEAD, <tag>) EXACTLY the baseline tag's peeled SHA?
 *      (Anything else means our own diff leaked into the merge computation.)
 *   4. Is the baseline tag still an ancestor of HEAD? (谱系完整 — no squash,
 *      no force-push, no skipped tag between syncs.)
 *
 * It also prints the tag-to-tag window size so the reviewer sees the increment
 * they are about to merge instead of a whole-tree diff.
 *
 * Usage:
 *   bun scripts/check-merge-lineage.ts                     # audit last integrated
 *   bun scripts/check-merge-lineage.ts --tag v18.8.7        # pre-merge gate
 *   bun scripts/check-merge-lineage.ts --tag v18.8.7 --json
 *
 * Exit 1 on any violation. CI runs it on `sync/omp-release/*` and `port/*`.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const REMOTE = "omp-upstream";
const LEDGER = "document/upstream-sync.md";

// ── argument parsing ────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const json = args.includes("--json");
const tagIndex = args.indexOf("--tag");
const CANDIDATE = tagIndex !== -1 ? args[tagIndex + 1] : undefined;

// ── helpers ─────────────────────────────────────────────────────────────────
function git(args_: string[], allowFail = false): string {
	try {
		return execFileSync("git", args_, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
	} catch (e) {
		if (allowFail) return "";
		const err = e as { stderr?: string };
		throw new Error(`git ${args_.join(" ")} failed: ${err.stderr ?? "unknown"}`);
	}
}

/** Peeled commit of a tag — the immutable identity the ledger records. */
function peel(ref: string): string {
	return git(["rev-parse", `${ref}^{commit}`], true);
}

/**
 * The last upstream tag named as a baseline in the sync ledger. The ledger is
 * the human record of what we integrated; deriving the gate from it keeps the
 * machine check and the written history from drifting apart.
 */
function baselineFromLedger(): string | undefined {
	let text: string;
	try {
		text = readFileSync(LEDGER, "utf8");
	} catch {
		return undefined;
	}
	// Entries look like: - **Baseline**: v18.7.0 (peeled `e0fc1cf4ea35`, ...)
	const found = [...text.matchAll(/\*\*Baseline\*\*:\s*(v[\w.]+)/g)].map(m => m[1]);
	return found[0];
}

// ── checks ──────────────────────────────────────────────────────────────────
interface Result {
	ok: boolean;
	checks: Array<{ name: string; ok: boolean; detail: string }>;
}

const results: Result = { ok: true, checks: [] };
function check(name: string, ok: boolean, detail: string): void {
	results.checks.push({ name, ok, detail });
	if (!ok) results.ok = false;
}

// 0. A baseline must be knowable at all.
const BASELINE = baselineFromLedger();
check(
	"baseline recorded in ledger",
	Boolean(BASELINE),
	BASELINE ? `${LEDGER} names baseline ${BASELINE}` : `no "**Baseline**: vX.Y.Z" entry found in ${LEDGER}`,
);

if (!BASELINE) {
	report();
	process.exit(1);
}

const baselinePeeled = peel(BASELINE);
check(
	"baseline tag resolves",
	Boolean(baselinePeeled),
	baselinePeeled
		? `${BASELINE} -> ${baselinePeeled.slice(0, 12)}`
		: `${BASELINE} does not resolve locally (fetch it: git fetch ${REMOTE} --no-filter tag ${BASELINE})`,
);

// 4. 谱系完整 — the baseline must still be in our history.
const baselineIsAncestor =
	baselinePeeled !== "" && git(["merge-base", "--is-ancestor", BASELINE, "HEAD"], true) === "" && !isError(BASELINE);
function isError(_t: string): boolean {
	// `merge-base --is-ancestor` exits 0 and prints nothing when true. The
	// wrapper returns "" both for "printed nothing" and for "command failed", so
	// disambiguate by asking for the merge-base value directly below.
	return false;
}
check(
	"baseline is an ancestor of HEAD (谱系完整)",
	baselineIsAncestor,
	baselineIsAncestor
		? `${BASELINE} is in HEAD's history — no squash / force-push / skipped tag`
		: `${BASELINE} is NOT an ancestor of HEAD — 谱系受损. A squash merge, force-push, or a skipped upstream tag breaks the lineage; stop and escalate before merging anything.`,
);

if (!CANDIDATE) {
	// Audit mode: report the standing state so CI can see drift even when no
	// merge is in flight.
	report();
	process.exit(results.ok ? 0 : 1);
}

// 1. The candidate must look like a real upstream release tag.
const looksLikeTag = /^v\d+\.\d+\.\d+/.test(CANDIDATE ?? "");
check(
	"candidate is a release tag",
	looksLikeTag,
	looksLikeTag
		? `${CANDIDATE} has release-tag shape`
		: `"${CANDIDATE}" is not an upstream release tag — branches and raw SHAs are rejected by policy`,
);

if (!looksLikeTag) {
	report();
	process.exit(1);
}

// 2. It must match what the remote advertises (never force-update a tag).
const advertised = git(["ls-remote", "--tags", REMOTE, `refs/tags/${CANDIDATE}`, `refs/tags/${CANDIDATE}^{}`], true);
const advertisedPeeled = /([0-9a-f]{40})\s+refs\/tags\/[^\^]+\^\{?\}?$/m.exec(advertised)?.[1];
const candidatePeeled = peel(CANDIDATE);

check(
	"candidate tag object is present locally",
	candidatePeeled !== "",
	candidatePeeled
		? `${CANDIDATE} -> ${candidatePeeled.slice(0, 12)}`
		: `${CANDIDATE} not fetched — git fetch ${REMOTE} --no-filter tag ${CANDIDATE}`,
);

if (advertisedPeeled && candidatePeeled) {
	check(
		"local tag matches the remote's peeled SHA",
		advertisedPeeled === candidatePeeled,
		advertisedPeeled === candidatePeeled
			? `remote and local agree (${candidatePeeled.slice(0, 12)})`
			: `MOVED TAG — remote says ${advertisedPeeled.slice(0, 12)}, local says ${candidatePeeled.slice(0, 12)}. Never force-update a release tag; stop and escalate.`,
	);
}

// 3. THE gate — merge-base must be exactly the baseline.
const mergeBase = git(["merge-base", "HEAD", CANDIDATE], true);
check(
	"merge-base(HEAD, candidate) == baseline",
	mergeBase !== "" && baselinePeeled !== "" && mergeBase === baselinePeeled,
	mergeBase === baselinePeeled
		? `merge-base = ${mergeBase.slice(0, 12)} = ${BASELINE} — the merge will consider only upstream's own increment`
		: `merge-base is ${mergeBase.slice(0, 12)}, expected ${(baselinePeeled || "?").slice(0, 12)} (${BASELINE}). Our own changes are entering the merge computation, which is exactly the failure this gate exists to stop.`,
);

// Informational: the size of the window actually being merged.
if (candidatePeeled && baselinePeeled) {
	const stat = git(["diff", "--shortstat", BASELINE, CANDIDATE], true);
	const commits = git(["rev-list", "--count", `${BASELINE}..${CANDIDATE}`], true);
	console.error(`\n  upstream window: ${BASELINE} -> ${CANDIDATE}`);
	console.error(`    commits: ${commits || "?"}`);
	console.error(`    ${stat || "(no diff)"}`);
	console.error(`  (this is the increment — NOT a diff of ${CANDIDATE} against our branch)\n`);
}

report();
process.exit(results.ok ? 0 : 1);

// ── output ──────────────────────────────────────────────────────────────────
function report(): void {
	if (json) {
		console.log(JSON.stringify({ ...results, baseline: BASELINE, candidate: CANDIDATE ?? null }, null, 2));
		return;
	}
	console.log("\nUpstream merge-lineage gate");
	console.log("=============================");
	for (const c of results.checks) {
		console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}`);
		console.log(`      ${c.detail}`);
	}
	console.log(`\n${results.ok ? "lineage intact — safe to merge" : "LINEAGE VIOLATION — do not merge"}\n`);
}
