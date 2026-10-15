import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import {
	firstErrorLine,
	formatSummary,
	formatSeconds,
	parseArgs,
	planSteps,
	runSteps,
	verdictExitCode,
	type SpawnFn,
	type StepResult,
} from "./merge-gate.ts";

/**
 * Tests for the one-command merge gate (`scripts/merge-gate.ts`).
 *
 * Three properties carry the whole feature, so each has a test that fails when
 * the property is lost:
 *   - the summary is a *single page*: one row per step (name / verdict /
 *     duration) plus the first error line of a failed step, and nothing else;
 *   - a failed step makes the process exit non-zero (a gate that reports
 *     "fail" and exits 0 is the 假绿 this repo keeps re-learning about);
 *   - `--gates-only` really drops the test phase, and the full plan really
 *     includes the orphan suites (pi-messenger vitest, packages/stats) that no
 *     CI job ran before.
 *
 * The runner is exercised through an injected `spawn`, so the tests never shell
 * out to the guards themselves — except the two CLI cases at the bottom, which
 * run the real script (`--dry-run`, and a real audit failure) because a plan
 * that only exists in a pure function proves nothing about the CLI.
 */

const SCRIPT = path.join(import.meta.dir, "merge-gate.ts");

const stub = (results: Array<{ exitCode: number; output: string }>): { spawn: SpawnFn; calls: string[][] } => {
	const calls: string[][] = [];
	let i = 0;
	const spawn: SpawnFn = async argv => {
		calls.push(argv);
		return results[Math.min(i++, results.length - 1)]!;
	};
	return { spawn, calls };
};

const result = (over: Partial<StepResult>): StepResult => ({
	id: "x",
	name: "x",
	phase: "guard",
	status: "pass",
	seconds: 1,
	...over,
});

describe("parseArgs", () => {
	test("defaults to the full run against main", () => {
		const options = parseArgs([]);
		expect(options.gatesOnly).toBe(false);
		expect(options.base).toBe("main");
		expect(options.tag).toBeUndefined();
		expect(options.dryRun).toBe(false);
		expect(options.only).toEqual([]);
	});

	test("threads --gates-only / --base / --tag", () => {
		const options = parseArgs(["--gates-only", "--base", "v18.10.0", "--tag", "v18.10.1"]);
		expect(options.gatesOnly).toBe(true);
		expect(options.base).toBe("v18.10.0");
		expect(options.tag).toBe("v18.10.1");
	});

	test("rejects a flag without its value and an unknown flag", () => {
		expect(() => parseArgs(["--base"])).toThrow();
		expect(() => parseArgs(["--nope"])).toThrow();
	});

	test("--only takes a comma-separated list", () => {
		expect(parseArgs(["--only", "audit-members,plugin-suite"]).only).toEqual(["audit-members", "plugin-suite"]);
	});
});

describe("planSteps", () => {
	test("--gates-only drops every behaviour test", () => {
		const plan = planSteps(parseArgs(["--gates-only"]));
		expect(plan.some(step => step.phase === "test")).toBe(false);
		// the two phases --gates-only keeps are still whole
		expect(plan.filter(step => step.phase === "guard").length).toBeGreaterThan(8);
		expect(plan.filter(step => step.phase === "audit").map(step => step.id)).toEqual([
			"audit-members",
			"audit-brand-regressions",
			"audit-lineage",
		]);
	});

	test("the mechanical phase covers the push-gate guards", () => {
		const commands = planSteps(parseArgs([]))
			.flatMap(step => step.commands.flat())
			.join("\n");
		for (const guard of [
			"scripts/check-version-consistency.ts",
			"ci:check:full",
			"scripts/check-scope-imports.ts",
			"scripts/brand/brand-check.ts",
			"scripts/check-zeta-sentinels.ts",
			"scripts/check-ci-surface.ts",
			"scripts/check-shared-infra.ts",
			"scripts/check-release-asset-names.ts",
			"scripts/check-package-json-merge.ts",
		])
			expect(commands).toContain(guard);
	});

	test("--base reaches the diff audits, --tag only the lineage audit", () => {
		const plan = planSteps(parseArgs(["--gates-only", "--base", "abc123", "--tag", "v18.10.1"]));
		const audits = plan.filter(step => step.phase === "audit");
		// The lineage audit reads its baseline from the ledger, not from --base.
		for (const audit of audits.filter(step => step.id !== "audit-lineage"))
			expect(audit.commands.flat()).toContain("abc123");
		const lineage = audits.find(step => step.id === "audit-lineage")!;
		expect(lineage.commands.flat()).toContain("--tag");
		expect(lineage.commands.flat()).toContain("v18.10.1");
		expect(lineage.commands.flat()).not.toContain("abc123");
		const members = audits.find(step => step.id === "audit-members")!;
		expect(members.commands.flat()).not.toContain("--tag");
	});

	test("the full plan carries both orphan suites, pi-messenger on its own runner", () => {
		const plan = planSteps(parseArgs([]));
		const stats = plan.find(step => step.id === "stats-suite")!;
		expect(stats.phase).toBe("test");
		expect(stats.commands.flat()).toContain("packages/stats/test");

		const plugin = plan.find(step => step.id === "plugin-suite")!;
		expect(plugin.phase).toBe("test");
		expect(plugin.cwd).toBe("plugins/official/pi-messenger");
		expect(plugin.runner).toContain("vitest");
		expect(plugin.commands.flat()).toContain("vitest");

		// the bun-test entry point every other bucket goes through
		const suite = plan.find(step => step.id === "ts-suite")!;
		expect(suite.commands.flat()).toContain("test:ts");
	});

	test("--only keeps just the named steps", () => {
		const plan = planSteps(parseArgs(["--only", "audit-members"]));
		expect(plan.map(step => step.id)).toEqual(["audit-members"]);
	});

	test("every step has a unique id and a non-empty argv", () => {
		const plan = planSteps(parseArgs([]));
		expect(new Set(plan.map(step => step.id)).size).toBe(plan.length);
		for (const step of plan) {
			expect(step.commands.length).toBeGreaterThan(0);
			for (const command of step.commands) expect(command.length).toBeGreaterThan(0);
		}
	});
});

describe("firstErrorLine", () => {
	test("prefers the first line that names a failure, ANSI stripped", () => {
		const output = "\x1b[32mok\x1b[0m\nsome chatter\nerror: expected 1, got 2\nmore\n";
		expect(firstErrorLine(output)).toBe("error: expected 1, got 2");
	});

	test("falls back to the first non-empty line", () => {
		expect(firstErrorLine("\n\n  plain failure text  \n")).toBe("plain failure text");
	});

	test("returns undefined on silence", () => {
		expect(firstErrorLine("   \n\n")).toBeUndefined();
	});
});

describe("runSteps", () => {
	test("a non-zero exit is a fail carrying the first error line", async () => {
		const { spawn } = stub([{ exitCode: 1, output: "chunk 1/4 compiling\nerror: boom: it broke\n" }]);
		const results = await runSteps([{ id: "a", name: "A", phase: "guard", commands: [["bun", "x"]] }], {
			stream: false,
			spawn,
		});
		expect(results[0]!.status).toBe("fail");
		expect(results[0]!.firstError).toBe("error: boom: it broke");
		expect(results[0]!.seconds).toBeGreaterThanOrEqual(0);
	});

	test("a tool that prints its finding but exits 0 is judged by its output", async () => {
		const { spawn } = stub([{ exitCode: 0, output: "3 brand regressions in the merge diff (main..HEAD)\n" }]);
		const plan = planSteps(parseArgs([])).filter(step => step.id === "audit-brand-regressions");
		const results = await runSteps(plan, { stream: false, spawn, log: () => {} });
		expect(results[0]!.status).toBe("fail");
		expect(results[0]!.detail).toContain("3");

		const clean = stub([{ exitCode: 0, output: "0 brand regressions in the merge diff (main..HEAD)\n" }]);
		const green = await runSteps(plan, { stream: false, spawn: clean.spawn, log: () => {} });
		expect(green[0]!.status).toBe("pass");
	});

	test("a missing verdict line is never read as clean", async () => {
		const { spawn } = stub([{ exitCode: 0, output: "" }]);
		const plan = planSteps(parseArgs([])).filter(step => step.id === "audit-brand-regressions");
		const results = await runSteps(plan, { stream: false, spawn, log: () => {} });
		expect(results[0]!.status).toBe("fail");
	});

	test("a skipped step shells out to nothing", async () => {
		const { spawn, calls } = stub([{ exitCode: 0, output: "" }]);
		const results = await runSteps(
			[{ id: "r", name: "rustfmt", phase: "guard", commands: [["cargo", "fmt"]], skipWhen: () => "no Rust change" }],
			{ stream: false, spawn, log: () => {} },
		);
		expect(results[0]!.status).toBe("skip");
		expect(results[0]!.detail).toBe("no Rust change");
		expect(calls).toHaveLength(0);
	});
});

describe("formatSummary", () => {
	const results: StepResult[] = [
		result({ id: "version-line", name: "version line", status: "pass", seconds: 1.2 }),
		result({
			id: "brand",
			name: "brand residue",
			status: "fail",
			seconds: 0.9,
			firstError: "12 hit(s), first: x.ts",
		}),
		result({ id: "rustfmt", name: "rustfmt", status: "skip", seconds: 0, detail: "no Rust change since main" }),
	];

	test("is one row per step: name, verdict, duration, first error", () => {
		const summary = formatSummary(results, { seconds: 131.4 });
		expect(summary).toContain("version line");
		expect(summary).toContain("1.2s");
		expect(summary).toContain("900ms"); // the sub-second step
		expect(summary).toContain("12 hit(s), first: x.ts");
		expect(summary).toContain("no Rust change since main");
		expect(summary).toContain("brand residue");
		expect(summary.split("\n").length).toBeLessThanOrEqual(60);
	});

	test("verdict is FAIL and the failed steps are listed once", () => {
		const summary = formatSummary(results, { seconds: 131.4 });
		expect(summary).toContain("FAIL");
		expect(summary.match(/brand residue/g)!.length).toBeLessThanOrEqual(3);
		expect(summary).toContain("failed: brand residue");
	});

	test("an all-green run says PASS", () => {
		const summary = formatSummary([result({ name: "version line", status: "pass", seconds: 2 })], { seconds: 2 });
		expect(summary).toContain("PASS");
		expect(summary).not.toContain("failed:");
	});

	test("formatSeconds keeps bun's bracket style", () => {
		expect(formatSeconds(0.42)).toBe("420ms");
		expect(formatSeconds(3.25)).toBe("3.3s");
		expect(formatSeconds(131.44)).toBe("2m11s");
	});
});

describe("verdictExitCode", () => {
	test("all green (or skipped) exits 0", () => {
		expect(verdictExitCode([result({ status: "pass" }), result({ status: "skip" })])).toBe(0);
	});

	test("one failure exits non-zero, however many passed", () => {
		expect(verdictExitCode([result({ status: "pass" }), result({ status: "fail" })])).not.toBe(0);
	});
});

describe("cli", () => {
	const run = (args: string[]) => {
		const proc = Bun.spawnSync([process.execPath, SCRIPT, ...args], {
			stdout: "pipe",
			stderr: "pipe",
			stdin: "ignore",
		});
		return {
			exitCode: proc.exitCode,
			stdout: proc.stdout.toString(),
			stderr: proc.stderr.toString(),
		};
	};

	// These spawn a real `bun scripts/merge-gate.ts`; a cold bun start plus a git
	// probe costs a few seconds on a busy box, well past bun test's 5 s default.
	test("--dry-run prints the plan and runs nothing", () => {
		const gates = run(["--dry-run", "--gates-only"]);
		expect(gates.exitCode).toBe(0);
		expect(gates.stdout).toContain("scripts/brand/brand-check.ts");
		expect(gates.stdout).not.toContain("vitest");

		const full = run(["--dry-run"]);
		expect(full.exitCode).toBe(0);
		expect(full.stdout).toContain("vitest");
		expect(full.stdout).toContain("packages/stats/test");
	}, 60_000);

	test("a failing step exits non-zero and the summary names it", () => {
		// An unresolvable --base makes the member audit fail (exit 2, its own
		// "could not audit" code) before it scans anything, so this is a real
		// CLI failure with a real first-error line and a sub-second runtime.
		const bad = run(["--only", "audit-members", "--base", "zeta-no-such-ref-xyz"]);
		expect(bad.exitCode).not.toBe(0);
		expect(bad.stdout).toContain("FAIL");
		expect(bad.stdout).toContain("merge member loss");
	}, 60_000);

	test("an unknown step selector is an error, not a silent no-op", () => {
		const none = run(["--only", "no-such-step"]);
		expect(none.exitCode).not.toBe(0);
		expect(none.stderr).toContain("no step matched");
	}, 60_000);
});
