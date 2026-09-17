import { describe, expect, it } from "bun:test";
import { resolveWebUiRuntime } from "@linxiraos/zeta/commands/web-ui-launcher";

describe("Web UI runtime resolution", () => {
	it("uses the bundled runtime when the desktop shell provides one", () => {
		expect(resolveWebUiRuntime({ ZETA_WEB_RUNTIME: "C:\\Zeta\\resources\\zeta\\node.exe" })).toBe(
			"C:\\Zeta\\resources\\zeta\\node.exe",
		);
	});

	it("falls back to node for CLI and source installs", () => {
		expect(resolveWebUiRuntime({})).toBe("node");
	});
});
