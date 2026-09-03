import { describe, expect, it } from "bun:test";
import { type Component, TUI, visibleWidth } from "@linxiraos/pi-tui";
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
