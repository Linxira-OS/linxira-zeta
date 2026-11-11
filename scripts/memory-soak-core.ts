/**
 * Pure helpers for `scripts/memory-soak.ts`.
 *
 * Kept free of TUI imports so the unit test can exercise the sampling/summary
 * contract without loading native-backed render modules or allocating a soak.
 */

export interface MemorySampleSnapshot {
	atMs: number;
	rssBytes: number;
	heapUsedBytes: number;
	heapTotalBytes: number;
	externalBytes: number;
	/** System-wide commit charge (Windows only); `undefined` when unavailable. */
	systemCommitBytes?: number;
}

export interface SoakSummary {
	samples: number;
	durationMs: number;
	rssStartMiB: number;
	rssPeakMiB: number;
	rssGrowthMiB: number;
	heapStartMiB: number;
	heapPeakMiB: number;
	systemCommitStartMiB?: number;
	systemCommitPeakMiB?: number;
	/** `null` when no measured threshold was supplied (report-only). */
	maxRssGrowthMiB: number | null;
	/** `null` in report-only runs; `true` when the measured growth exceeded the cap. */
	exceeded: boolean | null;
}

export type SpawnSyncResult = {
	exitCode: number | null;
	success?: boolean;
	stdout?: Uint8Array | string;
};

export type SpawnSyncRunner = (command: string[]) => SpawnSyncResult;

const MIB = 1024 ** 2;

export function toMiB(bytes: number): number {
	return Number((bytes / MIB).toFixed(2));
}

/**
 * Parse the PowerShell commit-charge line. `Get-Counter` prints the invariant
 * decimal value on its own line; a localized thousands separator or a warning
 * line must not be mistaken for a byte count.
 */
export function parseWindowsCommitBytes(stdout: string): number | undefined {
	for (const line of stdout.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (trimmed.length === 0) continue;
		if (!/^\d+(?:\.\d+)?$/.test(trimmed)) return undefined;
		const value = Number(trimmed);
		return Number.isFinite(value) && value > 0 ? Math.round(value) : undefined;
	}
	return undefined;
}

/**
 * Read the system commit charge on Windows. Returns `undefined` off Windows,
 * when PowerShell cannot be spawned, or when its output is not a byte count —
 * the caller must never report a fabricated number.
 */
export function readWindowsCommitBytes(
	platform: NodeJS.Platform = process.platform,
	run: SpawnSyncRunner = command => Bun.spawnSync(command, { timeout: 2000 }),
): number | undefined {
	if (platform !== "win32") return undefined;
	try {
		const result = run([
			"powershell.exe",
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			"(Get-Counter '\\Memory\\Committed Bytes').CounterSamples[0].CookedValue",
		]);
		if (result.exitCode !== 0) return undefined;
		const stdout = typeof result.stdout === "string" ? result.stdout : new TextDecoder().decode(result.stdout);
		return parseWindowsCommitBytes(stdout);
	} catch {
		return undefined;
	}
}

/** One process-memory reading; commit charge is passed through when sampled. */
export function sampleProcessMemory(atMs: number, systemCommitBytes?: number): MemorySampleSnapshot {
	const usage = process.memoryUsage();
	return {
		atMs,
		rssBytes: usage.rss,
		heapUsedBytes: usage.heapUsed,
		heapTotalBytes: usage.heapTotal,
		externalBytes: usage.external,
		systemCommitBytes,
	};
}

/** Reduce raw samples to the numbers a gate or report consumes. */
export function summarizeSamples(
	samples: readonly MemorySampleSnapshot[],
	options: { maxRssGrowthMiB?: number } = {},
): SoakSummary {
	const first = samples[0];
	const last = samples[samples.length - 1];
	let rssPeak = 0;
	let heapPeak = 0;
	let commitPeak: number | undefined;
	for (const sample of samples) {
		rssPeak = Math.max(rssPeak, sample.rssBytes);
		heapPeak = Math.max(heapPeak, sample.heapUsedBytes);
		if (sample.systemCommitBytes !== undefined) {
			commitPeak = Math.max(commitPeak ?? 0, sample.systemCommitBytes);
		}
	}
	const rssGrowth = rssPeak - (first?.rssBytes ?? 0);
	const cap = options.maxRssGrowthMiB;
	return {
		samples: samples.length,
		durationMs: (last?.atMs ?? 0) - (first?.atMs ?? 0),
		rssStartMiB: toMiB(first?.rssBytes ?? 0),
		rssPeakMiB: toMiB(rssPeak),
		rssGrowthMiB: toMiB(rssGrowth),
		heapStartMiB: toMiB(first?.heapUsedBytes ?? 0),
		heapPeakMiB: toMiB(heapPeak),
		systemCommitStartMiB: first?.systemCommitBytes !== undefined ? toMiB(first.systemCommitBytes) : undefined,
		systemCommitPeakMiB: commitPeak !== undefined ? toMiB(commitPeak) : undefined,
		maxRssGrowthMiB: cap ?? null,
		exceeded: cap === undefined ? null : rssGrowth > cap * MIB,
	};
}
