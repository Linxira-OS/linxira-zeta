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

	test("installs once and removes its listener on uninstall", () => {
		const source = testSource();
		const { calls, effects } = recorder();
		const first = track(installMemoryPressureShed({ platform: "win32", source, effects }));
		expect(first).toBeDefined();
		expect(source.listeners.size).toBe(1);
		expect(isMemoryPressureShedInstalled()).toBe(true);

		const second = installMemoryPressureShed({ platform: "win32", source, effects });
		expect(second).toBe(first);
		expect(source.listeners.size).toBe(1);

		first!();
		expect(source.listeners.size).toBe(0);
		expect(isMemoryPressureShedInstalled()).toBe(false);

		source.emit("critical");
		expect(calls).toEqual([]);
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
