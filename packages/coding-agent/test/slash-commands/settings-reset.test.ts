import { beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import { Settings, settings } from "@linxiraos/zeta";
import { M } from "@linxiraos/zeta/i18n/index";
import type { InteractiveModeContext } from "@linxiraos/zeta/modes/types";
import { cfgStatusLineTransparent, cfgTuiSidebar, cfgTuiSidebarWidgets } from "@linxiraos/zeta/modes/settings";
import {
	BUILTIN_SLASH_COMMAND_DEFS,
	executeBuiltinSlashCommand,
} from "@linxiraos/zeta/slash-commands/builtin-registry";

const TOUCHED_HANDLES = [cfgTuiSidebar, cfgTuiSidebarWidgets, cfgStatusLineTransparent] as const;

function resetSetting(setting: (typeof TOUCHED_HANDLES)[number]): void {
	setting.unset(settings);
	setting.clearOverride(settings);
}

beforeAll(async () => {
	await Settings.init({ inMemory: true });
});

beforeEach(() => {
	for (const setting of TOUCHED_HANDLES) resetSetting(setting);
});

function createRuntime() {
	const showSettingsSelector = vi.fn();
	const showStatus = vi.fn();
	const showWarning = vi.fn();
	const applySidebar = vi.fn();
	const setText = vi.fn();
	const invalidate = vi.fn();
	const requestRender = vi.fn();
	const runtime = {
		ctx: {
			editor: { setText },
			statusLine: { invalidate },
			ui: { requestRender },
			settings,
			applySidebar,
			showSettingsSelector,
			showStatus,
			showWarning,
		} as unknown as InteractiveModeContext,
		handleBackgroundCommand: () => {},
	};
	return { showSettingsSelector, showStatus, showWarning, applySidebar, invalidate, setText, runtime };
}

describe("registry-driven settings reset", () => {
	it("restores a single setting to its schema default across the persisted layer", () => {
		expect(cfgTuiSidebar.get(settings)).toBe(false);
		cfgTuiSidebar.set(settings, true);
		expect(cfgTuiSidebar.isConfigured(settings)).toBe(true);

		cfgTuiSidebar.unset(settings);

		expect(cfgTuiSidebar.get(settings)).toBe(false);
		expect(cfgTuiSidebar.isConfigured(settings)).toBe(false);
		cfgTuiSidebar.unset(settings);
		expect(cfgTuiSidebar.get(settings)).toBe(false);
		expect(cfgTuiSidebar.isConfigured(settings)).toBe(false);
	});

	it("also clears runtime overrides", () => {
		cfgStatusLineTransparent.override(settings, true);
		expect(cfgStatusLineTransparent.get(settings)).toBe(true);

		resetSetting(cfgStatusLineTransparent);

		expect(cfgStatusLineTransparent.get(settings)).toBe(false);
		expect(cfgStatusLineTransparent.isConfigured(settings)).toBe(false);
	});

	it("prunes emptied parent groups so no empty stub remains", () => {
		cfgTuiSidebarWidgets.set(settings, true);
		resetSetting(cfgTuiSidebarWidgets);
		expect(cfgTuiSidebarWidgets.isConfigured(settings)).toBe(false);
	});

	it("resets every key back to its default when driven across the whole schema", () => {
		cfgTuiSidebar.set(settings, true);
		cfgStatusLineTransparent.set(settings, true);
		cfgTuiSidebarWidgets.override(settings, true);

		for (const setting of TOUCHED_HANDLES) resetSetting(setting);

		expect(cfgTuiSidebar.get(settings)).toBe(false);
		expect(cfgStatusLineTransparent.get(settings)).toBe(false);
		expect(cfgTuiSidebarWidgets.get(settings)).toBe(false);
	});
});

describe("/settings reset", () => {
	it("exposes the reset subcommand to slash command autocomplete", () => {
		const settingsCommand = BUILTIN_SLASH_COMMAND_DEFS.find(command => command.name === "settings");
		expect(settingsCommand?.allowArgs).toBe(true);
		expect(settingsCommand?.subcommands?.map(subcommand => subcommand.name)).toContain("reset");
	});

	it("opens the settings selector for bare /settings", async () => {
		const harness = createRuntime();
		await executeBuiltinSlashCommand("/settings", harness.runtime);
		expect(harness.showSettingsSelector).toHaveBeenCalledTimes(1);
		expect(harness.setText).toHaveBeenCalledWith("");
	});

	it("requires an explicit confirm before touching any stored setting", async () => {
		cfgTuiSidebar.set(settings, true);
		const harness = createRuntime();

		await executeBuiltinSlashCommand("/settings reset", harness.runtime);

		expect(harness.showStatus).toHaveBeenCalledWith(M.settingsResetConfirmHint.replace("%s", "1"));
		expect(cfgTuiSidebar.get(settings)).toBe(true);
		expect(harness.setText).toHaveBeenCalledWith("");
	});

	it("resets every configured setting after /settings reset confirm", async () => {
		cfgTuiSidebar.set(settings, true);
		cfgStatusLineTransparent.set(settings, true);
		const harness = createRuntime();

		await executeBuiltinSlashCommand("/settings reset confirm", harness.runtime);

		expect(harness.showStatus).toHaveBeenCalledWith(M.settingsResetDoneFmt.replace("%s", "2"));
		expect(cfgTuiSidebar.get(settings)).toBe(false);
		expect(cfgStatusLineTransparent.get(settings)).toBe(false);
		expect(harness.applySidebar).toHaveBeenCalled();
		expect(harness.invalidate).toHaveBeenCalled();
	});

	it("resets a single key directly", async () => {
		cfgTuiSidebar.set(settings, true);
		const harness = createRuntime();

		await executeBuiltinSlashCommand("/settings reset tui.sidebar", harness.runtime);

		expect(harness.showStatus).toHaveBeenCalledWith(M.settingsResetKeyDoneFmt.replace("%s", "tui.sidebar"));
		expect(cfgTuiSidebar.get(settings)).toBe(false);
	});

	it("rejects unknown setting keys without touching stored state", async () => {
		cfgTuiSidebar.set(settings, true);
		const harness = createRuntime();

		await executeBuiltinSlashCommand("/settings reset not.a.real.key", harness.runtime);

		expect(harness.showWarning).toHaveBeenCalledWith("Unknown setting: not.a.real.key");
		expect(cfgTuiSidebar.get(settings)).toBe(true);
	});

	it("reports nothing to reset when the confirmation preview finds no stored settings", async () => {
		const harness = createRuntime();

		await executeBuiltinSlashCommand("/settings reset", harness.runtime);

		expect(harness.showStatus).toHaveBeenCalledWith(M.settingsResetNothing);
	});

	it("shows usage for unrecognized argument shapes", async () => {
		const harness = createRuntime();
		await executeBuiltinSlashCommand("/settings bogus", harness.runtime);
		expect(harness.showWarning).toHaveBeenCalledWith("Usage: /settings [reset [confirm|<key>]]");

		const multiArg = createRuntime();
		await executeBuiltinSlashCommand("/settings reset confirm extra", multiArg.runtime);
		expect(multiArg.showWarning).toHaveBeenCalledWith("Usage: /settings reset [confirm|<key>]");
	});
});
