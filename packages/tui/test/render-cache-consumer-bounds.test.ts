import { afterAll, describe, expect, it } from "bun:test";
import { Markdown, clearRenderCache } from "@linxiraos/pi-tui/components/markdown";
import { TranscriptContainer, type TranscriptStableRow } from "@linxiraos/pi-tui/chrome/transcript-container";
import type { Component } from "@linxiraos/pi-tui/tui";
import { defaultMarkdownTheme } from "./test-themes.js";

/**
 * Consumer retained-byte guards.
 *
 * These measure the heap the consumer actually keeps after a full GC, not the
 * cache's configured constants: an implementation can keep its knobs and still
 * retain unbounded bytes, and a test that asserts the constant would pass.
 * The fills are large enough that the bounded behavior is an order of magnitude
 * below the unbounded one; the caps below sit in that gap rather than at a
 * tuned runner budget.
 */
const MIB = 1024 ** 2;

function heapAfterFullGc(): number {
	Bun.gc(true);
	Bun.gc(true);
	return process.memoryUsage().heapUsed;
}

/** Settle and acknowledge every available flush batch at one width. */
function commitAll(container: TranscriptContainer, width = 80): void {
	container.liveRowCount(width);
	for (let guard = 0; guard <= container.children.length; guard++) {
		const batch = container.peekFlushBatch(width);
		if (!batch) return;
		container.acknowledgeFinalizedBatch(batch.id);
	}
}

class FillBlock implements Component {
	readonly transcriptBlockMode = "appendOnly" as const;
	readonly #rows: readonly string[];
	readonly #stable: TranscriptStableRow[];

	constructor(index: number) {
		this.#rows = Array.from({ length: 8 }, (_, row) => `${index}:${row} ${"consumer cap transcript row ".repeat(4)}`);
		this.#stable = this.#rows.map((_, row) => ({ key: `${index}:${row}` }));
	}

	isTranscriptBlockFinalized(): boolean {
		return true;
	}

	getTranscriptStableRows(): readonly TranscriptStableRow[] {
		return this.#stable;
	}

	renderTranscriptStableRows(count: number): readonly string[] {
		return this.#rows.slice(0, count);
	}

	render(): readonly string[] {
		return this.#rows;
	}
}

function fillMarkdownDocuments(count: number, bytesPerDocument: number): void {
	const line = "consumer cap markdown payload line with a few words\n";
	const repeats = Math.ceil(bytesPerDocument / line.length);
	for (let index = 0; index < count; index++) {
		const text = `# Document ${index}\n\n${line.repeat(repeats)}`;
		// The module L2 cache is the only consumer here; the local reference dies.
		void new Markdown(text, 0, 0, defaultMarkdownTheme).render(80);
	}
}

afterAll(() => {
	clearRenderCache();
});

describe("consumer retained-byte caps", () => {
	it("bounds retained markdown render bytes under a cache larger than its aggregate cap", () => {
		clearRenderCache();
		void new Markdown("# warmup\n\nbody", 0, 0, defaultMarkdownTheme).render(80);
		clearRenderCache();
		const baseline = heapAfterFullGc();

		// 96 documents x 150 KiB ≈ 14 MiB offered; the cache's aggregate budget is
		// a few MiB, so an unbounded cache retains ~14 MiB here.
		fillMarkdownDocuments(96, 150 * 1024);
		const retained = heapAfterFullGc() - baseline;
		console.log(`[retained] markdown cache: ${(retained / MIB).toFixed(2)} MiB for 14.06 MiB offered`);

		// Retained stays well under the offered bytes, and the cache still retains
		// something (a zero would mean the guard measured nothing).
		expect(retained).toBeLessThan(9 * MIB);
		expect(retained).toBeGreaterThan(1 * MIB);
	});

	it("drops committed transcript render caches instead of retaining them per width", () => {
		const warmup = new TranscriptContainer();
		warmup.addChild(new FillBlock(-1));
		warmup.render(80);
		const baseline = heapAfterFullGc();

		const oneWidth = new TranscriptContainer();
		for (let index = 0; index < 1500; index++) oneWidth.addChild(new FillBlock(index));
		oneWidth.render(80);
		commitAll(oneWidth);
		const afterOneWidth = heapAfterFullGc();

		const fourWidths = new TranscriptContainer();
		for (let index = 0; index < 1500; index++) fourWidths.addChild(new FillBlock(index));
		for (const width of [80, 120, 60, 160]) fourWidths.render(width);
		commitAll(fourWidths);
		const afterFourWidths = heapAfterFullGc();

		const oneWidthBytes = afterOneWidth - baseline;
		const fourWidthsBytes = afterFourWidths - afterOneWidth;
		const extraBytes = fourWidthsBytes - oneWidthBytes;
		console.log(
			`[retained] committed transcript: ${(oneWidthBytes / MIB).toFixed(2)} MiB (1 width), ` +
				`${(fourWidthsBytes / MIB).toFixed(2)} MiB (4 widths), delta ${(extraBytes / MIB).toFixed(2)} MiB`,
		);

		expect(oneWidth.blockStates().every(state => state === "committed")).toBe(true);
		expect(fourWidths.blockStates().every(state => state === "committed")).toBe(true);
		// Both containers retain the same semantic blocks; only the extra width
		// epochs differ. Released caches make that difference near zero, while
		// per-width stable-row copies would add megabytes.
		expect(extraBytes).toBeLessThan(1.5 * MIB);
	});
});
