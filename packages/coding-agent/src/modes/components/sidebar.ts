/**
 * Sidebar widget model: the ordered registry of sidebar panels (context gauge,
 * todo/plan progress, detached subagents, MCP server health and the cached Git
 * panel) plus any widgets a host registers at runtime.
 *
 * 19.2 has no gutter `Component`: a host places {@link SidebarComponent.build}'s
 * node tree in whatever slot it owns (a dock column, a panel). Every widget
 * reads synchronous getters per build (never IO) and is skipped when it renders
 * nothing; adjacent widgets are separated by a muted rule. The Model and Usage
 * rows stay owned by the status line.
 */
import { type JSXNode, UiNode } from "@linxiraos/pi-tui";
import { currentTheme } from "@linxiraos/pi-tui/theme/runtime";
import type { TspTone } from "@linxiraos/pi-wire";
import { pluralize } from "@linxiraos/pi-utils";
import { settings } from "../../config/settings";
import { isClosedTodo, selectCollapsedTodos, type TodoItem, type TodoPhase } from "../../tools/details/todo";
import type { ObservableSession } from "../../task/session-observer-registry";
import type { SegmentContext } from "../view-model/status-line/types";
import { cfgTuiSidebarWidgets } from "../settings";
import type { SidebarGitSnapshot } from "./sidebar-git";

/** Fixed sidebar width in columns (v1: no drag resize). */
export const SIDEBAR_WIDTH = 36;

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
	session: SidebarSessionSource;
	/** Detached-subagent registry snapshot provider. */
	subagents?: () => ObservableSession[];
	/** Live MCP server health sets. */
	mcp?: SidebarMcpSource;
	/** Cached Git snapshot provider; `null` hides the Git widget (no repo / error). */
	git?: () => SidebarGitSnapshot | null;
}

/**
 * One sidebar panel. `build` returns this frame's node tree, or `null` when the
 * widget has nothing to show. It runs synchronously on every frame, so it must
 * never perform IO.
 */
export interface SidebarWidget {
	readonly id: string;
	readonly title: string;
	/** Ordering among widgets; ties break by id. */
	readonly order: number;
	build(ctx: SegmentContext): JSXNode | null;
}

/** Subagent rows shown before a panel truncates (HUD-visible-limit precedent). */
const SUBAGENT_ROW_LIMIT = 8;
/** Todo rows previewed for the phase holding the current work. */
const TODO_ROW_LIMIT = 4;

/** A one-line panel row: native truncation handles the width. */
function row(text: string, tone: TspTone, role: string): UiNode {
	return new UiNode("text", { text, tone, role, truncate: "end" });
}

/** Status glyph and tone of a detached subagent. */
function subagentStatus(session: ObservableSession): { glyph: string; tone: TspTone } {
	const symbols = currentTheme().symbols;
	switch (session.status) {
		case "active":
			return { glyph: symbols.symbol("status.running"), tone: "success" };
		case "completed":
			return { glyph: symbols.symbol("status.success"), tone: "muted" };
		case "failed":
			return { glyph: symbols.symbol("status.error"), tone: "error" };
		case "aborted":
			return { glyph: symbols.symbol("status.aborted"), tone: "neutral" };
	}
}

/** The row's plain text: the status glyph plus the label and current activity. */
function subagentLabel(session: ObservableSession): string {
	const activity = session.progress?.currentTool ?? session.progress?.assignment ?? session.description;
	const suffix = activity === undefined || activity === "" ? "" : ` · ${activity}`;
	return `${subagentStatus(session).glyph} ${session.label}${suffix}`;
}

/** The task row's plain text. */
function todoLabel(todo: TodoItem): string {
	const symbols = currentTheme().symbols;
	const box = todo.status === "completed" ? symbols.symbol("checkbox.checked") : symbols.symbol("checkbox.unchecked");
	return `${box} ${todo.content}`;
}

/** Semantic tone of a task row. */
function todoTone(status: TodoItem["status"]): TspTone {
	switch (status) {
		case "completed":
			return "success";
		case "in_progress":
			return "accent";
		case "abandoned":
			return "error";
		default:
			return "muted";
	}
}

/** The context widget's compact gauge line, or null while the context is unknown. */
function contextGaugeLine(ctx: SegmentContext): string | null {
	const pct = ctx.contextPercent;
	if (pct === null || !ctx.contextWindow) return null;
	const gaugeCells = 10;
	const filled = Math.max(0, Math.min(gaugeCells, Math.round((pct / 100) * gaugeCells)));
	const gauge = `${"▰".repeat(filled)}${"▱".repeat(gaugeCells - filled)}`;
	return `${currentTheme().symbols.icon("context")} ${gauge} ${Math.round(pct)}%`;
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
	const symbols = currentTheme().symbols;
	const header = `${symbols.icon("plan")} ${planMode ? "Plan Mode" : "Todos"} · ${closed}/${total}`;
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
	const symbols = currentTheme().symbols;
	return {
		header: `${symbols.icon("agents")} Agents · ${running}/${subs.length} running`,
		rows: ordered.slice(0, SUBAGENT_ROW_LIMIT),
	};
}

/** One MCP health count. */
interface McpCount {
	glyph: string;
	tone: TspTone;
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
	const symbols = currentTheme().symbols;
	const counts: McpCount[] = [];
	if (connected > 0) counts.push({ glyph: symbols.symbol("status.success"), tone: "success", count: connected });
	if (pending > 0) counts.push({ glyph: symbols.symbol("status.pending"), tone: "warning", count: pending });
	if (failed > 0) counts.push({ glyph: symbols.symbol("status.error"), tone: "error", count: failed });
	return {
		header: `${symbols.icon("extensionMcp")} MCP · ${total} ${pluralize("server", total)}`,
		counts,
	};
}

/** One Git working-tree count (`+staged`, `*unstaged`, `?untracked`). */
interface GitCount {
	label: string;
	tone: TspTone;
}

/** The Git panel's frame data: branch header, working-tree counts and recent commits. */
function gitPanel(snapshot: SidebarGitSnapshot): {
	header: string;
	counts: readonly GitCount[];
	commits: SidebarGitSnapshot["commits"];
} {
	const header: string[] = [`${currentTheme().symbols.icon("branch")} ${snapshot.branch ?? "detached"}`];
	if (snapshot.ahead > 0) header.push(`↑${snapshot.ahead}`);
	if (snapshot.behind > 0) header.push(`↓${snapshot.behind}`);
	const counts: GitCount[] = [];
	if (snapshot.staged > 0) counts.push({ label: `+${snapshot.staged}`, tone: "success" });
	if (snapshot.unstaged > 0) counts.push({ label: `*${snapshot.unstaged}`, tone: "warning" });
	if (snapshot.untracked > 0) counts.push({ label: `?${snapshot.untracked}`, tone: "muted" });
	return { header: header.join(" "), counts, commits: snapshot.commits };
}

/** The five built-in widgets, as nodes. */
function createBuiltinWidgets(sources: SidebarSources): SidebarWidget[] {
	return [
		{
			id: "context",
			title: "Context",
			order: 0,
			build: ctx => {
				const line = contextGaugeLine(ctx);
				return line === null ? null : row(line, "muted", "zeta.sidebar.context");
			},
		},
		{
			id: "todos",
			title: "Todos",
			order: 10,
			build: ctx => {
				const panel = todoPanel(
					sources.session.getTodoPhases().filter(phase => phase.tasks.length > 0),
					ctx,
				);
				if (!panel) return null;
				const children: JSXNode[] = [
					row(panel.header, panel.planMode ? "accent" : "muted", "zeta.sidebar.todos.header"),
				];
				for (const task of panel.tasks) {
					children.push(row(todoLabel(task), todoTone(task.status), "zeta.sidebar.todos.item"));
				}
				if (panel.summary) children.push(row(panel.summary, "muted", "zeta.sidebar.todos.summary"));
				return new UiNode("col", { role: "zeta.sidebar.todos", children });
			},
		},
		{
			id: "subagents",
			title: "Subagents",
			order: 20,
			build: () => {
				const panel = subagentPanel(sources.subagents);
				if (!panel) return null;
				const children: JSXNode[] = [row(panel.header, "muted", "zeta.sidebar.subagents.header")];
				for (const session of panel.rows) {
					children.push(row(subagentLabel(session), subagentStatus(session).tone, "zeta.sidebar.subagents.item"));
				}
				return new UiNode("col", { role: "zeta.sidebar.subagents", children });
			},
		},
		{
			id: "mcp",
			title: "MCP",
			order: 30,
			build: () => {
				const panel = mcpPanel(sources.mcp);
				if (!panel) return null;
				const counts = panel.counts.map(entry => `${entry.glyph}${entry.count}`).join("  ");
				return new UiNode("col", {
					role: "zeta.sidebar.mcp",
					children: [
						row(panel.header, "muted", "zeta.sidebar.mcp.header"),
						row(counts, "muted", "zeta.sidebar.mcp.counts"),
					],
				});
			},
		},
		{
			id: "git",
			title: "Git",
			order: 40,
			build: () => {
				const snapshot = sources.git?.();
				if (!snapshot) return null;
				const panel = gitPanel(snapshot);
				const children: JSXNode[] = [
					row(panel.header, "muted", "zeta.sidebar.git.header"),
					row(
						panel.counts.map(entry => entry.label).join(" ") || "clean",
						panel.counts.length > 0 ? "warning" : "muted",
						"zeta.sidebar.git.count",
					),
				];
				for (const commit of panel.commits) {
					children.push(
						row(`${commit.shortSha} ${commit.age} ${commit.subject}`, "muted", "zeta.sidebar.git.commit"),
					);
				}
				return new UiNode("col", { role: "zeta.sidebar.git", children });
			},
		},
	];
}

interface RegisteredWidget {
	widget: SidebarWidget;
	/** Built-ins ignore the `tui.sidebar.widgets` gate. */
	builtin: boolean;
}

/**
 * The sidebar's widget registry and node builder. A host renders
 * {@link build} into its own slot; the tree is plain TSP nodes.
 */
export class SidebarComponent {
	readonly #sources: SidebarSources;
	#widgets = new Map<string, RegisteredWidget>();

	constructor(sources: SidebarSources) {
		this.#sources = sources;
		for (const widget of createBuiltinWidgets(sources)) {
			this.#widgets.set(widget.id, { widget, builtin: true });
		}
	}

	/**
	 * Register a widget. Registration is synchronous and re-registering an id
	 * replaces the previous widget; `build` runs synchronously on every frame,
	 * so it must never perform IO. Third-party widgets render only while the
	 * `tui.sidebar.widgets` setting is on; the built-ins are unaffected.
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

	/**
	 * The sidebar's node tree for this frame: each visible widget's node, a
	 * muted rule between adjacent widgets, or `null` when nothing is visible.
	 */
	build(ctx: SegmentContext): UiNode | null {
		const children: JSXNode[] = [];
		for (const widget of this.#sortedWidgets()) {
			let built: JSXNode | null;
			try {
				built = widget.build(ctx);
			} catch {
				// A throwing third-party widget must not take down the frame;
				// skip its node for this build.
				continue;
			}
			if (built === null || built === undefined) continue;
			if (children.length > 0) {
				children.push(new UiNode("rule", { role: "zeta.sidebar.separator", tone: "muted" }));
			}
			children.push(built);
		}
		if (children.length === 0) return null;
		return new UiNode("col", { role: "zeta.sidebar", gap: "xs", children });
	}
}
