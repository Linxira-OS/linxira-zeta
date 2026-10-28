import { M } from "../i18n";
import { cfgTuiSidebar } from "../modes/settings";
import { type PauseWorkStatus, runPauseScreen } from "@linxiraos/pi-tui/overlays/pause-screen";
import { AgentRegistry } from "../registry/agent-registry";
import type { AgentSession } from "../session/agent-session";
import { clearApprovalGrants } from "../tools/approval-cache";
import { clearSubmittedText } from "./helpers/draft";
import { shutdownHandlerTui } from "./helpers/shutdown";
import { commandConsumed, errorMessage, usage } from "./helpers/parse";
import type { SlashCommandSpec } from "./types";
import { LIVE_DISABLED_MESSAGE, LIVE_FEATURE_ENABLED } from "../live/feature-gate";

/** Advisors with review work they can still run (not parked, yielded, or quota-paused). */
function advisorUnsettledCount(session: AgentSession): number {
	return session
		.getAdvisorStatusOverview()
		.advisors.filter(advisor => advisor.backlog > 0 && !advisor.isPaused && !advisor.yielded).length;
}

/**
 * Outstanding work for the `/pause` screen. A subagent counts as a turn only
 * while its session streams and is not parked; its task job is deduplicated
 * against that same live set, so a pre-live or stale `running` ref still
 * counts through its job. Advisors of the root and every live subagent count.
 */
function pauseWorkStatus(root: AgentSession): PauseWorkStatus {
	const registry = AgentRegistry.global();
	const liveSubagents = registry.list().filter(ref => ref.kind === "sub" && registry.isRunning(ref));
	const liveSubagentIds = new Set(liveSubagents.map(ref => ref.id));
	let unsettledTurns = Number(root.isStreaming && !root.agent.isPaused) + advisorUnsettledCount(root);
	for (const ref of liveSubagents) {
		if (!ref.session) continue;
		if (!ref.session.agent.isPaused) unsettledTurns++;
		unsettledTurns += advisorUnsettledCount(ref.session);
	}
	const unfinishedJobs =
		root
			.getAsyncJobTree({ recentLimit: 0 })
			?.running.filter(job => job.type !== "task" || job.agentId === undefined || !liveSubagentIds.has(job.agentId))
			.length ?? 0;
	return { unsettledTurns, unfinishedJobs };
}

export const BUILTIN_CONTROL_SLASH_COMMANDS: ReadonlyArray<SlashCommandSpec> = [
	{
		name: "force",
		icon: "hammer",
		description: () => M.cmdForce,
		aliases: ["force:"],
		inlineHint: "<tool-name> [prompt]",
		allowArgs: true,
		getTuiAutocompleteDescription: runtime => {
			const count = runtime.ctx.session.getActiveToolNames().length;
			return count === 0 ? M.acForceNoActiveTools : `Force: ${count} active tools`;
		},
		handle: async (command, runtime) => {
			const spaceIdx = command.args.indexOf(" ");
			const toolName = spaceIdx === -1 ? command.args : command.args.slice(0, spaceIdx);
			const prompt = spaceIdx === -1 ? "" : command.args.slice(spaceIdx + 1).trim();
			if (!toolName) return usage("Usage: /force:<tool-name> [prompt]", runtime);
			try {
				runtime.session.setForcedToolChoice(toolName);
			} catch (err) {
				return usage(errorMessage(err), runtime);
			}
			await runtime.output(`Next turn forced to use ${toolName}.`);
			return prompt ? { prompt } : commandConsumed();
		},
		handleTui: (command, runtime) => {
			const spaceIdx = command.args.indexOf(" ");
			const toolName = spaceIdx === -1 ? command.args : command.args.slice(0, spaceIdx);
			const prompt = spaceIdx === -1 ? "" : command.args.slice(spaceIdx + 1).trim();

			if (!toolName) {
				runtime.ctx.showError("Usage: /force:<tool-name> [prompt]");
				clearSubmittedText(runtime);
				return;
			}

			try {
				runtime.ctx.session.setForcedToolChoice(toolName);
				runtime.ctx.showStatus(`Next turn forced to use ${toolName}.`);
			} catch (error) {
				runtime.ctx.showError(errorMessage(error));
				clearSubmittedText(runtime);
				return;
			}

			clearSubmittedText(runtime);

			// If a prompt was provided, pass it through as input
			if (prompt) return { prompt };
		},
	},
	{
		name: "live",
		icon: "voice",
		description: () => M.cmdLiveVoice,
		// Codex Frameless Bidi is the only transport today: the signaling URL,
		// model and OAuth provider are hardcoded. Keep the implementation behind
		// this gate until a provider-agnostic realtime layer exists.
		enabled: () => LIVE_FEATURE_ENABLED,
		disabledMessage: LIVE_DISABLED_MESSAGE,
		handleTui: async (_command, runtime) => {
			clearSubmittedText(runtime);
			await runtime.ctx.handleLiveCommand();
		},
	},
	{
		name: "record",
		icon: "export",
		description: () => M.cmdRecord,
		handleTui: async (_command, runtime) => {
			clearSubmittedText(runtime);
			await runtime.ctx.toggleRecording();
		},
	},
	{
		name: "pause",
		icon: "pause",
		description: () => M.cmdPause,
		handleTui: async (_command, runtime) => {
			clearSubmittedText(runtime);
			const ctx = runtime.ctx;
			await runPauseScreen(ctx, { getWorkStatus: () => pauseWorkStatus(ctx.session) });
		},
	},
	{
		name: "forget-approvals",
		icon: "trash",
		description: () => M.cmdForgetApprovals,
		handle: async (_command, runtime) => {
			clearApprovalGrants(runtime.settings.getAgentDir());
			await runtime.output("Remembered approvals forgotten; the next read or write asks again.");
			return commandConsumed();
		},
	},
	{
		name: "quit",
		aliases: ["q"],
		icon: "power",
		description: () => M.cmdQuit,
		handleTui: shutdownHandlerTui,
	},
	{
		name: "sidebar",
		icon: "gauge",
		description: () => M.cmdSidebar,
		getTuiAutocompleteDescription: runtime =>
			cfgTuiSidebar.get(runtime.ctx.settings) ? M.acSidebarOn : M.acSidebarOff,
		handleTui: (_command, runtime) => {
			runtime.ctx.handleSidebarToggle();
		},
	},
];
