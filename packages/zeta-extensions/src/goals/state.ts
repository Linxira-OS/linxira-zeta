// port of omp packages/coding-agent/src/goals/state.ts (subset)
export type GoalStatus = "active" | "paused" | "completed" | "dropped" | "budget-limited";

export interface Goal {
	objective: string;
	status: GoalStatus;
	tokenBudget: number | undefined;
	tokensUsed: number;
	timeBudgetSeconds: number | undefined;
	timeUsedSeconds: number;
	createdAt: number;
	updatedAt: number;
	lastPausedAt: number | undefined;
}

export interface GoalTokenUsage {
	input: number;
	output: number;
}

export function createGoal(objective: string, tokenBudget: number | undefined, timeBudgetSeconds: number | undefined): Goal {
	return {
		objective,
		status: "active",
		tokenBudget,
		tokensUsed: 0,
		timeBudgetSeconds,
		timeUsedSeconds: 0,
		createdAt: Date.now(),
		updatedAt: Date.now(),
		lastPausedAt: undefined,
	};
}

export function remainingTokens(goal: Goal): number | null {
	if (goal.tokenBudget === undefined) return null;
	return Math.max(0, goal.tokenBudget - goal.tokensUsed);
}

export function goalTokenDelta(current: GoalTokenUsage, baseline: GoalTokenUsage | undefined): number {
	if (!baseline) return 0;
	return Math.max(0, current.input - baseline.input) + Math.max(0, current.output - baseline.output);
}

export function isAccountingStatus(goal: Goal): boolean {
	return goal.status === "active" || goal.status === "budget-limited";
}
