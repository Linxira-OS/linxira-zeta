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
 * `packages/​*​/src` module in a **pre-merge Zeta ref** against the same file
 * in the working tree (or `--against <ref>`) and reports, per file, members
 * that existed before and are gone now.
 *
 * Usage:
 *   bun scripts/audit-merge-members.ts --base <pre-merge-ref>
 *   bun scripts/audit-merge-members.ts --base main --against HEAD
 *   bun scripts/audit-merge-members.ts --base <ref> --json
 *
 * Exit 1 when anything was dropped, so it can gate a merge push.
 *
 * A member is:
 *   - a top-level `export (default )?(async )?(function|class|const|let|
 *     interface|type|enum) NAME`
 *   - a class member: an indented `NAME (` / `NAME =` / `NAME <` declaration
 *   - a private class member: an indented `#NAME (` / `#NAME =`
 */

import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const argValue = (name: string): string | undefined => {
	const i = args.indexOf(`--${name}`);
	return i !== -1 ? args[i + 1] : undefined;
};
const BASE = argValue("base") ?? "main";
const AGAINST = argValue("against");
const JSON_OUT = args.includes("--json");

// `git grep -P` extracts every member-declaration line across the whole tree
// in one pass — orders of magnitude faster than `git show` per file.
const EXPORT_RE = String.raw`^export\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z0-9_$]+)`;
const CLASS_RE = String.raw`^\t+\s*(?:(?:public|private|protected|readonly|static|async|get|set|declare|override|abstract)\s+)*([A-Za-z_$][A-Za-z0-9_$]*)\s*[(<=]`;
const PRIVATE_RE = String.raw`^\t+\s*#([A-Za-z_$][A-Za-z0-9_$]*)\s*[(<=]`;

const topRe = new RegExp(EXPORT_RE);
const clsRe = new RegExp(CLASS_RE);
const privRe = new RegExp(PRIVATE_RE);

function membersByFile(ref: string): Map<string, Set<string>> {
	let out: string;
	try {
		out = execFileSync(
			"git",
			["grep", "-n", "-P", "-e", EXPORT_RE, "-e", CLASS_RE, "-e", PRIVATE_RE, ref, "--", "packages"],
			{
				encoding: "utf8",
				maxBuffer: 1 << 30,
			},
		);
	} catch {
		return new Map();
	}
	const byFile = new Map<string, Set<string>>();
	for (const line of out.split("\n")) {
		if (line === "") continue;
		const first = line.indexOf(":");
		if (first === -1) continue;
		const file = line.slice(0, first).replace(new RegExp(`^${ref}:`), "");
		if (!/^packages\/[^/]+\/src\/.*\.tsx?$/.test(file)) continue;
		const content = line.slice(line.indexOf(":", first + 1) + 1);
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

function filesIn(ref: string): Set<string> {
	const out = execFileSync("git", ["ls-tree", "-r", "--name-only", ref, "--", "packages"], {
		encoding: "utf8",
		maxBuffer: 1 << 30,
	});
	return new Set(out.split("\n").filter(f => /^packages\/[^/]+\/src\/.*\.tsx?$/.test(f)));
}

const before = membersByFile(BASE);
const after = AGAINST ? membersByFile(AGAINST) : membersByFile("HEAD");
const afterFiles = AGAINST ? filesIn(AGAINST) : filesIn("HEAD");

const dropped: Array<{ file: string; members: string[] }> = [];
for (const [file, oldMembers] of before) {
	if (!afterFiles.has(file)) {
		dropped.push({ file, members: ["<whole file removed>"] });
		continue;
	}
	const newMembers = after.get(file) ?? new Set<string>();
	const gone = [...oldMembers].filter(m => !newMembers.has(m)).sort();
	if (gone.length > 0) dropped.push({ file, members: gone });
}

const total = dropped.reduce((n, d) => n + d.members.length, 0);
dropped.sort((a, b) => a.file.localeCompare(b.file));

if (JSON_OUT) {
	console.log(JSON.stringify({ base: BASE, against: AGAINST ?? "HEAD", total, dropped }, null, 2));
} else {
	console.log(`\nMerge member-loss audit: ${BASE} -> ${AGAINST ?? "HEAD"}`);
	console.log("=".repeat(60));
	for (const d of dropped) {
		console.log(`- ${d.file}`);
		for (const m of d.members) console.log(`    ${m}`);
	}
	console.log(`\n${total} member(s) dropped across ${dropped.length} file(s)\n`);
}
process.exit(dropped.length === 0 ? 0 : 1);
