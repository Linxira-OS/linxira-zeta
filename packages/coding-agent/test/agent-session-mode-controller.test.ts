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
import type { Message } from "@linxiraos/pi-ai";
import { getBundledModel } from "@linxiraos/pi-catalog/models";
import { type } from "@linxiraos/pi-omptype";
import { resolveLocalUrlToPath } from "@linxiraos/zeta/internal-urls";
import { TempDir } from "@linxiraos/pi-utils";
import { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { Settings } from "@linxiraos/zeta/config/settings";
import { AgentSession } from "@linxiraos/zeta/session/agent-session";
import { convertToLlm } from "@linxiraos/zeta/session/messages";
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

/** Concatenate the text blocks of a provider message (string or content-array). */
function messageText(message: { content?: unknown }): string {
	const content = message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((block): block is { type: "text"; text: string } => (block as { type?: string }).type === "text")
		.map(block => block.text)
		.join("\n");
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
		authStorage.keys.setRuntime("anthropic", "test-key");
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

	async function createModeSession(settings: Settings, options?: { mock?: MockModel }): Promise<ModeHarness> {
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

		const mock = options?.mock ?? createMockModel({ responses: [{ content: ["ok"] }] });
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: {
				model,
				systemPrompt: ["Test"],
				tools: [askTool, writeTool, readTool],
				messages: [],
			},
			streamFn: mock.stream,
			// Production wiring (`createAgentSession` passes the coding-agent's
			// `convertToLlm`): without it a `custom` message (e.g. the plan-mode
			// context) lands in the transcript but never reaches the model, so
			// request-shape assertions would read the wrong thing.
			convertToLlm,
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

	it("records who armed plan mode: an agent entry is marked, every other caller stays user-armed", async () => {
		const harness = await createModeSession(
			Settings.isolated({ "compaction.enabled": false, "retry.enabled": false }),
		);

		await harness.session.enterMode("plan", { enteredBy: "agent" });
		expect(harness.session.getPlanModeState()?.enteredBy).toBe("agent");

		// The default is the conservative direction: `/plan`, the CLI, the web
		// gateway and ACP clients all omit `enteredBy`, and the `mode` tool must
		// not be able to leave a mode any of them armed.
		await harness.session.exitMode("plan");
		await harness.session.enterMode("plan");
		expect(harness.session.getPlanModeState()?.enteredBy).toBe("user");
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

	function userTexts(harness: ModeHarness): string[] {
		return harness.session.agent.state.messages
			.filter(m => m.role === "user")
			.map(m => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)));
	}

	it("enterMode('plan', { initialPrompt }) dispatches the task as the first planning round", async () => {
		const harness = await createModeSession(
			Settings.isolated({ "compaction.enabled": false, "retry.enabled": false }),
		);

		await harness.session.enterMode("plan", { initialPrompt: "Draft the migration plan" });
		await harness.session.waitForIdle();

		// The steered task must land in the transcript and drive a model call,
		// not just arm the mode (web `/plan <task>` regression).
		expect(userTexts(harness).some(text => text.includes("Draft the migration plan"))).toBe(true);
		expect(harness.mock.calls.length).toBeGreaterThan(0);
	});

	it("enterMode('plan', { initialPrompt }) while plan mode is armed still delivers the task", async () => {
		const harness = await createModeSession(
			Settings.isolated({ "compaction.enabled": false, "retry.enabled": false }),
		);
		await harness.session.enterMode("plan");

		await harness.session.enterMode("plan", { initialPrompt: "Second task" });
		await harness.session.waitForIdle();

		// Re-entry is a mode no-op, but the supplied task must reach the agent
		// instead of being dropped by the early return.
		expect(
			userTexts(harness).some(text => text.includes("Second task")) ||
				harness.session.getQueuedMessages().steering.some(text => text.includes("Second task")),
		).toBe(true);
	});

	it("enterMode('plan', { initialPrompt }) opens the turn with the plan-mode context", async () => {
		const settings = Settings.isolated({ "compaction.enabled": false, "retry.enabled": false });
		// `enterMode` schedules the queued-task drain instead of awaiting the
		// turn, so the mock resolves the signal when the drain reaches the model.
		const firstRequest = Promise.withResolvers<readonly Message[]>();
		const mock = createMockModel({
			handler: context => {
				firstRequest.resolve(context.messages);
				return { content: ["ok"] };
			},
		});
		const harness = await createModeSession(settings, { mock });

		await harness.session.enterMode("plan", { initialPrompt: "Draft the migration plan" });
		const request = await firstRequest.promise;

		// The turn must start with `plan-mode-context` immediately before the
		// user task — the CLI's `/plan <prompt>` reaches `prompt()`, whose build
		// injects `#buildPlanModeMessage()`. Going through `steer()` alone left
		// the first plan turn without constraints, so settle enforcement forced
		// an instant plan file.
		const contextIndex = request.findIndex(message => messageText(message).includes("Plan mode active."));
		const taskIndex = request.findIndex(
			message => message.role === "user" && messageText(message).includes("Draft the migration plan"),
		);
		expect(contextIndex).toBeGreaterThanOrEqual(0);
		expect(taskIndex).toBeGreaterThan(contextIndex);
		const contextText = messageText(request[contextIndex]!);
		expect(contextText).toContain("Canonical plan");
		// Interpolations are filled, not left as empty template placeholders.
		expect(contextText).toContain("`write`");
		expect(contextText).not.toContain("{{");
	});

	it("a submitted plan promotes its real file path into plan-mode state", async () => {
		const harness = await createModeSession(
			Settings.isolated({ "compaction.enabled": false, "retry.enabled": false }),
		);
		await harness.session.enterMode("plan");
		const entryPlanPath = harness.session.getPlanModeState()?.planFilePath;

		// The agent drafts `local://web-plan.md` (its own slug) and proposes the
		// matching title, exactly as the plan-mode prompt instructs.
		const planPath = resolveLocalUrlToPath("local://web-plan.md", {
			getArtifactsDir: () => harness.session.sessionManager.getArtifactsDir(),
			getSessionId: () => harness.session.sessionManager.getSessionId(),
		});
		await Bun.write(planPath, "# Web plan\n\nImplement it.\n");

		const handler = harness.session.peekPlanProposalHandler();
		if (!handler) throw new Error("Expected the default plan proposal handler");
		const result = await handler("web");

		expect(result.details).toMatchObject({ planFilePath: "local://web-plan.md", planExists: true });
		// What `get_state` reads back for the web-ui Preview + plan_approve.
		expect(harness.session.getPlanModeState()?.planFilePath).toBe("local://web-plan.md");
		expect(harness.session.getPlanModeState()?.planFilePath).not.toBe(entryPlanPath);
		await expect(harness.session.getPlanFileContent("local://web-plan.md")).resolves.toContain("Implement it.");
	});
});
