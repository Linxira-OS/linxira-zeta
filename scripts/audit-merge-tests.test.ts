import { afterAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Regression tests for `scripts/audit-merge-tests.ts`.
 *
 * The merge member audit only sees `packages/*​/src`, so a conflicted test file
 * can be dropped or kept unchanged while the source audit reports clean. These
 * cases run the real CLI against scratch git repositories:
 *   - an upstream-added test/fixture missing from the merge is reported;
 *   - an upstream-modified test identical to the pre-merge ref is reported;
 *   - an upstream-deleted test still present is a non-fatal stale report;
 *   - the retire-list exception (`share.test.ts`) stays exempt;
 *   - a target that carries the upstream delta passes.
 */

const SCRIPT = path.join(import.meta.dir, "audit-merge-tests.ts");
const scratch: string[] = [];

const sh = (cwd: string, argv: string[]) => Bun.spawnSync(argv, { cwd, stdout: "pipe", stderr: "pipe" });

function repo(name: string): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), `zeta-test-audit-${name}-`));
	scratch.push(dir);
	sh(dir, ["git", "init", "-q", "-b", "zeta"]);
	sh(dir, ["git", "config", "user.email", "repro@example.invalid"]);
	sh(dir, ["git", "config", "user.name", "repro"]);
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
	const result = sh(dir, ["git", "commit", "-qm", message]);
	expect(result.exitCode, result.stderr.toString()).toBe(0);
	return sh(dir, ["git", "rev-parse", "HEAD"]).stdout.toString().trim();
}

interface Audit {
	exitCode: number;
	stdout: string;
	stderr: string;
}

function runAudit(dir: string, argv: string[]): Audit {
	const result = sh(dir, [process.execPath, SCRIPT, ...argv]);
	return {
		exitCode: result.exitCode,
		stdout: result.stdout.toString(),
		stderr: result.stderr.toString(),
	};
}

interface Report {
	compared: number;
	violations: Array<{ kind: string; path: string }>;
	stale: Array<{ path: string }>;
	allowlisted: Array<{ path: string }>;
}

function parsed(result: Audit): Report | null {
	const start = result.stdout.indexOf("{");
	return start === -1 ? null : (JSON.parse(result.stdout.slice(start)) as Report);
}

afterAll(() => {
	for (const dir of scratch) {
		try {
			fs.rmSync(dir, { recursive: true, force: true });
		} catch {
			// Windows may still hold a handle on .git; a leftover temp dir is not a failure.
		}
	}
});

const BASE_TEST = `import { expect, test } from "bun:test";\ntest("old behavior", () => expect(1).toBe(1));`;
const UPSTREAM_TEST = `import { expect, test } from "bun:test";\ntest("old behavior", () => expect(1).toBe(1));\ntest("new behavior", () => expect(2).toBe(2));`;
const BASE_FIXTURE = `{"old":true}`;
const UPSTREAM_FIXTURE = `{"new":true}`;

function seedBase(dir: string): string {
	write(dir, "packages/demo/test/base.test.ts", BASE_TEST);
	write(dir, "packages/demo/test/fixtures/base.json", BASE_FIXTURE);
	return commit(dir, "pre-merge");
}

function seedUpstream(dir: string): void {
	write(dir, "packages/demo/test/base.test.ts", UPSTREAM_TEST);
	write(dir, "packages/demo/test/new.test.ts", UPSTREAM_TEST);
	write(dir, "packages/demo/test/fixtures/base.json", UPSTREAM_FIXTURE);
	write(dir, "packages/demo/test/fixtures/new.json", UPSTREAM_FIXTURE);
}

describe("merge test/fixture audit", () => {
	test("reports missing upstream-added tests/fixtures", () => {
		const dir = repo("missing");
		const base = seedBase(dir);
		sh(dir, ["git", "checkout", "-q", "-b", "upstream"]);
		seedUpstream(dir);
		commit(dir, "upstream");
		sh(dir, ["git", "tag", "v99.0.0"]);
		sh(dir, ["git", "checkout", "-q", "-b", "merge", base]);

		const result = runAudit(dir, ["--base", base, "--tag", "v99.0.0", "--against", "HEAD", "--json"]);
		expect(result.exitCode).toBe(1);
		const report = parsed(result);
		expect(report).not.toBeNull();
		expect(report?.compared).toBe(4);
		expect(report?.violations.map(v => v.path).sort()).toEqual([
			"packages/demo/test/base.test.ts",
			"packages/demo/test/fixtures/base.json",
			"packages/demo/test/fixtures/new.json",
			"packages/demo/test/new.test.ts",
		]);
		expect(report?.violations.every(v => v.kind === "unchanged-modified" || v.kind === "missing-added")).toBe(true);
	}, 120_000);

	test("reports a local edit that did not carry the upstream test change", () => {
		const dir = repo("partial");
		write(dir, "packages/demo/test/base.test.ts", BASE_TEST);
		const base = commit(dir, "pre-merge");
		sh(dir, ["git", "checkout", "-q", "-b", "upstream"]);
		write(dir, "packages/demo/test/base.test.ts", BASE_TEST.replace("old behavior", "upstream behavior"));
		commit(dir, "upstream test edit");
		sh(dir, ["git", "tag", "v99.0.0"]);
		sh(dir, ["git", "checkout", "-q", "-b", "merge", base]);
		write(dir, "packages/demo/test/base.test.ts", `// Zeta local edit\n${BASE_TEST}`);
		commit(dir, "merge: local edit without the upstream hunk");

		const result = runAudit(dir, ["--base", base, "--tag", "v99.0.0", "--against", "HEAD", "--json"]);
		expect(result.exitCode).toBe(1);
		const report = parsed(result);
		expect(report?.violations).toEqual([
			expect.objectContaining({
				kind: "modified-upstream-missing",
				path: "packages/demo/test/base.test.ts",
			}),
		]);
	}, 120_000);

	test("passes when the target carries the upstream delta", () => {
		const dir = repo("clean");
		const base = seedBase(dir);
		sh(dir, ["git", "checkout", "-q", "-b", "upstream"]);
		seedUpstream(dir);
		commit(dir, "upstream");
		sh(dir, ["git", "tag", "v99.0.0"]);
		sh(dir, ["git", "checkout", "-q", "-b", "merge", base]);
		seedUpstream(dir);
		commit(dir, "merge upstream tests");

		const result = runAudit(dir, ["--base", base, "--tag", "v99.0.0", "--against", "HEAD", "--json"]);
		expect(result.exitCode, result.stderr).toBe(0);
		const report = parsed(result);
		expect(report?.violations).toEqual([]);
	}, 120_000);

	test("keeps the retired share test allowlisted", () => {
		const dir = repo("allowlist");
		write(dir, "packages/coding-agent/test/share.test.ts", BASE_TEST);
		const base = commit(dir, "pre-merge");
		sh(dir, ["git", "checkout", "-q", "-b", "upstream"]);
		write(dir, "packages/coding-agent/test/share.test.ts", UPSTREAM_TEST);
		commit(dir, "upstream");
		sh(dir, ["git", "tag", "v99.0.0"]);
		sh(dir, ["git", "checkout", "-q", "-b", "merge", base]);
		fs.rmSync(path.join(dir, "packages/coding-agent/test/share.test.ts"));
		commit(dir, "merge: share retired");

		const result = runAudit(dir, ["--base", base, "--tag", "v99.0.0", "--against", "HEAD", "--json"]);
		expect(result.exitCode, result.stderr).toBe(0);
		const report = parsed(result);
		expect(report?.violations).toEqual([]);
		expect(report?.allowlisted.map(entry => entry.path)).toEqual(["packages/coding-agent/test/share.test.ts"]);
	}, 120_000);

	test("reports an upstream-deleted test that survived the merge as stale, not fatal", () => {
		const dir = repo("stale");
		write(dir, "packages/demo/test/gone.test.ts", BASE_TEST);
		const base = commit(dir, "pre-merge");
		sh(dir, ["git", "checkout", "-q", "-b", "upstream"]);
		fs.rmSync(path.join(dir, "packages/demo/test/gone.test.ts"));
		commit(dir, "upstream deletes test");
		sh(dir, ["git", "tag", "v99.0.0"]);
		sh(dir, ["git", "checkout", "-q", "-b", "merge", base]);

		const result = runAudit(dir, ["--base", base, "--tag", "v99.0.0", "--against", "HEAD", "--json"]);
		expect(result.exitCode).toBe(0);
		const report = parsed(result);
		expect(report?.violations).toEqual([]);
		expect(report?.stale.map(entry => entry.path)).toEqual(["packages/demo/test/gone.test.ts"]);
	}, 120_000);
});
