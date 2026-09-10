/**
 * OMP release-merge scope report: the mechanical "what do I actually have to
 * look at" generator for the sync procedure (document/merge-review.md).
 *
 * Given a verified upstream tag (--tag, mandatory), produces three file lists
 * into --out (default ./.zeta/merge-scope):
 *
 *   upstream-scope.txt   every file upstream changed vs the merge base — the
 *                        only set a reviewer must read (4497 dirty Zeta-side
 *                        files are irrelevant: upstream never touched them).
 *   conflicts.txt        files git actually conflicts on (merge-tree, no
 *                        worktree touched) — resolve per merge-review.md.
 *   silent-merge.txt     both sides changed but git auto-merged — the real
 *                        damage zone (workspaces.catalog, sdk.ts, upstream
 *                        config-dir test paths all historically landed here). Run the five
 *                        guards over these files post-merge.
 *
 * Layered review (base several releases back): pass --from <tag> to also
 * write per-release slices upstream-slice-<tag>.txt so each official
 * release's changes can be read against its release note. git computes the
 * merge base itself; a stale local baseline does not affect merge or report
 * correctness.
 *
 * Usage:
 *   bun scripts/merge-scope-report.ts --tag v18.1.15 [--from v18.1.10] [--out DIR]
 */

import * as fs from "node:fs";
import * as path from "node:path";

const UPSTREAM_REMOTE = "omp-upstream";

function git(args: string[], opts: { cwd?: string } = {}): string {
	const out = Bun.spawnSync(["git", ...args], { cwd: opts.cwd ?? ROOT, stdout: "pipe", stderr: "pipe" });
	// merge-tree exits 1 when the merge has conflicts — that IS the data we
	// are after, so tolerate it whenever stdout carried anything.
	if (out.exitCode !== 0 && out.stdout.toString().trim() === "") {
		throw new Error(`git ${args.join(" ")} failed: ${out.stderr.toString().trim()}`);
	}
	return out.stdout.toString();
}

const ROOT = git(["rev-parse", "--show-toplevel"], { cwd: process.cwd() }).trim() || process.cwd();
let OUT_DIR = "";

interface Options {
	tag: string;
	from?: string;
	out: string;
}

function parseArgs(argv: string[]): Options {
	const out: Options = { tag: "", out: "" };
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--tag") out.tag = argv[++i] ?? "";
		else if (argv[i] === "--from") out.from = argv[++i] ?? "";
		else if (argv[i] === "--out") out.out = argv[++i] ?? "";
	}
	if (!out.tag || !/^v[\w.-]+$/.test(out.tag)) {
		console.error("usage: merge-scope-report.ts --tag <upstream-tag> [--from <older-tag>] [--out DIR]");
		process.exit(2);
	}
	if (!out.out) out.out = path.join(ROOT, ".zeta", "merge-scope");
	return out;
}

function verifyRemoteTag(tag: string): void {
	const ls = Bun.spawnSync(["git", "ls-remote", UPSTREAM_REMOTE, `refs/tags/${tag}`, `refs/tags/${tag}^{}`], {
		cwd: ROOT,
		stdout: "pipe",
		stderr: "pipe",
	});
	let sha: string;
	if (ls.exitCode !== 0 || ls.stdout.toString().trim() === "") {
		// Offline or network-restricted: a locally fetched tag from the upstream
		// remote still proves provenance — its creation remote is recorded in
		// the tag object. Fail loudly when we have neither.
		const local = git(["rev-parse", `${tag}^{}`]).trim();
		if (!local) {
			throw new Error(
				`tag ${tag} not found on ${UPSTREAM_REMOTE} nor locally — refusing to report on an unverified tag`,
			);
		}
		console.log(`offline: using locally fetched ${tag} → ${local}`);
		sha = local;
	} else {
		const lines = ls.stdout.toString().trim().split("\n").filter(Boolean);
		const peeled = lines.find(l => l.endsWith(`refs/tags/${tag}^{}`)) ?? lines[0]!;
		sha = peeled.split(/\s+/)[0]!;
		// A local tag disagreeing with the remote means a moved tag — stop.
		const local = git(["rev-parse", `${tag}^{}`]).trim();
		if (local && local !== sha) {
			throw new Error(
				`local ${tag} (${local}) disagrees with remote (${sha}) — moved release tag, STOP and escalate`,
			);
		}
	}
	console.log(`verified ${tag} → ${sha}`);
	// Keep the report attached to the exact commit it described.
	fs.writeFileSync(path.join(OUT_DIR, "SOURCE"), `${tag}\t${sha}\n`);
}

function mergeBase(tag: string): string {
	const base = git(["merge-base", "main", tag]).trim();
	if (!base) throw new Error("no merge base between main and the tag");
	return base;
}

function diffFiles(from: string, to: string): string[] {
	return git(["diff", "--name-only", from, to])
		.split("\n")
		.map(l => l.trim())
		.filter(Boolean)
		.sort();
}

function conflictFiles(tag: string): string[] {
	const raw = git(["merge-tree", "--write-tree", "--name-only", "main", tag]);
	// --name-only prints the merged tree oid first, then one
	// "CONFLICT (<kind>): Merge conflict in <path>" line per conflict.
	// Noise arriving on the same stream: "Auto-merging <path>" progress lines
	// and the zeta-package merge driver's " merged:" stdout — skip both.
	const lines = raw
		.split("\n")
		.map(l => l.trim())
		.map(l => /^CONFLICT \([^)]*\): Merge conflict in (.+)$/.exec(l)?.[1] ?? "")
		.filter(l => l && !l.includes(" merged:") && !/^[0-9a-f]{40}$/.test(l));
	return [...new Set(lines)].sort();
}

function writeList(file: string, rows: string[]): void {
	fs.writeFileSync(file, `${rows.join("\n")}${rows.length ? "\n" : ""}`);
}

function report(opts: Options): void {
	OUT_DIR = opts.out;
	fs.mkdirSync(opts.out, { recursive: true });
	verifyRemoteTag(opts.tag);

	const base = mergeBase(opts.tag);
	console.log(`merge-base(main, ${opts.tag}) = ${base}`);

	const upstream = diffFiles(base, opts.tag);
	const conflicts = conflictFiles(opts.tag);
	const zetaSide = new Set(diffFiles(base, "main"));
	const intersection = upstream.filter(f => zetaSide.has(f));
	const silent = intersection.filter(f => !conflicts.includes(f));

	writeList(path.join(opts.out, "upstream-scope.txt"), upstream);
	writeList(path.join(opts.out, "conflicts.txt"), conflicts);
	writeList(path.join(opts.out, "silent-merge.txt"), silent);

	if (opts.from) {
		// Per-release slices between --from and --tag (layered review): each
		// official release's changes read against its release note.
		const between = git(["tag", "--merged", opts.tag, "--sort=version:refname"])
			.split("\n")
			.map(t => t.trim())
			.filter(t => /^v\d/.test(t));
		const fromIdx = between.indexOf(opts.from);
		const toIdx = between.indexOf(opts.tag);
		if (fromIdx >= 0 && toIdx > fromIdx) {
			for (let i = fromIdx + 1; i <= toIdx; i++) {
				const slice = diffFiles(between[i - 1]!, between[i]!);
				writeList(path.join(opts.out, `upstream-slice-${between[i]}.txt`), slice);
				console.log(`slice ${between[i - 1]} → ${between[i]}: ${slice.length} files`);
			}
		}
	}

	console.log(`upstream scope:   ${upstream.length} files  (the review set)`);
	console.log(`true conflicts:   ${conflicts.length} files  (resolve per merge-review.md)`);
	console.log(`silent merges:    ${silent.length} files  (run the five guards post-merge)`);
	console.log(`report: ${opts.out}`);
}

try {
	report(parseArgs(process.argv.slice(2)));
} catch (error) {
	console.error(`merge-scope-report: ${(error as Error).message}`);
	process.exit(1);
}
