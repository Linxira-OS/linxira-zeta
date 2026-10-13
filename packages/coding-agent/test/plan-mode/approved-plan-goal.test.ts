/**
 * The TUI half of "approving a plan executes it as a goal": `#approvePlan`
 * arms goal mode with the task stated at plan entry, so the execution round
 * carries the goal context and the goal's own continuation drives the rest.
 *
 * Driven through the real `InteractiveMode.handlePlanApproval` seam (the plan
 * review overlay is stubbed to the operator's choice), with a real
 * `AgentSession` and a registered `goal` tool.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import * as path from "node:path";
import { Agent, type AgentTool } from "@linxiraos/pi-agent-core";
import { type } from "@linxiraos/pi-omptype";
import { initTheme } from "@linxiraos/pi-tui/theme";
import { TempDir } from "@linxiraos/pi-utils";
import { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { resetSettingsForTest, Settings } from "@linxiraos/zeta/config/settings";
import { resolveLocalUrlToPath } from "@linxiraos/zeta/internal-urls";
import { InteractiveMode } from "@linxiraos/zeta/modes/interactive-mode";
import { cfgStartupQuiet } from "@linxiraos/zeta/modes/settings";
import { AgentSession } from "@linxiraos/zeta/session/agent-session";
import { AuthStorage } from "@linxiraos/zeta/session/auth-storage";
import { SessionManager } from "@linxiraos/zeta/session/session-manager";

function makeTool(name: string): AgentTool {
	return {
		name,
		label: name,
		description: `Fake ${name}`,
		parameters: type({}),
		async execute() {
			return { content: [{ type: "text" as const, text: "ok" }] };
		},
	};
}

describe("approved plan execution is goal-directed (TUI)", () => {
	let tempDir: TempDir;
	let authStorage: AuthStorage;
	let mode: InteractiveMode | undefined;
	let session: AgentSession | undefined;

	beforeAll(() => {
		initTheme();
	});

	beforeEach(async () => {
		resetSettingsForTest();
		tempDir = TempDir.createSync("@pi-approved-plan-goal-");
		await Settings.init({ inMemory: true, cwd: tempDir.path() });
		cfgStartupQuiet.set(Settings.instance, true);
		authStorage = await AuthStorage.create(path.join(tempDir.path(), "testauth.db"));
		authStorage.keys.setRuntime("anthropic", "test-key");
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		mode?.stop();
		await session?.dispose();
		authStorage?.close();
		tempDir?.removeSync();
		mode = undefined;
		session = undefined;
		resetSettingsForTest();
	});

	function createHarness(settings: Settings): InteractiveMode {
		const registry = new ModelRegistry(authStorage, path.join(tempDir.path(), "models.yml"));
		const model = registry.find("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Expected anthropic/claude-sonnet-4-5 to exist");
		const readTool = makeTool("read");
		const toolRegistry = new Map<string, AgentTool>([
			["read", readTool],
			// Goal mode adds this to the active set; the registry must carry it or
			// the selection silently drops the name (issue #9444).
			["goal", makeTool("goal")],
		]);
		const manager = SessionManager.create(tempDir.path(), path.join(tempDir.path(), "active"));
		const created = new AgentSession({
			agent: new Agent({
				initialState: { model, systemPrompt: ["Test"], tools: [readTool], messages: [] },
			}),
			sessionManager: manager,
			settings,
			modelRegistry: registry,
			toolRegistry,
			builtInToolNames: ["read"],
		});
		session = created;
		mode = new InteractiveMode(created, "test");
		return mode;
	}

	/** Seed the plan file on disk and stub the review overlay + execution turn. */
	async function approvePlan(
		created: InteractiveMode,
		planFilePath: string,
		choice: string,
	): Promise<{ prompt: ReturnType<typeof vi.spyOn> }> {
		const resolvedPlanPath = resolveLocalUrlToPath(planFilePath, {
			getArtifactsDir: () => session!.sessionManager.getArtifactsDir(),
			getSessionId: () => session!.sessionManager.getSessionId(),
		});
		await Bun.write(resolvedPlanPath, "# Plan\n\nImplement it.");
		vi.spyOn(session!, "getContextUsage").mockReturnValue(undefined);
		vi.spyOn(created, "showPlanReview").mockResolvedValue(choice);
		const prompt = vi.spyOn(session!, "prompt").mockResolvedValue(undefined as never);
		await created.handlePlanApproval({ planFilePath, planExists: true, title: "PLAN" });
		return { prompt };
	}

	it("arms goal mode under the task stated at plan entry, before the execution turn", async () => {
		const created = createHarness(
			Settings.isolated({ "compaction.enabled": false, "plan.enabled": true, "goal.enabled": true }),
		);
		const planFilePath = "local://PLAN.md";
		// `/plan Ship the release`: plan mode records the operator's task. No input
		// waiter is installed here, so nothing is submitted as a turn.
		expect(await created.handlePlanModeCommand("Ship the release")).toBe(false);
		expect(session!.getPlanModeState()).toMatchObject({ enabled: true, objective: "Ship the release" });

		const { prompt } = await approvePlan(created, planFilePath, "Approve and keep context");

		expect(created.planModeEnabled).toBe(false);
		expect(created.goalModeEnabled).toBe(true);
		expect(session!.getGoalModeState()).toMatchObject({
			enabled: true,
			goal: { objective: "Ship the release", status: "active" },
		});
		// Goal mode added its tool on top of the restored execution toolset.
		expect(session!.getActiveToolNames()).toContain("goal");
		expect(session!.getActiveToolNames()).toContain("read");
		// The plan-approved prompt is the execution turn's first message.
		expect(prompt).toHaveBeenCalledTimes(1);
		expect(String(prompt.mock.calls[0]?.[0])).toContain("Plan approved.");
	});

	it("derives the objective from the plan when no task was stated at plan entry", async () => {
		const created = createHarness(
			Settings.isolated({ "compaction.enabled": false, "plan.enabled": true, "goal.enabled": true }),
		);
		const planFilePath = "local://PLAN.md";
		await created.handlePlanModeCommand();

		await approvePlan(created, planFilePath, "Approve and keep context");

		expect(session!.getGoalModeState()?.goal.objective).toBe("Plan");
	});

	it("still executes the plan when goal mode is disabled", async () => {
		const created = createHarness(
			Settings.isolated({ "compaction.enabled": false, "plan.enabled": true, "goal.enabled": false }),
		);
		const planFilePath = "local://PLAN.md";
		await created.handlePlanModeCommand("Ship the release");

		const { prompt } = await approvePlan(created, planFilePath, "Approve and keep context");

		expect(created.goalModeEnabled).toBe(false);
		expect(session!.getGoalModeState()).toBeUndefined();
		expect(session!.getActiveToolNames()).not.toContain("goal");
		expect(prompt).toHaveBeenCalledTimes(1);
	}, 30_000);

	it("arms goal mode on the fresh (clear-context) approval branch too", async () => {
		const created = createHarness(
			Settings.isolated({ "compaction.enabled": false, "plan.enabled": true, "goal.enabled": true }),
		);
		const planFilePath = "local://PLAN.md";
		await created.handlePlanModeCommand("Ship the release");

		const { prompt } = await approvePlan(created, planFilePath, "Approve and execute");

		// The transcript was cleared, then the goal was armed on the new session
		// (a goal armed before the clear would be discarded with it).
		expect(created.goalModeEnabled).toBe(true);
		expect(session!.getGoalModeState()?.goal.objective).toBe("Ship the release");
		expect(prompt).toHaveBeenCalledTimes(1);
	}, 30_000);
});
