// port of omp goal slash command (interactive-mode.ts handleGoalCommand) onto pi extension API
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { GoalRuntime } from "./runtime.ts";
import { createGoal, remainingTokens, type Goal, type GoalStatus } from "./state.ts";

const STATUS_KEY = "zeta-goal";

export interface GoalHost {
	getGoal(): Goal | undefined;
	setGoal(goal: Goal | undefined): void;
}

export interface GoalsInstallOptions {
	host: GoalHost;
	runtime: GoalRuntime;
	appendEntry: (goal: Goal | undefined) => void;
}

const GOAL_USAGE = "Usage: /goal set <objective> [budget=<n>] [time=<n>s|m|h] | /goal show | /goal pause | /goal resume | /goal complete | /goal drop";

export function installGoals(api: ExtensionAPI, options: GoalsInstallOptions): void {
	const { host, runtime, appendEntry } = options;

	const persist = (): void => {
		appendEntry(host.getGoal());
	};

	const updateStatus = (ctx: { ui: { setStatus: (key: string, text: string | undefined) => void } }): void => {
		const goal = host.getGoal();
		if (!goal) {
			ctx.ui.setStatus(STATUS_KEY, undefined);
			return;
		}
		const budget = goal.tokenBudget === undefined ? "" : `, ${remainingTokens(goal)} tokens left`;
		ctx.ui.setStatus(STATUS_KEY, `Goal [${goal.status}]${budget}`);
	};

	const setStatusOf = (goal: Goal, status: GoalStatus, ctx: { ui: { setStatus: (key: string, text: string | undefined) => void } }): void => {
		goal.status = status;
		goal.updatedAt = Date.now();
		if (status === "paused") goal.lastPausedAt = goal.updatedAt;
		persist();
		updateStatus(ctx);
	};

	api.registerTool({
		name: "goal",
		label: "Goal",
		description:
			"Manage the active goal. Use op=complete only after a completion audit proves the objective's deliverables against current repo state; it ends the autonomous loop and surfaces a done report. op=pause/report do not end the goal.",
		parameters: Type.Object({
			op: Type.Union([Type.Literal("complete"), Type.Literal("pause"), Type.Literal("resume"), Type.Literal("report")], {
				description: "Operation: complete (claim done), pause, resume, or report progress.",
			}),
			summary: Type.Optional(Type.String({ description: "Summary text for report/complete." })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const goal = host.getGoal();
			if (!goal) {
				return {
					content: [{ type: "text", text: "No active goal. Start one with /goal set <objective>." }],
					details: undefined,
				};
			}
			switch (params.op) {
				case "complete":
					if (goal.status !== "completed") {
						goal.status = "completed";
						goal.updatedAt = Date.now();
						persist();
						updateStatus(ctx);
					}
					return {
						content: [
							{ type: "text", text: `Goal completed: ${goal.objective}${params.summary ? `\n${params.summary}` : ""}` },
						],
						details: undefined,
					};
				case "pause":
					if (goal.status === "active") {
						goal.status = "paused";
						goal.lastPausedAt = Date.now();
						goal.updatedAt = Date.now();
						persist();
						updateStatus(ctx);
					}
					return { content: [{ type: "text", text: "Goal paused." }], details: undefined };
				case "resume":
					if (goal.status === "paused" || goal.status === "budget-limited") {
						goal.status = "active";
						goal.updatedAt = Date.now();
						persist();
						updateStatus(ctx);
					}
					return { content: [{ type: "text", text: "Goal resumed." }], details: undefined };
				case "report":
					return {
						content: [{ type: "text", text: params.summary ?? `Goal in progress: ${goal.objective}` }],
						details: undefined,
					};
			}
		},
	});

	api.registerCommand("goal", {
		description: GOAL_USAGE,
		getArgumentCompletions: (prefix: string) => {
			const suggestions = ["set ", "show", "pause", "resume", "complete", "drop"];
			return suggestions.filter((s) => s.startsWith(prefix)).map((value) => ({ value, label: value }));
		},
		handler: async (args, ctx) => {
			await handleGoal(args, ctx);
		},
	});

	const handleGoal = async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
		const trimmed = args.trim();
		if (!trimmed) {
			await show(ctx);
			return;
		}

		const [verb, ...rest] = trimmed.split(/\s+/);
		switch (verb) {
			case "set": {
				const objectiveText = rest.join(" ").trim();
				let tokenBudget: number | undefined;
				let timeBudgetSeconds: number | undefined;
				const budgetMatch = /budget=(\d+)/.exec(objectiveText);
				if (budgetMatch) {
					tokenBudget = Number(budgetMatch[1]);
				}
				const timeMatch = /time=(\d+)(s|m|h)/.exec(objectiveText);
				if (timeMatch) {
					const unitSeconds = timeMatch[2] === "h" ? 3600 : timeMatch[2] === "m" ? 60 : 1;
					timeBudgetSeconds = Number(timeMatch[1]) * unitSeconds;
				}
				const objective = objectiveText.replace(/budget=\d+/, "").replace(/time=\d+[smh]/, "").trim();
				if (!objective) {
					void api.sendMessage({ customType: "zeta-goal", content: GOAL_USAGE, display: true });
					return;
				}
				const goal = createGoal(objective, tokenBudget, timeBudgetSeconds);
				host.setGoal(goal);
				persist();
				updateStatus(ctx);
				void api.sendMessage({
					customType: "zeta-goal",
					content: `Goal set: ${objective}${tokenBudget !== undefined ? ` (budget ${tokenBudget} tokens)` : ""}`,
					display: true,
				});
				void api.sendUserMessage(
					`Work toward the active goal: ${objective}${tokenBudget !== undefined ? ` (token budget ${tokenBudget})` : ""}`,
					{ deliverAs: "followUp" },
				);
				return;
			}
			case "show":
				await show(ctx);
				return;
			case "pause":
			case "resume":
			case "complete":
			case "drop": {
				const goal = host.getGoal();
				if (!goal) {
					void api.sendMessage({ customType: "zeta-goal", content: "No active goal.", display: true });
					return;
				}
				const status: GoalStatus =
					verb === "pause" ? "paused" : verb === "complete" ? "completed" : verb === "drop" ? "dropped" : "active";
				setStatusOf(goal, status, ctx);
				if (status === "completed") {
					runtime.recordWallClock();
				}
				void api.sendMessage({
					customType: "zeta-goal",
					content: `Goal ${status}.`,
					display: true,
				});
				return;
			}
			default:
				void api.sendMessage({ customType: "zeta-goal", content: GOAL_USAGE, display: true });
		}
	};

	const show = async (ctx: ExtensionCommandContext): Promise<void> => {
		const goal = host.getGoal();
		if (!goal) {
			void api.sendMessage({ customType: "zeta-goal", content: "No active goal. /goal set <objective> to start one.", display: true });
			return;
		}
		const lines = [
			`Goal [${goal.status}]: ${goal.objective}`,
			`Tokens used: ${goal.tokensUsed}${goal.tokenBudget !== undefined ? ` of ${goal.tokenBudget}` : ""}`,
			`Time used: ${goal.timeUsedSeconds}s${goal.timeBudgetSeconds !== undefined ? ` of ${goal.timeBudgetSeconds}s` : ""}`,
		];
		void api.sendMessage({ customType: "zeta-goal", content: lines.join("\n"), display: true });
	};
}
