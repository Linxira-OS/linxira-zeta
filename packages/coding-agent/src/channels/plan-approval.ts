/**
 * plan-approval — remote plan-approval execution for `zeta serve` (no TUI).
 *
 * Replicates the core branches of interactive-mode's `#approvePlan` for the
 * web/IM path, operating directly on the `AgentSession`:
 *
 * - `preserve` — keep the transcript, inject the approved-plan synthetic prompt.
 * - `compact`  — distill the plan-mode transcript, then inject the prompt.
 * - `fresh`    — start a new conversation, persist the approved plan, inject.
 * - `cancel`   — do nothing; plan mode stays active.
 *
 * The synthetic approved-plan prompt (`plan-mode-approved.md`) makes the agent
 * read `planFilePath` and execute the plan with full tool access. Unlike the
 * interactive path this never touches TUI state — serve mode has no UI.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { isEnoent, logger, prompt } from "@linxiraos/pi-utils";
import { type LocalProtocolOptions, resolveLocalUrlToPath } from "../internal-urls";
import planModeApprovedPrompt from "../prompts/system/plan-mode-approved.md" with { type: "text" };
import planModeCompactInstructionsPrompt from "../prompts/system/plan-mode-compact-instructions.md" with { type: "text" };
import type { AgentSession } from "../session/agent-session";

export type PlanApproveMode = "preserve" | "compact" | "fresh" | "cancel";

export interface PlanApprovalRequest {
	planFilePath: string;
	mode: PlanApproveMode;
}

export interface PlanApprovalResult {
	approved: boolean;
	error?: string;
}

async function readPlanFile(planFilePath: string, localProtocolOptions: LocalProtocolOptions): Promise<string | null> {
	try {
		const resolved = resolveLocalUrlToPath(planFilePath, localProtocolOptions);
		const content = await Bun.file(resolved).text();
		return content.trim() ? content : null;
	} catch (error) {
		if (isEnoent(error)) return null;
		throw error;
	}
}

async function writePlanFile(
	planFilePath: string,
	content: string,
	localProtocolOptions: LocalProtocolOptions,
): Promise<void> {
	const resolved = resolveLocalUrlToPath(planFilePath, localProtocolOptions);
	await fs.promises.mkdir(path.dirname(resolved), { recursive: true });
	await fs.promises.writeFile(resolved, content, "utf8");
}

/**
 * Execute the plan-approval decision for the given session. Resolves when the
 * approved-execution turn finishes (the prompt call blocks for the whole run).
 */
export async function approveRemotePlan(
	session: AgentSession,
	request: PlanApprovalRequest,
	localProtocolOptions: LocalProtocolOptions,
): Promise<PlanApprovalResult> {
	const { planFilePath, mode } = request;

	if (mode === "cancel") {
		return { approved: false };
	}

	const planContent = await readPlanFile(planFilePath, localProtocolOptions);
	if (planContent === null) {
		return { approved: false, error: `Plan file not found: ${planFilePath}` };
	}

	try {
		// Leave plan mode so the execution turn runs with the normal toolset.
		session.setPlanModeState(undefined);

		if (mode === "fresh") {
			// New conversation: clear the transcript, then persist the approved
			// plan at the (possibly re-keyed) artifacts path so the synthetic
			// prompt's read lands on disk.
			await session.newSession();
			await writePlanFile(planFilePath, planContent, localProtocolOptions);
		} else if (mode === "compact") {
			const compactionPrompt = prompt.render(planModeCompactInstructionsPrompt, { planFilePath });
			await session.compact(compactionPrompt);
		}

		session.setPlanReferencePath(planFilePath);
		session.markPlanReferenceSent();
		const approvedPrompt = prompt.render(planModeApprovedPrompt, {
			planFilePath,
			planContent,
			contextPreserved: mode !== "fresh",
		});
		await session.prompt(approvedPrompt);
		return { approved: true };
	} catch (error) {
		logger.warn("Remote plan approval failed", {
			mode,
			error: error instanceof Error ? error.message : String(error),
		});
		return { approved: false, error: error instanceof Error ? error.message : String(error) };
	}
}
