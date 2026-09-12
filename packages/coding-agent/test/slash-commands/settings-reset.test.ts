import { beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import { Settings, settings } from "@linxiraos/zeta";
import { M } from "@linxiraos/zeta/i18n/index";
import type { InteractiveModeContext } from "@linxiraos/zeta/modes/types";
import {
	BUILTIN_SLASH_COMMAND_DEFS,
	executeBuiltinSlashCommand,
} from "@linxiraos/zeta/slash-commands/builtin-registry";

const TOUCHED_KEYS = ["tui.sidebar", "tui.sidebarWidgets", "statusLine.transparent"] as const;

beforeAll(async () => {
	await Settings.init({ inMemory: true });
});

beforeEach(() => {
	for (const key of TOUCHED_KEYS) settings.reset(key);
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

describe("Settings.reset", () => {
	it("restores a single setting to its schema default across the persisted layer", () => {
		expect(settings.get("tui.sidebar")).toBe(false);
		settings.set("tui.sidebar", true);
		expect(settings.isConfigured("tui.sidebar")).toBe(true);

		expect(settings.reset("tui.sidebar")).toBe(true);

		expect(settings.get("tui.sidebar")).toBe(false);
		expect(settings.isConfigured("tui.sidebar")).toBe(false);
		expect(settings.reset("tui.sidebar")).toBe(false);
	});

	it("also clears runtime overrides", () => {
		settings.override("statusLine.transparent", true);
		expect(settings.get("statusLine.transparent")).toBe(true);

		expect(settings.reset("statusLine.transparent")).toBe(true);

		expect(settings.get("statusLine.transparent")).toBe(false);
		expect(settings.isConfigured("statusLine.transparent")).toBe(false);
	});

	it("prunes emptied parent groups so no empty stub remains", () => {
		settings.set("tui.sidebarWidgets", true);
		expect(settings.reset("tui.sidebarWidgets")).toBe(true);
		expect(settings.isConfigured("tui.sidebarWidgets")).toBe(false);
	});

	it("resets every key back to its default when driven across the whole schema", () => {
		settings.set("tui.sidebar", true);
		settings.set("statusLine.transparent", true);
		settings.override("tui.sidebarWidgets", true);

		for (const key of TOUCHED_KEYS) {
			expect(settings.reset(key)).toBe(true);
		}

		expect(settings.get("tui.sidebar")).toBe(false);
		expect(settings.get("statusLine.transparent")).toBe(false);
		expect(settings.get("tui.sidebarWidgets")).toBe(false);
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
		settings.set("tui.sidebar", true);
		const harness = createRuntime();

		await executeBuiltinSlashCommand("/settings reset", harness.runtime);

		expect(harness.showStatus).toHaveBeenCalledWith(M.settingsResetConfirmHint.replace("%s", "1"));
		expect(settings.get("tui.sidebar")).toBe(true);
		expect(harness.setText).toHaveBeenCalledWith("");
	});

	it("resets every configured setting after /settings reset confirm", async () => {
		settings.set("tui.sidebar", true);
		settings.set("statusLine.transparent", true);
		const harness = createRuntime();

		await executeBuiltinSlashCommand("/settings reset confirm", harness.runtime);

		expect(harness.showStatus).toHaveBeenCalledWith(M.settingsResetDoneFmt.replace("%s", "2"));
		expect(settings.get("tui.sidebar")).toBe(false);
		expect(settings.get("statusLine.transparent")).toBe(false);
		expect(harness.applySidebar).toHaveBeenCalled();
		expect(harness.invalidate).toHaveBeenCalled();
	});

	it("resets a single key directly", async () => {
		settings.set("tui.sidebar", true);
		const harness = createRuntime();

		await executeBuiltinSlashCommand("/settings reset tui.sidebar", harness.runtime);

		expect(harness.showStatus).toHaveBeenCalledWith(M.settingsResetKeyDoneFmt.replace("%s", "tui.sidebar"));
		expect(settings.get("tui.sidebar")).toBe(false);
	});

	it("rejects unknown setting keys without touching stored state", async () => {
		settings.set("tui.sidebar", true);
		const harness = createRuntime();

		await executeBuiltinSlashCommand("/settings reset not.a.real.key", harness.runtime);

		expect(harness.showWarning).toHaveBeenCalledWith("Unknown setting: not.a.real.key");
		expect(settings.get("tui.sidebar")).toBe(true);
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
