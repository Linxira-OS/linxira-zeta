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

export type SpawnResult = {
	exitCode: number | null;
	stdout?: Uint8Array | string;
};

export type SpawnRunner = (command: string[], options: { timeout: number }) => Promise<SpawnResult>;

const MIB = 1024 ** 2;

/**
 * Windows PowerShell cold start plus `Get-Counter` measured 8.1 s on a loaded
 * host, so the former 2 s cap killed the query before it printed anything and
 * system-commit sampling silently degraded to "unavailable" on every sample.
 * Ten seconds bounds a hung shell; the caller launches the probe
 * asynchronously so the render loop keeps producing workload while it runs.
 */
export const WINDOWS_COMMIT_TIMEOUT_MS = 10_000;

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
 * Read the system commit charge on Windows without blocking the caller. Returns
 * `undefined` off Windows, when PowerShell cannot be spawned, or when its
 * output is not a byte count — the caller must never report a fabricated number.
 */
export async function readWindowsCommitBytes(
	platform: NodeJS.Platform = process.platform,
	run: SpawnRunner = runWithTimeout,
	timeoutMs: number = WINDOWS_COMMIT_TIMEOUT_MS,
): Promise<number | undefined> {
	if (platform !== "win32") return undefined;
	try {
		const result = await run(
			[
				"powershell.exe",
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				"(Get-Counter '\\Memory\\Committed Bytes').CounterSamples[0].CookedValue",
			],
			{ timeout: timeoutMs },
		);
		if (result.exitCode !== 0) return undefined;
		const stdout = typeof result.stdout === "string" ? result.stdout : new TextDecoder().decode(result.stdout);
		return parseWindowsCommitBytes(stdout);
	} catch {
		return undefined;
	}
}

async function runWithTimeout(command: string[], options: { timeout: number }): Promise<SpawnResult> {
	const proc = Bun.spawn(command, { stdout: "pipe", stderr: "ignore" });
	const timer = setTimeout(() => {
		try {
			proc.kill();
		} catch {
			// already exited
		}
	}, options.timeout);
	try {
		const exitCode = await proc.exited;
		const stdout = await proc.stdout.text();
		return { exitCode, stdout };
	} finally {
		clearTimeout(timer);
	}
}

/**
 * One Windows commit probe in flight at a time. `sample()` returns the last
 * known value immediately and, when idle, starts a background query; a second
 * call while one is pending neither spawns again nor blocks the caller.
 */
export class CommitChargeSampler {
	readonly #query: () => Promise<number | undefined>;
	#pending: Promise<void> | null = null;
	#bytes: number | undefined;

	constructor(query: () => Promise<number | undefined>) {
		this.#query = query;
	}

	get bytes(): number | undefined {
		return this.#bytes;
	}

	get pending(): boolean {
		return this.#pending !== null;
	}

	/** Resolves when no probe is in flight (immediately when idle). */
	whenIdle(): Promise<void> {
		return this.#pending ?? Promise.resolve();
	}

	sample(): number | undefined {
		if (this.#pending === null) {
			this.#pending = this.#query()
				.then(
					value => {
						if (value !== undefined) this.#bytes = value;
					},
					() => {},
				)
				.finally(() => {
					this.#pending = null;
				});
		}
		return this.#bytes;
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
	const firstCommit = samples.find(sample => sample.systemCommitBytes !== undefined)?.systemCommitBytes;
	const cap = options.maxRssGrowthMiB;
	return {
		samples: samples.length,
		durationMs: (last?.atMs ?? 0) - (first?.atMs ?? 0),
		rssStartMiB: toMiB(first?.rssBytes ?? 0),
		rssPeakMiB: toMiB(rssPeak),
		rssGrowthMiB: toMiB(rssGrowth),
		heapStartMiB: toMiB(first?.heapUsedBytes ?? 0),
		heapPeakMiB: toMiB(heapPeak),
		systemCommitStartMiB: firstCommit !== undefined ? toMiB(firstCommit) : undefined,
		systemCommitPeakMiB: commitPeak !== undefined ? toMiB(commitPeak) : undefined,
		maxRssGrowthMiB: cap ?? null,
		exceeded: cap === undefined ? null : rssGrowth > cap * MIB,
	};
}
