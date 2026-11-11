import { describe, expect, test } from "bun:test";
import {
	CommitChargeSampler,
	type MemorySampleSnapshot,
	type SpawnResult,
	parseWindowsCommitBytes,
	readWindowsCommitBytes,
	sampleProcessMemory,
	summarizeSamples,
	WINDOWS_COMMIT_TIMEOUT_MS,
} from "./memory-soak-core";

const MIB = 1024 ** 2;

function snapshot(atMs: number, rssMiB: number, heapMiB: number, commitMiB?: number): MemorySampleSnapshot {
	return {
		atMs,
		rssBytes: rssMiB * MIB,
		heapUsedBytes: heapMiB * MIB,
		heapTotalBytes: heapMiB * MIB * 2,
		externalBytes: 0,
		systemCommitBytes: commitMiB === undefined ? undefined : commitMiB * MIB,
	};
}

describe("parseWindowsCommitBytes", () => {
	test("reads the invariant byte count PowerShell prints", () => {
		expect(parseWindowsCommitBytes("1234567890\n")).toBe(1234567890);
		expect(parseWindowsCommitBytes("  42.0  ")).toBe(42);
		expect(parseWindowsCommitBytes("7\r\n")).toBe(7);
	});

	test("rejects output that is not a single byte count", () => {
		expect(parseWindowsCommitBytes("")).toBeUndefined();
		expect(parseWindowsCommitBytes("Get-Counter : no data\n")).toBeUndefined();
		expect(parseWindowsCommitBytes("1,234,567\n")).toBeUndefined();
		expect(parseWindowsCommitBytes("0\n")).toBeUndefined();
		expect(parseWindowsCommitBytes("-5\n")).toBeUndefined();
	});
});

describe("readWindowsCommitBytes", () => {
	test("does not spawn anything off Windows", async () => {
		let calls = 0;
		const result = await readWindowsCommitBytes("linux", async () => {
			calls++;
			return { exitCode: 0, stdout: "1" };
		});
		expect(result).toBeUndefined();
		expect(calls).toBe(0);
	});

	test("runs the fixed PowerShell query on Windows and decodes its stdout", async () => {
		const commands: string[][] = [];
		const timeouts: number[] = [];
		const result = await readWindowsCommitBytes("win32", async (command, options) => {
			commands.push(command);
			timeouts.push(options.timeout);
			return { exitCode: 0, stdout: new TextEncoder().encode("987654321\n") };
		});
		expect(result).toBe(987654321);
		expect(commands).toHaveLength(1);
		expect(commands[0]![0]).toBe("powershell.exe");
		expect(commands[0]!.join(" ")).toContain("Committed Bytes");
		expect(timeouts).toEqual([WINDOWS_COMMIT_TIMEOUT_MS]);
		expect(WINDOWS_COMMIT_TIMEOUT_MS).toBeGreaterThan(2000);
	});

	test("reports nothing when the query fails or output is unusable", async () => {
		const failed = async (): Promise<SpawnResult> => ({ exitCode: 1, stdout: "123" });
		expect(await readWindowsCommitBytes("win32", failed)).toBeUndefined();
		const malformed = async (): Promise<SpawnResult> => ({ exitCode: 0, stdout: "not a number" });
		expect(await readWindowsCommitBytes("win32", malformed)).toBeUndefined();
		const timedOut = async (): Promise<SpawnResult> => ({ exitCode: null, stdout: "" });
		expect(await readWindowsCommitBytes("win32", timedOut)).toBeUndefined();
		expect(
			await readWindowsCommitBytes("win32", async () => {
				throw new Error("spawn unavailable");
			}),
		).toBeUndefined();
	});
});

describe("CommitChargeSampler", () => {
	test("keeps one probe in flight and serves the last known value", async () => {
		let calls = 0;
		const { promise, resolve } = Promise.withResolvers<number | undefined>();
		const sampler = new CommitChargeSampler(() => {
			calls++;
			return promise;
		});

		expect(sampler.sample()).toBeUndefined();
		expect(sampler.pending).toBe(true);
		expect(sampler.sample()).toBeUndefined();
		expect(calls).toBe(1);
		const idle = sampler.whenIdle();
		resolve(42);
		await idle;
		expect(sampler.bytes).toBe(42);
		expect(sampler.pending).toBe(false);
	});

	test("leaves the value unavailable when the probe yields no reading", async () => {
		const sampler = new CommitChargeSampler(async () => undefined);
		expect(sampler.sample()).toBeUndefined();
		await sampler.whenIdle();
		expect(sampler.bytes).toBeUndefined();
		expect(sampler.pending).toBe(false);
	});

	test("does not keep a failed probe pending", async () => {
		const sampler = new CommitChargeSampler(async () => {
			throw new Error("spawn unavailable");
		});
		sampler.sample();
		await sampler.whenIdle();
		expect(sampler.bytes).toBeUndefined();
		expect(sampler.pending).toBe(false);
	});
});

describe("summarizeSamples", () => {
	test("reports peaks, growth, and no verdict in report-only runs", () => {
		const summary = summarizeSamples([
			snapshot(0, 100, 20, 1900),
			snapshot(1000, 150, 35, 2000),
			snapshot(2000, 140, 30, 2100),
		]);
		expect(summary.samples).toBe(3);
		expect(summary.durationMs).toBe(2000);
		expect(summary.rssStartMiB).toBe(100);
		expect(summary.rssPeakMiB).toBe(150);
		expect(summary.rssGrowthMiB).toBe(50);
		expect(summary.heapPeakMiB).toBe(35);
		expect(summary.systemCommitStartMiB).toBe(1900);
		expect(summary.systemCommitPeakMiB).toBe(2100);
		expect(summary.maxRssGrowthMiB).toBeNull();
		expect(summary.exceeded).toBeNull();
	});

	test("reports the first real commit reading when early probes are still pending", () => {
		const summary = summarizeSamples([snapshot(0, 100, 20), snapshot(1000, 150, 35, 2000), snapshot(2000, 140, 30, 2100)]);
		expect(summary.systemCommitStartMiB).toBe(2000);
		expect(summary.systemCommitPeakMiB).toBe(2100);
	});

	test("applies a supplied measured cap at the boundary", () => {
		const samples = [snapshot(0, 100, 20), snapshot(1000, 150, 20)];
		expect(summarizeSamples(samples, { maxRssGrowthMiB: 51 }).exceeded).toBe(false);
		expect(summarizeSamples(samples, { maxRssGrowthMiB: 50 }).exceeded).toBe(false);
		expect(summarizeSamples(samples, { maxRssGrowthMiB: 49 }).exceeded).toBe(true);
	});

	test("degrades to zeroes when no sample was taken", () => {
		const summary = summarizeSamples([], { maxRssGrowthMiB: 10 });
		expect(summary).toMatchObject({
			samples: 0,
			durationMs: 0,
			rssStartMiB: 0,
			rssPeakMiB: 0,
			rssGrowthMiB: 0,
			maxRssGrowthMiB: 10,
			exceeded: false,
		});
		expect(summary.systemCommitStartMiB).toBeUndefined();
		expect(summary.systemCommitPeakMiB).toBeUndefined();
	});
});

describe("sampleProcessMemory", () => {
	test("records the process reading and passes commit charge through", () => {
		const sample = sampleProcessMemory(1234, 5);
		expect(sample.atMs).toBe(1234);
		expect(sample.systemCommitBytes).toBe(5);
		expect(sample.rssBytes).toBeGreaterThan(0);
		expect(sample.heapUsedBytes).toBeGreaterThan(0);

		expect(sampleProcessMemory(0).systemCommitBytes).toBeUndefined();
	});
});
