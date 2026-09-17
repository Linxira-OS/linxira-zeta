import { describe, expect, test, vi } from "bun:test";
import { Agent, type AgentTool } from "@linxiraos/pi-agent-core";
import type { Model } from "@linxiraos/pi-ai";
import { buildModel } from "@linxiraos/pi-catalog/build";
import { type } from "@linxiraos/pi-omptype";
import { Settings } from "../src/config/settings";
import type { InteractiveModeContext } from "../src/modes/types";
import type { PlanWorkflow } from "../src/plan-mode/state";
import { AgentSession } from "../src/session/agent-session";
import { SessionManager } from "../src/session/session-manager";
import { executeBuiltinSlashCommand } from "../src/slash-commands/builtin-registry";

function model(): Model {
	return buildModel({
		id: "test-plan-model",
		name: "test",
		api: "openai-responses",
		provider: "openai",
		baseUrl: "https://example.invalid",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 8192,
		maxTokens: 1024,
	});
}

function tool(name: string): AgentTool {
	return {
		name,
		label: name,
		description: name,
		parameters: type({}),
		async execute() {
			return { content: [{ type: "text", text: name }] };
		},
	};
}

const sessions: AgentSession[] = [];

function createSession(): AgentSession {
	const tools = [tool("read"), tool("ask"), tool("write"), tool("edit")];
	const session = new AgentSession({
		agent: new Agent({ initialState: { model: model(), systemPrompt: [], tools } }),
		sessionManager: SessionManager.inMemory(),
		settings: Settings.isolated({}),
		modelRegistry: {
			getApiKey: async () => "test-key",
			hasConfiguredAuth: () => true,
			refreshSelectedModelMetadata: async (value: Model) => value,
			clearSuppressedSelector: () => undefined,
		} as never,
		toolRegistry: new Map(tools.map(value => [value.name, value])),
		builtInToolNames: tools.map(value => value.name),
		rebuildSystemPrompt: async names => ({ systemPrompt: [`tools:${names.join(",")}`] }),
	});
	sessions.push(session);
	return session;
}

async function planModeContext(workflow: PlanWorkflow | undefined, reentry = false): Promise<string> {
	const session = createSession();
	session.setPlanModeState({ enabled: true, planFilePath: "local://PLAN.md", workflow, reentry });
	await session.sendPlanModeContext();
	const planMessage = session.state.messages.find(
		message => (message as { customType?: string }).customType === "plan-mode-context",
	);
	return String((planMessage as { content?: string })?.content ?? "");
}

describe("plan-ultra mode context", () => {
	test("ultra workflow renders the ultra template with the incremental-write discipline", async () => {
		const content = await planModeContext("ultra");
		expect(content).toContain("Plan-ultra mode active");
		expect(content).toContain("Workflow — ultra");
		// Always-on incremental write discipline (survives non-reentry turns):
		expect(content).toContain("NEVER re-emit an existing plan with a single full-replacement");
		expect(content).toContain("high-limit re-reads before amending");
		// Re-entry send-back guidance is always-on in ultra (covers the turn
		// right after a review dismissal, where reentry is not yet set).
		expect(content).toContain("sending the plan back");
	});

	test("ultra template does not leak the parallel/iterative workflow sections", async () => {
		const content = await planModeContext("ultra");
		expect(content).not.toContain("Workflow — parallel");
		expect(content).not.toContain("Workflow — iterative");
	});

	test("default workflow renders the parallel template without ultra markers", async () => {
		const content = await planModeContext(undefined);
		expect(content).toContain("Workflow — parallel");
		expect(content).not.toContain("Workflow — ultra");
		expect(content).not.toContain("NEVER re-emit an existing plan with a single full-replacement");
	});
});

describe("/plan-ultra command dispatch", () => {
	function stubContext() {
		const handlePlanUltraCommand = vi.fn(async () => true);
		const handlePlanModeCommand = vi.fn(async () => true);
		const ctx = {
			collabGuest: false,
			editor: {
				clearDraft() {},
				getText: () => "",
				setText() {},
				pendingImages: [],
				pendingImageLinks: [],
			},
			handlePlanUltraCommand,
			handlePlanModeCommand,
		} as unknown as InteractiveModeContext;
		return { ctx, handlePlanUltraCommand, handlePlanModeCommand };
	}

	test("/plan-ultra routes to the ultra plan handler", async () => {
		const { ctx, handlePlanUltraCommand } = stubContext();
		const result = await executeBuiltinSlashCommand("/plan-ultra", { ctx } as never);
		expect(result).toBe(true);
		expect(handlePlanUltraCommand).toHaveBeenCalledTimes(1);
	});

	test("/plan still routes to the plain plan handler", async () => {
		const { ctx, handlePlanModeCommand } = stubContext();
		const result = await executeBuiltinSlashCommand("/plan", { ctx } as never);
		expect(result).toBe(true);
		expect(handlePlanModeCommand).toHaveBeenCalledTimes(1);
		expect((handlePlanModeCommand.mock.calls[0] as unknown[] | undefined)?.[2]).toBeUndefined();
	});
});
