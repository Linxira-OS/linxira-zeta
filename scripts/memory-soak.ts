/**
 * Bounded TUI memory soak.
 *
 * Scripted long session: large Markdown documents plus a transcript that keeps
 * adding and committing append-only blocks while the width cycles through a
 * resize sequence. Samples process RSS/heap and — on Windows only — the system
 * commit charge, because the v18 crashes died at the commit limit
 * (`ERROR_COMMITMENT_LIMIT`, os error 1455), not at an RSS ceiling.
 *
 * The harness has no built-in threshold. Run it once on the runner class you
 * intend to gate, record the measured peak, then pass
 * `--max-rss-growth-mib=<measured + headroom>`. Without that flag the run is
 * report-only (`enforced: false`) and always exits 0 — a guessed budget in CI
 * would be noise, not a guard.
 *
 * Usage:
 *   bun scripts/memory-soak.ts --seconds=180
 *   bun scripts/memory-soak.ts --seconds=180 --max-rss-growth-mib=96 --out=temp/memory-soak.json
 *
 * Windows commit sampling shells out once per commit interval (default 5 s):
 *   (Get-Counter '\Memory\Committed Bytes').CounterSamples[0].CookedValue
 * It is skipped on every other platform and when PowerShell is unavailable.
 * The query runs asynchronously with at most one probe in flight, so rendering
 * and sampling continue while PowerShell starts. It has a 10 s budget:
 * PowerShell cold start plus Get-Counter measured 8.1 s on a loaded host, while
 * a timeout or unusable output is recorded as "no commit value" rather than
 * zero.
 *
 * This is not a unit test: it allocates tens of MB and runs for minutes.
 * `scripts/memory-soak.test.ts` covers only the pure helpers in
 * `scripts/memory-soak-core.ts`.
 */

import { Markdown } from "../packages/tui/src/components/markdown";
import { TranscriptContainer } from "../packages/tui/src/chrome/transcript-container";
import { loadTheme } from "../packages/tui/src/theme/loader";
import { setThemeInstance } from "../packages/tui/src/theme/theme";
import { getMarkdownTheme } from "../packages/tui/src/theme/tui-adapters";
import type { Component } from "../packages/tui/src/tui";
import {
	CommitChargeSampler,
	type MemorySampleSnapshot,
	type SoakSummary,
	readWindowsCommitBytes,
	sampleProcessMemory,
	summarizeSamples,
} from "./memory-soak-core";

export interface SoakOptions {
	durationMs: number;
	sampleIntervalMs: number;
	commitIntervalMs: number;
	widths: readonly number[];
	maxBlocks: number;
	maxRssGrowthMiB?: number;
	forceGc: boolean;
	platform?: NodeJS.Platform;
}

export interface SoakResult {
	samples: MemorySampleSnapshot[];
	summary: SoakSummary;
	workload: { blocks: number; renders: number };
}

interface StableRow {
	key: string;
}

/** One append-only block with several large rows, finalized on creation. */
class SoakBlock implements Component {
	readonly transcriptBlockMode = "appendOnly" as const;
	readonly #lines: readonly string[];

	constructor(index: number, rows: number) {
		this.#lines = Array.from(
			{ length: rows },
			(_, row) => `${index}:${row} ${"soak tool output payload ".repeat(8)}`,
		);
	}

	isTranscriptBlockFinalized(): boolean {
		return true;
	}

	getTranscriptStableRows(): readonly StableRow[] {
		return this.#lines.map((_, row) => ({ key: `${row}` }));
	}

	renderTranscriptStableRows(count: number): readonly string[] {
		return this.#lines.slice(0, count);
	}
	render(): readonly string[] {
		return this.#lines;
	}
}

function parseNumberFlag(argv: readonly string[], name: string, fallback: number): number {
	const prefix = `--${name}=`;
	for (const arg of argv) {
		if (!arg.startsWith(prefix)) continue;
		const value = Number(arg.slice(prefix.length));
		return Number.isFinite(value) ? value : fallback;
	}
	return fallback;
}

function parseStringFlag(argv: readonly string[], name: string): string | undefined {
	const prefix = `--${name}=`;
	for (const arg of argv) if (arg.startsWith(prefix)) return arg.slice(prefix.length);
	return undefined;
}

/**
 * Run for `durationMs`, admitting at most `maxBlocks` semantic blocks while
 * continuing resize/render passes after that cap. Returns samples and counters.
 */
export async function runSoak(options: SoakOptions): Promise<SoakResult> {
	setThemeInstance(await loadTheme("dark"));
	const theme = getMarkdownTheme();
	const container = new TranscriptContainer();
	const platform = options.platform ?? process.platform;
	const samples: MemorySampleSnapshot[] = [];
	const startedAt = Bun.nanoseconds();

	let blocks = 0;
	let renders = 0;
	let nextSampleAt = 0;
	let nextCommitAt = 0;
	let nextYieldAt = 0;
	const commitSampler =
		platform === "win32" ? new CommitChargeSampler(() => readWindowsCommitBytes(platform)) : undefined;

	const maybeSample = (force = false): void => {
		const elapsed = (Bun.nanoseconds() - startedAt) / 1_000_000;
		if (!force && elapsed < nextSampleAt) return;
		nextSampleAt = elapsed + options.sampleIntervalMs;
		if (commitSampler && (force || elapsed >= nextCommitAt)) {
			nextCommitAt = elapsed + options.commitIntervalMs;
			commitSampler.sample();
		}
		samples.push(sampleProcessMemory((Bun.nanoseconds() - startedAt) / 1_000_000, commitSampler?.bytes));
	};

	maybeSample(true);
	for (;;) {
		const elapsed = (Bun.nanoseconds() - startedAt) / 1_000_000;
		if (elapsed >= options.durationMs) break;
		const width = options.widths[(renders / 2) % options.widths.length]!;
		const document = Array.from(
			{ length: 40 },
			(_, paragraph) => `## Block ${blocks} paragraph ${paragraph}\n\n${"soak markdown payload ".repeat(60)}`,
		).join("\n\n");
		// The module-level L2 cache retains this render; the local reference is dropped.
		void new Markdown(document, 0, 0, theme).render(width);
		renders++;

		if (blocks < options.maxBlocks) {
			container.addChild(new SoakBlock(blocks, 8));
			blocks++;
		}
		container.render(width);
		renders++;

		if (blocks > 0 && blocks % 32 === 0) {
			container.liveRowCount(width);
			const batch = container.peekFlushBatch(width);
			if (batch) container.acknowledgeFinalizedBatch(batch.id);
		}
		if (options.forceGc) Bun.gc(true);
		maybeSample();

		// Yield only while a commit probe is pending so its IO can finish without
		// stalling the render loop; text rendering and samples keep running.
		const afterRender = (Bun.nanoseconds() - startedAt) / 1_000_000;
		if (commitSampler?.pending && afterRender >= nextYieldAt) {
			nextYieldAt = afterRender + 100;
			await Bun.sleep(0);
		}
	}

	Bun.gc(true);
	Bun.gc(true);
	maybeSample(true);
	return {
		samples,
		summary: summarizeSamples(samples, { maxRssGrowthMiB: options.maxRssGrowthMiB }),
		workload: { blocks, renders },
	};
}

if (import.meta.main) {
	const argv = Bun.argv.slice(2);
	const requestedGrowth = parseNumberFlag(argv, "max-rss-growth-mib", Number.NaN);
	const options: SoakOptions = {
		durationMs: Math.min(Math.max(parseNumberFlag(argv, "seconds", 180), 5), 600) * 1000,
		sampleIntervalMs: Math.max(parseNumberFlag(argv, "sample-ms", 500), 50),
		commitIntervalMs: Math.max(parseNumberFlag(argv, "commit-ms", 5000), 500),
		widths: [80, 120, 60, 160, 100],
		maxBlocks: Math.max(parseNumberFlag(argv, "blocks", 5000), 1),
		maxRssGrowthMiB: Number.isFinite(requestedGrowth) ? requestedGrowth : undefined,
		forceGc: argv.includes("--gc"),
	};
	const { samples, summary, workload } = await runSoak(options);
	const peakSample = samples.reduce((peak, sample) => (sample.rssBytes > peak.rssBytes ? sample : peak), samples[0]!);
	const output = {
		enforced: summary.exceeded !== null,
		options,
		workload,
		summary,
		peakSample,
		samples,
	};
	const json = JSON.stringify(output, null, 2);
	const out = parseStringFlag(argv, "out");
	if (out) await Bun.write(out, `${json}\n`);
	else console.log(json);
	if (summary.exceeded === true) process.exitCode = 1;
}
