import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { getKeybindings, KeybindingsManager, setKeybindings } from "@linxiraos/zeta/config/keybindings/keybindings";
import { keyText } from "@linxiraos/zeta/extensibility/legacy-pi-coding-agent-shim";
import { setKeyHintPlatform } from "@linxiraos/zeta/ui/keys/format";

describe("legacy keyText", () => {
	let previous: KeybindingsManager;

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
