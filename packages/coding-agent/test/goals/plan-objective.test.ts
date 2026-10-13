/**
 * Approved-plan goal objective derivation: the statement of intent an approved
 * plan executes under, and the sanitization that keeps a pasted task from
 * becoming a wall of text inside the goal prompts.
 */
import { describe, expect, it } from "bun:test";
import {
	derivePlanGoalObjective,
	normalizeGoalObjective,
	PLAN_GOAL_OBJECTIVE_MAX_LENGTH,
} from "@linxiraos/zeta/goals/plan-objective";

describe("normalizeGoalObjective", () => {
	it("flattens to one line and drops an empty statement", () => {
		expect(normalizeGoalObjective("  ship   the\n\nrelease  ")).toBe("ship the release");
		expect(normalizeGoalObjective("   \n\t ")).toBeUndefined();
		expect(normalizeGoalObjective(undefined)).toBeUndefined();
	});

	it("clamps a long task statement", () => {
		const normalized = normalizeGoalObjective("x".repeat(PLAN_GOAL_OBJECTIVE_MAX_LENGTH + 50));
		expect(normalized).toHaveLength(PLAN_GOAL_OBJECTIVE_MAX_LENGTH);
		expect(normalized?.endsWith("…")).toBe(true);
	});
});

describe("derivePlanGoalObjective", () => {
	it("prefers the task stated at plan entry", () => {
		expect(
			derivePlanGoalObjective({
				statedTask: "Ship the release",
				planContent: "# Something else\n\nbody",
				title: "some-slug",
			}),
		).toBe("Ship the release");
	});

	it("falls back to the plan's heading, then the title, then the first content line", () => {
		expect(derivePlanGoalObjective({ planContent: "intro\n\n## Refactor the auth store\n\nbody" })).toBe(
			"Refactor the auth store",
		);
		expect(derivePlanGoalObjective({ planContent: "intro line\n\nbody", title: "auth-refactor" })).toBe(
			"auth-refactor",
		);
		expect(derivePlanGoalObjective({ planContent: "\n\nbody only\n" })).toBe("body only");
	});

	it("ignores fenced code and markdown noise", () => {
		expect(
			derivePlanGoalObjective({
				planContent: ["```bash", "# not a heading", "```", "", "# Fix **the** login redirect", ""].join("\n"),
			}),
		).toBe("Fix the login redirect");
	});

	it("returns undefined when the plan carries nothing usable", () => {
		expect(derivePlanGoalObjective({ planContent: "```\ncode only\n```\n" })).toBeUndefined();
		expect(derivePlanGoalObjective({ planContent: "   \n\n" })).toBeUndefined();
	});
});
