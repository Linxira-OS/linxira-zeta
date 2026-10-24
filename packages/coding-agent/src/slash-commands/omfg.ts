/**
 * Headless `/omfg`: turn a complaint into a validated TTSR rule and save it.
 *
 * The TUI keeps its live panel (draft streaming, save-location picker, amend
 * loop); ACP/RPC and attached clients use this handler, which picks the project
 * scope by default (`--global` for the user scope) and overwrites an existing
 * rule of the same name. `--force` saves a candidate whose condition could not
 * be confirmed against the transcript.
 */

import * as path from "node:path";
import { invalidate as invalidateCapabilityCache } from "../capability";
import { CONFIG_DIR_NAME, prompt } from "@linxiraos/pi-utils";
import omfgUserPrompt from "../prompts/system/omfg-user.md" with { type: "text" };
import { TtsrToolInspector } from "../session/ttsr-outputs";
import {
	buildOmfgRuleForPath,
	historyOutputs,
	parseGeneratedRule,
	validateParsedRuleAgainstAssistantHistory,
	type ParsedGeneratedRule,
	type ParsedRuleHistoryValidation,
} from "../modes/controllers/omfg-rule";
import { commandConsumed } from "./helpers/parse";
import type { ParsedSlashCommand, SlashCommandResult, SlashCommandRuntime } from "./types";

const OMFG_USAGE = "Usage: /omfg [--global] [--force] <complaint>";
const MAX_ATTEMPTS = 3;

interface ParsedOmfgArgs {
	complaint: string;
	global: boolean;
	force: boolean;
	error?: string;
}

export function parseOmfgArgs(args: string): ParsedOmfgArgs {
	let global = false;
	let force = false;
	const words: string[] = [];
	for (const token of args.split(/\s+/).filter(Boolean)) {
		if (token === "--global" || token === "-g") global = true;
		else if (token === "--force" || token === "-f") force = true;
		else words.push(token);
	}
	const complaint = words.join(" ").trim();
	return { complaint, global, force, ...(complaint ? {} : { error: OMFG_USAGE }) };
}

async function generateCandidate(
	runtime: SlashCommandRuntime,
	complaint: string,
	output: (text: string) => void,
): Promise<{ candidate: ParsedGeneratedRule; validated: boolean } | undefined> {
	const session = runtime.session;
	const inspector = new TtsrToolInspector(
		() => session.agent.state.tools,
		() => runtime.cwd,
	);
	const failedAttempts: string[] = [];
	let previousRule: string | undefined;
	let lastCandidate: ParsedGeneratedRule | undefined;

	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		if (runtime.signal?.aborted) return undefined;
		output(`omfg: attempt ${attempt}/${MAX_ATTEMPTS} generating…`);
		const promptText = prompt.render(omfgUserPrompt, {
			complaint,
			feedback: failedAttempts.length > 0 ? failedAttempts.join("\n\n") : undefined,
			previousRule,
		});
		const { replyText } = await session.runEphemeralTurn({
			promptText,
			dedupeReply: false,
			signal: runtime.signal,
		});
		const parsed = parseGeneratedRule(replyText);
		if ("error" in parsed) {
			failedAttempts.push(`Attempt ${attempt} failed: invalid rule (${parsed.error}).`);
			previousRule = replyText.trim();
			continue;
		}

		output(`omfg: attempt ${attempt}/${MAX_ATTEMPTS} validating…`);
		const validated: ParsedRuleHistoryValidation = await validateParsedRuleAgainstAssistantHistory(
			parsed,
			historyOutputs(session.messages, inspector),
			parsed.rule.question !== undefined ? session.ruleJudge() : undefined,
		);
		if (validated.validation.matched) {
			return { candidate: validated.candidate, validated: true };
		}
		if (validated.validation.judgeUnavailable) {
			return { candidate: validated.candidate, validated: false };
		}
		lastCandidate = validated.candidate;
		failedAttempts.push(
			`Attempt ${attempt} failed validation:\n${
				validated.validation.feedback ?? "The rule condition did not match any earlier assistant output."
			}`,
		);
		previousRule = validated.candidate.fileContent;
	}
	return lastCandidate ? { candidate: lastCandidate, validated: false } : undefined;
}

/** Generate and save one rule; returns whether the rule was written. */
export async function runOmfgCommand(
	runtime: SlashCommandRuntime,
	options: ParsedOmfgArgs,
): Promise<SlashCommandResult> {
	const output = (text: string) => void runtime.output(text);
	try {
		const generated = await generateCandidate(runtime, options.complaint, output);
		if (!generated) {
			output("omfg: the model did not return a valid TTSR rule.");
			return commandConsumed({ failed: true });
		}
		if (!generated.validated && !options.force) {
			output(
				"omfg: the rule condition could not be confirmed against this transcript; rerun with --force to save it anyway.",
			);
			return commandConsumed({ failed: true });
		}
		const ruleName = generated.candidate.rule.name;
		const filePath = options.global
			? path.join(runtime.settings.getAgentDir(), "rules", `${ruleName}.md`)
			: path.join(runtime.cwd, CONFIG_DIR_NAME, "rules", `${ruleName}.md`);
		await Bun.write(filePath, generated.candidate.fileContent);
		// Invalidate the file, its rules dir, and the config dir so the next
		// discovery pass sees a first-ever rules directory too.
		invalidateCapabilityCache(filePath);
		invalidateCapabilityCache(path.dirname(filePath));
		invalidateCapabilityCache(path.dirname(path.dirname(filePath)));
		const level = options.global ? "user" : "project";
		runtime.session.ttsrManager?.addRule(
			buildOmfgRuleForPath(ruleName, generated.candidate.fileContent, filePath, level),
		);
		output(`omfg: saved ${ruleName} to ${filePath}${generated.validated ? "" : " (unconfirmed)"}.`);
		return commandConsumed();
	} catch (error) {
		output(`omfg failed: ${error instanceof Error ? error.message : String(error)}`);
		return commandConsumed({ failed: true });
	}
}

/** `/omfg` handler for ACP/RPC and attached clients. */
export async function handleOmfgSlashCommand(
	command: ParsedSlashCommand,
	runtime: SlashCommandRuntime,
): Promise<SlashCommandResult> {
	const parsed = parseOmfgArgs(command.args);
	if (parsed.error) {
		await runtime.output(parsed.error);
		return commandConsumed({ failed: true });
	}
	const run = () => runOmfgCommand(runtime, parsed);
	if (runtime.runCommandInBackground) {
		runtime.runCommandInBackground(async () => {
			await run();
		});
		return commandConsumed();
	}
	return await run();
}
