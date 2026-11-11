import { describe, expect, it } from "bun:test";
import { clearRenderCache, Markdown } from "@linxiraos/pi-tui/components/markdown";
import { TranscriptContainer, type TranscriptStableRow } from "@linxiraos/pi-tui/chrome/transcript-container";
import type { Component } from "@linxiraos/pi-tui/tui";
import { defaultMarkdownTheme } from "./test-themes.js";

/**
 * Pressure shedding drops derived render caches only. These tests prove the
 * consumer side of that contract: after the same cache release the shed
 * performs, the next render rebuilds the identical rows and no semantic
 * transcript content is lost.
 */
class ReleasableBlock implements Component {
	readonly transcriptBlockMode = "appendOnly" as const;
	readonly #rows: readonly string[];
	readonly #stable: TranscriptStableRow[];
	releases = 0;
	#rendered: readonly string[] | undefined;

	constructor(index: number) {
		this.#rows = Array.from({ length: 6 }, (_, row) => `${index}:${row} ${"large tool output row ".repeat(4)}`);
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

	releaseRenderCaches(): void {
		this.releases++;
		this.#rendered = undefined;
	}

	render(): readonly string[] {
		this.#rendered ??= this.#rows;
		return this.#rendered;
	}
}

describe("render-cache pressure restoration", () => {
	it("re-renders identical markdown rows after the L2 cache is dropped", () => {
		clearRenderCache();
		const source = Array.from(
			{ length: 120 },
			(_, index) => `## Section ${index}\n\nParagraph ${index} with **bold** and \`code\`.`,
		).join("\n\n");

		const first = new Markdown(source, 0, 0, defaultMarkdownTheme).render(80);
		const cached = new Markdown(source, 0, 0, defaultMarkdownTheme).render(80);
		expect(cached).toBe(first);

		// Exactly what the memoryPressure shed does: drop the module L2 cache.
		clearRenderCache();

		const restored = new Markdown(source, 0, 0, defaultMarkdownTheme).render(80);
		expect(restored).toEqual(first);
		expect(restored).not.toBe(first);
	});

	it("restores a committed transcript block after retirement releases its caches", () => {
		const container = new TranscriptContainer();
		const block = new ReleasableBlock(1);
		container.addChild(block);

		const before = container.render(80);
		container.liveRowCount(100);
		const batch = container.peekFlushBatch(80);
		if (!batch) throw new Error("expected a flush batch for the settled block");
		container.acknowledgeFinalizedBatch(batch.id);

		expect(block.releases).toBeGreaterThan(0);

		// Clearing derived caches must not change the transcript the consumer sees.
		clearRenderCache();
		expect(container.render(80)).toEqual(before);
	});
});
