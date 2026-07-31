// Zeta extension entry. Symlinked into ~/.pi/agent/extensions/zeta-extensions/
// by scripts/install.ps1. Loaded by pi as an extension directory (index.ts).
// Implements omp-style features on the pi Extension API: loop, goal, plan,
// vibe modes; retry/queue/todo/commit/stats/workspace/say commands; computer
// use, ssh, and web search tools; desktop notifications; settings panel.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installLoop } from "./src/loop.ts";
import { installGoals, type GoalHost } from "./src/goals/commands.ts";
import { GoalRuntime } from "./src/goals/runtime.ts";
import { createGoal, type Goal } from "./src/goals/state.ts";
import { ModeManager } from "./src/modes/shared.ts";
import { installPlanMode } from "./src/modes/plan.ts";
import { installVibeMode } from "./src/modes/vibe.ts";
import { installRetry } from "./src/commands/retry.ts";
import { installQueue } from "./src/commands/queue.ts";
import { installTodo } from "./src/commands/todo.ts";
import { installCommit } from "./src/commands/commit.ts";
import { installStats } from "./src/commands/stats.ts";
import { installWorkspaceCommands, installSayCommands } from "./src/commands/workspace.ts";
import { installCleanupCommands } from "./src/commands/cleanup.ts";
import { installGuidedGoal } from "./src/commands/guided-goal.ts";
import { installComputerTools } from "./src/tools/computer.ts";
import { installSshTools, installSshCommand } from "./src/tools/ssh.ts";
import { installWebSearchTools, installWebSearchCommand } from "./src/tools/web-search.ts";
import { installDesktopNotify, installSettingsPanel, type ZetaFeatureInfo } from "./src/tui/enhancements.ts";

const GOAL_ENTRY_TYPE = "zeta-goal";
const MODE_ENTRY_TYPE = "zeta-mode";

export default function factory(api: ExtensionAPI): void {
	let goal: Goal | undefined;

	const goalHost: GoalHost = {
		getGoal: () => goal,
		setGoal: (g: Goal | undefined) => {
			goal = g;
		},
	};

	const runtime = new GoalRuntime({
		getGoal: () => goal,
		setGoal: (g: Goal | undefined) => {
			goal = g;
		},
		persist: () => {
			api.appendEntry(GOAL_ENTRY_TYPE, goal);
		},
		sendHiddenMessage: (content: string) => {
			void api.sendUserMessage(content, { deliverAs: "followUp" });
		},
	});

	const modes = new ModeManager(api, {
		appendEntry: (state) => {
			api.appendEntry(MODE_ENTRY_TYPE, state);
		},
	});

	installLoop(api);
	const planState = installPlanMode(api, modes);
	const vibeState = installVibeMode(api, modes);
	installGoals(api, {
		host: goalHost,
		runtime,
		appendEntry: (g: Goal | undefined) => {
			api.appendEntry(GOAL_ENTRY_TYPE, g);
		},
	});
	installGuidedGoal(api, {
		setGoal: (objective, tokenBudget, timeBudgetSeconds) => {
			goalHost.setGoal(createGoal(objective, tokenBudget, timeBudgetSeconds));
			api.appendEntry(GOAL_ENTRY_TYPE, goal);
			void api.sendUserMessage(`Work toward the active goal: ${objective}`, { deliverAs: "followUp" });
		},
	});

	installRetry(api);
	installQueue(api);
	installTodo(api);
	installCommit(api);
	installStats(api);
	installWorkspaceCommands(api);
	installSayCommands(api);
	installCleanupCommands(api);
	installComputerTools(api);
	installSshTools(api);
	installSshCommand(api);
	installWebSearchTools(api);
	installWebSearchCommand(api);
	installDesktopNotify(api);

	installSettingsPanel(api, () => {
		const features: ZetaFeatureInfo[] = [
			{
				name: "Loop",
				status: "on",
				toggle: async () => {
					/* toggled via /loop */
				},
			},
			{
				name: "Plan mode",
				status: planState().enabled ? "on" : "off",
				toggle: async () => {
					/* toggled via /plan */
				},
			},
			{
				name: "Vibe mode",
				status: vibeState().enabled ? "on" : "off",
				toggle: async () => {
					/* toggled via /vibe */
				},
			},
			{
				name: "Goal",
				status: goal ? goal.status : "none",
				toggle: async () => {
					/* managed via /goal */
				},
			},
		];
		return features;
	});

	api.on("turn_start", (_event, ctx) => {
		runtime.onTurnStart(ctx);
	});
	api.on("turn_end", (_event, ctx) => {
		runtime.onTurnEnd(ctx);
	});
	api.on("agent_settled", (_event, ctx) => {
		runtime.recordWallClock();
		runtime.checkBudget(ctx);
		runtime.onSettled(ctx);
	});
	api.on("session_start", (_event, ctx) => {
		goal = restoreGoal(ctx.sessionManager.getEntries());
		const modeState = ModeManager.restoreState(ctx.sessionManager.getEntries());
		if (modeState.mode) {
			modes.state = modeState;
		}
	});
}

function restoreGoal(entries: readonly { type: string; customType?: string; data?: unknown }[]): Goal | undefined {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry?.type === "custom" && entry.customType === GOAL_ENTRY_TYPE) {
			return entry.data as Goal | undefined;
		}
	}
	return undefined;
}
