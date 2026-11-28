import { describe, expect, it, vi } from "bun:test";
import type { InteractiveModeContext } from "@linxiraos/zeta/modes/types";
import { executeBuiltinSlashCommand } from "@linxiraos/zeta/slash-commands/builtin-registry";

function createRuntime(tsp: boolean) {
	const showStatus = vi.fn();
	const presentCommandOutput = vi.fn();
	const session = {};
	const ctx = {
		session,
		showStatus,
		presentCommandOutput,
		shell: {
			native: () => tsp,
			host: { driver: { capabilities: { tsp } } },
		},
	} as unknown as InteractiveModeContext;
	return {
		runtime: { ctx },
		session,
		showStatus,
		presentCommandOutput,
	};
}

describe("/ambient TUI routing", () => {
	it("keeps a plain ANSI terminal off and never presents a frame", async () => {
		const h = createRuntime(false);
		expect(await executeBuiltinSlashCommand("/ambient status", h.runtime)).toBe(true);
		expect(h.showStatus).toHaveBeenCalledTimes(1);
		expect(h.presentCommandOutput).not.toHaveBeenCalled();

		expect(await executeBuiltinSlashCommand("/ambient on", h.runtime)).toBe(true);
		expect(h.presentCommandOutput).not.toHaveBeenCalled();
		expect(h.showStatus.mock.calls.at(-1)?.[0]).toContain("TSP");
	});

	it("presents one live frame on a TSP host and updates it on feed", async () => {
		const h = createRuntime(true);
		try {
			expect(await executeBuiltinSlashCommand("/ambient on", h.runtime)).toBe(true);
			expect(h.presentCommandOutput).toHaveBeenCalledTimes(1);
			expect(h.showStatus.mock.calls.at(-1)?.[0]).toContain("on");

			expect(await executeBuiltinSlashCommand("/ambient feed 5 2", h.runtime)).toBe(true);
			expect(h.presentCommandOutput).toHaveBeenCalledTimes(1);
			expect(h.showStatus.mock.calls.at(-1)?.[0]).toContain("Fed (5, 2)");
		} finally {
			await executeBuiltinSlashCommand("/ambient off", h.runtime);
		}
		expect(h.showStatus.mock.calls.at(-1)?.[0]).toBe("Ambient tank: off.");
	});
});
