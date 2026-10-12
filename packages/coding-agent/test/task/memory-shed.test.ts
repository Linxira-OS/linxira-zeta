import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { logger } from "@linxiraos/pi-utils";
import type { MemorySample } from "../../src/task/fanout-pressure";
import {
	type MemoryShedContext,
	type MemoryShedEffects,
	resetMemoryShedState,
	shedUnderMemoryPressure,
} from "../../src/task/memory-shed";

const GIB = 1024 ** 3;

function sample(rssGib: number, freeGib: number, totalGib: number): MemorySample {
	return { rssBytes: rssGib * GIB, systemFreeBytes: freeGib * GIB, systemTotalBytes: totalGib * GIB };
}

/** Records each effect invocation, and returns preset counts/results. */
function recorder(options: { tabs?: number; daemons?: string[] } = {}): {
	calls: string[];
	effects: MemoryShedEffects;
} {
	const calls: string[] = [];
	return {
		calls,
		effects: {
			clearRenderCaches: () => calls.push("caches"),
			releaseIdleTabs: async ownerId => {
				calls.push(`tabs:${ownerId}`);
				return options.tabs ?? 0;
			},
			terminateMnemopiWorker: async () => {
				calls.push("mnemopi");
			},
			stopIdleBrokerDaemons: async (_session, ownerId) => {
				calls.push(`daemons:${ownerId ?? "none"}`);
				return options.daemons ?? [];
			},
		},
	};
}

function context(ownerId: string | null = "sess-1", force = false): MemoryShedContext {
	return { session: { cwd: "/tmp/project", getSessionId: () => ownerId }, source: "test checkpoint", force };
}

beforeEach(() => {
	resetMemoryShedState();
});

describe("memory shed level mapping", () => {
	test("healthy memory runs no effect and reports nothing", async () => {
		const { calls, effects } = recorder();
		const result = await shedUnderMemoryPressure("ok", sample(1, 16, 32), context(), effects);
		expect(result).toBeUndefined();
		expect(calls).toEqual([]);
	});

	test("tight sheds render caches and idle tabs only", async () => {
		const { calls, effects } = recorder({ tabs: 3 });
		const result = await shedUnderMemoryPressure("tight", sample(1, 3, 32), context(), effects);
		expect(calls).toEqual(["caches", "tabs:sess-1"]);
		expect(result?.level).toBe("tight");
		expect(result?.released).toContain("TUI render caches (markdown, mermaid)");
		expect(result?.released).toContain("idle browser tabs (\u00d73)");
	});

	test("critical adds the mnemopi worker and idle broker daemons", async () => {
		const { calls, effects } = recorder({ tabs: 1, daemons: ["dev-server", "lsp"] });
		const result = await shedUnderMemoryPressure("critical", sample(11, 1, 32), context(), effects);
		expect(calls).toEqual(["caches", "tabs:sess-1", "mnemopi", "daemons:sess-1"]);
		expect(result?.level).toBe("critical");
		expect(result?.released).toContain("mnemopi embed worker");
		expect(result?.released).toContain("broker daemons (dev-server, lsp)");
	});

	test("a session that owns nothing reports the cache shed without idle tab noise", async () => {
		const { effects } = recorder();
		const result = await shedUnderMemoryPressure("tight", sample(1, 3, 32), context(), effects);
		expect(result?.released).toEqual(["TUI render caches (markdown, mermaid)"]);
	});

	test("no owner id: tabs are skipped and the broker sweep gets no owner", async () => {
		const { calls, effects } = recorder();
		await shedUnderMemoryPressure("critical", sample(11, 1, 32), context(null), effects);
		expect(calls).toEqual(["caches", "mnemopi", "daemons:none"]);
	});
});

describe("memory shed episode handling", () => {
	test("a sustained level sheds once, not per checkpoint", async () => {
		const { calls, effects } = recorder();
		await shedUnderMemoryPressure("tight", sample(1, 3, 32), context(), effects);
		const second = await shedUnderMemoryPressure("tight", sample(1, 3, 32), context(), effects);
		expect(calls).toEqual(["caches", "tabs:sess-1"]);
		expect(second).toBeUndefined();
	});

	test("escalating tight -> critical sheds the critical level", async () => {
		const { calls, effects } = recorder();
		await shedUnderMemoryPressure("tight", sample(1, 3, 32), context(), effects);
		await shedUnderMemoryPressure("critical", sample(11, 1, 32), context(), effects);
		expect(calls).toEqual(["caches", "tabs:sess-1", "caches", "tabs:sess-1", "mnemopi", "daemons:sess-1"]);
	});

	test("force re-runs the shed at the same level", async () => {
		const { calls, effects } = recorder();
		await shedUnderMemoryPressure("tight", sample(1, 3, 32), context(), effects);
		await shedUnderMemoryPressure("tight", sample(1, 3, 32), context("sess-1", true), effects);
		expect(calls).toEqual(["caches", "tabs:sess-1", "caches", "tabs:sess-1"]);
	});

	test("healthy memory resets the episode so the next squeeze sheds again", async () => {
		const { calls, effects } = recorder();
		await shedUnderMemoryPressure("tight", sample(1, 3, 32), context(), effects);
		await shedUnderMemoryPressure("ok", sample(1, 16, 32), context(), effects);
		await shedUnderMemoryPressure("tight", sample(1, 3, 32), context(), effects);
		expect(calls).toEqual(["caches", "tabs:sess-1", "caches", "tabs:sess-1"]);
	});
});

describe("memory shed logging", () => {
	const unregister: Array<() => void> = [];
	afterEach(() => {
		for (const off of unregister.splice(0)) off();
	});

	/** Capture warn-level log messages for the duration of one test. */
	function captureLogs(): string[] {
		const messages: string[] = [];
		unregister.push(
			logger.registerLogSink(event => {
				if (event.level === "warn" && event.message.includes("memory-shed")) messages.push(event.message);
			}),
		);
		return messages;
	}

	test("one pressure episode logs one shed line; escalation logs another", async () => {
		const logs = captureLogs();
		const { effects } = recorder();

		await shedUnderMemoryPressure("tight", sample(1, 3, 32), context(), effects);
		expect(logs).toHaveLength(1);

		await shedUnderMemoryPressure("critical", sample(11, 1, 32), context(), effects);
		expect(logs).toHaveLength(2);
	});

	test("a forced turn-end shed that releases idle tabs logs mid-episode", async () => {
		const logs = captureLogs();

		await shedUnderMemoryPressure("tight", sample(1, 3, 32), context(), recorder({ tabs: 0 }).effects);
		await shedUnderMemoryPressure("tight", sample(1, 3, 32), context("sess-1", true), recorder({ tabs: 2 }).effects);
		expect(logs).toHaveLength(2);
		expect(logs[1]).toContain("idle browser tabs");
	});

	test("a forced shed with nothing released stays quiet", async () => {
		const logs = captureLogs();

		await shedUnderMemoryPressure("tight", sample(1, 3, 32), context(), recorder().effects);
		await shedUnderMemoryPressure("tight", sample(1, 3, 32), context("sess-1", true), recorder().effects);
		expect(logs).toHaveLength(1);
	});
});
