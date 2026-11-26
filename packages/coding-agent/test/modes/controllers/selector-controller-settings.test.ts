import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { Agent } from "@linxiraos/pi-agent-core";
import type { Model } from "@linxiraos/pi-ai";
import { getBundledModel } from "@linxiraos/pi-catalog/models";
import { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { Settings } from "@linxiraos/zeta/config/settings";
import { SecretObfuscator } from "@linxiraos/zeta/secrets";
import { AgentSession } from "@linxiraos/zeta/session/agent-session";
import { AuthStorage } from "@linxiraos/zeta/session/auth-storage";
import { SessionManager } from "@linxiraos/zeta/session/session-manager";
import { TempDir } from "@linxiraos/pi-utils";
import { cfgCompactionEnabled } from "@linxiraos/zeta/session/context-settings";
import { cfgFollowUpMode, cfgInterruptMode, cfgSteeringMode } from "@linxiraos/zeta/modes/settings";
import { cfgToolsXdevDocs } from "@linxiraos/zeta/tools/settings";

/**
 * The settings panel writes the setting first and then notifies the mode. Live
 * side effects are owned by settings listeners on the session (queue modes,
 * prompt inputs), so these tests write through the same handles the panel uses
 * rather than the SelectorController's post-write hook.
 */
describe("settings panel prompt-affecting settings", () => {
	let tempDir: TempDir;
	let authStorage: AuthStorage;
	let settings: Settings;
	let session: AgentSession;
	let configPath: string;

	beforeEach(async () => {
		tempDir = TempDir.createSync("@pi-selector-settings-");
		const agentDir = tempDir.path();
		configPath = path.join(agentDir, "config.yml");

		authStorage = await AuthStorage.create(path.join(agentDir, "auth.db"));
		authStorage.keys.setRuntime("anthropic", "test-key");
		const modelRegistry = new ModelRegistry(authStorage);

		const model = getBundledModel("anthropic", "claude-sonnet-4-5") as Model;
		settings = await Settings.loadIsolated({ agentDir, cwd: agentDir });

		session = new AgentSession({
			agent: new Agent({ initialState: { model, systemPrompt: ["Test"], tools: [], messages: [] } }),
			sessionManager: SessionManager.create(agentDir, agentDir),
			settings,
			modelRegistry,
			obfuscator: new SecretObfuscator([]),
		});
	});

	afterEach(async () => {
		// The session was never prompted; skip its 5s in-flight drain window.
		await session?.dispose({ drainTimeoutMs: 100 });
		authStorage.close();
		try {
			// Windows holds a handle on the config/session files for a moment after
			// close; a zero-retry removal keeps the hook fast and leaves the rest
			// to the OS temp cleaner.
			fs.rmSync(tempDir.path(), { recursive: true, force: true, maxRetries: 0 });
		} catch {}
	});

	it("refreshes the active prompt when xdev docs mode changes", async () => {
		const refreshBaseSystemPrompt = vi.spyOn(session, "refreshBaseSystemPrompt").mockResolvedValue();

		cfgToolsXdevDocs.set(settings, "inline");
		await Promise.resolve();

		expect(refreshBaseSystemPrompt).toHaveBeenCalledTimes(1);
	});

	it("applies panel queue-mode toggles live and persists them globally", async () => {
		cfgSteeringMode.set(settings, "all");
		cfgFollowUpMode.set(settings, "all");
		cfgInterruptMode.set(settings, "wait");
		await settings.flush();
		await Promise.resolve();

		expect(session.steeringMode).toBe("all");
		expect(session.followUpMode).toBe("all");
		expect(session.interruptMode).toBe("wait");
		expect(settings.getGlobalSettings()).toMatchObject({
			steeringMode: "all",
			followUpMode: "all",
			interruptMode: "wait",
		});
		const onDisk = await Bun.file(configPath).text();
		expect(onDisk).toContain("steeringMode: all");
		expect(onDisk).toContain("followUpMode: all");
		expect(onDisk).toContain("interruptMode: wait");
	});

	it("persists the Auto-Compact toggle globally from the settings panel", async () => {
		cfgCompactionEnabled.set(settings, false);
		await settings.flush();
		await Promise.resolve();

		// The panel owns the durable write; unlike the session-scoped RPC path
		// (#11431), it does not route through a runtime-only override.
		expect(session.autoCompactionEnabled).toBe(false);
		const onDisk = await Bun.file(configPath).text();
		expect(onDisk).toMatch(/compaction:\n\s+enabled: false/);
	});
});
