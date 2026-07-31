// Zeta extension entry. Symlinked into ~/.pi/agent/extensions/zeta-extensions/
// by scripts/install.ps1. Loaded by pi as an extension directory (index.ts).
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installLoop } from "./src/loop.ts";
import { installGoals, type GoalHost } from "./src/goals/commands.ts";
import { GoalRuntime } from "./src/goals/runtime.ts";
import type { Goal } from "./src/goals/state.ts";

const GOAL_ENTRY_TYPE = "zeta-goal";

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

	installLoop(api);
	installGoals(api, {
		host: goalHost,
		runtime,
		appendEntry: (g: Goal | undefined) => {
			api.appendEntry(GOAL_ENTRY_TYPE, g);
		},
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
