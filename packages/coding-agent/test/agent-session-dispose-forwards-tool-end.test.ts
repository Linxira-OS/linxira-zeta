/**
 * Regression (#18450): a tool that settles inside dispose's bounded run drain
 * must still reach session subscribers as `tool_execution_end`; one that
 * outlives the drain must not be forwarded after dispose returns.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { type } from "@linxiraos/zeta-schema";
import { Agent, type AgentTool } from "@linxiraos/pi-agent-core";
import { createMockModel } from "@linxiraos/pi-ai/providers/mock";
import { getBundledModel } from "@linxiraos/pi-catalog/models";
import { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { Settings } from "@linxiraos/zeta/config/settings";
import { AgentSession } from "@linxiraos/zeta/session/agent-session";
import type { AuthStorage } from "@linxiraos/zeta/session/auth-storage";
import { SessionManager } from "@linxiraos/zeta/session/session-manager";
import { TempDir } from "@linxiraos/pi-utils";
import { createInMemoryAuthStorage } from "./helpers/agent-session-setup";

const CALL_ID = "toolu_dispose_drain";

describe("AgentSession dispose forwards tool ends settled inside its drain", () => {
	let tempDir: TempDir;
	let authStorage: AuthStorage;

	beforeEach(() => {
		tempDir = TempDir.createSync("@omp-dispose-tool-end-");
		authStorage = createInMemoryAuthStorage();
		authStorage.keys.setRuntime("anthropic", "test-key");
	});

	afterEach(() => {
		vi.restoreAllMocks();
		authStorage.close();
		tempDir.removeSync();
	});

	/** Start a turn whose tool ignores abort and settles only when the test releases it, like a client-bridge read. */
	async function startUncancellableTool() {
		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Expected bundled Anthropic model");
		const toolStarted = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const tool: AgentTool = {
			name: "read",
			label: "Read",
			description: "Settles when released, ignoring abort",
			parameters: type({}),
			execute: async () => {
				toolStarted.resolve();
				await release.promise;
				return { content: [{ type: "text", text: "fixture" }] };
			},
		};
		const mock = createMockModel({
			responses: [{ content: [{ type: "toolCall", id: CALL_ID, name: "read", arguments: {} }] }],
			handler: { content: ["done"] },
		});
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: { model, systemPrompt: ["Test"], tools: [tool] },
			streamFn: mock.stream,
		});
		const session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(tempDir.path()),
			settings: Settings.isolated({ "compaction.enabled": false }),
			modelRegistry: new ModelRegistry(authStorage, tempDir.join("models.yml")),
		});
		const forwardedEnds: string[] = [];
		session.subscribe(event => {
			if (event.type === "tool_execution_end") forwardedEnds.push(event.toolCallId);
		});
		const prompt = session.prompt("read the fixture").catch(() => {});
		await toolStarted.promise;
		return { session, agent, release: () => release.resolve(), forwardedEnds, prompt };
	}

	it("delivers the terminal tool event when the tool settles during the bounded drain", async () => {
		const { session, agent, release, forwardedEnds, prompt } = await startUncancellableTool();
		// Detaching the provider interceptor is the first step of the bounded run
		// drain; settle the tool exactly there, after every earlier teardown stage.
		const setInterceptor = agent.setProviderResponseInterceptor.bind(agent);
		vi.spyOn(agent, "setProviderResponseInterceptor").mockImplementation(interceptor => {
			setInterceptor(interceptor);
			if (interceptor === undefined && session.isDisposed) release();
		});

		await session.dispose();
		await prompt;

		expect(forwardedEnds).toEqual([CALL_ID]);
	});

	it("does not forward a tool end that lands after the drain deadline", async () => {
		const { session, agent, release, forwardedEnds, prompt } = await startUncancellableTool();

		await session.dispose({ drainTimeoutMs: 20 });
		release();
		await agent.waitForIdle();
		await prompt;

		expect(forwardedEnds).toEqual([]);
	});
});
