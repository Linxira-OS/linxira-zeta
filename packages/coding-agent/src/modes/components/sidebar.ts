/**
 * Right-hand sidebar rendered into the TUI's gutter column (see
 * `TUI.setGutterComponent`). Four panels — Model, Context, Usage, Git —
 * computed fresh on every frame from the same {@link SegmentContext} the
 * status line renders from, so both surfaces always agree.
 */
import type { Component } from "@linxiraos/pi-tui";
import { formatNumber } from "@linxiraos/pi-utils";
import { theme } from "../../modes/theme/theme";
import type { StatusLineComponent } from "./status-line/component";
import type { SegmentContext } from "./status-line/types";

/** Fixed sidebar width in columns (v1: no drag resize). */
export const SIDEBAR_WIDTH = 36;

export class SidebarComponent implements Component {
	constructor(private readonly statusLine: StatusLineComponent) {}

	render(width: number): readonly string[] {
		const w = Math.max(20, width);
		const ctx = this.statusLine.getSidebarContext(w);
		return [
			this.#modelRow(ctx),
			theme.fg("dim", "─".repeat(w)),
			...this.#contextRows(ctx, w),
			this.#usageRow(ctx),
			this.#gitRow(ctx),
		];
	}

	invalidate(): void {}

	#modelRow(ctx: SegmentContext): string {
		const state = ctx.session.state;
		let name = state.model?.name || state.model?.id || "no model";
		if (name.startsWith("Claude ")) name = name.slice(7);
		return theme.fg("muted", `${theme.icon.model} ${name}`);
	}

	#contextRows(ctx: SegmentContext, w: number): string[] {
		const pct = ctx.contextPercent;
		const window = ctx.contextWindow;
		if (pct === null || !window) return [];
		const gaugeCells = 10;
		const filled = Math.max(0, Math.min(gaugeCells, Math.round((pct / 100) * gaugeCells)));
		const gauge = `${"▰".repeat(filled)}${"▱".repeat(gaugeCells - filled)}`;
		const head = `${theme.icon.context} ${gauge} ${Math.round(pct)}%`;
		const detail = `${formatNumber(ctx.contextTokens)} / ${formatNumber(window)} tok`;
		return [theme.fg("muted", head), theme.fg("dim", detail)].map(row => row.slice(0, w - 2));
	}

	#usageRow(ctx: SegmentContext): string {
		const { input, output, cost } = ctx.usageStats;
		if (!input && !output && !cost) return "";
		const parts = [`${theme.icon.input}${formatNumber(input)}`, `${theme.icon.output}${formatNumber(output)}`];
		if (cost) parts.push(`$${cost.toFixed(2)}`);
		return theme.fg("muted", parts.join(" "));
	}

	#gitRow(ctx: SegmentContext): string {
		const { branch, status } = ctx.git;
		if (!branch) return "";
		let text = `${theme.icon.branch}${branch}`;
		if (status) {
			const dirty = status.unstaged + status.staged + status.untracked;
			if (dirty > 0) text += ` *${dirty}`;
		}
		return theme.fg("statusLineGitClean", text);
	}
}
