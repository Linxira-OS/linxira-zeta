/**
 * Headless `/cleanse`: the same detector/repair loop as the TUI overlay and the
 * `zetacode cleanse` CLI, driven by a text board.
 *
 * The TUI keeps its overlay (`handleTui`); ACP, RPC and an attached client use
 * this handler so the work runs in the backend's session workspace and its
 * progress reaches the client through `runtime.output`.
 */

import type { CleanseStatusBoard } from "@linxiraos/pi-tui/apps/cleanse-board";
import { runCleanse, type CleanseCommandOptions } from "../cleanse";
import type { CleanseAssignment, CleanseAgentOutcome, CleanseCheckResult } from "../cleanse/types";
import { commandConsumed } from "./helpers/parse";
import type { ParsedSlashCommand, SlashCommandResult, SlashCommandRuntime } from "./types";

const CLEANSE_USAGE = "Usage: /cleanse [request] [--all] [--tests] [-n <agents>] [-m <model>]";

interface ParsedCleanseArgs extends CleanseCommandOptions {
	error?: string;
}

/** Parse `/cleanse` arguments without the TUI's interactive picker fields. */
export function parseCleanseArgs(args: string): ParsedCleanseArgs {
	const tokens = args.split(/\s+/).filter(Boolean);
	const requestParts: string[] = [];
	const parsed: ParsedCleanseArgs = { all: false, includeTests: false };
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i] ?? "";
		if (token === "--all" || token === "-a") {
			parsed.all = true;
		} else if (token === "--tests" || token === "-t") {
			parsed.includeTests = true;
		} else if (token === "--agents" || token === "-n") {
			const value = Number(tokens[++i]);
			if (!Number.isInteger(value) || value <= 0) return { ...parsed, error: CLEANSE_USAGE };
			parsed.maxAgents = value;
		} else if (token === "--model" || token === "-m") {
			const value = tokens[++i];
			if (!value) return { ...parsed, error: CLEANSE_USAGE };
			parsed.model = value;
		} else if (token.startsWith("-") && token.length > 1 && !/^-\d/.test(token)) {
			return { ...parsed, error: CLEANSE_USAGE };
		} else {
			requestParts.push(token);
		}
	}
	parsed.request = requestParts.join(" ") || undefined;
	return parsed;
}

function createTextBoard(output: (text: string) => void): CleanseStatusBoard {
	return {
		interactive: false,
		log: text => output(text),
		phase: () => undefined,
		checkerStarted: () => undefined,
		checkerFinished: (check: CleanseCheckResult) => {
			if (check.exitCode !== 0) output(`checker ${check.label}: exit ${check.exitCode ?? "error"}`);
		},
		repairFinished: () => undefined,
		agentStarted: (_name: string, assignment: CleanseAssignment) => {
			output(`repair agent ${assignment.index + 1} started (${assignment.weight} issue groups)`);
		},
		agentProgress: () => undefined,
		agentFinished: (outcome: CleanseAgentOutcome, assignment: CleanseAssignment) => {
			const detail = outcome.success ? "completed" : `failed${outcome.error ? `: ${outcome.error}` : ""}`;
			output(`repair agent ${assignment.index + 1} ${detail}`);
		},
		close: () => undefined,
	};
}

/** Run one cleanse pass and report permanent lines through `runtime.output`. */
export async function runCleanseCommand(
	options: CleanseCommandOptions,
	runtime: SlashCommandRuntime,
): Promise<SlashCommandResult> {
	const output = (text: string) => void runtime.output(text);
	try {
		const result = await runCleanse(
			{ ...options, cwd: runtime.cwd },
			{
				board: createTextBoard(output),
				print: output,
				printError: output,
			},
			runtime.signal ?? new AbortController().signal,
		);
		output(`Cleanse ${result.status}: ${result.report.diagnostics.length} diagnostic(s) remaining.`);
		return commandConsumed({ failed: result.status === "unresolved" });
	} catch (error) {
		output(`Cleanse failed: ${error instanceof Error ? error.message : String(error)}`);
		return commandConsumed({ failed: true });
	}
}

/** `/cleanse` handler for the ACP/RPC runtime (and attached clients). */
export async function handleCleanseSlashCommand(
	command: ParsedSlashCommand,
	runtime: SlashCommandRuntime,
): Promise<SlashCommandResult> {
	const parsed = parseCleanseArgs(command.args);
	if (parsed.error) {
		await runtime.output(parsed.error);
		return commandConsumed({ failed: true });
	}
	const run = () => runCleanseCommand(parsed, runtime);
	if (runtime.runCommandInBackground) {
		runtime.runCommandInBackground(async () => {
			await run();
		});
		return commandConsumed();
	}
	return await run();
}
