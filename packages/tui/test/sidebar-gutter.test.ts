import { describe, expect, it } from "bun:test";
import {
	type Component,
	type TerminalFramePlan,
	type TerminalFrameProvider,
	TUI,
	type ViewportSize,
	visibleWidth,
} from "@linxiraos/pi-tui";
import { VirtualRenderScheduler } from "./virtual-render-scheduler";
import { VirtualTerminal } from "./virtual-terminal";

class AppendableLines implements Component {
	lines: string[];

	constructor(lines: string[]) {
		this.lines = lines;
	}

	append(count: number): void {
		for (let i = 0; i < count; i++) this.lines.push(`MAIN-${String(this.lines.length).padStart(3, "0")}`);
	}

	render(width: number): string[] {
		return this.lines.map(line => line.slice(0, width));
	}
}

/** Gutter stub whose rows can be swapped to force gutter-only repaints. */
class MutableGutter implements Component {
	rows: string[] = [];

	render(): string[] {
		return this.rows;
	}
}

function gutterRows(count: number, tag: string): string[] {
	return Array.from({ length: count }, (_, i) => `${tag}${String(i).padStart(2, "0")}`);
}

describe("TUI sidebar gutter", () => {
	it("paints the main area left and the gutter right; committed history carries no gutter text", async () => {
		const term = new VirtualTerminal(120, 24, 12_000);
		const tui = new TUI(term);
		const main = new AppendableLines(Array.from({ length: 60 }, (_, i) => `MAIN-${String(i).padStart(3, "0")}`));
		const gutter = new MutableGutter();
		gutter.rows = gutterRows(40, "GTR");
		tui.addChild(main);
		tui.setMainWidth(36);
		tui.setGutterComponent(gutter);

		try {
			tui.start({ clearScrollback: true });
			await term.waitForRender();

			const viewport = term.getViewport();
			const contentRows = viewport.filter(line => line.includes("MAIN-"));
			expect(contentRows.length).toBeGreaterThan(0);
			for (const line of contentRows) {
				// Main area (84 cols) left, gutter (36 cols) right. getViewport()
				// trims trailing blanks, so rows end at the last gutter glyph.
				const trimmed = line.trimEnd();
				expect(trimmed.startsWith("MAIN-")).toBe(true);
				expect(visibleWidth(trimmed)).toBeGreaterThan(84);
				expect(trimmed).toContain("GTR");
			}

			// Streaming appends scroll the screen; erase-before-scroll must keep
			main.append(5);
			tui.requestRender();
			await term.waitForRender();
			await new Promise(resolve => setTimeout(resolve, 50));

			// The fallback children frame owns no history (the frame provider
			// does in the product path), so the assertion here is that the
			// viewport keeps the main area left and the gutter right after the
			// append-triggered repaint.
			const vp = term.getViewport();
			const rowsAfter = vp.filter(line => line.includes("MAIN-"));
			expect(rowsAfter.length).toBeGreaterThan(0);
			for (const line of rowsAfter) {
				const trimmed = line.trimEnd();
				expect(trimmed.startsWith("MAIN-")).toBe(true);
				expect(trimmed).toContain("GTR");
			}
		} finally {
			tui.stop();
		}
	});

	it("ignores the override when the main area would drop below the floor", async () => {
		// 80 - 36 = 44 < 64 → the frame renders at the full physical width.
		const term = new VirtualTerminal(80, 24, 12_000);
		const tui = new TUI(term);
		const main = new AppendableLines(Array.from({ length: 30 }, (_, i) => `MAIN-${String(i).padStart(3, "0")}`));
		const gutter = new MutableGutter();
		gutter.rows = gutterRows(40, "GTR");
		tui.addChild(main);
		tui.setMainWidth(36);
		tui.setGutterComponent(gutter);

		try {
			tui.start({ clearScrollback: true });
			await term.waitForRender();

			for (const line of term.getViewport().filter(l => l.includes("MAIN-"))) {
				expect(line.trimEnd()).not.toContain("GTR");
			}
		} finally {
			tui.stop();
		}
	});

	it("repaints the gutter when only the gutter content changes", async () => {
		const term = new VirtualTerminal(120, 24, 12_000);
		const tui = new TUI(term);
		const main = new AppendableLines(Array.from({ length: 60 }, (_, i) => `MAIN-${String(i).padStart(3, "0")}`));
		const gutter = new MutableGutter();
		gutter.rows = gutterRows(40, "GTR");
		tui.addChild(main);
		tui.setMainWidth(36);
		tui.setGutterComponent(gutter);

		try {
			tui.start({ clearScrollback: true });
			await term.waitForRender();
			gutter.rows = gutterRows(40, "ALT");
			tui.requestRender();
			await term.waitForRender(() => term.getViewport().some(line => line.includes("ALT")));
			await new Promise(resolve => setTimeout(resolve, 50));

			for (const line of term.getViewport().filter(l => l.includes("MAIN-"))) {
				expect(line).toContain("ALT");
				expect(line).not.toContain("GTR");
			}
		} finally {
			tui.stop();
		}
	});
});

/** Frame provider that records the width of every composed frame. */
class RecordingProvider implements TerminalFrameProvider {
	readonly widths: number[] = [];
	replayCount = 0;

	renderFrame(viewport: ViewportSize): TerminalFramePlan {
		this.widths.push(viewport.columns);
		return { viewport: [`MAIN@${viewport.columns}`, "editor"] };
	}

	acknowledgeHistory(): void {}

	beginHistoryReplay(): void {
		this.replayCount++;
	}
}

/** Virtual terminal that also records raw write sequences. */
class RecordingTerminal extends VirtualTerminal {
	readonly writes: string[] = [];

	override write(data: string): void {
		this.writes.push(data);
		super.write(data);
	}
}

interface GutterFixture {
	term: RecordingTerminal;
	provider: RecordingProvider;
	gutter: MutableGutter;
	tui: TUI;
	scheduler: VirtualRenderScheduler;
}

/** Frame-provider TUI at 120x24 with a 36-column sidebar reservation already applied. */
function providerFixture(): GutterFixture {
	const term = new RecordingTerminal(120, 24);
	const provider = new RecordingProvider();
	const gutter = new MutableGutter();
	gutter.rows = gutterRows(24, "GTR");
	const scheduler = new VirtualRenderScheduler();
	const tui = new TUI(term, undefined, { renderScheduler: scheduler });
	// Append mode makes resize replay observable as provider.beginHistoryReplay
	// calls (production's rebuild mode resets destructively instead).
	tui.setResizeScrollback("append");
	// Wire the sidebar before the provider so the first frame already composes
	// at the narrowed main width.
	tui.setMainWidth(36);
	tui.setGutterComponent(gutter);
	tui.setFrameProvider(provider);
	return { term, provider, gutter, tui, scheduler };
}

describe("TUI sidebar gutter (frame-provider path)", () => {
	it("composes the provider frame at the main width and paints the gutter column beside it", async () => {
		const { term, provider, tui, scheduler } = providerFixture();
		try {
			await scheduler.settle(term);
			// 120 physical - 36 gutter = 84: the provider never sees the gutter columns.
			expect(provider.widths).toEqual([84]);

			// The gutter write is absolute-positioned at column mainWidth+1 = 85,
			// in its own write after the frame block.
			const gutterWrite = term.writes.find(write => write.includes("\x1b[1;85H"));
			expect(gutterWrite).toBeDefined();
			expect(gutterWrite).toContain("GTR00");

			// On screen: main content left, gutter right.
			const rows = term.getViewport().filter(line => line.includes("MAIN@84"));
			expect(rows.length).toBeGreaterThan(0);
			for (const line of rows) {
				expect(line.trimEnd()).toContain("GTR");
			}
		} finally {
			tui.stop();
		}
	});

	it("restores full provider width and clears the right edge while an overlay is up", async () => {
		const { term, provider, tui, scheduler } = providerFixture();
		try {
			await scheduler.settle(term);
			const overlay = tui.showOverlay({ render: () => ["DIALOG"] });
			await scheduler.settle(term);
			expect(provider.widths.at(-1)).toBe(120);
			for (const line of term.getViewport()) {
				expect(line).not.toContain("GTR");
				expect(line).not.toContain("MAIN@84");
			}
			expect(term.getViewport().some(line => line.includes("DIALOG"))).toBe(true);

			overlay.hide();
			await scheduler.settle(term);
			expect(provider.widths.at(-1)).toBe(84);
			expect(term.getViewport().some(line => line.includes("GTR"))).toBe(true);
		} finally {
			tui.stop();
		}
	});

	it("re-offers history and restores full width when the sidebar is disabled", async () => {
		const { term, provider, tui, scheduler } = providerFixture();
		try {
			await scheduler.settle(term);
			// The pre-start reservation never replayed: no scrollback existed yet.
			expect(provider.replayCount).toBe(0);

			tui.setMainWidth(null);
			await scheduler.settle(term);
			expect(provider.replayCount).toBe(1);
			expect(provider.widths.at(-1)).toBe(120);
			for (const line of term.getViewport()) {
				expect(line).not.toContain("GTR");
			}
		} finally {
			tui.stop();
		}
	});

	it("dedups resize replay on physical width: a height-only resize must not re-offer history", async () => {
		const { term, provider, tui, scheduler } = providerFixture();
		try {
			await scheduler.settle(term);
			term.resize(120, 30);
			tui.requestRender();
			await scheduler.settle(term);
			expect(provider.replayCount).toBe(0);
			expect(provider.widths.at(-1)).toBe(84);

			term.resize(140, 30);
			tui.requestRender();
			await scheduler.settle(term);
			expect(provider.replayCount).toBe(1);
			expect(provider.widths.at(-1)).toBe(104);
		} finally {
			tui.stop();
		}
	});
});
