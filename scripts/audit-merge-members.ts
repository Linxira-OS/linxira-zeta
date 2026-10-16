/**
 * Merge member-loss audit.
 *
 * AGENTS damage class 4 is "conflict resolution silently drops Zeta-only
 * code". It happens because taking an upstream file wholesale (or resolving a
 * conflict to "theirs"/"ours") removes members the other side never had, and
 * `check:ts` only reports a handful of unrelated-looking errors — the title
 * subsystem loss during v18.8.7/v18.8.8 produced four such errors while 45
 * members were gone.
 *
 * `git merge-file`/three-way merges are no help: naming the upstream tag as
 * the base declares our members "deleted" and reports zero conflicts while
 * deleting them (document/upstream-sync.md, v18.8.8 entry).
 *
 * This script is the detector. It compares the member set of every
 * `packages/​*​/src` module in a **pre-merge Zeta ref** against the same file in
 * the working tree (or `--against <ref>`) and reports, per file, members
 * that existed before and are gone now.
 *
 * Usage:
 *   bun scripts/audit-merge-members.ts --base <pre-merge-ref>
 *   bun scripts/audit-merge-members.ts --base main --against HEAD
 *   bun scripts/audit-merge-members.ts --base <ref> --tag <upstream-tag> --json
 *
 * `--tag` (default: the ledger's `## Integrated through:` tag) is the upstream
 * release tag whose increment this tree carries. Every member the comparison
 * reports is then judged against that tag — and against the tag it descends
 * from (`merge-base <base> <tag>`, i.e. the previously integrated tag while the
 * lineage is intact):
 *
 *   - the tag still ships it                       → **dropped** (real class-4 loss)
 *   - absent from the tag, present in its parent    → **explained**: upstream
 *     removed or renamed it in this window, so the merge was right to follow
 *   - absent from both tags                         → **dropped**: no upstream
 *     side ever had it, so it is Zeta's own code
 *
 * Without a resolvable tag the classification is unavailable and every finding
 * counts as a drop, exactly as before — a missing ledger must not silently
 * downgrade real damage. That is why the round that added this (v18.11.1:
 * 24 findings, every one upstream's own removal in the window) needed no
 * hand-reconciliation.
 *
 * Exit codes: 0 nothing dropped · 1 members dropped · 2 the audit could not run
 * (unknown ref, git failure, or an extraction that found zero members in the base
 * ref). 2 is deliberately distinct from 0: the shipped version swallowed every
 * failure into an empty member set and printed "0 member(s) dropped" + exit 0 for
 * *every* input, including the v18.10.0 sync merge — the "假绿" that let class-4
 * damage through. A silent clean report is the one output this script must never
 * produce without having compared real members.
 *
 * A member is:
 *   - a top-level `export (default )?(async )?(function|class|const|let|
 *     interface|type|enum) NAME`
 *   - a class member: an indented `NAME (` / `NAME =` / `NAME <` declaration
 *   - a private class member: an indented `#NAME (` / `#NAME =`
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const args = process.argv.slice(2);
const argValue = (name: string): string | undefined => {
	const i = args.indexOf(`--${name}`);
	return i !== -1 ? args[i + 1] : undefined;
};
const BASE = argValue("base") ?? "main";
const AGAINST = argValue("against");
const JSON_OUT = args.includes("--json");

// `git grep` extracts every member-declaration line across the whole tree in
// one pass — orders of magnitude faster than `git show` per file.
const EXPORT_RE = String.raw`^export\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z0-9_$]+)`;
const CLASS_RE = String.raw`^\t+\s*(?:(?:public|private|protected|readonly|static|async|get|set|declare|override|abstract)\s+)*([A-Za-z_$][A-Za-z0-9_$]*)\s*[(<=]`;
const PRIVATE_RE = String.raw`^\t+\s*#([A-Za-z_$][A-Za-z0-9_$]*)\s*[(<=]`;
const SCOPE_RE = /^packages\/[^/]+\/src\/.*\.tsx?$/;

const topRe = new RegExp(EXPORT_RE);
const clsRe = new RegExp(CLASS_RE);
const privRe = new RegExp(PRIVATE_RE);

function fail(message: string): never {
	console.error(`audit-merge-members: ${message}`);
	process.exit(2);
}

/** The two fields `execFileSync` attaches to a thrown non-zero exit; both are read below. */
interface ExecFailure {
	status: number | null;
	stderr: string;
}

/** Boundary narrowing for a thrown value: a non-Error or a missing field degrades to "spawn failed". */
function asExecFailure(thrown: unknown): ExecFailure {
	if (typeof thrown !== "object" || thrown === null) return { status: null, stderr: "" };
	return {
		status: "status" in thrown && typeof thrown.status === "number" ? thrown.status : null,
		stderr: "stderr" in thrown && typeof thrown.stderr === "string" ? thrown.stderr : "",
	};
}

function execGit(argv: string[], options: { cwd?: string; allowNoMatch?: boolean } = {}): string {
	try {
		return execFileSync("git", argv, { encoding: "utf8", cwd: options.cwd, maxBuffer: 1 << 30 });
	} catch (thrown) {
		const failure = asExecFailure(thrown);
		// `git grep` exits 1 for "searched, no match" — its only non-error failure.
		if (options.allowNoMatch && failure.status === 1) return "";
		const stderr = failure.stderr.trim();
		if (failure.status === null) fail(`could not run git ${argv[0] ?? ""}: ${String(thrown).slice(0, 200)}`);
		fail(`git ${argv.join(" ")} failed (exit ${failure.status})${stderr ? `: ${stderr}` : ""}`);
	}
}

/** Repo root: every path this script matches on is repo-relative, so git must run there, not in the caller's cwd. */
const TOPLEVEL = execGit(["rev-parse", "--show-toplevel"]).trim();

function git(argv: string[], allowNoMatch = false): string {
	return execGit(argv, { cwd: TOPLEVEL, allowNoMatch });
}

function requireCommit(ref: string): void {
	// A leading `-` would be read as another option by the `git grep`/`ls-tree`
	// call sitting behind this ref.
	if (ref.startsWith("-")) fail(`refusing a ref that looks like an option: ${ref}`);
	if (git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], true) === "")
		fail(`${ref} does not resolve to a commit here — refusing to report a clean audit`);
}

/**
 * A revision to audit, or the working tree. `git grep` prefixes every hit with
 * `<ref>:` when it is given a revision and prints a bare `path:content` when it
 * is not, so the prefix is carried on the tree instead of being guessed from the
 * line — deriving the path from the first `:` is what made the shipped version
 * compare two empty member sets forever.
 */
interface Tree {
	label: string;
	ref: string | null;
}

function membersByFile(tree: Tree): Map<string, Set<string>> {
	const argv = ["grep", "-n", "-P", "-e", EXPORT_RE, "-e", CLASS_RE, "-e", PRIVATE_RE];
	if (tree.ref) argv.push(tree.ref);
	argv.push("--", "packages");
	const out = git(argv, true);

	const prefix = tree.ref ? `${tree.ref}:` : "";
	const byFile = new Map<string, Set<string>>();
	for (const line of out.split("\n")) {
		if (line === "") continue;
		if (prefix && !line.startsWith(prefix))
			fail(`unparseable git grep output (expected a '${prefix}' prefix): ${line.slice(0, 120)}`);
		const rest = line.slice(prefix.length);
		// `-n` is always passed, so the shape is `path:line:content` — pinning it
		// keeps the parse independent of a `grep.lineNumber` config in the caller.
		const file = rest.slice(0, rest.indexOf(":"));
		const numbered = rest.slice(file.length + 1);
		const lineNumber = numbered.slice(0, numbered.indexOf(":"));
		if (!/^\d+$/.test(lineNumber))
			fail(`unparseable git grep output (expected path:line:content): ${line.slice(0, 120)}`);
		if (!SCOPE_RE.test(file)) continue;
		const content = numbered.slice(lineNumber.length + 1);
		const top = topRe.exec(content);
		const priv = top ? null : privRe.exec(content);
		const cls = top || priv ? null : clsRe.exec(content);
		const name = top ? `export ${top[1]}` : priv ? `#${priv[1]}` : cls ? cls[1] : null;
		if (name === null) continue;
		let set = byFile.get(file);
		if (!set) byFile.set(file, (set = new Set()));
		set.add(name);
	}
	return byFile;
}

function filesIn(tree: Tree): Set<string> {
	const out = git(
		tree.ref
			? ["ls-tree", "-r", "--name-only", tree.ref, "--", "packages"]
			: ["ls-files", "--full-name", "--", "packages"],
	);
	return new Set(out.split("\n").filter(f => SCOPE_RE.test(f)));
}

requireCommit(BASE);
if (AGAINST) requireCommit(AGAINST);
const base: Tree = { label: BASE, ref: BASE };
const target: Tree = AGAINST ? { label: AGAINST, ref: AGAINST } : { label: "worktree", ref: null };

/** The tag named by the ledger's `## Integrated through` line, when there is a ledger. */
function ledgerTag(): string | undefined {
	try {
		const text = fs.readFileSync(path.join(TOPLEVEL, "document", "upstream-sync.md"), "utf8");
		return /^## Integrated through: (v\d+\.\d+\.\d+)/m.exec(text)?.[1];
	} catch {
		return undefined; // no ledger here (scratch repos, non-Zeta checkouts): no consultation
	}
}

/**
 * The upstream side a reported member is judged against: the tag whose
 * increment this tree carries, and the tag it descends from. `prev` is the
 * merge-base of the audited base and that tag — under an intact lineage that is
 * exactly the previously integrated tag, so "the tag does not have it, its
 * parent did" means upstream removed it in this window.
 */
interface Consultation {
	tag: Tree;
	prev: Tree;
}

const TAG = argValue("tag") ?? ledgerTag();
let consultation: Consultation | undefined;
if (TAG) {
	requireCommit(TAG);
	const prev = git(["merge-base", BASE, TAG]).trim();
	requireCommit(prev);
	if (prev === git(["rev-parse", `${TAG}^{commit}`]).trim()) {
		fail(
			`--tag ${TAG} is already in ${BASE}'s history, so it cannot date anything this tree changed — ` +
				"pass the tag whose increment the merge applied (the ledger's `Integrated through` line is still on the previous tag)",
		);
	}
	consultation = { tag: { label: TAG, ref: TAG }, prev: { label: prev, ref: prev } };
}

const before = membersByFile(base);
// Non-vacuity: an empty base set means the extraction (or the ref) is broken, not
// that the merge was clean. Reporting "0 dropped" here is exactly the bug this
// script shipped with, so refuse it outright.
if (before.size === 0)
	fail(`extracted 0 members across 0 files from ${BASE} — the extraction is broken, refusing to report a clean audit`);

const after = membersByFile(target);
const afterFiles = filesIn(target);

// The upstream side of the same comparison, extracted with the same regexes, so
// "the tag does not have it" means exactly what the drop report means — the same
// heuristics on both sides, never a second opinion from a different matcher.
const upstream = consultation
	? {
			members: membersByFile(consultation.tag),
			prevMembers: membersByFile(consultation.prev),
			files: filesIn(consultation.tag),
			prevFiles: filesIn(consultation.prev),
		}
	: undefined;

interface Finding {
	file: string;
	members: string[];
}

const dropped: Finding[] = [];
const explained: Finding[] = [];

/** Split one file's gone members into "we lost code upstream still ships" and "upstream removed it too". */
function classify(file: string, gone: string[]): void {
	if (!upstream) {
		dropped.push({ file, members: gone });
		return;
	}
	const tagMembers = upstream.members.get(file);
	const prevMembers = upstream.prevMembers.get(file);
	const lost: string[] = [];
	const removedUpstream: string[] = [];
	for (const member of gone) {
		if (tagMembers?.has(member)) lost.push(member);
		else if (prevMembers?.has(member)) removedUpstream.push(member);
		else lost.push(member); // no upstream side ever had it: it is Zeta's own
	}
	if (lost.length > 0) dropped.push({ file, members: lost });
	if (removedUpstream.length > 0) explained.push({ file, members: removedUpstream });
}

for (const [file, oldMembers] of before) {
	if (!afterFiles.has(file)) {
		const whole = ["<whole file removed>"];
		if (!upstream || upstream.files.has(file)) dropped.push({ file, members: whole });
		else if (upstream.prevFiles.has(file)) explained.push({ file, members: whole });
		else dropped.push({ file, members: whole }); // a Zeta-only module: no upstream side to blame
		continue;
	}
	const newMembers = after.get(file) ?? new Set<string>();
	const gone = [...oldMembers].filter(m => !newMembers.has(m)).sort();
	if (gone.length > 0) classify(file, gone);
}

const total = dropped.reduce((n, d) => n + d.members.length, 0);
const explainedTotal = explained.reduce((n, d) => n + d.members.length, 0);
const compared = [...before.values()].reduce((n, s) => n + s.size, 0);
dropped.sort((a, b) => a.file.localeCompare(b.file));
explained.sort((a, b) => a.file.localeCompare(b.file));

if (JSON_OUT) {
	// `compared` is the non-vacuity anchor for machine consumers: a report with
	// `compared: 0` means the extraction saw nothing, never that the merge was clean.
	console.log(
		JSON.stringify(
			{
				base: BASE,
				against: target.label,
				tag: TAG ?? null,
				total,
				explainedTotal,
				compared,
				dropped,
				explained,
			},
			null,
			2,
		),
	);
} else {
	console.log(`\nMerge member-loss audit: ${base.label} -> ${target.label}`);
	console.log("=".repeat(60));
	for (const d of dropped) {
		console.log(`- ${d.file}`);
		for (const m of d.members) console.log(`    ${m}`);
	}
	console.log(`\n${total} member(s) dropped across ${dropped.length} file(s)`);
	if (explained.length > 0) {
		console.log(
			`${explainedTotal} member(s) across ${explained.length} file(s) explained as upstream's own removal in this window (${TAG})`,
		);
		for (const d of explained) {
			console.log(`  ~ ${d.file}`);
			for (const m of d.members) console.log(`      ${m}`);
		}
	} else if (TAG) {
		console.log(`0 members explained by ${TAG} (nothing was reported and absent from it)`);
	}
	console.log(
		`${compared} members compared in ${before.size} file(s) of ${base.label} against ${afterFiles.size} file(s) of ${target.label}\n`,
	);
}
process.exit(dropped.length === 0 ? 0 : 1);
