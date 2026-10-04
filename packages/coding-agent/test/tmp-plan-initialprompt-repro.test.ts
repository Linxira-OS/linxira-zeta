/**
 * THROWAWAY repro for: `/plan <task>` via web gateway mode_enter activates plan
 * mode but the task never becomes a planning round. Not part of the suite.
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

describe("repro: plan mode initialPrompt via enterMode", () => {
	let tempDir: TempDir;
	let authDir: TempDir;
	let authStorage: AuthStorage;
	let modelRegistry: ModelRegistry;
	let session: AgentSession | undefined;

	beforeAll(async () => {
		authDir = TempDir.createSync("@pi-repro-auth-");
		authStorage = await AuthStorage.create(authDir.join("auth.db"));
		authStorage.keys.setRuntime("anthropic", "test-key");
		modelRegistry = new ModelRegistry(authStorage, authDir.join("models.yml"));
	});

	afterAll(() => {
		authStorage.close();
		authDir.removeSync();
	});

	beforeEach(() => {
		tempDir = TempDir.createSync("@pi-repro-");
	});

	afterEach(async () => {
		try {
			await session?.dispose();
		} finally {
			session = undefined;
			await tempDir?.remove();
		}
	});

	async function createSession(): Promise<{ session: AgentSession; mock: MockModel }> {
		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("bundled model missing");

		const askTool = makeTool("ask");
		const writeTool = makeTool("write");
		const readTool = makeTool("read");
		const toolRegistry = new Map<string, AgentTool>([
			["ask", askTool],
			["write", writeTool],
			["read", readTool],
		]);

		const mock = createMockModel({ responses: [{ content: ["ok"] }, { content: ["ok2"] }, { content: ["ok3"] }, { content: ["ok4"] }] });
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: { model, systemPrompt: ["Test"], tools: [askTool, writeTool, readTool], messages: [] },
			streamFn: mock.stream,
		});

		const created = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(),
			settings: Settings.isolated({ "compaction.enabled": false, "retry.enabled": false }),
			modelRegistry,
			toolRegistry,
			builtInToolNames: ["ask", "write", "read"],
			advisorTools: [],
			createVibeTools: () => [makeTool("vibe_dir")],
		});
		session = created;
		return { session: created, mock };
	}

	async function settle(s: AgentSession): Promise<void> {
		await s.waitForIdle();
		// Macrotask yield: a queued drain scheduled inside enterMode claims the
		// turn only after the current task unwinds; waitForIdle alone can
		// snapshot the pre-turn idle state.
		const { promise, resolve } = Promise.withResolvers<void>();
		queueMicrotask(() => resolve());
		await promise;
		await s.waitForIdle();
	}

	it("A: fresh session → enterMode(plan, initialPrompt) runs a round with the task", async () => {
		const { session: s, mock } = await createSession();
		await s.enterMode("plan", { initialPrompt: "Plan the migration" });
		await settle(s);
		const userTexts = s.agent.state.messages.filter(m => m.role === "user").map(m => JSON.stringify(m.content));
		console.log("[A] user texts:", userTexts, "isStreaming:", s.isStreaming, "queue:", JSON.stringify(s.getQueuedMessages()));
		expect(userTexts.some(t => t.includes("Plan the migration"))).toBe(true);
	});

	it("B: session with history → enterMode(plan, initialPrompt) steers a round", async () => {
		const { session: s, mock } = await createSession();
		await s.prompt("hello world");
		await settle(s);
		await s.enterMode("plan", { initialPrompt: "Analyze this repo" });
		await settle(s);
		const userTexts = s.agent.state.messages.filter(m => m.role === "user").map(m => JSON.stringify(m.content));
		console.log("[B] user texts:", userTexts, "isStreaming:", s.isStreaming, "queue:", JSON.stringify(s.getQueuedMessages()));
		expect(userTexts.some(t => t.includes("Analyze this repo"))).toBe(true);
	});

	it("C: already in plan mode → enterMode(plan, initialPrompt) keeps the task", async () => {
		const { session: s } = await createSession();
		await s.enterMode("plan");
		await s.enterMode("plan", { initialPrompt: "Second task" });
		await settle(s);
		const userTexts = s.agent.state.messages.filter(m => m.role === "user").map(m => JSON.stringify(m.content));
		console.log("[C] user texts:", userTexts, "queue:", JSON.stringify(s.getQueuedMessages()));
		expect(userTexts.some(t => t.includes("Second task")) || s.getQueuedMessages().steering.some(t => t.includes("Second task"))).toBe(true);
	});
});
