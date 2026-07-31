// port of omp GoalRuntime (packages/coding-agent/src/goals/runtime.ts) onto pi extension API.
// pi extension events do not expose per-request input/output usage, so token
// accounting uses the context estimate (ctx.getContextUsage().tokens) deltas.
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	goalTokenDelta,
	isAccountingStatus,
	remainingTokens,
	type Goal,
	type GoalTokenUsage,
} from "./state.ts";

export interface GoalRuntimeHost {
	getGoal(): Goal | undefined;
	setGoal(goal: Goal | undefined): void;
	persist(): void;
	sendHiddenMessage(content: string): void;
}

export interface GoalTurnSnapshot {
	baselineUsage: number;
}

const CONTINUATION_TEMPLATE = `Continue work on the active goal.

<objective>
{{objective}}
</objective>

Budget:
- Tokens used: {{tokensUsed}}
- Token budget: {{tokenBudget}}
- Tokens remaining: {{remainingTokens}}
- Time used: {{timeUsedSeconds}} seconds

This is an autonomous continuation. The objective persists across turns; NEVER redefine success around a smaller, easier, or already-completed subset.

Before calling the goal tool with op "complete", you MUST perform a completion audit against the current repo state:
1. Restate the objective as concrete deliverables (files, behaviors, tests, gates).
2. Map each deliverable to evidence: the authoritative source that would prove it.
3. Inspect the actual current state. Read the files. Run the commands. NEVER rely on memory of earlier work.
4. Match verification scope to claim scope: a narrow check does not prove a broad claim.
5. Treat uncertainty as not-yet-achieved. Gather stronger evidence or do more work.
6. Budget exhaustion is not completion. If the budget is tight and the work is unfinished, leave the goal active and stop the turn.

If the work is not done, just keep working. NEVER narrate that you are continuing; execute.`;

const BUDGET_LIMIT_TEMPLATE = `The active goal has reached its token budget.

<objective>
{{objective}}
</objective>

Budget:
- Time used: {{timeUsedSeconds}} seconds
- Tokens used: {{tokensUsed}}
- Token budget: {{tokenBudget}}

The runtime marked the goal as budget-limited. NEVER start new substantive work for this goal. Wrap up this turn soon: summarize useful progress, identify remaining work or blockers, and leave the user with a clear next step.`;

function renderTemplate(template: string, goal: Goal): string {
	return template
		.replaceAll("{{objective}}", goal.objective)
		.replaceAll("{{tokensUsed}}", String(goal.tokensUsed))
		.replaceAll("{{tokenBudget}}", goal.tokenBudget === undefined ? "none" : String(goal.tokenBudget))
		.replaceAll("{{remainingTokens}}", String(remainingTokens(goal) ?? "unbounded"))
		.replaceAll("{{timeUsedSeconds}}", String(goal.timeUsedSeconds));
}

export function estimateUsage(ctx: ExtensionContext): GoalTokenUsage {
	const usage = ctx.getContextUsage();
	const tokens = usage?.tokens ?? 0;
	return { input: tokens, output: 0 };
}

export class GoalRuntime {
	#host: GoalRuntimeHost;
	#turnSnapshot: GoalTurnSnapshot | undefined;
	#lastAccountedAt: number;

	constructor(host: GoalRuntimeHost) {
		this.#host = host;
		this.#lastAccountedAt = Date.now();
	}

	onTurnStart(ctx: ExtensionContext): void {
		const goal = this.#host.getGoal();
		if (!goal || !isAccountingStatus(goal)) return;
		this.#turnSnapshot = { baselineUsage: estimateUsage(ctx).input };
	}

	onTurnEnd(ctx: ExtensionContext): void {
		const goal = this.#host.getGoal();
		if (!goal || !isAccountingStatus(goal)) return;
		this.#account(ctx);
	}

	onSettled(ctx: ExtensionContext): void {
		const goal = this.#host.getGoal();
		if (!goal) return;
		if (goal.status === "active") {
			this.#account(ctx);
			this.#host.sendHiddenMessage(renderTemplate(CONTINUATION_TEMPLATE, goal));
		}
	}

	#account(ctx: ExtensionContext): void {
		const goal = this.#host.getGoal();
		if (!goal) return;
		const current = estimateUsage(ctx);
		const baseline = this.#turnSnapshot;
		const delta = goalTokenDelta(current, baseline ? { input: baseline.baselineUsage, output: 0 } : undefined);
		if (delta > 0) {
			goal.tokensUsed += delta;
			this.#host.persist();
		}
		this.#turnSnapshot = undefined;
		this.#lastAccountedAt = Date.now();
	}

	recordWallClock(): void {
		const goal = this.#host.getGoal();
		if (!goal) return;
		const now = Date.now();
		goal.timeUsedSeconds += Math.max(0, (now - this.#lastAccountedAt) / 1000);
		this.#lastAccountedAt = now;
		this.#host.persist();
	}

	checkBudget(ctx: ExtensionContext): "ok" | "budget-limited" {
		const goal = this.#host.getGoal();
		if (!goal) return "ok";
		if (goal.tokenBudget !== undefined && goal.tokensUsed >= goal.tokenBudget) {
			if (goal.status === "active") {
				goal.status = "budget-limited";
				this.#host.persist();
				this.#host.sendHiddenMessage(renderTemplate(BUDGET_LIMIT_TEMPLATE, goal));
			}
			return "budget-limited";
		}
		if (goal.timeBudgetSeconds !== undefined && goal.timeUsedSeconds >= goal.timeBudgetSeconds) {
			if (goal.status === "active") {
				goal.status = "budget-limited";
				this.#host.persist();
				this.#host.sendHiddenMessage(renderTemplate(BUDGET_LIMIT_TEMPLATE, goal));
			}
			return "budget-limited";
		}
		return "ok";
	}
}
