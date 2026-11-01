#!/usr/bin/env bun
/**
 * Branch registry drift guard.
 *
 * `document/agents/workflow/branch-registry.md` is the single record of why a
 * local branch exists and when it must go. This guard keeps the record honest:
 *
 * - every local branch is listed, either as live or as retired;
 * - a retired branch is actually gone (a stale table is worse than none);
 * - a live branch marked as ours still exists;
 * - branches past their review age are reported (feat/fix/chore 30 days,
 *   backup/spike 90), because an unmerged branch older than that has usually
 *   been forgotten rather than parked.
 *
 * Local only: CI has no local branches. `merge-gate` runs it as a guard.
 */
import * as fs from "node:fs";
import { execFileSync } from "node:child_process";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
const REGISTRY = path.join(ROOT, "document", "agents", "workflow", "branch-registry.md");

const DAY = 86_400;
const MAX_AGE: { pattern: RegExp; days: number }[] = [
	{ pattern: /^(feat|fix|chore)\//, days: 30 },
	{ pattern: /^(backup|spike)\//, days: 90 },
];

const text = fs.readFileSync(REGISTRY, "utf8");
const section = (heading: string, next: string): string => {
	const start = text.indexOf(heading);
	if (start === -1) return "";
	const end = text.indexOf(next, start + heading.length);
	return end === -1 ? text.slice(start) : text.slice(start, end);
};

/** The branch names a table section lists: first cell, first backticked token. */
const branchesIn = (block: string): string[] =>
	block
		.split("\n")
		.filter(line => line.trim().startsWith("| `"))
		.map(line => /^`([^`]+)`/.exec(line.split("|").map(cell => cell.trim())[1] ?? "")?.[1])
		.filter((name): name is string => name !== undefined);

const live = new Set(branchesIn(section("## 在册分支", "## 已退役")));
const retired = new Set(branchesIn(section("## 已退役", "## 定期动作")));

const stdout = execFileSync(
	"git",
	["for-each-ref", "--format=%(refname:short)%09%(committerdate:unix)", "refs/heads"],
	{ cwd: ROOT, encoding: "utf8" },
);
const local = new Map<string, number>();
for (const line of stdout.split("\n")) {
	if (line.trim() === "") continue;
	const [name, stamp] = line.split("\t");
	if (name !== "main") local.set(name, Number(stamp));
}

const failures: string[] = [];
const warnings: string[] = [];

for (const name of local.keys()) {
	if (!live.has(name) && !retired.has(name)) failures.push(`unregistered branch: ${name}`);
	if (retired.has(name))
		failures.push(`retired branch still exists: ${name} — delete it or move the row back to 在册`);
}
for (const name of live) {
	if (!local.has(name))
		failures.push(`live branch is missing: ${name} — delete the row (record the SHA) or restore the branch`);
}

const now = Math.floor(Date.now() / 1000);
for (const [name, stamp] of local) {
	for (const { pattern, days } of MAX_AGE) {
		if (!pattern.test(name)) continue;
		const age = Math.floor((now - stamp) / DAY);
		if (age > days) warnings.push(`${name}: ${age} days old (limit ${days}) — merge, park or retire it`);
	}
}

const summary = `branch-registry: ${local.size + 1} local branch(es), ${live.size} live, ${retired.size} retired`;
for (const warning of warnings) console.warn(`  ! ${warning}`);
for (const failure of failures) console.error(`  ✗ ${failure}`);
if (failures.length > 0) {
	console.error(`${summary} — ${failures.length} drift(s)`);
	process.exit(1);
}
console.log(`${summary} — registry matches the branch list`);
