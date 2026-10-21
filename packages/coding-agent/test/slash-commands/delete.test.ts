import { describe, expect, it, vi } from "bun:test";
import type { InteractiveModeContext } from "@linxiraos/zeta/modes/types";
import { executeBuiltinSlashCommand } from "@linxiraos/zeta/slash-commands/builtin-registry";

function createRuntimeHarness() {
	const setText = vi.fn();
	const showError = vi.fn();
	const handleDeleteCommand = vi.fn(async () => {});
	const getSessionName = vi.fn(() => "My Session");
	return {
		setText,
		showError,
		handleDeleteCommand,
		runtime: {
			ctx: {
				editor: { setText } as unknown as InteractiveModeContext["editor"],
				showError,
				handleDeleteCommand,
				sessionManager: {
					getSessionName,
					getSessionId: () => "session-id",
				},
			} as unknown as InteractiveModeContext,
		},
	};
}

describe("/delete slash command", () => {
	it("refuses without an explicit yes and names what would be deleted", async () => {
		const harness = createRuntimeHarness();
		expect(await executeBuiltinSlashCommand("/delete", harness.runtime)).toBe(true);
		expect(harness.handleDeleteCommand).not.toHaveBeenCalled();
		expect(harness.showError).toHaveBeenCalledWith(expect.stringContaining("Usage: /delete yes"));
		expect(harness.showError).toHaveBeenCalledWith(expect.stringContaining("My Session"));
		expect(harness.setText).toHaveBeenCalledWith("");
	});

	it("refuses arguments other than the exact word yes", async () => {
		const harness = createRuntimeHarness();
		expect(await executeBuiltinSlashCommand("/delete YES", harness.runtime)).toBe(true);
		expect(await executeBuiltinSlashCommand("/delete sure", harness.runtime)).toBe(true);
		expect(harness.handleDeleteCommand).not.toHaveBeenCalled();
	});

	it("deletes through the existing flow with an explicit yes", async () => {
		const harness = createRuntimeHarness();
		expect(await executeBuiltinSlashCommand("/delete yes", harness.runtime)).toBe(true);
		expect(harness.handleDeleteCommand).toHaveBeenCalledTimes(1);
		expect(harness.showError).not.toHaveBeenCalled();
	});
});
