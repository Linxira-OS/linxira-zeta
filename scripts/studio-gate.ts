#!/usr/bin/env bun
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { formatSummary, runSteps, verdictExitCode, type GateStep, type SpawnFn } from "./merge-gate";

const ROOT = path.resolve(import.meta.dir, "..");
const HOST_TESTS = [
	"studio-host-contexts",
	"studio-context-selection",
	"studio-host-ops",
	"studio-host-command-manifest",
	"studio-stream-identity",
	"studio-conversation-feed",
	"studio-browser-control",
	"studio-managed-browser",
	"tools/studio-browser-observation",
	"web-gateway/terminal",
	"web-gateway/workspace-files",
	"studio-web-app",
	"studio-host-evaluation-binding",
	"studio-host-evaluation-producer",
	"studio-computer-policy",
	"studio-computer-workspace",
	"studio-computer-ownership",
	"studio-time-travel-store",
	"studio-time-travel-runtime",
	"hindsight-private-credentials",
	"studio-service-fencing",
	"studio-service-preview",
	"studio-host-services",
].map(name => `packages/coding-agent/test/${name}.test.ts`);
const AUTH_TESTS = [
	"packages/coding-agent/test/studio-host-loopback-auth.test.ts",
	"packages/coding-agent/test/studio-host-remote-access.test.ts",
	"packages/coding-agent/test/server-auth/remote-network.e2e.test.ts",
	"packages/coding-agent/test/server-auth/two-factor-auth.test.ts",
];
const RENDERER_TESTS = [
	"src/studio/App.modelSelection.test.tsx",
	"src/studio/conversationWorkspace",
	"src/studio/core/terminalSessions.test.ts",
	"src/studio/transportContexts.test.ts",
	"src/studio/RuntimeLossBanner.test.tsx",
	"src/studio/composer/dispatch.test.ts",
	"src/studio/deck/AskImages.test.tsx",
	"src/studio/terminalSessions.test.tsx",
	"src/studio/TerminalPane.test.tsx",
	"src/studio/files/FilePane.test.tsx",
	"src/studio/evaluation/EvaluationWorkspace.test.tsx",
	"src/studio/evaluation/EvaluationActivity.test.tsx",
	"src/studio/computer/ComputerWorkspace.test.tsx",
	"src/studio/computer/ComputerFrameView.test.tsx",
	"src/studio/history/TimeTravel.test.tsx",
];
export type StudioProfile = "quick" | "behavior" | "final";
export function studioSteps(profile: StudioProfile, report?: string, decisions?: string): GateStep[] {
	const steps: GateStep[] = [
		{
			id: "naming",
			name: "Studio product naming",
			phase: "guard",
			cwd: "web-app",
			commands: [["bun", "run", "check:naming"]],
		},
		{
			id: "types",
			name: "Renderer and desktop types",
			phase: "guard",
			commands: [["bun", "scripts/check-studio-types.ts"]],
		},
		{
			id: "host-types",
			name: "Production Host types",
			phase: "guard",
			commands: [["bun", "check", "--no-script", "-p", "packages/coding-agent/tsconfig.json"]],
		},
	];
	if (profile === "quick") return steps;
	steps.push(
		{
			id: "sync-regressions",
			name: "Mapped merge safety regressions",
			phase: "test",
			commands: [["bun", "test", "scripts/studio-sync.test.ts", "scripts/check-studio-sync.test.ts"]],
		},
		{ id: "host", name: "Conversation Host and identity", phase: "test", commands: [["bun", "test", ...HOST_TESTS]] },
		{ id: "auth", name: "Cookie device 2FA remote auth", phase: "test", commands: [["bun", "test", ...AUTH_TESTS]] },
		{
			id: "shared",
			name: "Bun and Node Studio contracts",
			phase: "test",
			cwd: "web-app",
			commands: [["bun", "scripts/test-runtimes.ts"]],
		},
		{
			id: "renderer",
			name: "Conversation and terminal behavior",
			phase: "test",
			cwd: "web-app",
			commands: [
				["node", "node_modules/vitest/vitest.mjs", "run", "--maxWorkers=2", "--reporter=dot", ...RENDERER_TESTS],
			],
		},
		{
			id: "desktop",
			name: "Desktop bridge behavior",
			phase: "test",
			cwd: "desktop",
			commands: [
				["bun", "../scripts/check-studio-types.ts", "--emit-desktop"],
				[
					"node",
					"--test",
					"scripts/preload-bridge.test.mjs",
					"scripts/remote-bridge.test.mjs",
					"scripts/remote-protocol.test.mjs",
					"scripts/workspace-state.test.mjs",
					"scripts/terminal-recorder.test.mjs",
					"scripts/serve-discovery.test.mjs",
				],
			],
		},
	);
	if (profile === "final")
		steps.push(
			{
				id: "accounting",
				name: "Complete decisions and source ancestry",
				phase: "audit",
				commands: [
					[
						"bun",
						"scripts/check-studio-sync.ts",
						"--report",
						report ?? "<required-report>",
						...(decisions ? ["--decisions", decisions] : []),
						"--require-complete",
						"--require-ancestry",
					],
				],
			},
			{
				id: "build",
				name: "Production renderer build",
				phase: "guard",
				cwd: "web-app",
				commands: [
					["bun", "x", "--no-install", "vite", "build", "--logLevel", "warn"],
					["bun", "run", "check:first-load"],
				],
			},
			{
				id: "renderer-all",
				name: "Complete renderer behavior suite",
				phase: "test",
				cwd: "web-app",
				commands: [["node", "node_modules/vitest/vitest.mjs", "run", "--maxWorkers=2", "--reporter=dot"]],
			},
			{
				id: "desktop-all",
				name: "Complete desktop behavior suite",
				phase: "test",
				cwd: "desktop",
				commands: [
					["bun", "../scripts/check-studio-types.ts", "--emit-desktop"],
					["node", "--test", "scripts/*.test.mjs", "test/*.test.mjs"],
				],
			},
		);
	return steps;
}
async function main(): Promise<void> {
	let profile: StudioProfile = "quick",
		dryRun = false,
		only: string[] = [],
		out = `temp/studio-gate-${Date.now()}`;
	let report: string | undefined, decisions: string | undefined;
	const args = process.argv.slice(2);
	for (let index = 0; index < args.length; index++) {
		const arg = args[index]!;
		if (arg === "--help") {
			console.log(
				"bun scripts/studio-gate.ts [--profile quick|behavior|final] [--report temp/<run>/report.json] [--decisions <json>] [--only exact-id,...] [--dry-run] [--out temp/<dir>]",
			);
			return;
		}
		if (arg === "--dry-run") {
			dryRun = true;
			continue;
		}
		const value = args[++index];
		if (!value || value.startsWith("--")) throw new Error(`${arg} needs a value`);
		if (arg === "--profile" && ["quick", "behavior", "final"].includes(value)) profile = value as StudioProfile;
		else if (arg === "--only") only = value.split(",");
		else if (arg === "--out") out = value;
		else if (arg === "--report") report = value;
		else if (arg === "--decisions") decisions = value;
		else throw new Error(`unknown argument or value: ${arg} ${value}`);
	}
	let steps = studioSteps(profile, report, decisions);
	for (const id of only) if (!steps.some(step => step.id === id)) throw new Error(`unknown step ${id} in ${profile}`);
	if (only.length) steps = steps.filter(step => only.includes(step.id));
	if (dryRun) {
		for (const step of steps)
			console.log(`${step.id}\t${step.cwd ?? "."}\t${step.commands.map(command => command.join(" ")).join(" && ")}`);
		return;
	}
	if (steps.some(step => step.id === "accounting") && !report)
		throw new Error("final accounting requires --report and explicit decisions for every unresolved path");
	const directory = path.resolve(ROOT, out);
	const relative = path.relative(path.join(ROOT, "temp"), directory);
	if (relative === "") throw new Error("--out must name a directory below temp/");
	try {
		await fs.lstat(directory);
		throw new Error("--out already exists; use a new directory to preserve gate evidence");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("--out must be inside repository temp/");
	await fs.mkdir(directory, { recursive: true });
	let invocation = 0;
	const spawn: SpawnFn = async (argv, cwd) => {
		const log = path.join(directory, `${++invocation}-${path.basename(argv[0]!)}.log`);
		const child = Bun.spawn(argv, {
			cwd: path.join(ROOT, cwd),
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
			windowsHide: true,
		});
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		const output = stdout + stderr;
		await Bun.write(log, output);
		return { exitCode, output };
	};
	const start = performance.now();
	const results = await runSteps(steps, { stream: false, spawn });
	console.log(formatSummary(results, { seconds: (performance.now() - start) / 1000 }));
	await Bun.write(
		path.join(directory, "report.json"),
		JSON.stringify(
			{
				profile,
				partial: only.length > 0,
				results,
				liveAcceptance: "separate: browser/native desktop/SSH/source-matched native/CI",
			},
			null,
			2,
		) + "\n",
	);
	console.log(`Evidence: ${directory}; this profile does not certify live/native/SSH or source ancestry.`);
	process.exitCode = verdictExitCode(results);
}
if (import.meta.main)
	await main().catch(error => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 2;
	});
