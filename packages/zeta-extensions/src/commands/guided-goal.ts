// /guided-goal: interview the user, then set up goal mode (port of omp guided-goal)
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

export interface GuidedGoalHost {
	setGoal: (objective: string, tokenBudget: number | undefined, timeBudgetSeconds: number | undefined) => void;
}

const QUESTION_ORDER = [
	"1. What is the objective? (a sentence describing the outcome)",
	"2. What is the token budget? (a number, or 'none' for unbounded)",
	"3. What is the time budget? (e.g. 30m, 2h, or 'none' for unbounded)",
] as const;

export function installGuidedGoal(api: ExtensionAPI, host: GuidedGoalHost): void {
	api.registerCommand("guided-goal", {
		description: "Interview you in chat, then set up goal mode. Usage: /guided-goal [rough objective]",
		handler: async (args, ctx) => {
			await interview(api, ctx, host, args);
		},
	});

	const interview = async (
		api: ExtensionAPI,
		ctx: ExtensionCommandContext,
		host: GuidedGoalHost,
		initial: string,
	): Promise<void> => {
		const answers: string[] = [initial.trim()];
		for (const question of QUESTION_ORDER) {
			const answer = await ctx.ui.input(question, "type your answer or enter to skip");
			answers.push(answer?.trim() ?? "");
		}
		const objective = answers[0];
		if (!objective) {
			ctx.ui.notify("No objective provided. Aborting.", "warning");
			return;
		}
		const budgetRaw = answers[1]?.toLowerCase() ?? "";
		const tokenBudget = budgetRaw && budgetRaw !== "none" && /^\d+$/.test(budgetRaw) ? Number(budgetRaw) : undefined;
		const timeRaw = answers[2]?.toLowerCase() ?? "";
		let timeBudgetSeconds: number | undefined;
		if (timeRaw && timeRaw !== "none") {
			const match = /(\d+)\s*(s|m|h)?/.exec(timeRaw);
			if (match) {
				const unit = match[2] === "h" ? 3600 : match[2] === "m" ? 60 : 1;
				timeBudgetSeconds = Number(match[1]) * unit;
			}
		}
		host.setGoal(objective, tokenBudget, timeBudgetSeconds);
		void api.sendUserMessage(`Work toward the active goal: ${objective}`, { deliverAs: "followUp" });
	};
}
