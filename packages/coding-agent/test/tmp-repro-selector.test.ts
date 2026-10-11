import { beforeEach, describe, expect, it, vi } from "bun:test";
import { getThemeByName, setThemeInstance } from "@linxiraos/pi-tui/theme";
import { getBundledModel } from "@linxiraos/pi-catalog/models";
import { Settings } from "@linxiraos/zeta/config/settings";
import { SelectorController } from "@linxiraos/zeta/modes/controllers/selector-controller";
import type { InteractiveModeContext } from "@linxiraos/zeta/modes/types";
import { beginSettingsTest, restoreSettingsTestState, type SettingsTestState } from "./helpers/settings-test-state";

let settingsState: SettingsTestState | undefined;

beforeEach(async () => {
	settingsState = beginSettingsTest();
	await Settings.init({ inMemory: true });
});

describe("repro", () => {
	it("global edit replaces runtime override", async () => {
		const testTheme = await getThemeByName("dark");
		if (!testTheme) throw new Error("Failed to load dark theme");
		setThemeInstance(testTheme);

		const projectModel = getBundledModel("openai", "gpt-5.5");
		const globalModel = getBundledModel("openai", "gpt-5.6");
		if (!projectModel || !globalModel) throw new Error("Expected bundled models");

		const projectSelector = `${projectModel.provider}/${projectModel.id}`;
		const settings = Settings.isolated({ modelRoleStorage: "project" });
		settings.setProjectModelRole("default", projectSelector);
		settings.overrideModelRoles({ default: `anthropic/claude-sonnet-4-5` });
		const setModel = vi.fn(async () => ({ switched: true }));
		const assignmentApplied = Promise.withResolvers<void>();
		const showStatus = vi.fn((message: string) => {
			console.log("[status]", message);
			if (message.startsWith("Global default model:")) assignmentApplied.resolve();
		});
		let captured: unknown;
		const controller = new SelectorController({
			ui: {
				requestRender: vi.fn(),
				setFocus: vi.fn(),
				showOverlay: vi.fn((component: unknown) => {
					captured = component;
					return { hide: vi.fn() };
				}),
				terminal: { rows: 40 },
			},
			editorContainer: { clear: vi.fn(), addChild: vi.fn(), children: [] },
			editor: {},
			settings,
			session: {
				model: projectModel,
				effectiveServiceTier: () => undefined,
				modelRegistry: {
					getAll: () => [projectModel, globalModel],
					getAvailable: () => [projectModel, globalModel],
					getError: () => undefined,
					refresh: async () => {},
					refreshProvider: async () => {},
					getDiscoverableProviders: () => [],
					getProviderDiscoveryState: () => undefined,
					authStorage: { hasAuth: () => false },
				},
				scopedModels: [{ model: projectModel }, { model: globalModel }],
				getContextUsage: () => undefined,
				setModel,
				setThinkingLevel: vi.fn(),
			},
			statusLine: { invalidate: vi.fn() },
			updateEditorBorderColor: vi.fn(),
			keybindings: { getKeys: () => [], getDisplayString: () => "" },
			showStatus,
			showError: vi.fn(m => console.log("[error]", m)),
		} as unknown as InteractiveModeContext);

		controller.showModelSelector();
		const hub = captured as { handleInput(data: string): void; dispose(): void } | undefined;
		if (!hub) throw new Error("Expected model hub overlay to be shown");
		try {
			for (const inp of ["\x1b[A", "\n", "\n", "\x1b[B", "\n", "\x1b[B", "\n"] as const) {
				console.log("[input]", JSON.stringify(inp));
				hub.handleInput(inp);
				const { stripVTControlCharacters } = await import("node:util");
				console.log(
					"[view]\n" +
						stripVTControlCharacters(
							(hub as unknown as { render(w: number): readonly string[] }).render(100).join("\n"),
						),
				);
			}
			await assignmentApplied.promise;
			expect(setModel).toHaveBeenCalledWith(globalModel, "default", expect.objectContaining({ persist: true }));
		} finally {
			hub.dispose();
		}
	}, 10000);
});
