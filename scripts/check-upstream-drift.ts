#!/usr/bin/env bun
/**
 * Upstream drift report and pre-merge warning gate.
 *
 * `check-merge-lineage.ts` proves a named tag is safe to merge. This script
 * answers the earlier question: what changed upstream since the last integrated
 * tag, and does the increment contain contract-level removals? It never merges
 * and never accepts a branch or raw SHA.
 *
 * Usage:
 *   bun scripts/check-upstream-drift.ts --tag v19.2.1
 *   bun scripts/check-upstream-drift.ts --tag v19.2.1 --json
 *   bun scripts/check-upstream-drift.ts --tag v19.2.1 --fail-on-breaking
 *
 * Exit 0 for a readable report, 1 for an invalid tag/baseline/lineage, and
 * (with --fail-on-breaking) 1 when the increment removes public exports or
 * carries `BREAKING CHANGE`/`!:` commits.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const REMOTE = "omp-upstream";
const LEDGER = "document/upstream-sync.md";
const CONTRACT_ROOTS = [
	"packages/coding-agent/src",
	"packages/ai/src",
	"packages/catalog/src",
	"packages/agent/src",
	"packages/tui/src",
];

const args = process.argv.slice(2);
const json = args.includes("--json");
const failOnBreaking = args.includes("--fail-on-breaking");
const tagIndex = args.indexOf("--tag");
const tag = tagIndex === -1 ? undefined : args[tagIndex + 1];

function git(argv: string[], allowFail = false): string {
	try {
		return execFileSync("git", argv, { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 }).trim();
	} catch (error) {
		if (allowFail) return "";
		const stderr =
			error && typeof error === "object" && "stderr" in error && typeof error.stderr === "string"
				? error.stderr
				: undefined;
		throw new Error(`git ${argv.join(" ")} failed${stderr ? `: ${stderr}` : ""}`);
	}
}

function gitSucceeds(argv: string[]): boolean {
	try {
		execFileSync("git", argv, { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

function fail(message: string): never {
	console.error(`check-upstream-drift: ${message}`);
	process.exit(1);
}

if (!tag || !/^v\d+\.\d+\.\d+(?:[-+].+)?$/.test(tag)) {
	fail("pass an upstream release tag, e.g. --tag v19.2.1 (branches and raw SHAs are rejected)");
}
if (git(["ls-remote", "--heads", REMOTE, `refs/heads/${tag}`], true) !== "") {
	fail(`"${tag}" is a branch, not a release tag`);
}

const ledger = readFileSync(LEDGER, "utf8");
const integrated = /\*\*Integrated through\*\*:\s*`(v[\w.]+)`/.exec(ledger)?.[1];
if (!integrated) fail(`${LEDGER} has no "Integrated through" tag`);

const remoteTag = git(["ls-remote", "--tags", REMOTE, `refs/tags/${tag}`, `refs/tags/${tag}^{}`], true);
if (!remoteTag) fail(`${tag} is not advertised by ${REMOTE}`);
const remoteLines = remoteTag.split("\n").map(line => line.split("\t"));
const remotePeeled =
	remoteLines.find(([, ref]) => ref === `refs/tags/${tag}^{}`)?.[0] ??
	remoteLines.find(([, ref]) => ref === `refs/tags/${tag}`)?.[0];
if (!remotePeeled) fail(`${tag} has no commit advertised by ${REMOTE}`);

const localTag = git(["rev-parse", `${tag}^{commit}`], true);
if (!localTag) {
	console.error(`check-upstream-drift: ${tag} is not fetched locally; fetching tag only`);
	git(["fetch", "--force", REMOTE, "--no-filter", "tag", tag]);
}
const candidate = git(["rev-parse", `${tag}^{commit}`]);
const baseline = git(["rev-parse", `${integrated}^{commit}`], true);
if (!baseline) fail(`baseline ${integrated} is not present locally`);

const alreadyMerged = gitSucceeds(["merge-base", "--is-ancestor", candidate, "HEAD"]);
const baselineAncestor = gitSucceeds(["merge-base", "--is-ancestor", baseline, "HEAD"]);

const commits = Number(git(["rev-list", "--count", `${integrated}..${tag}`], true) || "0");
const shortstat = git(["diff", "--shortstat", integrated, tag], true);
const names = git(["diff", "--name-only", integrated, tag], true).split("\n").filter(Boolean);
const hotspots = new Map<string, number>();
for (const path of names) {
	const key = path.split("/").slice(0, 2).join("/");
	hotspots.set(key, (hotspots.get(key) ?? 0) + 1);
}
const topHotspots = [...hotspots].sort((a, b) => b[1] - a[1]).slice(0, 12);

const messages = git(["log", "--format=%s%n%b%n---", `${integrated}..${tag}`], true);
const breakingCommits = messages
	.split("\n---\n")
	.map(block => block.trim())
	.filter(block => /(^|\n)[a-z]+(\([^)]*\))?!:|BREAKING[ -]CHANGE/i.test(block))
	.map(block => block.split("\n")[0]);

const exportDiff = git(
	["diff", "-U0", integrated, tag, "--", ...CONTRACT_ROOTS, ":(exclude)**/*.test.ts", ":(exclude)**/*.spec.ts"],
	true,
);
const removedExports = new Set<string>();
for (const line of exportDiff.split("\n")) {
	if (!line.startsWith("-export ")) continue;
	const name =
		/\b(?:function|class|const|let|var|type|interface|enum)\s+([A-Za-z_$][\w$]*)/.exec(line)?.[1] ??
		/\bexport\s*\{\s*([^}]+)\}/
			.exec(line)?.[1]
			?.split(",")[0]
			?.trim()
			.replace(/\s+as\s+.*/, "");
	if (name) removedExports.add(name);
}

const result = {
	tag,
	remote: REMOTE,
	candidate,
	baseline: integrated,
	baselineCommit: baseline,
	alreadyMerged,
	baselineAncestor,
	commits,
	shortstat,
	files: names.length,
	topHotspots: Object.fromEntries(topHotspots),
	breakingCommits,
	removedExports: [...removedExports].sort(),
};

if (json) {
	console.log(JSON.stringify(result, null, 2));
} else {
	console.log(`\nUpstream drift: ${integrated} -> ${tag}`);
	console.log("=".repeat(48));
	console.log(`candidate     ${candidate}`);
	console.log(`baseline      ${baseline} (${integrated})`);
	console.log(`already merged ${alreadyMerged ? "yes — informational only" : "no"}`);
	console.log(`lineage       ${baselineAncestor ? "baseline is an ancestor of HEAD" : "BASELINE NOT IN HEAD"}`);
	console.log(`window        ${commits} commit(s), ${names.length} file(s)`);
	console.log(`shortstat     ${shortstat || "(none)"}`);
	console.log("\ntop hotspots");
	for (const [path, count] of topHotspots) console.log(`  ${String(count).padStart(4)}  ${path}`);
	if (breakingCommits.length > 0) {
		console.log("\nbreaking commits");
		for (const subject of breakingCommits) console.log(`  ${subject}`);
	}
	if (removedExports.size > 0) {
		console.log("\nremoved export lines in contract roots");
		for (const name of [...removedExports].sort()) console.log(`  ${name}`);
	}
	console.log("");
}

if (!baselineAncestor) fail(`${integrated} is not an ancestor of HEAD — run check-merge-lineage.ts before merging`);
if (failOnBreaking && (breakingCommits.length > 0 || removedExports.size > 0)) {
	fail(`increment contains ${breakingCommits.length} breaking commit(s) and ${removedExports.size} removed export(s)`);
}
