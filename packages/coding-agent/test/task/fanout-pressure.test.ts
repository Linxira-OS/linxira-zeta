import { describe, expect, test } from "bun:test";
import {
	describePressure,
	effectiveFanOutCap,
	memoryPressureLevel,
	readMemorySample,
	type MemorySample,
} from "../../src/task/fanout-pressure";

const GIB = 1024 ** 3;

const sample = (rssGib: number, freeGib: number, totalGib: number): MemorySample => ({
	rssBytes: rssGib * GIB,
	systemFreeBytes: freeGib * GIB,
	systemTotalBytes: totalGib * GIB,
});

describe("memory pressure classification", () => {
	test("plenty free and a small process is ok", () => {
		expect(memoryPressureLevel(sample(1, 16, 32))).toBe("ok");
	});

	test("free memory in the tight band is tight", () => {
		expect(memoryPressureLevel(sample(1, 3, 32))).toBe("tight");
	});

	test("free memory in the critical band is critical", () => {
		expect(memoryPressureLevel(sample(1, 1, 32))).toBe("critical");
	});

	test("a large process is pressure even while the OS still reports free memory", () => {
		expect(memoryPressureLevel(sample(7, 100, 128))).toBe("tight");
		expect(memoryPressureLevel(sample(11, 100, 128))).toBe("critical");
	});

	test("a large process outranks a merely tight system reading", () => {
		expect(memoryPressureLevel(sample(11, 3, 32))).toBe("critical");
	});

	test("unreadable system memory falls back to the process signal", () => {
		expect(memoryPressureLevel(sample(1, 0, 0))).toBe("ok");
		expect(memoryPressureLevel(sample(Number.NaN, 0, 0))).toBe("ok");
	});
});

describe("effective fan-out ceiling", () => {
	test("a healthy machine uses the configured cap untouched", () => {
		expect(effectiveFanOutCap(32, "ok")).toBe(32);
		// `0` is the "Unlimited" sentinel `normalizeConcurrencyLimit` produces;
		// the caller (Semaphore / workpool) is what widens it to Infinity.
		expect(effectiveFanOutCap(0, "ok")).toBe(0);
	});

	test("a short machine lowers the cap, never below one", () => {
		expect(effectiveFanOutCap(32, "tight")).toBe(8);
		expect(effectiveFanOutCap(32, "critical")).toBe(2);
		expect(effectiveFanOutCap(1, "critical")).toBe(1);
	});

	test('a configured "Unlimited" becomes bounded under pressure', () => {
		expect(effectiveFanOutCap(0, "tight")).toBe(8);
		expect(effectiveFanOutCap(0, "critical")).toBe(2);
	});

	test("never raises a cap the user already set lower", () => {
		expect(effectiveFanOutCap(3, "tight")).toBe(3);
		expect(effectiveFanOutCap(2, "critical")).toBe(2);
	});

	test("garbage input degrades to the safe ceiling", () => {
		expect(effectiveFanOutCap(Number.NaN, "critical")).toBe(2);
	});
});

describe("pressure notice", () => {
	test("silent while healthy", () => {
		expect(describePressure("ok", sample(1, 16, 32))).toBeUndefined();
	});

	test("names the level, the numbers and the untouched setting", () => {
		const notice = describePressure("tight", sample(7, 3, 32));
		expect(notice).toContain("tight");
		expect(notice).toContain("rss 7.0 GiB");
		expect(notice).toContain("system free 3.0 of 32.0 GiB");
		expect(notice).toContain("task.maxConcurrency unchanged");
	});
});

describe("live sample", () => {
	test("reads this machine without crossing signals", () => {
		const live = readMemorySample();
		expect(live.rssBytes).toBeGreaterThan(0);
		expect(live.systemTotalBytes).toBeGreaterThan(GIB / 2);
		expect(live.systemFreeBytes).toBeLessThanOrEqual(live.systemTotalBytes);
	});
});
