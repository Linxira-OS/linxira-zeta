import { expect, it, vi } from "bun:test";
import * as path from "node:path";
import { Agent } from "@linxiraos/pi-agent-core";
import { createMockModel } from "@linxiraos/pi-ai/providers/mock";
import { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { resetSettingsForTest, Settings } from "@linxiraos/zeta/config/settings";
import { InteractiveMode } from "@linxiraos/zeta/modes/interactive-mode";
import type { SubmittedUserInput } from "@linxiraos/zeta/modes/types";
import { AgentSession } from "@linxiraos/zeta/session/agent-session";
import { AuthStorage } from "@linxiraos/zeta/session/auth-storage";
import { convertToLlm } from "@linxiraos/zeta/session/messages";
import { SessionManager } from "@linxiraos/zeta/session/session-manager";
import { initTheme } from "@linxiraos/pi-tui/theme";
import { TempDir } from "@linxiraos/pi-utils";

it("pauses an armed loop after a terminal provider error instead of duplicating its @file attachment", async () => {
	initTheme();
	resetSettingsForTest();
	const tempDir = TempDir.createSync("@omp-loop-provider-error-");
	const authStorage = await AuthStorage.create(path.join(tempDir.path(), "auth.db"));
	let session: AgentSession | undefined;
	let mode: InteractiveMode | undefined;
	let pendingInput: Promise<SubmittedUserInput> | undefined;
	try {
		await Settings.init({ inMemory: true, cwd: tempDir.path() });
		const model = createMockModel({
			responses: [
				{
					content: [],
					stopReason: "error",
					errorMessage: "This request would exceed your account's rate limit. Please try again later.",
				},
			],
		});
		authStorage.keys.setRuntime("mock", "test-key");
		const settings = Settings.isolated({
			"compaction.enabled": false,
			"retry.enabled": false,
			"todo.enabled": false,
		});
		settings.setModelRole("default", `${model.provider}/${model.id}`);
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: { model, systemPrompt: ["Test"], tools: [], messages: [] },
			convertToLlm,
			streamFn: model.stream,
		});
		session = new AgentSession({
			agent,
			sessionManager: SessionManager.create(tempDir.path(), tempDir.path()),
			settings,
			modelRegistry: new ModelRegistry(authStorage),
		});
		mode = new InteractiveMode(session, "test");
		mode.ui.requestRender = vi.fn();
		await mode.init({ suppressWelcomeIntro: true });
		await Bun.write(path.join(tempDir.path(), "task.md"), "Implement the task.\n");
		mode.loopModeEnabled = true;
		mode.loopPrompt = "@task.md";
		await session.prompt("@task.md");
		await session.waitForIdle();

		vi.useFakeTimers();
		const submitted: SubmittedUserInput[] = [];
		pendingInput = mode.getUserInput();
		void pendingInput.then(input => submitted.push(input));
		vi.advanceTimersByTime(800);
		await Promise.resolve();
		await Promise.resolve();
		expect(submitted).toHaveLength(0);
		expect(mode.loopModePaused).toBe(true);
		expect(mode.loopPrompt).toBeUndefined();
		expect(
			session.sessionManager
				.getBranch()
				.filter(entry => entry.type === "message" && entry.message.role === "fileMention"),
		).toHaveLength(1);
	} finally {
		mode?.disableLoopMode();
		if (mode?.onInputCallback) mode.onInputCallback({ text: "", cancelled: true, started: false });
		await pendingInput;
		mode?.stop();
		await session?.dispose();
		authStorage.close();
		tempDir.removeSync();
		vi.useRealTimers();
		vi.restoreAllMocks();
		resetSettingsForTest();
	}
});
