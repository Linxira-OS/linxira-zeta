import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import * as path from "node:path";
import { Agent } from "@linxiraos/pi-agent-core";
import { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { resetSettingsForTest, Settings, settings } from "@linxiraos/zeta/config/settings";
import { LiveCommandController } from "@linxiraos/zeta/modes/controllers/live-command-controller";
import { InteractiveMode } from "@linxiraos/zeta/modes/interactive-mode";
import { AgentSession } from "@linxiraos/zeta/session/agent-session";
import { AuthStorage } from "@linxiraos/zeta/session/auth-storage";
import { SessionManager } from "@linxiraos/zeta/session/session-manager";
import { LIVE_DISABLED_MESSAGE } from "@linxiraos/zeta/live/feature-gate";
import { initTheme } from "@linxiraos/pi-tui/theme";
import { TempDir } from "@linxiraos/pi-utils";

describe("InteractiveMode live mode vs. composer dictation", () => {
	let tempDir: TempDir;
	let authStorage: AuthStorage;
	let session: AgentSession;
	let mode: InteractiveMode;

	beforeAll(() => {
		initTheme();
	});

	beforeEach(async () => {
		resetSettingsForTest();
		tempDir = TempDir.createSync("@pi-live-dictation-gate-");
		await Settings.init({ inMemory: true, cwd: tempDir.path() });
		authStorage = await AuthStorage.create(path.join(tempDir.path(), "testauth.db"));
		const modelRegistry = new ModelRegistry(authStorage);
		const model = modelRegistry.find("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Expected claude-sonnet-4-5 to exist in registry");
		session = new AgentSession({
			agent: new Agent({ initialState: { model, systemPrompt: ["Test"], tools: [], messages: [] } }),
			sessionManager: SessionManager.create(tempDir.path(), tempDir.path()),
			settings: Settings.isolated(),
			modelRegistry,
		});
		mode = new InteractiveMode(session, "test");
		mode.ui.requestRender = vi.fn();
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		mode?.stop();
		await session?.dispose();
		authStorage?.close();
		tempDir?.removeSync();
		resetSettingsForTest();
	});

	it("keeps live mode dark and reports the deferred transport", async () => {
		const liveCommand = vi.spyOn(LiveCommandController.prototype, "handleCommand").mockResolvedValue(undefined);
		const showWarning = vi.spyOn(mode, "showWarning").mockImplementation(() => {});

		await mode.handleLiveCommand();

		expect(liveCommand).not.toHaveBeenCalled();
		expect(showWarning).toHaveBeenCalledWith(LIVE_DISABLED_MESSAGE);
	});
});
