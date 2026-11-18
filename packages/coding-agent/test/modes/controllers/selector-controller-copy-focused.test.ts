/**
 * The `/copy` picker lists the transcript on screen: a focused subagent's branch,
 * not the main session's.
 *
 * Failure mode if this regresses: picking a turn from a focused view copies text
 * from the main conversation the user is not looking at.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, spyOn, vi } from "bun:test";
import type { AgentMessage } from "@linxiraos/pi-agent-core";
import { resetSettingsForTest, Settings } from "@linxiraos/zeta/config/settings";
import { SelectorController } from "@linxiraos/zeta/modes/controllers/selector-controller";
import type { InteractiveModeContext } from "@linxiraos/zeta/modes/types";
import type { SessionMessageEntry } from "@linxiraos/zeta/session/session-entries";
import * as clipboard from "@linxiraos/zeta/utils/clipboard";
import { setKeybindings } from "@linxiraos/pi-tui";
import { KeybindingsManager } from "@linxiraos/pi-tui/app-keybindings";
import type { CopySelectorComponent } from "@linxiraos/pi-tui/overlays/copy-selector";
import { initTheme } from "@linxiraos/pi-tui/theme";

const ENTER = "\r";

function sessionWithReply(reply: string) {
	const entries: SessionMessageEntry[] = [
		{
			type: "message",
			id: "u1",
			parentId: null,
			timestamp: "2024-01-01T00:00:00Z",
			message: { role: "user", content: "go", timestamp: 1 } as AgentMessage,
		},
		{
			type: "message",
			id: "a1",
			parentId: "u1",
			timestamp: "2024-01-01T00:00:01Z",
			message: {
				role: "assistant",
				content: [{ type: "text", text: reply }],
				stopReason: "stop",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				timestamp: 2,
			} as unknown as AgentMessage,
		},
	];
	return {
		sessionManager: { getBranch: () => entries, getCwd: () => "/tmp" },
		getToolByName: () => undefined,
		hasBuiltInTool: () => false,
		extensionRunner: undefined,
	};
}

describe("SelectorController.showCopySelector", () => {
	beforeAll(async () => {
		await initTheme();
	});
	beforeEach(async () => {
		await Settings.init({ inMemory: true, cwd: process.cwd() });
		setKeybindings(KeybindingsManager.inMemory());
	});
	afterEach(() => {
		vi.restoreAllMocks();
		setKeybindings(KeybindingsManager.inMemory());
		resetSettingsForTest();
	});

	it("copies a turn picked from the focused subagent's transcript", () => {
		const copySpy = spyOn(clipboard, "copyToClipboard").mockResolvedValue(undefined);
		const showOverlay = vi.fn(() => ({ hide: vi.fn() }));
		const main = sessionWithReply("main reply");
		const ctx = {
			ui: { showOverlay, setFocus: vi.fn(), requestRender: vi.fn(), requestComponentRender: vi.fn() },
			session: main,
			sessionManager: main.sessionManager,
			viewSession: sessionWithReply("worker reply"),
			editor: {},
			editorContainer: { children: [] },
			showStatus: vi.fn(),
		} as unknown as InteractiveModeContext;

		new SelectorController(ctx).showCopySelector();
		const [selector] = showOverlay.mock.calls[0] as unknown as [CopySelectorComponent];
		selector.render(100);
		selector.handleInput(ENTER);

		expect(copySpy).toHaveBeenCalledWith("worker reply");
	});
});
