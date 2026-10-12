import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import * as path from "node:path";
import { Agent } from "@linxiraos/pi-agent-core";
import { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { resetSettingsForTest, Settings } from "@linxiraos/zeta/config/settings";
import { InteractiveMode } from "@linxiraos/zeta/modes/interactive-mode";
import { BtwController } from "@linxiraos/zeta/modes/controllers/btw-controller";
import { CleanseCommandController } from "@linxiraos/zeta/modes/controllers/cleanse-command-controller";
import { CommandController } from "@linxiraos/zeta/modes/controllers/command-controller";
import { OmfgController } from "@linxiraos/zeta/modes/controllers/omfg-controller";
import { initTheme } from "@linxiraos/pi-tui/theme";
import { AgentSession } from "@linxiraos/zeta/session/agent-session";
import { AuthStorage } from "@linxiraos/zeta/session/auth-storage";
import { SessionManager } from "@linxiraos/zeta/session/session-manager";
import { TempDir } from "@linxiraos/pi-utils";

describe("InteractiveMode fork placement bridge", () => {
	let tempDir: TempDir;
	let authStorage: AuthStorage;
	let session: AgentSession;
	let mode: InteractiveMode;

	beforeAll(async () => {
		await initTheme();
	});

	beforeEach(async () => {
		resetSettingsForTest();
		tempDir = TempDir.createSync("@pi-fork-placement-");
		await Settings.init({ inMemory: true, cwd: tempDir.path() });
		authStorage = await AuthStorage.create(path.join(tempDir.path(), "testauth.db"));
		const modelRegistry = new ModelRegistry(authStorage);
		const model = modelRegistry.find("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Expected claude-sonnet-4-5 to exist in registry");

		session = new AgentSession({
			agent: new Agent({ initialState: { model, systemPrompt: ["Test"], tools: [], messages: [] } }),
			sessionManager: SessionManager.create(tempDir.path(), tempDir.path()),
			settings: Settings.isolated({ "compaction.enabled": false }),
			modelRegistry,
		});
		mode = new InteractiveMode(session, "test");
	});

	afterEach(async () => {
		mode?.stop();
		await session?.dispose();
		authStorage?.close();
		tempDir?.removeSync();
		vi.restoreAllMocks();
		resetSettingsForTest();
	});

	it.each([
		["an in-place fork tears down", undefined, 1],
		["a pane fork keeps", "pane", 0],
	] as const)("%s the current session's side controllers", async (_label, placement, disposals) => {
		const btwDispose = vi.spyOn(BtwController.prototype, "dispose");
		const omfgDispose = vi.spyOn(OmfgController.prototype, "dispose");
		const cleanseDispose = vi.spyOn(CleanseCommandController.prototype, "dispose");
		vi.spyOn(CommandController.prototype, "handleForkCommand").mockResolvedValue();

		await mode.handleForkCommand(placement);

		expect(btwDispose).toHaveBeenCalledTimes(disposals);
		expect(omfgDispose).toHaveBeenCalledTimes(disposals);
		expect(cleanseDispose).toHaveBeenCalledTimes(disposals);
	});
});
