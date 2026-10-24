import { describe, expect, it, vi } from "bun:test";
import { Settings } from "@linxiraos/zeta/config/settings";
import type { InteractiveModeContext } from "@linxiraos/zeta/modes/types";
import { executeBuiltinSlashCommand } from "@linxiraos/zeta/slash-commands/builtin-registry";

function createRuntime() {
	const showProviderSetup = vi.fn(async () => {});
	const showError = vi.fn();
	const setText = vi.fn();
	return {
		showProviderSetup,
		showError,
		setText,
		runtime: {
			ctx: {
				editor: { setText } as unknown as InteractiveModeContext["editor"],
				settings: Settings.isolated(),
				showProviderSetup,
				showError,
			} as unknown as InteractiveModeContext,
			handleBackgroundCommand: () => {},
		},
	};
}

describe("/setup slash command", () => {
	// `/setup` and its `/providers` alias were retired in favor of `/login`.
	// Both spellings must refuse without invoking the old provider scene.
	for (const text of ["/setup", "/setup providers", "/providers"]) {
		it(`retires ${text}`, async () => {
			const harness = createRuntime();

			const handled = await executeBuiltinSlashCommand(text, harness.runtime);

			expect(handled).toBe(true);
			expect(harness.showProviderSetup).not.toHaveBeenCalled();
			expect(harness.showError).toHaveBeenCalledWith(
				"Provider setup is retired; use /login (or the first-run setup wizard).",
			);
		});
	}
});
