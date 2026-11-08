import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AuthStorage } from "@linxiraos/pi-ai";
import { getBundledModel } from "@linxiraos/pi-catalog/models";
import { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { Settings } from "@linxiraos/zeta/config/settings";
import { createAgentSession } from "@linxiraos/zeta/sdk";
import type { AgentSession } from "@linxiraos/zeta/session/agent-session";
import { SessionManager } from "@linxiraos/zeta/session/session-manager";
import { removeSyncWithRetries, Snowflake } from "@linxiraos/pi-utils";

import { cfgEditMode } from "@linxiraos/zeta/edit/settings";
import { cfgBashEnabled } from "@linxiraos/zeta/exec/settings";
import { cfgGithubEnabled, cfgGrepEnabled } from "@linxiraos/zeta/tools/settings";

// Tool-gating settings (`grep.enabled`, `*.enabled`, ...) must reconcile a live
// session's tools and prompt instead of waiting for the next session.
describe("settings-gated tools in a live session", () => {
	let registryDir: string;
	let authStorage: AuthStorage;
	let modelRegistry: ModelRegistry;
	const sessions: AgentSession[] = [];

	beforeAll(async () => {
		registryDir = path.join(os.tmpdir(), `pi-settings-gated-tools-${Snowflake.next()}`);
		fs.mkdirSync(registryDir, { recursive: true });
		authStorage = await AuthStorage.create(path.join(registryDir, "auth.db"));
		modelRegistry = new ModelRegistry(authStorage, path.join(registryDir, "models.yml"));
	});

	afterEach(async () => {
		for (const session of sessions.splice(0)) await session.dispose().catch(() => {});
	});

	afterAll(() => {
		authStorage.close();
		if (fs.existsSync(registryDir)) removeSyncWithRetries(registryDir);
	});

	async function startSession(settings: Settings, toolNames?: string[]): Promise<AgentSession> {
		const { session } = await createAgentSession({
			cwd: registryDir,
			agentDir: registryDir,
			modelRegistry,
			sessionManager: SessionManager.inMemory(),
			settings,
			model: getBundledModel("openai", "gpt-4o-mini"),
			disableExtensionDiscovery: true,
			enableMCP: false,
			enableLsp: false,
			skills: [],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
			rules: [],
			workspaceTree: { rootPath: registryDir, rendered: "", truncated: false, totalLines: 0, agentsMdFiles: [] },
			toolNames,
		});
		sessions.push(session);
		return session;
	}

	/** Lets the coalesced watch fire, then waits for the reconcile it queued on the registry lock. */
	async function settle(session: AgentSession): Promise<void> {
		await Promise.resolve();
		await session.runToolRegistryMutation(async () => {});
	}

	const GREP_POLICY = "NEVER shell `grep`/`rg`/`awk`";

	it("removes and restores grep in the request tools and system prompt", async () => {
		const settings = Settings.isolated({});
		const session = await startSession(settings);
		expect(session.getActiveToolNames()).toContain("grep");
		expect(session.systemPrompt.join("\n")).toContain(GREP_POLICY);

		cfgGrepEnabled.set(settings, false);
		await settle(session);
		expect(session.getActiveToolNames()).not.toContain("grep");
		expect(session.getToolByName("grep")).toBeUndefined();
		expect(session.systemPrompt.join("\n")).not.toContain(GREP_POLICY);
		expect(session.getActiveToolNames()).toContain("read");

		cfgGrepEnabled.set(settings, true);
		await settle(session);
		expect(session.getActiveToolNames()).toContain("grep");
		expect(session.systemPrompt.join("\n")).toContain(GREP_POLICY);
	});

	it("edit.mode none swaps edit out and keeps bash despite bash.enabled", async () => {
		const settings = Settings.isolated({ "bash.enabled": false });
		const session = await startSession(settings);
		expect(session.getActiveToolNames()).toContain("edit");
		expect(session.getActiveToolNames()).not.toContain("bash");

		cfgEditMode.set(settings, "none");
		await settle(session);
		expect(session.getToolByName("edit")).toBeUndefined();
		expect(session.getActiveToolNames()).not.toContain("edit");
		expect(session.getActiveToolNames()).toContain("bash");

		cfgEditMode.set(settings, "replace");
		await settle(session);
		expect(session.getActiveToolNames()).toContain("edit");
		expect(session.getToolByName("bash")).toBeUndefined();
	});

	it("never widens an explicit tool list", async () => {
		const settings = Settings.isolated({ "grep.enabled": false, "github.enabled": false });
		const session = await startSession(settings, ["read", "bash"]);
		const before = session.getActiveToolNames();
		expect(before).not.toContain("grep");

		cfgGrepEnabled.set(settings, true);
		cfgGithubEnabled.set(settings, true);
		await settle(session);
		expect(session.getActiveToolNames()).toEqual(before);
		expect(session.getToolByName("grep")).toBeUndefined();

		cfgBashEnabled.set(settings, false);
		await settle(session);
		expect(session.getActiveToolNames()).not.toContain("bash");
		expect(session.getActiveToolNames()).toContain("read");
	});
});
