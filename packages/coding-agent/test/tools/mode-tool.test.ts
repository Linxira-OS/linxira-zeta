import { describe, expect, it, vi } from "bun:test";
import type { PlanModeState } from "@linxiraos/zeta/plan-mode/state";
import type { ToolSession } from "@linxiraos/zeta/tools";
import { ModeTool, userAskedForPlanMode } from "@linxiraos/zeta/tools/mode";

function createToolSession(overrides: Partial<ToolSession>): ToolSession {
	return overrides as ToolSession;
}

function planState(overrides: Partial<PlanModeState> = {}): PlanModeState {
	return { enabled: true, planFilePath: "local://PLAN.md", workflow: "parallel", ...overrides };
}

describe("mode tool", () => {
	it("enters plan mode as the agent, forwarding the workflow and the provenance", async () => {
		const enterMode = vi.fn(async () => {});
		const tool = new ModeTool(
			createToolSession({
				enterMode,
				getPlanModeState: () => planState({ workflow: "ultra" }),
				getLastUserPromptText: () => "plan mode: map the auth refactor",
			}),
		);

		const result = await tool.execute("call-1", { op: "enter", mode: "plan", workflow: "ultra" });

		expect(enterMode).toHaveBeenCalledWith("plan", { workflow: "ultra", enteredBy: "agent" });
		expect(result.details).toEqual({ op: "enter", mode: "plan", workflow: "ultra" });
	});

	it("omits the workflow when none was asked for, so the session default applies", async () => {
		const enterMode = vi.fn(async () => {});
		const tool = new ModeTool(
			createToolSession({
				enterMode,
				getPlanModeState: () => planState(),
				getLastUserPromptText: () => "先做一个计划",
			}),
		);

		await tool.execute("call-1", { op: "enter", mode: "plan" });

		expect(enterMode).toHaveBeenCalledWith("plan", { enteredBy: "agent" });
	});

	it("refuses to enter goal and vibe mode without touching the controller", async () => {
		const enterMode = vi.fn(async () => {});
		const tool = new ModeTool(createToolSession({ enterMode, getLastUserPromptText: () => "plan first" }));

		await expect(tool.execute("call-1", { op: "enter", mode: "goal" })).rejects.toThrow(/only the user can grant/);
		await expect(tool.execute("call-2", { op: "enter", mode: "vibe" })).rejects.toThrow(/`\/vibe`/);
		expect(enterMode).not.toHaveBeenCalled();
	});

	it("refuses to leave goal and vibe mode without touching the controller", async () => {
		const exitMode = vi.fn(async () => {});
		const tool = new ModeTool(createToolSession({ exitMode }));

		await expect(tool.execute("call-1", { op: "exit", mode: "goal" })).rejects.toThrow(/only the user can grant/);
		await expect(tool.execute("call-2", { op: "exit", mode: "vibe" })).rejects.toThrow(/only the user can grant/);
		expect(exitMode).not.toHaveBeenCalled();
	});

	it("leaves the plan mode the agent entered itself", async () => {
		const exitMode = vi.fn(async () => {});
		const tool = new ModeTool(
			createToolSession({ exitMode, getPlanModeState: () => planState({ enteredBy: "agent" }) }),
		);

		const result = await tool.execute("call-1", { op: "exit", mode: "plan" });

		expect(exitMode).toHaveBeenCalledWith("plan", {});
		expect(result.details).toEqual({ op: "exit", mode: "plan" });
	});

	it("refuses to leave a user-armed plan mode — explicit or absent provenance — without touching the controller", async () => {
		const exitMode = vi.fn(async () => {});
		const states = [planState({ enteredBy: "user" }), planState()];

		for (const state of states) {
			const tool = new ModeTool(createToolSession({ exitMode, getPlanModeState: () => state }));
			await expect(tool.execute("call-1", { op: "exit", mode: "plan" })).rejects.toThrow(/only they can end it/);
		}
		expect(exitMode).not.toHaveBeenCalled();
	});

	it("refuses to leave when plan mode is not active", async () => {
		const exitMode = vi.fn(async () => {});
		const tool = new ModeTool(createToolSession({ exitMode, getPlanModeState: () => undefined }));

		await expect(tool.execute("call-1", { op: "exit", mode: "plan" })).rejects.toThrow(/not active/);
		expect(exitMode).not.toHaveBeenCalled();
	});

	it("refuses plan mode unless the user explicitly asked to plan first", async () => {
		const enterMode = vi.fn(async () => {});
		const tool = new ModeTool(
			createToolSession({ enterMode, getLastUserPromptText: () => "Just give me a simple proposal." }),
		);

		await expect(tool.execute("call-1", { op: "enter", mode: "plan" })).rejects.toThrow(/explicit user request/);
		expect(enterMode).not.toHaveBeenCalled();
	});

	it("treats a simple 方案 request and a bare question as no plan-mode authorization", () => {
		expect(userAskedForPlanMode("只让你简单出方案给我")).toBe(false);
		expect(userAskedForPlanMode("帮我看看这个 bug 怎么修")).toBe(false);
		expect(userAskedForPlanMode("先做计划，再改代码")).toBe(true);
		expect(userAskedForPlanMode("/plan auth refactor")).toBe(true);
	});

	it("surfaces the session's mutual-exclusion refusal as a tool error", async () => {
		const enterMode = vi.fn(async () => {
			throw new Error("Exit goal mode first.");
		});
		const tool = new ModeTool(createToolSession({ enterMode, getLastUserPromptText: () => "plan first" }));

		await expect(tool.execute("call-1", { op: "enter", mode: "plan" })).rejects.toThrow(
			/Cannot enter plan mode: Exit goal mode first\./,
		);
	});

	it("refuses when the session has no mode controller attached", async () => {
		const tool = new ModeTool(createToolSession({ getLastUserPromptText: () => "plan first" }));

		await expect(tool.execute("call-1", { op: "enter", mode: "plan" })).rejects.toThrow(/no mode controller/);
	});
});
