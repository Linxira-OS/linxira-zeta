#!/usr/bin/env bun
/**
 * Upstream sync impact gate.
 *
 * Runs before any OMP release merge. It verifies the exact tag, the preserved
 * merge-base, and reports the structural and conflict cost without touching the
 * worktree. A clean report is not an approval to merge; it is the evidence the
 * merge owner needs to choose the conflict strategy.
 */
import { spawnSync } from "node:child_process";

interface Args {
	tag: string;
	base?: string;
	json: boolean;
	allowConflicts: boolean;
}

function parseArgs(argv: string[]): Args {
	const args: Args = { tag: "", json: false, allowConflicts: false };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]!;
		if (arg === "--json") args.json = true;
		else if (arg === "--allow-conflicts") args.allowConflicts = true;
		else if (arg === "--tag") args.tag = argv[++i] ?? "";
		else if (arg.startsWith("--tag=")) args.tag = arg.slice("--tag=".length);
		else if (arg === "--base") args.base = argv[++i];
		else if (arg.startsWith("--base=")) args.base = arg.slice("--base=".length);
		else throw new Error(`Unknown argument: ${arg}`);
	}
	if (!args.tag)
		throw new Error(
			"Usage: bun scripts/upstream-sync-audit.ts --tag <vX.Y.Z> [--base <vX.Y.Z>] [--json] [--allow-conflicts]",
		);
	return args;
}

function git(args: string[], allowFailure = false): string {
	const result = spawnSync("git", args, { encoding: "utf8" });
	if (result.status !== 0 && !allowFailure) {
		throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim() || result.stdout.trim()}`);
	}
	return result.stdout.trim();
}

function main(): void {
	const args = parseArgs(process.argv.slice(2));
	if (!/^v\d+\.\d+\.\d+$/.test(args.tag)) throw new Error("--tag must be an exact release tag such as v19.1.0");
	const tagSha = git(["rev-parse", `${args.tag}^{}`]);
	const head = git(["rev-parse", "HEAD"]);
	const mergeBase = git(["merge-base", "HEAD", `${args.tag}^{}`]);
	const status = git(["diff", "--name-status", "--find-renames=50%", mergeBase, `${args.tag}^{}`]);
	const rows = status
		.split("\n")
		.filter(Boolean)
		.map(line => line.split("\t"));
	const counts = { added: 0, deleted: 0, modified: 0, renamed: 0 };
	for (const row of rows) {
		const code = row[0] ?? "";
		if (code.startsWith("A")) counts.added++;
		else if (code.startsWith("D")) counts.deleted++;
		else if (code.startsWith("R")) counts.renamed++;
		else if (code.startsWith("M")) counts.modified++;
	}
	const renamed = rows.filter(row => row[0]?.startsWith("R")).map(row => ({ from: row[1], to: row[2] }));
	const crateRenames = renamed.filter(row => row.from?.startsWith("crates/") || row.to?.startsWith("crates/"));
	const assetsChanged = rows
		.filter(row =>
			["assets/", "desktop/build/", "editor/npm/", "termide/", "packages/natives/native/"].some(prefix =>
				(row[1] ?? row[2] ?? "").startsWith(prefix),
			),
		)
		.map(row => row.slice(1));
	const mergeTree = spawnSync("git", ["merge-tree", "--write-tree", "--messages", "HEAD", `${args.tag}^{}`], {
		encoding: "utf8",
	});
	const conflicts = (mergeTree.stdout.match(/^CONFLICT /gm) ?? []).length;
	const commits = Number(git(["rev-list", "--count", `${mergeBase}..${args.tag}^{}`]));
	const zetaCommits = Number(git(["rev-list", "--count", `${mergeBase}..HEAD`]));
	const report = {
		tag: args.tag,
		tagSha,
		head,
		mergeBase,
		commits,
		zetaCommits,
		changes: counts,
		renames: renamed.length,
		crateRenames: crateRenames.slice(0, 20),
		assetsChanged: assetsChanged.slice(0, 20),
		conflicts,
		gate: conflicts === 0 || args.allowConflicts ? "pass" : "blocked",
	};
	if (args.json) console.log(JSON.stringify(report, null, 2));
	else {
		console.log(`Upstream sync impact: ${args.tag} (${tagSha})`);
		console.log(`  head: ${head}`);
		console.log(`  merge-base: ${mergeBase}`);
		console.log(`  commits: ${commits} upstream, ${zetaCommits} Zeta`);
		console.log(`  changes: +${counts.added} -${counts.deleted} ~${counts.modified} R${counts.renamed}`);
		console.log(`  crate renames: ${crateRenames.length}`);
		console.log(`  asset paths changed: ${assetsChanged.length}`);
		console.log(`  merge-tree conflicts: ${conflicts}`);
		console.log(`  gate: ${report.gate}`);
	}
	if (report.gate === "blocked") process.exitCode = 1;
}

main();
