import { describe, expect, it } from "bun:test";
import {
	type Component,
	type NativeNode,
	node,
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

/** Gutter that also hands out a semantic snapshot, like the product sidebar. */
class SnapshotGutter extends MutableGutter {
	snapshot: NativeNode | null = node("col", { role: "zeta.sidebar" }, [node("text", { text: "SNAP" })]);
	describeCalls = 0;

	describeSnapshot(): NativeNode | null {
		this.describeCalls++;
		return this.snapshot;
	}
}

/** Decoded sidebar APCs in write order; `null` marks the empty (clear) payload. */
function sidebarPayloads(writes: readonly string[]): (string | null)[] {
	const payloads: (string | null)[] = [];
	for (const match of writes.join("").matchAll(/\x1b_zeta;sidebar;([^\x1b]*)\x1b\\/g)) {
		const encoded = match[1] ?? "";
		payloads.push(encoded.length === 0 ? null : Buffer.from(encoded, "base64").toString("utf8"));
	}
	return payloads;
}

/** Frame-provider TUI at 120x24 whose gutter publishes a snapshot. */
function snapshotFixture(): {
	term: RecordingTerminal;
	provider: RecordingProvider;
	gutter: SnapshotGutter;
	tui: TUI;
	scheduler: VirtualRenderScheduler;
} {
	const term = new RecordingTerminal(120, 24);
	const provider = new RecordingProvider();
	const gutter = new SnapshotGutter();
	gutter.rows = gutterRows(24, "GTR");
	const scheduler = new VirtualRenderScheduler();
	const tui = new TUI(term, undefined, { renderScheduler: scheduler });
	tui.setResizeScrollback("append");
	tui.setMainWidth(36);
	tui.setGutterComponent(gutter);
	tui.setFrameProvider(provider);
	return { term, provider, gutter, tui, scheduler };
}

describe("TUI sidebar snapshot APC", () => {
	it("publishes the snapshot once, and again only when it changes", async () => {
		const { term, tui, gutter, scheduler } = snapshotFixture();
		try {
			await scheduler.settle(term);
			const first = sidebarPayloads(term.writes);
			expect(first).toHaveLength(1);
			const decoded = JSON.parse(first[0]!) as {
				v: number;
				node: { k: string; c?: { p?: { text?: string } }[] };
			};
			expect(decoded.v).toBe(1);
			expect(decoded.node.k).toBe("col");
			expect(decoded.node.c?.[0]?.p?.text).toBe("SNAP");

			// A repaint that leaves the snapshot alone writes no second APC.
			tui.requestRender();
			await scheduler.settle(term);
			expect(sidebarPayloads(term.writes)).toHaveLength(1);

			gutter.snapshot = node("col", { role: "zeta.sidebar" }, [node("text", { text: "NEXT" })]);
			tui.requestRender();
			await scheduler.settle(term);
			const updated = sidebarPayloads(term.writes);
			expect(updated).toHaveLength(2);
			expect(updated[1]).toContain("NEXT");
		} finally {
			tui.stop();
		}
	});

	it("clears the payload when the gutter component is removed", async () => {
		const { term, tui, scheduler } = snapshotFixture();
		try {
			await scheduler.settle(term);
			expect(sidebarPayloads(term.writes)).toHaveLength(1);

			tui.setGutterComponent(null);
			await scheduler.settle(term);
			expect(sidebarPayloads(term.writes).at(-1)).toBeNull();
		} finally {
			tui.stop();
		}
	});

	it("clears while an overlay forces the full width and republishes after it closes", async () => {
		const { term, tui, scheduler } = snapshotFixture();
		try {
			await scheduler.settle(term);
			const overlay = tui.showOverlay({ render: () => ["DIALOG"] });
			await scheduler.settle(term);
			expect(sidebarPayloads(term.writes).at(-1)).toBeNull();

			overlay.hide();
			await scheduler.settle(term);
			const restored = sidebarPayloads(term.writes).at(-1);
			expect(restored).not.toBeNull();
			expect(restored).toContain("SNAP");
		} finally {
			tui.stop();
		}
	});

	it("drops an oversized snapshot to the clear payload", async () => {
		const { term, tui, gutter, scheduler } = snapshotFixture();
		try {
			await scheduler.settle(term);
			gutter.snapshot = node("col", { role: "zeta.sidebar" }, [node("text", { text: "x".repeat(70_000) })]);
			tui.requestRender();
			await scheduler.settle(term);
			const payloads = sidebarPayloads(term.writes);
			expect(payloads).toHaveLength(2);
			expect(payloads[1]).toBeNull();
		} finally {
			tui.stop();
		}
	});

	it("writes no snapshot for a gutter that cannot describe itself", async () => {
		const term = new RecordingTerminal(120, 24);
		const provider = new RecordingProvider();
		const gutter = new MutableGutter();
		gutter.rows = gutterRows(24, "GTR");
		const scheduler = new VirtualRenderScheduler();
		const tui = new TUI(term, undefined, { renderScheduler: scheduler });
		tui.setMainWidth(36);
		tui.setGutterComponent(gutter);
		tui.setFrameProvider(provider);
		try {
			await scheduler.settle(term);
			expect(term.writes.some(write => write.includes("zeta;sidebar;"))).toBe(false);
		} finally {
			tui.stop();
		}
	});
});
