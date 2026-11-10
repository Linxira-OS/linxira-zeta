/**
 * A task batch reports progress per spawn, so a fan-out of N agents used to
 * paint the transcript card N times per cadence. The coalescer keeps the first
 * update immediate and then emits at most one trailing snapshot per window,
 * always the latest; the final result is independent of update frames.
 */
import { afterEach, describe, expect, it, vi } from "bun:test";
import { createCoalescedToolUpdates, runWithCoalescedToolUpdates } from "@linxiraos/zeta/task/tool-update";

afterEach(() => {
	vi.useRealTimers();
});

describe("task tool update coalescing", () => {
	it("emits the first update immediately and later ones once per window with the latest snapshot", () => {
		vi.useFakeTimers();
		const time = 0;
		const emitted: string[] = [];
		const updates = createCoalescedToolUpdates<string>(value => emitted.push(value), {
			windowMs: 100,
			now: () => time,
		});

		updates.update("spawned 1");
		expect(emitted).toEqual(["spawned 1"]);

		updates.update("agent a");
		updates.update("agent b");
		updates.update("agent c");
		expect(emitted).toEqual(["spawned 1"]);

		vi.advanceTimersByTime(99);
		expect(emitted).toEqual(["spawned 1"]);
		vi.advanceTimersByTime(1);
		expect(emitted).toEqual(["spawned 1", "agent c"]);
	});

	it("starts a fresh window after the trailing emit", () => {
		vi.useFakeTimers();
		let time = 0;
		const emitted: string[] = [];
		const updates = createCoalescedToolUpdates<string>(value => emitted.push(value), {
			windowMs: 100,
			now: () => time,
		});

		updates.update("a");
		updates.update("b");
		vi.advanceTimersByTime(100);
		expect(emitted).toEqual(["a", "b"]);

		time += 100;
		updates.update("c");
		expect(emitted).toEqual(["a", "b", "c"]);
	});

	it("flushes the latest pending snapshot synchronously and cancels the timer", () => {
		vi.useFakeTimers();
		const time = 0;
		const emitted: string[] = [];
		const updates = createCoalescedToolUpdates<string>(value => emitted.push(value), {
			windowMs: 100,
			now: () => time,
		});

		updates.update("a");
		updates.update("b");
		updates.flush();
		expect(emitted).toEqual(["a", "b"]);
		vi.advanceTimersByTime(100);
		expect(emitted).toEqual(["a", "b"]);

		updates.flush();
		expect(emitted).toEqual(["a", "b"]);
	});

	it("leaves the queue empty when flushing with nothing pending", () => {
		vi.useFakeTimers();
		const emitted: string[] = [];
		const updates = createCoalescedToolUpdates<string>(value => emitted.push(value), { windowMs: 0 });
		updates.flush();
		updates.update("only");
		expect(emitted).toEqual(["only"]);
	});
});

describe("task dispatch update coalescing", () => {
	it("collapses a 64-spawn burst to the first and latest snapshot and returns the real result", async () => {
		vi.useFakeTimers();
		const emitted: string[] = [];
		const result = { content: [{ type: "text", text: "batch result" }], details: undefined };
		const returned = await runWithCoalescedToolUpdates<string, typeof result>(
			value => emitted.push(value),
			async update => {
				for (let index = 0; index < 64; index++) update?.(`spawn ${index}`);
				// A detached spawn reports its final status after the call returned;
				// the callback it retained must still publish.
				return result;
			},
		);

		expect(returned).toBe(result);
		expect(emitted).toEqual(["spawn 0", "spawn 63"]);
	});

	it("keeps emitting for detached progress that lands after the call returned", async () => {
		vi.useFakeTimers();
		const emitted: string[] = [];
		let retained: ((update: string) => void) | undefined;
		await runWithCoalescedToolUpdates<string, void>(
			value => emitted.push(value),
			async update => {
				retained = update;
				update?.("spawner feedback");
				return undefined;
			},
		);
		expect(emitted).toEqual(["spawner feedback"]);

		retained?.("detached completion");
		vi.advanceTimersByTime(100);
		expect(emitted).toEqual(["spawner feedback", "detached completion"]);
	});

	it("passes undefined through when no consumer watches updates", async () => {
		let received: unknown = "unset";
		const returned = await runWithCoalescedToolUpdates<string, number>(undefined, async update => {
			received = update;
			return 7;
		});
		expect(received).toBeUndefined();
		expect(returned).toBe(7);
	});
});

describe("fan-out update budget", () => {
	it("paints at the window cadence, not per spawn, for a 32-agent batch", () => {
		vi.useFakeTimers();
		let time = 0;
		const emitted: number[] = [];
		const updates = createCoalescedToolUpdates<number>(value => emitted.push(value), {
			windowMs: 100,
			now: () => time,
		});

		const agents = 32;
		const rounds = 20;
		let latest = -1;
		for (let round = 0; round < rounds; round++) {
			for (let agent = 0; agent < agents; agent++) {
				latest = round * agents + agent;
				updates.update(latest);
			}
			time += 150;
			vi.advanceTimersByTime(150);
		}

		expect(latest).toBe(rounds * agents - 1);
		// 640 spawn updates collapse to at most one paint per 150 ms round.
		expect(emitted.length).toBeLessThanOrEqual(rounds + 1);
		expect(emitted.at(-1)).toBe(latest);
	});
});
