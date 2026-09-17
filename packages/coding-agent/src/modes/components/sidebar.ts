/**
 * Right-hand sidebar rendered into the TUI's gutter column (see
 * `TUI.setGutterComponent`). Owns an ordered registry of sidebar widgets: the
 * four built-ins (context gauge, todo/plan progress, detached subagents, and
 * MCP server health) plus any third-party widgets extensions register through
 * `ctx.ui.registerSidebarWidget`. Every widget reads synchronous getters per
 * frame (never IO) and is skipped when it renders nothing; adjacent widgets
 * are separated by the dim rule. The Model, Usage, and Git rows stay owned by
 * the status line.
 */
import { type Component, Ellipsis, truncateToWidth } from "@linxiraos/pi-tui";
import { pluralize } from "@linxiraos/pi-utils";
import { settings } from "../../config/settings";
import type { SidebarWidget } from "../../extensibility/extensions";
import { isClosedTodo, selectCollapsedTodos, type TodoItem, type TodoPhase } from "../../tools/todo";
import { type ThemeColor, theme } from "../theme/theme";
import type { ObservableSession } from "../session-observer-registry";
import type { StatusLineComponent } from "./status-line/component";
import type { SegmentContext } from "./status-line/types";

/** Fixed sidebar width in columns (v1: no drag resize). */
export const SIDEBAR_WIDTH = 36;

export type { SidebarWidget };

/** Session data the sidebar's built-in widgets read; structurally satisfied by AgentSession. */
export interface SidebarSessionSource {
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

/** Truncate to the gutter width first, then colorize, so escapes stay balanced. */
function fit(text: string, w: number, color: ThemeColor): string {
	return theme.fg(color, truncateToWidth(text, w, Ellipsis.Omit));
}

function subagentDot(session: ObservableSession): string {
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

function todoLine(todo: TodoItem, w: number): string {
	const box = todo.status === "completed" ? theme.checkbox.checked : theme.checkbox.unchecked;
	let text = `${box} ${todo.content}`;
	if (todo.status === "blocked") text += " (blocked)";
	switch (todo.status) {
		case "completed":
			return fit(text, w, "success");
		case "in_progress":
			return fit(text, w, "accent");
		case "abandoned":
			return fit(text, w, "error");
		case "blocked":
			return fit(text, w, "warning");
		default:
			return fit(text, w, "dim");
	}
}

/**
 * The four built-in widgets. `render` returns the widget's full rows — header
 * included when the widget has one — and an empty array hides the widget for
 * that frame. Orders space them below any future built-in so third-party
 * widgets sort deterministically by `order`, then id.
 */
function createBuiltinWidgets(sources: SidebarSources): SidebarWidget[] {
	return [
		{
			id: "context",
			title: "Context",
			order: 0,
			render: (ctx, w) => {
				const pct = ctx.contextPercent;
				if (pct === null || !ctx.contextWindow) return [];
				// Single compact gauge row: the sidebar is the gauge's primary display
				// (the status line compresses it), but token totals stay status-line-only.
				const gaugeCells = 10;
				const filled = Math.max(0, Math.min(gaugeCells, Math.round((pct / 100) * gaugeCells)));
				const gauge = `${"▰".repeat(filled)}${"▱".repeat(gaugeCells - filled)}`;
				return [fit(`${theme.icon.context} ${gauge} ${Math.round(pct)}%`, w, "muted")];
			},
		},
		{
			id: "todos",
			title: "Todos",
			order: 10,
			render: (ctx, w) => {
				const phases = sources.session.getTodoPhases().filter(phase => phase.tasks.length > 0);
				if (phases.length === 0) return [];
				const total = phases.reduce((sum, phase) => sum + phase.tasks.length, 0);
				const closed = phases.reduce((sum, phase) => sum + phase.tasks.filter(isClosedTodo).length, 0);
				const planMode = ctx.planMode?.enabled === true;
				const header = `${theme.icon.plan} ${planMode ? "Plan Mode" : "Todos"} · ${closed}/${total}`;
				const rows = [fit(header, w, planMode ? "accent" : "muted")];
				// Preview the phase holding the current work: the one with an in-flight
				// task, else the first with open work, else the last phase.
				const active =
					phases.find(phase => phase.tasks.some(task => task.status === "in_progress")) ??
					phases.find(phase => phase.tasks.some(task => !isClosedTodo(task))) ??
					phases[phases.length - 1];
				if (!active) return rows;
				const selection = selectCollapsedTodos(active.tasks, () => false, TODO_ROW_LIMIT);
				for (const task of selection.items) rows.push(todoLine(task, w));
				if (selection.summary) rows.push(fit(selection.summary, w, "dim"));
				return rows;
			},
		},
		{
			id: "subagents",
			title: "Subagents",
			order: 20,
			render: (_ctx, w) => {
				const provider = sources.subagents;
				if (!provider) return [];
				const subs = provider().filter(session => session.kind === "subagent");
				if (subs.length === 0) return [];
				const running = subs.filter(session => session.status === "active").length;
				const rows = [fit(`${theme.icon.agents} Subagents · ${running}/${subs.length} running`, w, "muted")];
				// Active work first so a long completed tail cannot hide it, then the
				// registry's spawn order for the rest, capped at the row limit.
				const ordered = [...subs.filter(s => s.status === "active"), ...subs.filter(s => s.status !== "active")];
				for (const session of ordered.slice(0, SUBAGENT_ROW_LIMIT)) {
					rows.push(fit(`${subagentDot(session)} ${session.label}`, w, "dim"));
				}
				return rows;
			},
		},
		{
			id: "mcp",
			title: "MCP",
			order: 30,
			render: (_ctx, w) => {
				const mcp = sources.mcp;
				if (!mcp) return [];
				const connected = mcp.connected.size;
				const pending = mcp.pending.size;
				const failed = mcp.failed.size;
				const total = connected + pending + failed;
				if (total === 0) return [];
				const rows = [fit(`${theme.icon.extensionMcp} MCP · ${total} ${pluralize("server", total)}`, w, "muted")];
				const groups: string[] = [];
				if (connected > 0) groups.push(`${theme.styledSymbol("status.success", "success")}${connected}`);
				if (pending > 0) groups.push(`${theme.styledSymbol("status.pending", "warning")}${pending}`);
				if (failed > 0) groups.push(`${theme.styledSymbol("status.error", "error")}${failed}`);
				rows.push(truncateToWidth(groups.join("  "), w, Ellipsis.Omit));
				return rows;
			},
		},
	];
}

interface RegisteredWidget {
	widget: SidebarWidget;
	/** Built-ins ignore the `tui.sidebar.widgets` gate. */
	builtin: boolean;
}

export class SidebarComponent implements Component {
	readonly #sources: SidebarSources;
	#widgets = new Map<string, RegisteredWidget>();

	constructor(sources: SidebarSources) {
		this.#sources = sources;
		for (const widget of createBuiltinWidgets(sources)) {
			this.#widgets.set(widget.id, { widget, builtin: true });
		}
	}

	/**
	 * Register a third-party widget (extension API via `ctx.ui`). Registration
	 * is synchronous and re-registering an id replaces the previous widget;
	 * `render` runs synchronously on every frame the sidebar draws, so it must
	 * never perform IO. Third-party widgets render only while the
	 * `tui.sidebarWidgets` setting is on; the built-ins are unaffected.
	 */
	registerWidget(widget: SidebarWidget): void {
		this.#widgets.set(widget.id, { widget, builtin: false });
	}

	/** Remove a previously registered widget; unknown ids are ignored. */
	unregisterWidget(id: string): void {
		this.#widgets.delete(id);
	}

	render(width: number): readonly string[] {
		const w = Math.max(12, width);
		const ctx = this.#sources.statusLine.getSidebarContext(w);
		const thirdPartyAllowed = settings.get("tui.sidebarWidgets");
		const widgets = [...this.#widgets.values()]
			.filter(entry => entry.builtin || thirdPartyAllowed)
			.map(entry => entry.widget)
			.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
		const separator = theme.fg("dim", "─".repeat(w));
		const rows: string[] = [];
		for (const widget of widgets) {
			let rendered: readonly string[];
			try {
				rendered = widget.render(ctx, w);
			} catch {
				// A throwing third-party widget must not take down the frame;
				// skip its rows for this render.
				continue;
			}
			if (rendered.length === 0) continue;
			if (rows.length > 0) rows.push(separator);
			rows.push(...rendered);
		}
		return rows;
	}

	invalidate(): void {}
}
