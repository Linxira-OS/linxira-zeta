import { describe, expect, it, vi } from "bun:test";
import { CompactionCancelledError } from "@linxiraos/pi-agent-core/compaction";
import type { CompactOptions } from "@linxiraos/zeta/extensibility/extensions/types";
import { USER_INTERRUPT_LABEL } from "@linxiraos/zeta/session/messages";
import { executeAcpBuiltinSlashCommand } from "@linxiraos/zeta/slash-commands/acp-builtins";
import type { SlashCommandRuntime } from "@linxiraos/zeta/slash-commands/types";

function acpRuntime() {
	const compact = vi.fn(async (_instructions?: string, _options?: CompactOptions) => {});
	const getContextUsage = vi.fn(() => undefined);
	const output = vi.fn();
	const runtime = { session: { compact, getContextUsage }, output } as unknown as SlashCommandRuntime;
	return { compact, output, runtime };
}

describe("/handoff dispatch (ACP)", () => {
	it("compacts with handoff mode and no focus for a bare invocation", async () => {
		const h = acpRuntime();
		await executeAcpBuiltinSlashCommand("/handoff", h.runtime);
		expect(h.compact).toHaveBeenCalledWith(undefined, { mode: "handoff" });
	});

	it("passes focus instructions through with handoff mode", async () => {
		const h = acpRuntime();
		await executeAcpBuiltinSlashCommand("/handoff focus on auth", h.runtime);
		expect(h.compact).toHaveBeenCalledWith("focus on auth", { mode: "handoff" });
	});

	it("treats mode names in /handoff arguments as focus rather than a different compaction mode", async () => {
		const h = acpRuntime();
		await executeAcpBuiltinSlashCommand("/handoff soft failure", h.runtime);
		await executeAcpBuiltinSlashCommand("/compact handoff soft failure", h.runtime);
		expect(h.compact.mock.calls).toEqual([
			["soft failure", { mode: "handoff" }],
			["soft failure", { mode: "handoff" }],
		]);
	});

	it("leaves the RPC command queue free while handoff generation runs", async () => {
		const compactStarted = Promise.withResolvers<void>();
		const compactFinished = Promise.withResolvers<void>();
		const h = acpRuntime();
		h.compact.mockImplementation(async () => {
			compactStarted.resolve();
			await compactFinished.promise;
		});
		const backgroundTasks: Promise<void>[] = [];
		h.runtime.runCommandInBackground = task => {
			backgroundTasks.push(task());
		};

		// The dispatcher must resolve before handoff generation finishes so the
		// RPC serialized queue can dequeue a follow-up abort.
		const result = await executeAcpBuiltinSlashCommand("/handoff", h.runtime);
		await compactStarted.promise;
		expect(result).toEqual({ consumed: true });
		expect(h.output).not.toHaveBeenCalled();

		compactFinished.resolve();
		await Promise.all(backgroundTasks);
		expect(h.output).toHaveBeenCalledWith("Compaction complete.");
	});

	it("reports success as a single line", async () => {
		const h = acpRuntime();
		await executeAcpBuiltinSlashCommand("/handoff", h.runtime);
		expect(h.output).toHaveBeenCalledTimes(1);
		expect(h.output).toHaveBeenCalledWith("Compaction complete.");
	});

	it("stays silent when the owning turn was cancelled by the user", async () => {
		// ACP `session/cancel` aborts with USER_INTERRUPT_LABEL, which the
		// cancellation error carries verbatim. The turn has already resolved as
		// `cancelled`, so any output here would be an out-of-turn chunk reporting
		// a false failure.
		const h = acpRuntime();
		h.compact.mockImplementation(async () => {
			throw new CompactionCancelledError(undefined, { cause: USER_INTERRUPT_LABEL });
		});
		const result = await executeAcpBuiltinSlashCommand("/handoff", h.runtime);
		expect(h.output).not.toHaveBeenCalled();
		expect(result).toEqual({ consumed: true });
	});

	it("surfaces extension cancellation behind the Compaction failed prefix", async () => {
		const h = acpRuntime();
		h.compact.mockImplementation(async () => {
			throw new CompactionCancelledError();
		});
		await executeAcpBuiltinSlashCommand("/handoff", h.runtime);
		expect(h.output).toHaveBeenCalledWith("Compaction failed: Compaction cancelled");
	});

	it("surfaces other failures behind the Compaction failed prefix", async () => {
		const h = acpRuntime();
		h.compact.mockImplementation(async () => {
			throw new Error("Nothing to hand off (no messages yet)");
		});
		await executeAcpBuiltinSlashCommand("/handoff", h.runtime);
		expect(h.output).toHaveBeenCalledWith("Compaction failed: Nothing to hand off (no messages yet)");
	});
});
