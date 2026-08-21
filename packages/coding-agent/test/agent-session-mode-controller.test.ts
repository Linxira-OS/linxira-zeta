/**
 * Contract: the shared ModeController API (`AgentSession.enterMode/exitMode/
 * getModeState`) drives plan/goal/vibe with the same behavior whether the
 * caller is the CLI or an external client (web gateway, attach).
 *
 * Mirrors the T0 harness of `agent-session-plan-mode-convergence.test.ts`:
 * a real AgentSession over an in-memory SessionManager, a mock model, and a
 * minimal tool registry.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { Agent, type AgentTool } from "@linxiraos/pi-agent-core";
import { createMockModel, type MockModel } from "@linxiraos/pi-ai/providers/mock";
import { getBundledModel } from "@linxiraos/pi-catalog/models";
import { type } from "@linxiraos/pi-omptype";
import { TempDir } from "@linxiraos/pi-utils";
import { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { Settings } from "@linxiraos/zeta/config/settings";
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

interface ModeHarness {
	session: AgentSession;
	mock: MockModel;
}

describe("AgentSession ModeController (plan/goal/vibe)", () => {
	let tempDir: TempDir;
	let authDir: TempDir;
	let authStorage: AuthStorage;
	let modelRegistry: ModelRegistry;
	let session: AgentSession | undefined;

	beforeAll(async () => {
		authDir = TempDir.createSync("@pi-mode-controller-auth-");
		authStorage = await AuthStorage.create(authDir.join("auth.db"));
		authStorage.setRuntimeApiKey("anthropic", "test-key");
		modelRegistry = new ModelRegistry(authStorage, authDir.join("models.yml"));
	});

	afterAll(() => {
		authStorage.close();
		authDir.removeSync();
	});

	beforeEach(() => {
		tempDir = TempDir.createSync("@pi-mode-controller-");
	});

	afterEach(async () => {
		try {
			await session?.dispose();
		} finally {
			session = undefined;
			await tempDir?.remove();
		}
	});

	async function createModeSession(settings: Settings): Promise<ModeHarness> {
		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Expected bundled anthropic model to exist");

		const askTool = makeTool("ask");
		const writeTool = makeTool("write");
		const readTool = makeTool("read");
		const goalTool = makeTool("goal");
		const toolRegistry = new Map<string, AgentTool>([
			["ask", askTool],
			["write", writeTool],
			["read", readTool],
			["goal", goalTool],
		]);

		const mock = createMockModel({ responses: [{ content: ["ok"] }] });
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: {
				model,
				systemPrompt: ["Test"],
				tools: [askTool, writeTool, readTool],
				messages: [],
			},
			streamFn: mock.stream,
		});

		const created = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(),
			settings,
			modelRegistry,
			toolRegistry,
			builtInToolNames: ["ask", "write", "read", "goal"],
			advisorTools: [],
			createVibeTools: () => [makeTool("vibe_dir"), makeTool("vibe_worker")],
		});
		session = created;
		return { session: created, mock };
	}

	function modeChangeEntries(): { mode: string; data?: Record<string, unknown> }[] {
		const entries = session!.sessionManager.getBranch();
		return entries.filter(e => e.type === "mode_change").map(e => ({ mode: e.mode, data: e.data }));
	}

	it("enterMode('plan') arms plan state, keeps write active, journals, and switches to the plan role model", async () => {
		const settings = Settings.isolated({ "compaction.enabled": false, "retry.enabled": false });
		settings.setModelRole("plan", "anthropic/claude-haiku-4-5");
		const harness = await createModeSession(settings);
		const initialModelId = harness.session.model?.id;

		await harness.session.enterMode("plan");

		const state = harness.session.getPlanModeState();
		expect(state?.enabled).toBe(true);
		expect(state?.planFilePath).toBeTruthy();
		expect(harness.session.getActiveToolNames()).toContain("write");
		expect(harness.session.peekPlanProposalHandler()).toBeDefined();
		expect(modeChangeEntries().at(-1)?.mode).toBe("plan");
		// Non-streaming entry switches the active model to the plan role.
		expect(harness.session.model?.id).toBe("claude-haiku-4-5");
		expect(harness.session.model?.id).not.toBe(initialModelId);
	});

	it("exitMode('plan') clears state, restores tools and the pre-plan model, and journals none", async () => {
		const settings = Settings.isolated({ "compaction.enabled": false, "retry.enabled": false });
		settings.setModelRole("plan", "anthropic/claude-haiku-4-5");
		const harness = await createModeSession(settings);
		const initialModelId = harness.session.model?.id;

		await harness.session.enterMode("plan");
		await harness.session.exitMode("plan");

		expect(harness.session.getPlanModeState()).toBeUndefined();
		expect(harness.session.getActiveToolNames()).toEqual(["ask", "write", "read"]);
		expect(harness.session.peekPlanProposalHandler()).toBeUndefined();
		expect(modeChangeEntries().at(-1)?.mode).toBe("none");
		expect(harness.session.model?.id).toBe(initialModelId);
	});

	it("enterMode('goal')/exitMode('goal') sets the goal state and augments/restores the toolset", async () => {
		const harness = await createModeSession(
			Settings.isolated({ "compaction.enabled": false, "retry.enabled": false }),
		);

		await harness.session.enterMode("goal", { objective: "Ship the release" });

		const state = harness.session.getGoalModeState();
		expect(state?.enabled).toBe(true);
		expect(state?.goal?.objective).toBe("Ship the release");
		expect(harness.session.getActiveToolNames()).toContain("goal");

		await harness.session.exitMode("goal", { reason: "completed" });

		expect(harness.session.getGoalModeState()).toBeUndefined();
		expect(harness.session.getActiveToolNames()).not.toContain("goal");
		expect(modeChangeEntries().at(-1)?.mode).toBe("none");
	});

	it("enterMode('vibe')/exitMode('vibe') activates the reduced toolset and restores it on exit", async () => {
		const harness = await createModeSession(
			Settings.isolated({ "compaction.enabled": false, "retry.enabled": false }),
		);
		const preVibeTools = harness.session.getActiveToolNames();

		await harness.session.enterMode("vibe");

		const state = harness.session.getVibeModeState();
		expect(state?.enabled).toBe(true);
		const vibeTools = harness.session.getActiveToolNames();
		expect(vibeTools).toContain("read");
		expect(vibeTools).toContain("vibe_dir");
		expect(vibeTools).toContain("vibe_worker");

		await harness.session.exitMode("vibe");

		expect(harness.session.getVibeModeState()).toBeUndefined();
		expect(harness.session.getActiveToolNames()).toEqual(preVibeTools);
		expect(harness.session.getActiveToolNames()).not.toContain("vibe_dir");
	});

	it("mode entry bumps the external state version", async () => {
		const harness = await createModeSession(
			Settings.isolated({ "compaction.enabled": false, "retry.enabled": false }),
		);
		const before = harness.session.getStateVersion();

		await harness.session.enterMode("plan");

		expect(harness.session.getStateVersion()).toBeGreaterThan(before);
	});
});
