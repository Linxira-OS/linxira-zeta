/**
 * Right-hand sidebar rendered into the TUI's gutter column (see
 * `TUI.setGutterComponent`). Owns an ordered registry of sidebar widgets: the
 * five built-ins (context gauge, todo/plan progress, detached subagents, MCP
 * server health, and the cached Git panel) plus any third-party widgets
 * extensions register through `ctx.ui.registerSidebarWidget`. Every widget
 * reads synchronous getters per frame (never IO) and is skipped when it
 * renders nothing; adjacent widgets are separated by the dim rule. The Model
 * and Usage rows stay owned by the status line, whose Git segment remains the
 * compact branch/dirty readout.
 */
import { cfgTuiSidebarWidgets } from "../settings";
import {
	type Component,
	Ellipsis,
	type NativeNode,
	type NativeSnapshotSource,
	col as nativeCol,
	node as nativeNode,
	text as nativeText,
	truncateToWidth,
} from "@linxiraos/pi-tui";
import type { TspTone } from "@linxiraos/pi-wire";
import { pluralize } from "@linxiraos/pi-utils";
import { settings } from "../../config/settings";
import type { SidebarWidget } from "../../extensibility/extensions";
import { isClosedTodo, selectCollapsedTodos, type TodoItem, type TodoPhase } from "@linxiraos/pi-tui/tools/todo";
import { type ThemeColor, theme } from "@linxiraos/pi-tui/theme/theme";
import type { ObservableSession } from "@linxiraos/pi-tui/overlays/session-observer-registry";
import type { StatusLineComponent } from "@linxiraos/pi-tui/status-line/component";
import type { SegmentContext } from "@linxiraos/pi-tui/status-line/types";
import type { SidebarGitSnapshot } from "./sidebar-git";

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
	/** Cached Git snapshot provider; `null` hides the Git widget (no repo / error). */
	git?: () => SidebarGitSnapshot | null;
}

/** Subagent rows shown before the panel truncates (HUD-visible-limit precedent). */
const SUBAGENT_ROW_LIMIT = 8;
/** Todo rows previewed for the phase holding the current work. */
const TODO_ROW_LIMIT = 4;

/** Truncate to the gutter width first, then colorize, so escapes stay balanced. */
function fit(text: string, w: number, color: ThemeColor): string {
	return theme.fg(color, truncateToWidth(text, w, Ellipsis.Omit));
}

/**
 * ANSI/SGR removal for the rows of a widget that only knows how to `render`:
 * a native snapshot carries text, never escapes. Covers CSI sequences (the
 * colors, cursor moves and shadows `theme` emits).
 */
function stripAnsi(row: string): string {
	return row.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

/**
 * Whether a described tree is plain JSON. A `Component` child would not
 * survive the snapshot's serialization boundary, so the caller falls back to
 * the ANSI gutter instead of shipping a tree the native renderer cannot mount.
 */
function isPlainNode(described: NativeNode): boolean {
	for (const child of described.c ?? []) {
		if (!("k" in child) || !isPlainNode(child)) return false;
	}
	return true;
}

/**
 * Status glyph and colors of a detached subagent: the ANSI dot and the native
 * snapshot's tone come from one table, so both renderers stay in step.
 */
function subagentStatus(session: ObservableSession): { glyph: string; color: ThemeColor; tone: TspTone } {
	switch (session.status) {
		case "active":
			return { glyph: theme.symbol("status.running"), color: "success", tone: "success" };
		case "completed":
			return { glyph: theme.symbol("status.success"), color: "muted", tone: "muted" };
		case "failed":
			return { glyph: theme.symbol("status.error"), color: "error", tone: "error" };
		case "aborted":
			return { glyph: theme.symbol("status.aborted"), color: "dim", tone: "neutral" };
	}
}

function subagentDot(session: ObservableSession): string {
	const status = subagentStatus(session);
	return theme.fg(status.color, status.glyph);
}

/** The row's plain text: the status glyph plus the label, shared by both renderers. */
function subagentLabel(session: ObservableSession): string {
	return `${subagentStatus(session).glyph} ${session.label}`;
}

/** The task row's plain text: the ANSI row and the native snapshot share it. */
function todoLabel(todo: TodoItem): string {
	const box = todo.status === "completed" ? theme.checkbox.checked : theme.checkbox.unchecked;
	let label = `${box} ${todo.content}`;
	if (todo.status === "blocked") label += " (blocked)";
	return label;
}

/** Theme color of a task row in the ANSI gutter. */
function todoColor(status: TodoItem["status"]): ThemeColor {
	switch (status) {
		case "completed":
			return "success";
		case "in_progress":
			return "accent";
		case "abandoned":
			return "error";
		case "blocked":
			return "warning";
		default:
			return "dim";
	}
}

/** Semantic tone of the same row for a native renderer (`dim` has no tone; muted is closest). */
function todoTone(status: TodoItem["status"]): TspTone {
	switch (status) {
		case "completed":
			return "success";
		case "in_progress":
			return "accent";
		case "abandoned":
			return "error";
		case "blocked":
			return "warning";
		default:
			return "muted";
	}
}

function todoLine(todo: TodoItem, w: number): string {
	return fit(todoLabel(todo), w, todoColor(todo.status));
}

/** The context widget's compact gauge row, shared by the ANSI and native forms. */
function contextGaugeLine(ctx: SegmentContext): string | null {
	const pct = ctx.contextPercent;
	if (pct === null || !ctx.contextWindow) return null;
	// Single compact gauge row: the sidebar is the gauge's primary display
	// (the status line compresses it), but token totals stay status-line-only.
	const gaugeCells = 10;
	const filled = Math.max(0, Math.min(gaugeCells, Math.round((pct / 100) * gaugeCells)));
	const gauge = `${"▰".repeat(filled)}${"▱".repeat(gaugeCells - filled)}`;
	return `${theme.icon.context} ${gauge} ${Math.round(pct)}%`;
}

/** The todo panel's frame data: header, the previewed tasks and the clamp summary. */
function todoPanel(
	phases: readonly TodoPhase[],
	ctx: SegmentContext,
): { header: string; planMode: boolean; tasks: readonly TodoItem[]; summary?: string } | null {
	if (phases.length === 0) return null;
	const total = phases.reduce((sum, phase) => sum + phase.tasks.length, 0);
	const closed = phases.reduce((sum, phase) => sum + phase.tasks.filter(isClosedTodo).length, 0);
	const planMode = ctx.planMode?.enabled === true;
	const header = `${theme.icon.plan} ${planMode ? "Plan Mode" : "Todos"} · ${closed}/${total}`;
	// Preview the phase holding the current work: the one with an in-flight
	// task, else the first with open work, else the last phase.
	const active =
		phases.find(phase => phase.tasks.some(task => task.status === "in_progress")) ??
		phases.find(phase => phase.tasks.some(task => !isClosedTodo(task))) ??
		phases[phases.length - 1];
	if (!active) return { header, planMode, tasks: [] };
	const selection = selectCollapsedTodos(active.tasks, () => false, TODO_ROW_LIMIT);
	return { header, planMode, tasks: selection.items, summary: selection.summary };
}

/** The subagent panel's frame data: the running/total header and the rows it shows. */
function subagentPanel(provider: (() => ObservableSession[]) | undefined): {
	header: string;
	rows: readonly ObservableSession[];
} | null {
	if (!provider) return null;
	const subs = provider().filter(session => session.kind === "subagent");
	if (subs.length === 0) return null;
	const running = subs.filter(session => session.status === "active").length;
	// Active work first so a long completed tail cannot hide it, then the
	// registry's spawn order for the rest, capped at the row limit.
	const ordered = [...subs.filter(s => s.status === "active"), ...subs.filter(s => s.status !== "active")];
	return {
		header: `${theme.icon.agents} Subagents · ${running}/${subs.length} running`,
		rows: ordered.slice(0, SUBAGENT_ROW_LIMIT),
	};
}

/** One MCP health count: the glyph is styled per renderer, the count stays plain. */
interface McpCount {
	glyph: string;
	color: ThemeColor;
	count: number;
}

/** The MCP panel's frame data: the server total and one count per health state. */
function mcpPanel(mcp: SidebarMcpSource | undefined): { header: string; counts: readonly McpCount[] } | null {
	if (!mcp) return null;
	const connected = mcp.connected.size;
	const pending = mcp.pending.size;
	const failed = mcp.failed.size;
	const total = connected + pending + failed;
	if (total === 0) return null;
	const counts: McpCount[] = [];
	if (connected > 0) counts.push({ glyph: theme.symbol("status.success"), color: "success", count: connected });
	if (pending > 0) counts.push({ glyph: theme.symbol("status.pending"), color: "warning", count: pending });
	if (failed > 0) counts.push({ glyph: theme.symbol("status.error"), color: "error", count: failed });
	return { header: `${theme.icon.extensionMcp} MCP · ${total} ${pluralize("server", total)}`, counts };
}

/** One Git working-tree count (`+staged`, `*unstaged`, `?untracked`). */
interface GitCount {
	label: string;
	color: ThemeColor;
}

/** The Git panel's frame data: branch header, working-tree counts and recent commits. */
function gitPanel(snapshot: SidebarGitSnapshot): {
	header: string;
	counts: readonly GitCount[];
	commits: SidebarGitSnapshot["commits"];
} {
	const header: string[] = [`${theme.icon.branch} ${snapshot.branch ?? "detached"}`];
	if (snapshot.ahead > 0) header.push(`↑${snapshot.ahead}`);
	if (snapshot.behind > 0) header.push(`↓${snapshot.behind}`);
	const counts: GitCount[] = [];
	if (snapshot.staged > 0) counts.push({ label: `+${snapshot.staged}`, color: "statusLineStaged" });
	if (snapshot.unstaged > 0) counts.push({ label: `*${snapshot.unstaged}`, color: "statusLineDirty" });
	if (snapshot.untracked > 0) counts.push({ label: `?${snapshot.untracked}`, color: "statusLineUntracked" });
	return { header: header.join(" "), counts, commits: snapshot.commits };
}

/**
 * The five built-in widgets. `render` returns the widget's full rows — header
 * included when the widget has one — and an empty array hides the widget for
 * that frame. `describe` is the same content as plain TSP nodes for a native
 * renderer. Orders space them below any future built-in so third-party
 * widgets sort deterministically by `order`, then id.
 */
function createBuiltinWidgets(sources: SidebarSources): SidebarWidget[] {
	return [
		{
			id: "context",
			title: "Context",
			order: 0,
			render: (ctx, w) => {
				const line = contextGaugeLine(ctx);
				return line === null ? [] : [fit(line, w, "muted")];
			},
			describe: (ctx, _width) => {
				const line = contextGaugeLine(ctx);
				return line === null ? null : nativeText(line, { role: "zeta.sidebar.context", tone: "muted" });
			},
		},
		{
			id: "todos",
			title: "Todos",
			order: 10,
			render: (ctx, w) => {
				const panel = todoPanel(
					sources.session.getTodoPhases().filter(phase => phase.tasks.length > 0),
					ctx,
				);
				if (!panel) return [];
				const rows = [fit(panel.header, w, panel.planMode ? "accent" : "muted")];
				for (const task of panel.tasks) rows.push(todoLine(task, w));
				if (panel.summary) rows.push(fit(panel.summary, w, "dim"));
				return rows;
			},
			describe: (ctx, _width) => {
				const panel = todoPanel(
					sources.session.getTodoPhases().filter(phase => phase.tasks.length > 0),
					ctx,
				);
				if (!panel) return null;
				const children: NativeNode[] = [
					nativeText(panel.header, {
						role: "zeta.sidebar.todos.header",
						tone: panel.planMode ? "accent" : "muted",
					}),
				];
				for (const task of panel.tasks) {
					children.push(
						nativeText(todoLabel(task), { role: "zeta.sidebar.todos.item", tone: todoTone(task.status) }),
					);
				}
				if (panel.summary) {
					children.push(nativeText(panel.summary, { role: "zeta.sidebar.todos.summary", tone: "muted" }));
				}
				return nativeCol(children, { role: "zeta.sidebar.todos" });
			},
		},
		{
			id: "subagents",
			title: "Subagents",
			order: 20,
			render: (_ctx, w) => {
				const panel = subagentPanel(sources.subagents);
				if (!panel) return [];
				const rows = [fit(panel.header, w, "muted")];
				for (const session of panel.rows) rows.push(fit(`${subagentDot(session)} ${session.label}`, w, "dim"));
				return rows;
			},
			describe: (_ctx, _width) => {
				const panel = subagentPanel(sources.subagents);
				if (!panel) return null;
				const children: NativeNode[] = [
					nativeText(panel.header, { role: "zeta.sidebar.subagents.header", tone: "muted" }),
				];
				for (const session of panel.rows) {
					children.push(
						nativeText(subagentLabel(session), {
							role: "zeta.sidebar.subagents.item",
							tone: subagentStatus(session).tone,
						}),
					);
				}
				return nativeCol(children, { role: "zeta.sidebar.subagents" });
			},
		},
		{
			id: "mcp",
			title: "MCP",
			order: 30,
			render: (_ctx, w) => {
				const panel = mcpPanel(sources.mcp);
				if (!panel) return [];
				const rows = [fit(panel.header, w, "muted")];
				const groups = panel.counts.map(entry => `${theme.fg(entry.color, entry.glyph)}${entry.count}`);
				rows.push(truncateToWidth(groups.join("  "), w, Ellipsis.Omit));
				return rows;
			},
			describe: (_ctx, _width) => {
				const panel = mcpPanel(sources.mcp);
				if (!panel) return null;
				// One counts row, not one node per health state: a native line carries
				// a single tone, so the distinct glyphs carry the state instead.
				const counts = panel.counts.map(entry => `${entry.glyph}${entry.count}`).join("  ");
				return nativeCol(
					[
						nativeText(panel.header, { role: "zeta.sidebar.mcp.header", tone: "muted" }),
						nativeText(counts, { role: "zeta.sidebar.mcp.counts", tone: "muted" }),
					],
					{ role: "zeta.sidebar.mcp" },
				);
			},
		},
		{
			id: "git",
			title: "Git",
			order: 40,
			render: (_ctx, w) => {
				const snapshot = sources.git?.();
				if (!snapshot) return [];
				const panel = gitPanel(snapshot);
				const rows = [
					fit(panel.header, w, "muted"),
					panel.counts.length > 0
						? truncateToWidth(
								panel.counts.map(entry => theme.fg(entry.color, entry.label)).join(" "),
								w,
								Ellipsis.Omit,
							)
						: fit("clean", w, "dim"),
				];
				for (const commit of panel.commits) {
					rows.push(fit(`${commit.shortSha} ${commit.age} ${commit.subject}`, w, "dim"));
				}
				return rows;
			},
			describe: (_ctx, _width) => {
				const snapshot = sources.git?.();
				if (!snapshot) return null;
				const panel = gitPanel(snapshot);
				const children: NativeNode[] = [
					nativeText(panel.header, { role: "zeta.sidebar.git.header", tone: "muted" }),
					nativeText(panel.counts.map(entry => entry.label).join(" ") || "clean", {
						role: "zeta.sidebar.git.count",
						tone: panel.counts.length > 0 ? "warning" : "muted",
					}),
				];
				for (const commit of panel.commits) {
					children.push(
						nativeText(`${commit.shortSha} ${commit.age} ${commit.subject}`, {
							role: "zeta.sidebar.git.commit",
							tone: "muted",
						}),
					);
				}
				return nativeCol(children, { role: "zeta.sidebar.git" });
			},
		},
	];
}

interface RegisteredWidget {
	widget: SidebarWidget;
	/** Built-ins ignore the `tui.sidebar.widgets` gate. */
	builtin: boolean;
}

export class SidebarComponent implements Component, NativeSnapshotSource {
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

	/** Widgets drawn this frame, ordered: built-ins always, third-party by setting. */
	#sortedWidgets(): SidebarWidget[] {
		const thirdPartyAllowed = cfgTuiSidebarWidgets.get(settings);
		return [...this.#widgets.values()]
			.filter(entry => entry.builtin || thirdPartyAllowed)
			.map(entry => entry.widget)
			.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	}

	render(width: number): readonly string[] {
		const w = Math.max(12, width);
		const ctx = this.#sources.statusLine.getSidebarContext(w);
		const separator = theme.fg("dim", "─".repeat(w));
		const rows: string[] = [];
		for (const widget of this.#sortedWidgets()) {
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

	/**
	 * Semantic twin of {@link render} for an external native renderer: the same
	 * widget selection, ordering and separators as plain TSP nodes. A widget
	 * with `describe` contributes its own node; one without contributes its
	 * rendered rows stripped of ANSI. Returns null when nothing is visible, or
	 * when a described tree carries a component child that could not cross the
	 * snapshot's serialization boundary.
	 */
	describeSnapshot(): NativeNode | null {
		const width = SIDEBAR_WIDTH;
		const ctx = this.#sources.statusLine.getSidebarContext(width);
		const children: NativeNode[] = [];
		for (const widget of this.#sortedWidgets()) {
			let described: readonly NativeNode[];
			try {
				described = this.#describeWidget(widget, ctx, width);
			} catch {
				// Same contract as render: a throwing widget is skipped, not fatal.
				continue;
			}
			if (described.length === 0) continue;
			if (children.length > 0) {
				children.push(nativeNode("rule", { role: "zeta.sidebar.separator", tone: "muted" }));
			}
			children.push(...described);
		}
		if (children.length === 0) return null;
		for (const child of children) if (!isPlainNode(child)) return null;
		return nativeNode("col", { role: "zeta.sidebar", gap: "xs" }, children);
	}

	/** One widget's snapshot nodes; empty when the widget hides this frame. */
	#describeWidget(widget: SidebarWidget, ctx: SegmentContext, width: number): readonly NativeNode[] {
		if (widget.describe) {
			const described = widget.describe(ctx, width);
			return described === null ? [] : [described];
		}
		const nodes: NativeNode[] = [];
		for (const row of widget.render(ctx, width)) {
			const line = stripAnsi(row).trimEnd();
			if (line.length === 0) continue;
			nodes.push(nativeText(line, { role: `zeta.sidebar.widget.${widget.id}`, tone: "muted" }));
		}
		return nodes;
	}

	invalidate(): void {}
}
