#!/usr/bin/env bun
/**
 * One-command post-merge gate: `bun run merge-gate`.
 *
 * The repo has four layers of verification (mechanical guards, merge audits,
 * behaviour tests, and a human checklist), but before this script no single
 * command ran them together: the guards live in the `check` job, the audits were
 * manual steps in `document/merge-review.md`, and the behaviour suites sat
 * behind `bun run test`, which nothing made anyone run after a merge. A broken
 * merge therefore surfaced wherever the next unrelated PR happened to trip it.
 *
 * This script runs every layer in one pass and ends on a **single-page summary**
 * — one row per step with its verdict, its wall time, and (on a failure) the
 * first error line — then exits non-zero if anything failed.
 *
 * Phases, in the order they run:
 *
 *   1. `guard`  every mechanical gate that exists today, in dependency order:
 *               version line → type check → brand/sentinel/CI-surface/… →
 *               local-ci parity → generated-asset freshness → manifest merge
 *               driver → (only when Rust changed) `cargo fmt --all -- --check`.
 *               `scripts/check-version-consistency.ts` is first because damage
 *               class 1/2 (a broken catalog/version line) makes every other
 *               step fail for the wrong reason.
 *   2. `audit`  the three pre-merge audits that used to be human checklist
 *               items, with their real CLI contracts (all read from source):
 *                 * `scripts/audit-merge-members.ts --base <ref>`  — exit 0
 *                   clean, 1 members dropped, 2 could-not-audit;
 *                 * `scripts/scan-brand-regressions.ts --base <ref>` — prints
 *                   "<n> brand regressions in the merge diff" and **always exits
 *                   0**, so the gate parses that line and treats a missing
 *                   verdict as a failure rather than as "clean";
 *                 * `scripts/check-merge-lineage.ts [--tag <tag>]` — `--tag`
 *                   adds the candidate-tag half; without it the ledger baseline
 *                   and the ancestry check still run.
 *               Without `--base` all three default to `main`.
 *   3. `test`   the behaviour suites: the guard regression tests the `check` job
 *               runs, `bun run test:ts` (every workspace/native/coding-agent
 *               bucket that CI shards), plus the orphan suites no CI job ran
 *               before — `packages/stats/test` (bun test) and
 *               `plugins/official/pi-messenger/tests` (**vitest**, outside the
 *               bun workspace, so it gets its own `npm install` + `npx vitest
 *               run`, a standalone-vitest shape no workspace bucket hosts).
 *
 * Usage:
 *   bun run merge-gate                      # everything
 *   bun run merge-gate --gates-only         # phases 1+2 — the pre-merge quick gate
 *   bun run merge-gate --base v18.10.0 --tag v18.10.1
 *   bun run merge-gate --only audit-members # re-run one step after fixing it
 *   bun run merge-gate --dry-run            # print the plan, run nothing
 *   bun run merge-gate --quiet              # only replay the output of failures
 *
 * Known machine-dependent false reds are deliberately *not* papered over here
 * (no LANG/TZ forcing): a gate that hides them hides real ones too. The two this
 * box hits are an unbuilt local native addon (`packages/natives/native/…`) and
 * `check:nix-bun`, which needs network access to fetch bun2nix.
 */

import * as path from "node:path";

export type Phase = "guard" | "audit" | "test";
export type Status = "pass" | "fail" | "skip";

export interface StepOutcome {
	exitCode: number;
	output: string;
}

/** Runs one argv in `cwd` (repo-relative) and returns its exit code + combined output. */
export type SpawnFn = (argv: string[], cwd: string, stream: boolean) => Promise<StepOutcome>;

export interface GateStep {
	id: string;
	name: string;
	phase: Phase;
	/** One or more argv invocations, run in order; the first non-zero stops the step. */
	commands: string[][];
	/** Repo-relative working directory (default: the repo root). */
	cwd?: string;
	/** Set when the step does not go through a plain `bun test` entry point. */
	runner?: string;
	/** Returns the reason to skip, or undefined to run. */
	skipWhen?: () => string | undefined;
	/** Verdict override for tools that report their finding but always exit 0. */
	interpret?: (outcome: StepOutcome) => { status: Status; detail?: string } | undefined;
}

export interface StepResult {
	id: string;
	name: string;
	phase: Phase;
	status: Status;
	seconds: number;
	runner?: string;
	detail?: string;
	firstError?: string;
}

export interface MergeGateOptions {
	gatesOnly: boolean;
	base: string;
	tag?: string;
	dryRun: boolean;
	only: string[];
	quiet: boolean;
}

const REPO_ROOT = path.join(import.meta.dir, "..");
const BASE_DEFAULT = "main";
const PHASES: Phase[] = ["guard", "audit", "test"];

/** Rust-relevant paths, for the conditional `cargo fmt`/`cargo nextest` steps. */
const RUST_PATHS = ["crates", "Cargo.toml", "Cargo.lock", "rustfmt.toml", "*.rs"];

/** Guard regression tests the `check` job runs — the fixtures prove the guards can fail. */
const GUARD_TESTS = [
	"scripts/check-package-json-merge.test.ts",
	"scripts/merge-package-json.test.ts",
	"scripts/audit-merge-members.test.ts",
	"scripts/check-i18n-consistency.test.ts",
	"scripts/check-i18n-commands.test.ts",
];

const HELP = `merge gate — every mechanical guard, merge audit and behaviour suite in one pass

usage: bun run merge-gate [options]

  --gates-only    run phases 1+2 (guards + merge audits), skip the behaviour tests
  --base <ref>    pre-merge ref for the merge audits (default: ${BASE_DEFAULT})
  --tag <tag>     upstream candidate tag for the lineage audit
  --only <ids>    comma-separated step ids to run instead of everything
                  (ids are printed by --dry-run; a substring of the id or the
                  step name matches too, e.g. --only audit-)
  --dry-run       print the plan and exit
  --quiet         capture output and replay it only for failing steps
  -h, --help      this text`;

// ── argument parsing ────────────────────────────────────────────────────────

export function parseArgs(argv: string[]): MergeGateOptions {
	const options: MergeGateOptions = {
		gatesOnly: false,
		base: BASE_DEFAULT,
		dryRun: false,
		only: [],
		quiet: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]!;
		const value = (): string => {
			const next = argv[++i];
			if (next === undefined || next.startsWith("--")) throw new Error(`${arg} needs a value`);
			return next;
		};
		switch (arg) {
			case "--gates-only":
				options.gatesOnly = true;
				break;
			case "--dry-run":
				options.dryRun = true;
				break;
			case "--quiet":
				options.quiet = true;
				break;
			case "--base":
				options.base = value();
				break;
			case "--tag":
				options.tag = value();
				break;
			case "--only":
				options.only = value()
					.split(",")
					.map(entry => entry.trim())
					.filter(Boolean);
				break;
			default:
				throw new Error(`unknown argument ${arg}`);
		}
	}
	return options;
}

// ── git probes for the conditional steps ────────────────────────────────────

/** Paths changed between `base` and HEAD under `spec`, or undefined when git cannot diff the ref. */
function changedPaths(base: string, spec: string[]): string[] | undefined {
	const result = Bun.spawnSync(["git", "diff", "--name-only", base, "HEAD", "--", ...spec], {
		cwd: REPO_ROOT,
		stdout: "pipe",
		stderr: "pipe",
	});
	if (result.exitCode !== 0) return undefined;
	return result.stdout.toString().split("\n").filter(Boolean);
}

/**
 * Why the Rust steps should be skipped, or undefined to run them. A change set
 * that cannot be diffed is *not* a reason to skip: the guard runs instead.
 */
function rustSkipReason(base: string): string | undefined {
	const changed = changedPaths(base, RUST_PATHS);
	if (changed?.length === 0) return `no Rust change since ${base}`;
	const cargo = Bun.spawnSync(["cargo", "--version"], { stdout: "pipe", stderr: "pipe" });
	if (cargo.exitCode !== 0) return "cargo is not on PATH";
	return undefined;
}

// ── the plan ────────────────────────────────────────────────────────────────

/** `scripts/scan-brand-regressions.ts` prints its verdict and exits 0 either way. */
const BRAND_REGRESSION_TOTAL = /^(\d+) brand regressions in the merge diff\b/m;

const guard = (id: string, name: string, script: string): GateStep => ({
	id,
	name,
	phase: "guard",
	commands: [["bun", script]],
});

export function planSteps(options: MergeGateOptions): GateStep[] {
	const { base, tag } = options;
	let steps: GateStep[] = [
		// Damage classes 1/2: a broken catalog/version line makes every other
		// step fail for the wrong reason, so it is settled first.
		guard("version-line", "version line", "scripts/check-version-consistency.ts"),
		{
			id: "typecheck",
			name: "type check (workspace)",
			phase: "guard",
			commands: [["bun", "run", "ci:check:full"]],
		},
		guard("brand", "brand residue", "scripts/brand/brand-check.ts"),
		guard("sentinels", "zeta-only sentinels", "scripts/check-zeta-sentinels.ts"),
		guard("shared-infra", "shared-infra ledger", "scripts/check-shared-infra.ts"),
		guard("scope-imports", "scope imports", "scripts/check-scope-imports.ts"),
		guard("ci-surface", "CI release surface", "scripts/check-ci-surface.ts"),
		guard("release-assets", "release asset names", "scripts/check-release-asset-names.ts"),
		guard("i18n-catalogue", "i18n catalogue consistency", "scripts/check-i18n-consistency.ts"),
		guard("i18n-commands", "i18n command descriptions", "scripts/check-i18n-commands.ts"),
		guard("serve-discovery", "serve-discovery parity", "scripts/check-serve-discovery-parity.ts"),
		guard("robomp-contract", "robomp container CLI contract", "scripts/check-robomp-cli-contract.ts"),
		guard("local-ci-parity", "local-ci parity", "scripts/check-local-ci-parity.ts"),
		{
			id: "nix-bun-freshness",
			name: "nix bun pin freshness",
			phase: "guard",
			commands: [["bun", "run", "check:nix-bun"]],
			runner: "needs network (fetches bun2nix)",
		},
		{
			id: "relay-assets-freshness",
			name: "relay extension assets freshness",
			phase: "guard",
			commands: [["bun", "run", "check:relay-assets"]],
		},
		guard("package-json-merge", "package.json merge-drop", "scripts/check-package-json-merge.ts"),
		{
			id: "rustfmt",
			name: "Rust format (cargo fmt --all -- --check)",
			phase: "guard",
			commands: [["cargo", "fmt", "--all", "--", "--check"]],
			skipWhen: () => rustSkipReason(base),
		},

		{
			id: "audit-members",
			name: "merge member loss",
			phase: "audit",
			// `--tag` lets the audit split its findings into real losses and
			// upstream's own removals in the merged window; without it the audit
			// falls back to the ledger's `Integrated through` tag.
			commands: [["bun", "scripts/audit-merge-members.ts", "--base", base, ...(tag ? ["--tag", tag] : [])]],
		},
		{
			id: "audit-brand-regressions",
			name: "brand regression scan",
			phase: "audit",
			commands: [["bun", "scripts/scan-brand-regressions.ts", "--base", base]],
			// The scanner is report-only by design ("no exit code"), so the gate
			// owns the verdict — and refuses to read a missing one as clean.
			interpret: outcome => {
				if (outcome.exitCode !== 0) return undefined;
				const match = BRAND_REGRESSION_TOTAL.exec(stripAnsi(outcome.output));
				if (!match) return { status: "fail", detail: "no brand-regression verdict line in the output" };
				const hits = Number(match[1]);
				return hits === 0
					? { status: "pass", detail: `0 regressions in the diff ${base}..HEAD` }
					: { status: "fail", detail: `${hits} brand regression(s) in the diff ${base}..HEAD` };
			},
		},
		{
			id: "audit-lineage",
			name: "upstream merge lineage",
			phase: "audit",
			commands: [["bun", "scripts/check-merge-lineage.ts", ...(tag ? ["--tag", tag] : [])]],
		},

		{
			id: "guard-tests",
			name: "guard regression tests",
			phase: "test",
			commands: [["bun", "test", ...GUARD_TESTS]],
		},
		{
			id: "ts-suite",
			name: "TS behaviour suites",
			phase: "test",
			commands: [["bun", "run", "test:ts"]],
			runner: "bun test via scripts/ci-test-ts.ts (local-ts)",
		},
		{
			id: "stats-suite",
			name: "stats package (orphan suite)",
			phase: "test",
			commands: [["bun", "test", "packages/stats/test"]],
		},
		{
			id: "plugin-suite",
			name: "pi-messenger plugin (orphan suite)",
			phase: "test",
			cwd: "plugins/official/pi-messenger",
			commands: [
				["npm", "install", "--no-audit", "--no-fund"],
				["npx", "vitest", "run"],
			],
			runner: "vitest — outside the bun workspace, so it installs its own deps",
		},
		{
			id: "rust-tests",
			name: "Rust tests (cargo nextest)",
			phase: "test",
			commands: [["bun", "run", "test:rs"]],
			skipWhen: () => rustSkipReason(base),
		},
	];

	if (options.gatesOnly) steps = steps.filter(step => step.phase !== "test");
	if (options.only.length > 0) {
		steps = steps.filter(step =>
			options.only.some(selector => step.id.includes(selector) || step.name.includes(selector)),
		);
	}
	return steps;
}

// ── running ─────────────────────────────────────────────────────────────────

const defaultSpawn: SpawnFn = async (argv, cwd, stream) => {
	const child = Bun.spawn(argv, {
		cwd: path.join(REPO_ROOT, cwd),
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	const decoder = new TextDecoder();
	let output = "";
	const pump = async (source: ReadableStream<Uint8Array>): Promise<void> => {
		for await (const chunk of source) {
			const text = decoder.decode(chunk, { stream: true });
			output += text;
			if (stream) process.stdout.write(text);
		}
	};
	await Promise.all([pump(child.stdout), pump(child.stderr)]);
	const exitCode = await child.exited;
	return { exitCode, output };
};

export interface RunOptions {
	stream: boolean;
	spawn?: SpawnFn;
	/** Where the per-step progress lines go (tests pass a sink to keep output clean). */
	log?: (message: string) => void;
}

export async function runSteps(steps: GateStep[], options: RunOptions): Promise<StepResult[]> {
	const spawn = options.spawn ?? defaultSpawn;
	const log = options.log ?? ((message: string) => process.stdout.write(`${message}\n`));
	const results: StepResult[] = [];
	for (const step of steps) {
		const identity = { id: step.id, name: step.name, phase: step.phase, runner: step.runner };
		const skipped = step.skipWhen?.();
		if (skipped !== undefined) {
			results.push({ ...identity, status: "skip", seconds: 0, detail: skipped });
			log(`  --  ${step.name} (skipped: ${skipped})`);
			continue;
		}
		log(`  ->  ${step.name}`);
		const started = performance.now();
		let output = "";
		let exitCode = 0;
		for (const command of step.commands) {
			const outcome = await spawn(command, step.cwd ?? ".", options.stream);
			output += outcome.output;
			exitCode = outcome.exitCode;
			if (exitCode !== 0) break;
		}
		const seconds = (performance.now() - started) / 1000;
		const interpreted = step.interpret?.({ exitCode, output });
		const status: Status = interpreted ? interpreted.status : exitCode === 0 ? "pass" : "fail";
		if (status === "fail" && !options.stream && output.trim() !== "") log(output.trimEnd());
		results.push({
			...identity,
			status,
			seconds,
			detail: interpreted?.detail,
			firstError: status === "fail" ? firstErrorLine(output) : undefined,
		});
	}
	return results;
}

// ── reporting ───────────────────────────────────────────────────────────────

const ANSI = /\x1b\[[0-9;]*m/g;

export function stripAnsi(value: string): string {
	return value.replace(ANSI, "");
}

/** The first line that names a failure, else the first non-empty line. */
export function firstErrorLine(output: string): string | undefined {
	const lines = stripAnsi(output)
		.split(/\r?\n/)
		.map(line => line.trim())
		.filter(Boolean);
	const found =
		lines.find(line => /\berror\b|\bFAILED\b|\bnot ok\b|✗|:\s*error\b/i.test(line)) ??
		lines.find(line => /\b(fail|failed|failure|panic|expected|received)\b/i.test(line)) ??
		lines[0];
	if (found === undefined) return undefined;
	return found.length <= 160 ? found : `${found.slice(0, 159)}…`;
}

/** bun-bracket style: `420ms` under a second, `3.3s` above, `2m11s` past a minute. */
export function formatSeconds(seconds: number): string {
	if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
	if (seconds < 60) return `${seconds.toFixed(1)}s`;
	const minutes = Math.floor(seconds / 60);
	const rest = Math.round(seconds % 60);
	return rest === 60 ? `${minutes + 1}m0s` : `${minutes}m${rest}s`;
}

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code: string, value: string): string => (useColor ? `\x1b[${code}m${value}\x1b[0m` : value);
const STATUS_LABEL: Record<Status, string> = { pass: "PASS", fail: "FAIL", skip: "SKIP" };
const STATUS_STYLE: Record<Status, string> = { pass: "32", fail: "31", skip: "2" };

export function formatSummary(results: StepResult[], options: { seconds: number }): string {
	const failed = results.filter(entry => entry.status === "fail");
	const passed = results.filter(entry => entry.status === "pass").length;
	const skipped = results.length - passed - failed.length;
	const verdict = failed.length > 0 ? "FAIL" : "PASS";
	const lines = [
		`merge gate — ${verdict} — ${passed} passed, ${failed.length} failed, ${skipped} skipped — ${formatSeconds(options.seconds)}`,
		"─".repeat(72),
	];
	for (const phase of PHASES) {
		const group = results.filter(entry => entry.phase === phase);
		if (group.length === 0) continue;
		lines.push(`${phase}s`);
		for (const entry of group) {
			const suffix = [entry.runner === undefined ? undefined : `runner: ${entry.runner}`, entry.detail]
				.filter(Boolean)
				.join(" — ");
			lines.push(
				`  ${paint(STATUS_STYLE[entry.status], STATUS_LABEL[entry.status])}  ${entry.name.padEnd(38)}${formatSeconds(entry.seconds).padStart(7)}${suffix === "" ? "" : `   ${suffix}`}`,
			);
			if (entry.firstError !== undefined) lines.push(`        ${entry.firstError}`);
		}
	}
	lines.push("─".repeat(72));
	if (failed.length > 0) lines.push(`failed: ${failed.map(entry => entry.name).join(", ")}`);
	return lines.join("\n");
}

export function verdictExitCode(results: StepResult[]): number {
	return results.some(entry => entry.status === "fail") ? 1 : 0;
}

function printPlan(steps: GateStep[], options: MergeGateOptions): void {
	console.log(
		`plan — ${steps.length} step(s) — base ${options.base}${options.tag ? `, tag ${options.tag}` : ""}${options.gatesOnly ? ", gates only" : ""}`,
	);
	for (const step of steps) {
		const command = step.commands.map(argv => argv.join(" ")).join(" && ");
		const where = step.cwd ? ` (cwd ${step.cwd})` : "";
		const runner = step.runner ? ` [${step.runner}]` : "";
		console.log(`  ${`${step.phase}/${step.id}`.padEnd(30)}${where}${command}${runner}`);
	}
}

// ── entry point ─────────────────────────────────────────────────────────────

async function main(): Promise<number> {
	const argv = process.argv.slice(2);
	if (argv.includes("--help") || argv.includes("-h")) {
		console.log(HELP);
		return 0;
	}
	let options: MergeGateOptions;
	try {
		options = parseArgs(argv);
	} catch (error) {
		console.error(`merge-gate: ${error instanceof Error ? error.message : String(error)}`);
		return 2;
	}

	const steps = planSteps(options);
	if (steps.length === 0) {
		console.error(`merge-gate: no step matched --only ${options.only.join(",")}`);
		return 2;
	}
	if (options.dryRun) {
		printPlan(steps, options);
		return 0;
	}

	console.log(
		`merge gate — ${steps.length} step(s) — base ${options.base}${options.tag ? `, tag ${options.tag}` : ""}${options.gatesOnly ? ", gates only" : ""}`,
	);
	const started = performance.now();
	const results = await runSteps(steps, { stream: !options.quiet });
	const summary = formatSummary(results, { seconds: (performance.now() - started) / 1000 });
	console.log(`\n${summary}`);
	return verdictExitCode(results);
}

if (import.meta.main) process.exit(await main());
