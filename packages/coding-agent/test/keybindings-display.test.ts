import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { keyText } from "@linxiraos/zeta/extensibility/legacy-pi-coding-agent-shim";
import { getKeybindings, setKeybindings, type KeybindingsManager as TuiKeybindingsManager } from "@linxiraos/pi-tui";
import { KeybindingsManager, setKeyHintPlatform } from "@linxiraos/pi-tui/app-keybindings";

describe("legacy keyText", () => {
	let previous: TuiKeybindingsManager;

	beforeEach(() => {
		previous = getKeybindings();
		setKeyHintPlatform("linux");
	});

	afterEach(() => {
		setKeybindings(previous);
		setKeyHintPlatform(undefined);
	});

	it("formats the active binding for legacy extensions", () => {
		setKeybindings(KeybindingsManager.inMemory({ "app.tools.expand": "alt+e" }));

		expect(keyText("app.tools.expand")).toBe("Alt+E");
	});
});
