import { afterEach, describe, expect, it, vi } from "bun:test";
import * as path from "node:path";
import { Agent, type AgentTool } from "@linxiraos/pi-agent-core";
import { createMockModel } from "@linxiraos/pi-ai/providers/mock";
import { getBundledModel } from "@linxiraos/pi-catalog/models";
import { type } from "@linxiraos/zeta-schema";
import { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { Settings } from "@linxiraos/zeta/config/settings";
import { AgentSession } from "@linxiraos/zeta/session/agent-session";
import { AuthStorage } from "@linxiraos/zeta/session/auth-storage";
import { convertToLlm } from "@linxiraos/zeta/session/messages";
import { SessionManager } from "@linxiraos/zeta/session/session-manager";
import { TempDir } from "@linxiraos/pi-utils";

const REVIEWER_PERSONA = "Find bugs author wants fixed before merge.";

interface CapturedRequest {
	model: string;
	systemPrompt: string[];
	tools: string[];
	sessionModel: string | undefined;
	commandSpawns: string | null;
}

function probeTool(name: string): AgentTool {
	return {
		name,
		label: name,
		description: `${name} probe`,
		parameters: type({}),
		async execute() {
			return { content: [{ type: "text", text: name }], details: {} };
		},
	} as AgentTool;
}

describe("command agent/model execution policy", () => {
	let session: AgentSession | undefined;
	let authStorage: AuthStorage | undefined;
	let tempDir: TempDir | undefined;

	afterEach(async () => {
		await session?.dispose();
		session = undefined;
		authStorage?.close();
		authStorage = undefined;
		tempDir?.removeSync();
		tempDir = undefined;
	});

	async function createSession(captured: CapturedRequest[]): Promise<AgentSession> {
		tempDir = TempDir.createSync("@zeta-command-policy-");
		authStorage = await AuthStorage.create(path.join(tempDir.path(), "auth.db"));
		authStorage.keys.setRuntime("anthropic", "test-key");
		const modelRegistry = new ModelRegistry(authStorage);
		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		const commandModel = getBundledModel("anthropic", "claude-haiku-4-5");
		if (!model || !commandModel) throw new Error("Expected bundled Anthropic models");
		const tools = ["read", "bash", "edit"].map(probeTool);
		const mock = createMockModel({ responses: [{ content: ["ok"] }] });
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: { model, systemPrompt: ["BASE"], tools, messages: [] },
			convertToLlm,
			streamFn: (requestModel, context, options) => {
				captured.push({
					model: `${requestModel.provider}/${requestModel.id}`,
					systemPrompt: [...(context.systemPrompt ?? [])],
					tools: session?.getEnabledToolNames() ?? [],
					sessionModel: session?.model ? `${session.model.provider}/${session.model.id}` : undefined,
					commandSpawns: session?.getCommandSpawns() ?? null,
				});
				return mock.stream(requestModel, context, options);
			},
		});
		const settings = Settings.isolated({ "compaction.enabled": false, "todo.enabled": false });
		session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(tempDir.path()),
			settings,
			modelRegistry,
			toolRegistry: new Map(tools.map(tool => [tool.name, tool])),
			rebuildSystemPrompt: async () => ({ systemPrompt: ["BASE"] }),
		});
		return session;
	}

	it("applies command model, persona and tool policy for the model turn, then restores them", async () => {
		const captured: CapturedRequest[] = [];
		const active = await createSession(captured);
		active.setSlashCommands([
			{
				name: "review",
				description: "Review",
				content: "Review $ARGUMENTS",
				source: "test",
				agent: "reviewer",
				model: "anthropic/claude-haiku-4-5",
			},
		]);

		await active.prompt("/review the diff");
		await active.waitForIdle();

		expect(captured).toHaveLength(1);
		expect(captured[0]?.model).toBe("anthropic/claude-haiku-4-5");
		expect(captured[0]?.sessionModel).toBe("anthropic/claude-haiku-4-5");
		expect(captured[0]?.systemPrompt).toContain("BASE");
		expect(captured[0]?.systemPrompt.join("\n")).toContain(REVIEWER_PERSONA);
		expect(captured[0]?.tools).toEqual(["read", "bash"]);
		expect(captured[0]?.commandSpawns).toBe("scout");

		expect(active.model && `${active.model.provider}/${active.model.id}`).toBe("anthropic/claude-sonnet-4-5");
		expect(active.getEnabledToolNames()).toEqual(["read", "bash", "edit"]);
		expect(active.getCommandSpawns()).toBeNull();
		expect(active.systemPrompt.join("\n")).not.toContain(REVIEWER_PERSONA);
	});

	it("blocks further prompts when command policy restore fails", async () => {
		const captured: CapturedRequest[] = [];
		const active = await createSession(captured);
		active.setSlashCommands([
			{
				name: "review",
				description: "Review",
				content: "Review $ARGUMENTS",
				source: "test",
				agent: "reviewer",
				model: "anthropic/claude-haiku-4-5",
			},
		]);

		const originalSetModelTemporary = active.setModelTemporary.bind(active);
		let calls = 0;
		vi.spyOn(active, "setModelTemporary").mockImplementation(async (model, thinkingLevel, options) => {
			calls += 1;
			if (calls === 2) throw new Error("simulated restore failure");
			return originalSetModelTemporary(model, thinkingLevel, options);
		});

		await expect(active.prompt("/review the diff")).rejects.toThrow(/Command policy restore failed/);
		await active.waitForIdle();
		expect(captured).toHaveLength(1);
		expect(calls).toBe(2);

		await expect(active.prompt("plain prompt after failed restore")).rejects.toThrow(/policy is uncertain/);
		expect(captured).toHaveLength(1);
	});

	it("rejects an unknown command agent before any model request", async () => {
		const captured: CapturedRequest[] = [];
		const active = await createSession(captured);
		active.setSlashCommands([
			{
				name: "review",
				description: "Review",
				content: "Review $ARGUMENTS",
				source: "test",
				agent: "missing-command-agent",
			},
		]);

		await expect(active.prompt("/review the diff")).rejects.toThrow(/Unknown command agent/);
		expect(captured).toHaveLength(0);
		expect(active.model && `${active.model.provider}/${active.model.id}`).toBe("anthropic/claude-sonnet-4-5");
	});

	it("rejects an unresolved command model before any model request", async () => {
		const captured: CapturedRequest[] = [];
		const active = await createSession(captured);
		active.setSlashCommands([
			{
				name: "review",
				description: "Review",
				content: "Review $ARGUMENTS",
				source: "test",
				model: "missing-provider/missing-model",
			},
		]);

		await expect(active.prompt("/review the diff")).rejects.toThrow(/Unknown or unavailable command model/);
		expect(captured).toHaveLength(0);
	});
});
