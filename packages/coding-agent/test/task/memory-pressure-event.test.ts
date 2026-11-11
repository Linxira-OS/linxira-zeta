import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	handleMemoryPressureEvent,
	installMemoryPressureShed,
	isMemoryPressureShedInstalled,
	memoryPressureEventShedLevel,
	supportsMemoryPressureEvent,
	type MemoryPressureEventEffects,
	type MemoryPressureEventLevel,
	type MemoryPressureEventSource,
} from "../../src/task/memory-shed";

/**
 * These tests inject the event level. They prove the adapter and its cache
 * effect; they do not prove that Bun/native code delivers a system signal, and
 * a listener registered on any EventEmitter would not either.
 */

/** A minimal source so the adapter contract is checked without an OS signal. */
type TestSource = MemoryPressureEventSource & {
	readonly listeners: Set<(level: MemoryPressureEventLevel) => void>;
	emit(level: MemoryPressureEventLevel): void;
};

function testSource(): TestSource {
	const listeners = new Set<(level: MemoryPressureEventLevel) => void>();
	return {
		listeners,
		on(_event, listener) {
			listeners.add(listener);
			return this;
		},
		off(_event, listener) {
			listeners.delete(listener);
			return this;
		},
		emit(level) {
			for (const listener of listeners) listener(level);
		},
	};
}

/** Records the only effect the event has: dropping derived render caches. */
function recorder(): { calls: string[]; effects: MemoryPressureEventEffects } {
	const calls: string[] = [];
	return { calls, effects: { clearRenderCaches: () => calls.push("caches") } };
}

const uninstallers: Array<() => void> = [];

function track(uninstall: (() => void) | undefined): (() => void) | undefined {
	if (uninstall) uninstallers.push(uninstall);
	return uninstall;
}

beforeEach(() => {
	expect(isMemoryPressureShedInstalled()).toBe(false);
});

afterEach(() => {
	while (uninstallers.length > 0) uninstallers.pop()!();
});

describe("memoryPressure event adapter", () => {
	test("maps the documented levels onto the shed ladder", () => {
		expect(memoryPressureEventShedLevel("warning")).toBe("tight");
		expect(memoryPressureEventShedLevel("critical")).toBe("critical");
	});

	test("claims the Windows platform only", () => {
		expect(supportsMemoryPressureEvent("win32")).toBe(true);
		expect(supportsMemoryPressureEvent("darwin")).toBe(false);
		expect(supportsMemoryPressureEvent("linux")).toBe(false);

		const source = testSource();
		const { calls, effects } = recorder();
		const install = installMemoryPressureShed({ platform: "linux", source, effects });
		expect(install).toBeUndefined();
		expect(source.listeners.size).toBe(0);
		expect(isMemoryPressureShedInstalled()).toBe(false);
		expect(calls).toEqual([]);
	});

	test("clears derived render caches when the event fires", () => {
		const source = testSource();
		const { calls, effects } = recorder();
		track(installMemoryPressureShed({ platform: "win32", source, effects }));

		source.emit("warning");
		source.emit("critical");

		expect(calls).toEqual(["caches", "caches"]);
	});

	test("repeated init for one owner needs only one stop", () => {
		const source = testSource();
		const owner = {};
		const { calls, effects } = recorder();
		const first = track(installMemoryPressureShed({ platform: "win32", source, effects, owner }));
		for (let init = 0; init < 10; init++) {
			expect(installMemoryPressureShed({ platform: "win32", source, effects, owner })).toBe(first);
		}
		source.emit("critical");
		expect(calls).toEqual(["caches"]);
		expect(source.listeners.size).toBe(1);
		first!();
		first!();
		expect(source.listeners.size).toBe(0);
		expect(isMemoryPressureShedInstalled()).toBe(false);
		source.emit("critical");
		expect(calls).toEqual(["caches"]);
	});

	test("stopping one owner leaves the other subscribed until its last stop", () => {
		const source = testSource();
		const firstEffects = recorder();
		const secondEffects = recorder();
		const first = track(
			installMemoryPressureShed({
				platform: "win32",
				source,
				owner: {},
				effects: firstEffects.effects,
			}),
		);
		const second = track(
			installMemoryPressureShed({
				platform: "win32",
				source,
				owner: {},
				effects: secondEffects.effects,
			}),
		);
		expect(source.listeners.size).toBe(1);
		source.emit("critical");
		expect(firstEffects.calls.length + secondEffects.calls.length).toBe(1);

		first!();
		first!();
		expect(isMemoryPressureShedInstalled()).toBe(true);
		expect(source.listeners.size).toBe(1);
		source.emit("warning");
		expect(firstEffects.calls).toEqual(["caches"]);
		expect(secondEffects.calls).toEqual(["caches"]);

		second!();
		expect(source.listeners.size).toBe(0);
		expect(isMemoryPressureShedInstalled()).toBe(false);
		source.emit("critical");
		expect(secondEffects.calls).toEqual(["caches"]);
	});

	test("restart after the last stop installs a fresh lease immune to old stops", () => {
		const source = testSource();
		const owner = {};
		const { calls, effects } = recorder();
		const previous = track(installMemoryPressureShed({ platform: "win32", source, effects, owner }));
		previous!();
		const restarted = track(installMemoryPressureShed({ platform: "win32", source, effects, owner }));
		expect(restarted).not.toBe(previous);
		previous!();
		expect(source.listeners.size).toBe(1);
		source.emit("critical");
		expect(calls).toEqual(["caches"]);
		restarted!();
		expect(source.listeners.size).toBe(0);
	});

	test("anonymous callers acquire independent leases too", () => {
		const source = testSource();
		const { calls, effects } = recorder();
		const first = track(installMemoryPressureShed({ platform: "win32", source, effects }));
		const second = track(installMemoryPressureShed({ platform: "win32", source, effects }));
		expect(second).not.toBe(first);
		first!();
		source.emit("critical");
		expect(calls).toEqual(["caches"]);
		second!();
		source.emit("critical");
		expect(calls).toEqual(["caches"]);
	});

	test("a throwing cache release is contained and keeps the listener installed", () => {
		const source = testSource();
		let attempts = 0;
		track(
			installMemoryPressureShed({
				platform: "win32",
				source,
				effects: {
					clearRenderCaches: () => {
						attempts++;
						throw new Error("cache release failed");
					},
				},
			}),
		);

		expect(() => source.emit("critical")).not.toThrow();
		expect(attempts).toBe(1);
		expect(isMemoryPressureShedInstalled()).toBe(true);
	});

	test("the direct handler path drops render caches without touching session truth", () => {
		const { calls, effects } = recorder();
		handleMemoryPressureEvent("critical", effects);
		expect(calls).toEqual(["caches"]);
	});
});
