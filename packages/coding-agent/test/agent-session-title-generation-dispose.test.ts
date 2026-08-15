import { afterEach, describe, expect, it, vi } from "bun:test";
import * as path from "node:path";
import { Agent } from "@linxiraos/pi-agent-core";
import * as ai from "@linxiraos/pi-ai";
import { createMockModel } from "@linxiraos/pi-ai/providers/mock";
import { getBundledModel } from "@linxiraos/pi-catalog/models";
import { TempDir } from "@linxiraos/pi-utils";
import { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { Settings } from "@linxiraos/zeta/config/settings";
import { AgentSession } from "@linxiraos/zeta/session/agent-session";
import { AuthStorage } from "@linxiraos/zeta/session/auth-storage";
import { SessionManager } from "@linxiraos/zeta/session/session-manager";
import { createAssistantMessage } from "./helpers/agent-session-setup";

let session: AgentSession | undefined;
let authStorage: AuthStorage | undefined;
let tempDir: TempDir | undefined;

afterEach(async () => {
	vi.restoreAllMocks();
	await session?.dispose();
	authStorage?.close();
	tempDir?.removeSync();
	session = undefined;
	authStorage = undefined;
	tempDir = undefined;
});

describe("AgentSession title generation disposal", () => {
	it("uses the active provider session and aborts an in-flight title request during disposal", async () => {
		tempDir = TempDir.createSync("@pi-title-dispose-");
		authStorage = await AuthStorage.create(path.join(tempDir.path(), "auth.db"));
		authStorage.setRuntimeApiKey("anthropic", "test-key");
		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Expected claude-sonnet-4-5 model to exist");
		const providerSessionId = "provider-session";

		const settings = Settings.isolated({
			"compaction.enabled": false,
			"providers.tinyModel": "online",
		});
		settings.overrideModelRoles({ smol: `${model.provider}/${model.id}` });
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: { model, systemPrompt: ["Test"], tools: [], messages: [] },
			streamFn: createMockModel({ responses: [{ content: ["Done"] }] }).stream,
		});
		const modelRegistry = new ModelRegistry(authStorage);
		const getApiKey = vi.spyOn(modelRegistry, "getApiKey");
		const resolver = vi.spyOn(modelRegistry, "resolver");
		session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(),
			settings,
			modelRegistry,
			providerSessionId,
		});
		const started = Promise.withResolvers<void>();
		const response = Promise.withResolvers<ai.AssistantMessage>();
		let requestSignal: AbortSignal | undefined;
		vi.spyOn(ai, "completeSimple").mockImplementation((_model, _context, options) => {
			requestSignal = options?.signal;
			requestSignal?.addEventListener("abort", () => response.resolve(createAssistantMessage("")), { once: true });
			started.resolve();
			return response.promise;
		});

		const generation = session.generateTitle("Investigate shutdown");
		await started.promise;
		expect(getApiKey.mock.calls[0]?.[1]).toBe(providerSessionId);
		expect(resolver.mock.calls[0]?.[1]).toBe(providerSessionId);
		session.beginDispose();

		expect(requestSignal?.aborted).toBe(true);
		expect(await generation).toBeNull();
	});
});
