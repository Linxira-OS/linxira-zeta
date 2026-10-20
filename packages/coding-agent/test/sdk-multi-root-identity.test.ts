/**
 * SDK-level contract for multi-root identity: two top-level sessions created
 * in one process register under distinct ids, and creating the second one no
 * longer displaces the first from `MAIN_AGENT_ID`.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as path from "node:path";
import { getBundledModel } from "@linxiraos/pi-catalog/models";
import { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { Settings } from "@linxiraos/zeta/config/settings";
import { IrcBus } from "@linxiraos/zeta/irc/bus";
import { AgentRegistry, MAIN_AGENT_ID } from "@linxiraos/zeta/registry/agent-registry";
import { createAgentSession } from "@linxiraos/zeta/sdk";
import type { AgentSession } from "@linxiraos/zeta/session/agent-session";
import { AuthStorage } from "@linxiraos/zeta/session/auth-storage";
import { SessionManager } from "@linxiraos/zeta/session/session-manager";
import { TempDir } from "@linxiraos/pi-utils";

describe("multi-root ids from createAgentSession", () => {
	let tempDir: TempDir;
	let authStorage: AuthStorage;
	let modelRegistry: ModelRegistry;
	const sessions: AgentSession[] = [];

	beforeEach(async () => {
		IrcBus.resetGlobalForTests();
		AgentRegistry.resetGlobalForTests();
		tempDir = TempDir.createSync("@zeta-multi-root-");
		authStorage = await AuthStorage.create(":memory:");
		modelRegistry = new ModelRegistry(authStorage, path.join(tempDir.path(), "models.yml"));
	});

	afterEach(async () => {
		for (const session of sessions.splice(0)) await session.dispose().catch(() => {});
		authStorage.close();
		tempDir.removeSync();
		IrcBus.resetGlobalForTests();
		AgentRegistry.resetGlobalForTests();
	});

	async function createRoot(): Promise<AgentSession> {
		const cwd = tempDir.join("project");
		const { session } = await createAgentSession({
			cwd,
			agentDir: tempDir.join("agent"),
			authStorage,
			modelRegistry,
			settings: Settings.isolated(),
			sessionManager: SessionManager.inMemory(cwd),
			model: getBundledModel("openai", "gpt-4o-mini"),
			disableExtensionDiscovery: true,
			skills: [],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
			enableMCP: false,
			enableLsp: false,
			skipPythonPreflight: true,
		});
		sessions.push(session);
		return session;
	}

	it("keeps the first root as Main and registers a second root under its session id", async () => {
		const first = await createRoot();
		const firstId = first.getAgentId() ?? "";
		expect(firstId).toBe(MAIN_AGENT_ID);

		const second = await createRoot();
		const secondId = second.getAgentId() ?? "";
		const secondSessionId = second.sessionManager.getSessionId();

		expect(secondId).toBe(secondSessionId);
		expect(secondId).not.toBe(MAIN_AGENT_ID);

		const registry = AgentRegistry.global();
		// The second root must not displace the first: both refs stay live and
		// addressable, each bound to its own session.
		expect(registry.get(MAIN_AGENT_ID)?.session).toBe(first);
		expect(registry.get(secondId)?.session).toBe(second);
		expect(registry.listVisibleTo(firstId).map(ref => ref.id)).toContain(secondId);
		expect(registry.listVisibleTo(secondId).map(ref => ref.id)).toContain(MAIN_AGENT_ID);

		// `agent://main` from the second root names the first, never itself.
		expect(registry.resolveMainAlias("main", secondId)).toBe(MAIN_AGENT_ID);
		expect(registry.resolveMainAlias("main", MAIN_AGENT_ID)).toBe(MAIN_AGENT_ID);
	});
});
