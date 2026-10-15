import { afterAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Red-first regression test for the merge member-loss audit
 * (`scripts/audit-merge-members.ts`).
 *
 * The auditor shipped broken: it took the text before the **first** `:` of each
 * `git grep <ref>` hit as the file name. With an explicit revision, git prefixes
 * every hit with `<ref>:` — so that field was the ref itself (`refs/heads/main`,
 * `2291ae3dc80`) and never a `packages/ * /src` path. Every hit was filtered
 * out, both member sets came back **empty**, and the auditor printed
 * `0 member(s) dropped across 0 file(s)` + exit 0 for every input — including
 * the v18.10.0 sync merge, where the same comparison finds hundreds of gone
 * members. That "假绿" is worse than no auditor at all: it is what let damage
 * class 4 (conflict resolution silently dropping Zeta-only code) ship unread.
 *
 * Each case runs the real CLI in a scratch repository — real commits, real
 * `git grep`, no network, no toolchain beyond `git` — and asserts on the JSON
 * contract:
 *   - a member deleted by a wholesale-file resolution is reported;
 *   - a file the change did not touch, and a file only the target has, are not;
 *   - identical revisions report nothing (non-vacuity);
 *   - the documented default (`--base <ref>` alone) audits the working tree;
 *   - an unresolvable ref fails loudly instead of reporting a clean audit.
 */

const SCRIPT = path.join(import.meta.dir, "audit-merge-members.ts");
const scratch: string[] = [];

const sh = (cwd: string, cmd: string[]) => Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });

function repo(name: string): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), `zeta-member-audit-${name}-`));
	scratch.push(dir);
	sh(dir, ["git", "init", "-q", "-b", "zeta"]);
	sh(dir, ["git", "config", "user.email", "repro@example.invalid"]);
	sh(dir, ["git", "config", "user.name", "repro"]);
	// Deterministic object ids: no wall-clock or environment identity in the SHAs.
	sh(dir, ["git", "config", "commit.gpgsign", "false"]);
	return dir;
}

function write(dir: string, file: string, content: string): void {
	const full = path.join(dir, file);
	fs.mkdirSync(path.dirname(full), { recursive: true });
	fs.writeFileSync(full, `${content}\n`);
}

function commit(dir: string, message: string): string {
	sh(dir, ["git", "add", "-A"]);
	const env = { GIT_AUTHOR_DATE: "2026-10-15T00:00:00Z", GIT_COMMITTER_DATE: "2026-10-15T00:00:00Z" };
	const res = Bun.spawnSync(["git", "commit", "-qm", message], {
		cwd: dir,
		env: { ...process.env, ...env },
		stdout: "pipe",
		stderr: "pipe",
	});
	expect(res.exitCode, res.stderr.toString()).toBe(0);
	return sh(dir, ["git", "rev-parse", "HEAD"]).stdout.toString().trim();
}

interface Audit {
	exitCode: number;
	stdout: string;
	stderr: string;
}

function audit(dir: string, argv: string[]): Audit {
	const res = sh(dir, [process.execPath, SCRIPT, ...argv, "--json"]);
	return { exitCode: res.exitCode, stdout: res.stdout.toString(), stderr: res.stderr.toString() };
}

interface Report {
	base: string;
	against: string;
	total: number;
	compared: number;
	dropped: Array<{ file: string; members: string[] }>;
}

/** JSON stdout, or `null` when the auditor failed before printing a report. */
function parsed(result: Audit): Report | null {
	const start = result.stdout.indexOf("{");
	return start === -1 ? null : (JSON.parse(result.stdout.slice(start)) as Report);
}

afterAll(() => {
	// Best effort: Windows keeps handles on a `.git` directory git touched seconds
	// ago, and a leftover temp directory is not a test failure.
	for (const dir of scratch) {
		try {
			fs.rmSync(dir, { recursive: true, force: true });
		} catch {
			// ignored
		}
	}
});

/** The pre-merge Zeta file: two exports, two functions and a class with a private member. */
const ALPHA_BASE = `
export interface AlphaOptions {
	readonly depth: number;
}

export const kept = 1;
export const doomed = 2;

export type AlphaKind = "a" | "b";

export function keptFn(): number {
	return kept;
}

export function doomedFn(): number {
	return doomed;
}

export class Alpha {
	keptMethod(): number {
		return 1;
	}

	doomedMethod(): number {
		return 2;
	}

	#doomedPrivate(): number {
		return 3;
	}
}
`;

/** What a "take upstream wholesale" resolution of that file leaves behind. */
const ALPHA_TAKEN_WHOLESALE = `
export interface AlphaOptions {
	readonly depth: number;
}

export const kept = 1;

export type AlphaKind = "a" | "b";

export function keptFn(): number {
	return kept;
}

export class Alpha {
	keptMethod(): number {
		return 1;
	}
}
`;

/** Untouched by the merge — must never be reported. */
const UNTOUCHED = `
export const stable = 1;

export function stableFn(): number {
	return stable;
}

export class Stable {
	stableMethod(): number {
		return 1;
	}
}
`;

/** Target-only file — nothing to lose, so it must never be reported either. */
const FRESH = `
export const added = 1;

export function addedFn(): number {
	return added;
}
`;

const GONE = `
export const vanished = 1;
`;

describe("merge member-loss audit", () => {
	test("reports the members a wholesale-file resolution dropped", () => {
		const dir = repo("loss");
		write(dir, "packages/demo/src/alpha.ts", ALPHA_BASE);
		write(dir, "packages/demo/src/untouched.ts", UNTOUCHED);
		write(dir, "packages/demo/src/gone.ts", GONE);
		const before = commit(dir, "pre-merge zeta");

		write(dir, "packages/demo/src/alpha.ts", ALPHA_TAKEN_WHOLESALE);
		write(dir, "packages/demo/src/fresh.ts", FRESH);
		fs.rmSync(path.join(dir, "packages/demo/src/gone.ts"));
		const after = commit(dir, "merge upstream (alpha taken wholesale)");

		const result = audit(dir, ["--base", before, "--against", after]);
		expect(result.exitCode).toBe(1);

		const report = parsed(result);
		expect(report).not.toBeNull();
		expect(report?.total).toBe(5);
		expect(report?.dropped.map(d => d.file)).toEqual(["packages/demo/src/alpha.ts", "packages/demo/src/gone.ts"]);
		expect(report?.dropped[0]?.members).toEqual([
			"#doomedPrivate",
			"doomedMethod",
			"export doomed",
			"export doomedFn",
		]);
		// A whole module deleted is the strongest form of the same damage.
		expect(report?.dropped[1]?.members).toEqual(["<whole file removed>"]);
	}, 120_000);

	test("does not report files the change never touched, or target-only files", () => {
		const dir = repo("clean");
		write(dir, "packages/demo/src/alpha.ts", ALPHA_BASE);
		write(dir, "packages/demo/src/untouched.ts", UNTOUCHED);
		const before = commit(dir, "pre-merge zeta");

		write(dir, "packages/demo/src/fresh.ts", FRESH);
		const after = commit(dir, "merge upstream (additive only)");

		const result = audit(dir, ["--base", before, "--against", after]);
		expect(result.exitCode).toBe(0);

		const report = parsed(result);
		expect(report?.total).toBe(0);
		expect(report?.dropped).toEqual([]);
		expect(result.stdout).not.toContain("untouched.ts");
		expect(result.stdout).not.toContain("fresh.ts");
	}, 120_000);

	test("comparing a revision with itself reports nothing (non-vacuity)", () => {
		const dir = repo("identity");
		write(dir, "packages/demo/src/alpha.ts", ALPHA_BASE);
		write(dir, "packages/demo/src/untouched.ts", UNTOUCHED);
		const head = commit(dir, "pre-merge zeta");

		const result = audit(dir, ["--base", head, "--against", head]);
		expect(result.exitCode).toBe(0);

		const report = parsed(result);
		expect(report?.total).toBe(0);
		expect(report?.dropped).toEqual([]);
		// The empty member sets of the shipped bug are impossible here: the
		// comparison must have actually run over the real members.
		expect(report?.compared).toBeGreaterThan(0);
	}, 120_000);

	test("defaults --against to the working tree, so a mid-merge worktree is auditable", () => {
		const dir = repo("worktree");
		write(dir, "packages/demo/src/alpha.ts", ALPHA_BASE);
		write(dir, "packages/demo/src/untouched.ts", UNTOUCHED);
		const before = commit(dir, "pre-merge zeta");

		// Uncommitted conflict resolution: `kept` and `stable` are edited in place.
		write(dir, "packages/demo/src/alpha.ts", ALPHA_TAKEN_WHOLESALE.replace("export const kept = 1;\n", ""));
		fs.writeFileSync(path.join(dir, "packages/demo/src/untouched.ts"), UNTOUCHED);

		const result = audit(dir, ["--base", before]);
		expect(result.exitCode).toBe(1);

		const report = parsed(result);
		expect(report?.against).toBe("worktree");
		expect(report?.dropped.map(d => d.file)).toEqual(["packages/demo/src/alpha.ts"]);
		expect(report?.dropped[0]?.members).toContain("export kept");
	}, 120_000);

	test("fails loudly on an unresolvable ref instead of reporting a clean audit", () => {
		const dir = repo("bogus");
		write(dir, "packages/demo/src/alpha.ts", ALPHA_BASE);
		const head = commit(dir, "pre-merge zeta");

		const result = audit(dir, ["--base", "no-such-revision", "--against", head]);
		expect(result.exitCode).not.toBe(0);
		// Never a "0 dropped" green: the audit did not run at all.
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("no-such-revision");
		expect(result.stdout).not.toContain("0 member(s) dropped");
	}, 120_000);
});
