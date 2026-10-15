import { describe, expect, it } from "bun:test";
import {
	analyzePlanDepth,
	isGenericStep,
	PLAN_DEPTH_CROSS_CUTTING_MIN_STEPS,
	PLAN_DEPTH_SINGLE_SURFACE_MIN_STEPS,
} from "@linxiraos/zeta/plan-mode/plan-depth";

/** Build a plan with `count` Approach steps; a plan shorter than the
 *  cross-cutting threshold keeps the single-surface step floor. */
function planWithSteps(steps: readonly string[]): string {
	return `# Task\n\n## Context\n\nWhy.\n\n## Approach\n\n${steps.map(step => `- ${step}`).join("\n")}\n`;
}

describe("analyzePlanDepth", () => {
	it("counts only the outermost Approach steps", () => {
		const content =
			"# Task\n\n## Approach\n\n" +
			"- Add `--verbose` to `src/cli.ts`\n" +
			"  - detail: wire the flag through `parseArgs`\n" +
			"- Rename `parseArgs` in `src/cli.ts`\n";
		const depth = analyzePlanDepth(content);
		expect(depth.stepCount).toBe(2);
		expect(depth.genericStepCount).toBe(0);
	});

	it("reports zero steps for a plan without an Approach section", () => {
		const depth = analyzePlanDepth("# Task\n\n## Context\n\nOnly prose.\n");
		expect(depth.stepCount).toBe(0);
		expect(depth.meetsFloor).toBe(false);
	});

	it("stops the Approach section at the next same-level heading", () => {
		const content = `## Approach\n\n- Update ` + "`a.ts`" + `\n\n## Verification\n\n- Run ` + "`b.ts`" + `\n`;
		expect(analyzePlanDepth(content).stepCount).toBe(1);
	});

	it("holds a short plan to the single-surface floor", () => {
		const depth = analyzePlanDepth(planWithSteps(["Add `--verbose`", "Rename `parseArgs`"]));
		expect(depth.stepFloor).toBe(PLAN_DEPTH_SINGLE_SURFACE_MIN_STEPS);
		expect(depth.meetsFloor).toBe(true);
	});

	it("holds a long plan to the cross-cutting floor", () => {
		const long = `${planWithSteps(["Add `--verbose`", "Rename `parseArgs`"])}${"\n<!-- filler -->\n".repeat(20)}`;
		const depth = analyzePlanDepth(long);
		expect(depth.stepFloor).toBe(PLAN_DEPTH_CROSS_CUTTING_MIN_STEPS);
		expect(depth.meetsFloor).toBe(false);
	});

	it("never meets the floor while any step is generic", () => {
		const depth = analyzePlanDepth(planWithSteps(["Add `--verbose`", "Update the parser", "Rename `x`"]));
		expect(depth.stepCount).toBe(3);
		expect(depth.genericStepCount).toBe(1);
		expect(depth.meetsFloor).toBe(false);
	});
});

describe("isGenericStep", () => {
	it("flags a vague action with no named target", () => {
		expect(isGenericStep("Update the parser")).toBe(true);
		expect(isGenericStep("Handle error handling")).toBe(true);
		expect(isGenericStep("Refactor the area")).toBe(true);
		expect(isGenericStep("Improve things")).toBe(true);
	});

	it("keeps a step that names a target in any spelling", () => {
		expect(isGenericStep("Update `parseArgs` to reject an empty list")).toBe(false);
		expect(isGenericStep("Update chapter 3")).toBe(false);
		expect(isGenericStep("Improve the Ledger flow")).toBe(false);
		expect(isGenericStep('Handle the "retry budget" case')).toBe(false);
		expect(isGenericStep("Add a new section on the HTTP cache")).toBe(false);
	});

	it("does not flag a concrete verb even without a target", () => {
		expect(isGenericStep("Add a new section")).toBe(false);
		expect(isGenericStep("Delete the draft")).toBe(false);
	});
});
