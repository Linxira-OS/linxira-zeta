/**
 * Right-hand sidebar rendered into the TUI's gutter column (see
 * `TUI.setGutterComponent`). Surfaces session state the single status row
 * cannot show: a session header, the context gauge, todo/plan progress,
 * detached subagents, and MCP server health. Every panel reads synchronous
 * getters per frame (never IO) and hides itself when empty; the Model, Usage,
 * and Git rows stay owned by the status line.
 */
import { type Component, Ellipsis, truncateToWidth } from "@linxiraos/pi-tui";
import { formatDuration, pluralize } from "@linxiraos/pi-utils";
import { type ThemeColor, theme } from "../../modes/theme/theme";
import { isClosedTodo, selectCollapsedTodos, type TodoItem, type TodoPhase } from "../../tools/todo";
import type { ObservableSession } from "../session-observer-registry";
import type { StatusLineComponent } from "./status-line/component";
import type { SegmentContext } from "./status-line/types";

/** Fixed sidebar width in columns (v1: no drag resize). */
export const SIDEBAR_WIDTH = 36;

/** Session data the sidebar reads; structurally satisfied by AgentSession. */
export interface SidebarSessionSource {
	/** Display name when the session has one, undefined otherwise. */
	readonly sessionName: string | undefined;
	readonly sessionId: string;
	/** Current todo phases, synced by the todo tool. */
	getTodoPhases(): TodoPhase[];
}

/** Read-only MCP server health sets, filled by the interactive mode's event wiring. */
export interface SidebarMcpSource {
	pending: ReadonlySet<string>;
	connected: ReadonlySet<string>;
	failed: ReadonlyMap<string, unknown>;
}

/** Data sources injected at construction; every read is a synchronous getter. */
export interface SidebarSources {
	/** Sidebar context provider: the same segment context the status bar builds. */
	statusLine: Pick<StatusLineComponent, "getSidebarContext">;
	session: SidebarSessionSource;
	/** Detached-subagent registry snapshot provider. */
	subagents?: () => ObservableSession[];
	/** Live MCP server health sets. */
	mcp?: SidebarMcpSource;
}

/** Subagent rows shown before the panel truncates (HUD-visible-limit precedent). */
const SUBAGENT_ROW_LIMIT = 8;
/** Todo rows previewed for the phase holding the current work. */
const TODO_ROW_LIMIT = 4;
/** First active duration cell; mirrors the status line's time_spent segment. */
const ACTIVE_MS_FLOOR = 1000;

export class SidebarComponent implements Component {
	constructor(private readonly sources: SidebarSources) {}

	render(width: number): readonly string[] {
		const w = Math.max(12, width);
		const ctx = this.sources.statusLine.getSidebarContext(w);
		const panels: string[][] = [];
		for (const panel of [
			this.#sessionRows(ctx, w),
			this.#contextRows(ctx, w),
			this.#todoRows(ctx, w),
			this.#subagentRows(w),
			this.#mcpRows(w),
		]) {
			if (panel.length > 0) panels.push(panel);
		}
		const separator = theme.fg("dim", "─".repeat(w));
		const rows: string[] = [];
		for (const panel of panels) {
			if (rows.length > 0) rows.push(separator);
			rows.push(...panel);
		}
		return rows;
	}

	invalidate(): void {}

	/** Truncate to the gutter width first, then colorize, so escapes stay balanced. */
	#fit(text: string, w: number, color: ThemeColor): string {
		return theme.fg(color, truncateToWidth(text, w, Ellipsis.Omit));
	}

	#sessionRows(ctx: SegmentContext, w: number): string[] {
		const { session } = this.sources;
		const name = session.sessionName ?? session.sessionId?.slice(0, 8) ?? "new session";
		const rows = [this.#fit(`${theme.icon.session} ${name}`, w, "text")];
		if (ctx.activeMs >= ACTIVE_MS_FLOOR) {
			rows.push(this.#fit(`${theme.icon.time} ${formatDuration(ctx.activeMs)}`, w, "dim"));
		}
		return rows;
	}

	#contextRows(ctx: SegmentContext, w: number): string[] {
		const pct = ctx.contextPercent;
		if (pct === null || !ctx.contextWindow) return [];
		// Single compact gauge row: the sidebar is the gauge's primary display
		// (the status line compresses it), but token totals stay status-line-only.
		const gaugeCells = 10;
		const filled = Math.max(0, Math.min(gaugeCells, Math.round((pct / 100) * gaugeCells)));
		const gauge = `${"▰".repeat(filled)}${"▱".repeat(gaugeCells - filled)}`;
		return [this.#fit(`${theme.icon.context} ${gauge} ${Math.round(pct)}%`, w, "muted")];
	}

	#todoRows(ctx: SegmentContext, w: number): string[] {
		const phases = this.sources.session.getTodoPhases().filter(phase => phase.tasks.length > 0);
		if (phases.length === 0) return [];
		const total = phases.reduce((sum, phase) => sum + phase.tasks.length, 0);
		const closed = phases.reduce((sum, phase) => sum + phase.tasks.filter(isClosedTodo).length, 0);
		const planMode = ctx.planMode?.enabled === true;
		const header = `${theme.icon.plan} ${planMode ? "Plan Mode" : "Todos"} · ${closed}/${total}`;
		const rows = [this.#fit(header, w, planMode ? "accent" : "muted")];
		// Preview the phase holding the current work: the one with an in-flight
		// task, else the first with open work, else the last phase.
		const active =
			phases.find(phase => phase.tasks.some(task => task.status === "in_progress")) ??
			phases.find(phase => phase.tasks.some(task => !isClosedTodo(task))) ??
			phases[phases.length - 1];
		if (!active) return rows;
		const selection = selectCollapsedTodos(active.tasks, () => false, TODO_ROW_LIMIT);
		for (const task of selection.items) rows.push(this.#todoLine(task, w));
		if (selection.summary) rows.push(this.#fit(selection.summary, w, "dim"));
		return rows;
	}

	#todoLine(todo: TodoItem, w: number): string {
		const box = todo.status === "completed" ? theme.checkbox.checked : theme.checkbox.unchecked;
		let text = `${box} ${todo.content}`;
		if (todo.status === "blocked") text += " (blocked)";
		switch (todo.status) {
			case "completed":
				return this.#fit(text, w, "success");
			case "in_progress":
				return this.#fit(text, w, "accent");
			case "abandoned":
				return this.#fit(text, w, "error");
			case "blocked":
				return this.#fit(text, w, "warning");
			default:
				return this.#fit(text, w, "dim");
		}
	}

	#subagentRows(w: number): string[] {
		const provider = this.sources.subagents;
		if (!provider) return [];
		const subs = provider().filter(session => session.kind === "subagent");
		if (subs.length === 0) return [];
		const running = subs.filter(session => session.status === "active").length;
		const rows = [this.#fit(`${theme.icon.agents} Subagents · ${running}/${subs.length} running`, w, "muted")];
		// Active work first so a long completed tail cannot hide it, then the
		// registry's spawn order for the rest, capped at the row limit.
		const ordered = [...subs.filter(s => s.status === "active"), ...subs.filter(s => s.status !== "active")];
		for (const session of ordered.slice(0, SUBAGENT_ROW_LIMIT)) {
			rows.push(this.#fit(`${this.#subagentDot(session)} ${session.label}`, w, "dim"));
		}
		return rows;
	}

	#subagentDot(session: ObservableSession): string {
		switch (session.status) {
			case "active":
				return theme.styledSymbol("status.running", "success");
			case "completed":
				return theme.styledSymbol("status.success", "muted");
			case "failed":
				return theme.styledSymbol("status.error", "error");
			case "aborted":
				return theme.styledSymbol("status.aborted", "dim");
		}
	}

	#mcpRows(w: number): string[] {
		const mcp = this.sources.mcp;
		if (!mcp) return [];
		const connected = mcp.connected.size;
		const pending = mcp.pending.size;
		const failed = mcp.failed.size;
		const total = connected + pending + failed;
		if (total === 0) return [];
		const rows = [this.#fit(`${theme.icon.extensionMcp} MCP · ${total} ${pluralize("server", total)}`, w, "muted")];
		const groups: string[] = [];
		if (connected > 0) groups.push(`${theme.styledSymbol("status.success", "success")}${connected}`);
		if (pending > 0) groups.push(`${theme.styledSymbol("status.pending", "warning")}${pending}`);
		if (failed > 0) groups.push(`${theme.styledSymbol("status.error", "error")}${failed}`);
		rows.push(truncateToWidth(groups.join("  "), w, Ellipsis.Omit));
		return rows;
	}
}
