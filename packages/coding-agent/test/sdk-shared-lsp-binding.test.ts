import { afterEach, describe, expect, it, vi } from "bun:test";
import type { Api, ModelSpec } from "@linxiraos/pi-ai";
import { buildModel } from "@linxiraos/pi-catalog/build";
import { resetCapabilityForTests } from "@linxiraos/zeta/capability";
import { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { Settings } from "@linxiraos/zeta/config/settings";
import * as lspClient from "@linxiraos/zeta/lsp/client";
import { cfgLspShared } from "@linxiraos/zeta/lsp/settings";
import { type CreateAgentSessionOptions, createAgentSession } from "@linxiraos/zeta/sdk";
import type { AgentSession } from "@linxiraos/zeta/session/agent-session";
import { AuthStorage } from "@linxiraos/zeta/session/auth-storage";
import { SessionManager } from "@linxiraos/zeta/session/session-manager";
import { createSubagentSettings } from "@linxiraos/zeta/task/executor";
import { TempDir } from "@linxiraos/pi-utils";

const modelSpec: ModelSpec<Api> = {
	id: "shared-lsp-binding",
	name: "Shared LSP binding",
	api: "test-shared-lsp-binding",
	provider: "managed-primary",
	baseUrl: "http://127.0.0.1:8080/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 32_768,
	maxTokens: 1024,
};
const model = buildModel(modelSpec);

// The shared-LSP flag is process-global and read on every client cold start;
// subagent and helper sessions must not switch it off for the parent.
describe("shared LSP flag with subagents and helper sessions", () => {
	const sessions: AgentSession[] = [];

	afterEach(async () => {
		for (const session of sessions.splice(0)) {
			if (!session.isDisposed) await session.dispose();
		}
		vi.restoreAllMocks();
		resetCapabilityForTests();
	});

	const starter = async (tempDir: TempDir) => {
		const authStorage = await AuthStorage.create(tempDir.join("auth.db"));
		authStorage.keys.setRuntime(model.provider, "test-key");
		const modelRegistry = new ModelRegistry(authStorage, tempDir.join("models.yml"));
		const start = async (
			settings: Settings,
			extra: Pick<
				CreateAgentSessionOptions,
				"parentTaskPrefix" | "taskDepth" | "agentId" | "bindProcessState" | "enableLsp"
			> = {},
		): Promise<AgentSession> => {
			const { session } = await createAgentSession({
				cwd: tempDir.path(),
				agentDir: tempDir.path(),
				sessionManager: SessionManager.inMemory(tempDir.path()),
				authStorage,
				modelRegistry,
				settings,
				model,
				disableExtensionDiscovery: true,
				skills: [],
				contextFiles: [],
				promptTemplates: [],
				slashCommands: [],
				rules: [],
				enableMCP: false,
				enableLsp: false,
				skipPythonPreflight: true,
				...extra,
			});
			sessions.push(session);
			return session;
		};
		return { start, close: () => authStorage.close() };
	};

	it("a subagent session does not turn shared LSP off for its parent", async () => {
		using tempDir = TempDir.createSync("@pi-shared-lsp-binding-");
		const { start, close } = await starter(tempDir);
		try {
			const parent = Settings.isolated({ "compaction.enabled": false, "lsp.shared": true });
			await start(parent, { enableLsp: true });
			expect(lspClient.isSharedLspEnabled()).toBe(true);

			await start(createSubagentSettings(parent), {
				parentTaskPrefix: "0-Sub",
				taskDepth: 1,
				agentId: "0-Sub",
				enableLsp: false,
			});
			expect(lspClient.isSharedLspEnabled()).toBe(true);

			await start(await parent.cloneForCwd(tempDir.path()), { bindProcessState: false, enableLsp: false });
			expect(lspClient.isSharedLspEnabled()).toBe(true);

			// `Settings.isolated` values sit in the override layer, so flip that one.
			cfgLspShared.override(parent, false);
			// `listen` coalesces changes per microtask; let the queued one run.
			await Promise.resolve();
			expect(lspClient.isSharedLspEnabled()).toBe(false);
		} finally {
			close();
		}
	});

	it("a disposed top-level session hands shared LSP back to the previous holder", async () => {
		using tempDir = TempDir.createSync("@pi-shared-lsp-handback-");
		const { start, close } = await starter(tempDir);
		try {
			await start(Settings.isolated({ "compaction.enabled": false, "lsp.shared": true }), { enableLsp: true });
			const newer = await start(Settings.isolated({ "compaction.enabled": false, "lsp.shared": false }), {
				enableLsp: true,
			});
			expect(lspClient.isSharedLspEnabled()).toBe(false);

			await newer.dispose();
			expect(lspClient.isSharedLspEnabled()).toBe(true);

			for (const session of sessions.splice(0)) await session.dispose();
			// No holder left: later cold starts in this process spawn private servers.
			expect(lspClient.isSharedLspEnabled()).toBe(false);
		} finally {
			close();
		}
	});
});
