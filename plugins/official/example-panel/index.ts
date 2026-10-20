/**
 * Example Panel — the teaching plugin for Zeta's three plugin layers.
 *
 * | Layer | What this plugin ships | Where it runs |
 * |---|---|---|
 * | behaviour | the `example_panel_data` tool, the `/example-panel` command | in the agent session, no front end |
 * | declarative panels | `plugin.json` → `ui.panels` (list / form / chart) | drawn natively by a Rust host (zetawork GUI) |
 * | web page | `pages/index.html` | hosted by web-ui at `/plugins/view/example-panel/pages/index.html` |
 *
 * The only data source is `data/tasks.json` in this package: the tool reads it,
 * the three declarative panels are three views of it, and the web page fetches
 * the same file through the asset route. Edit the file, refresh the panel, and
 * every layer changes together — which is what makes this an example rather
 * than a mock.
 *
 * Panel data contract (what a declarative panel's tool must return as
 * `details`), documented in `document/plugin-system.md`:
 *
 * ```jsonc
 * // kind: "list"   — one object per row; the manifest's `columns` pick the cells
 * { "rows": [{ "id": "T-1", "title": "…", "owner": "…", "state": "…" }] }
 * // kind: "form"   — read-only labelled fields, labels already localized
 * { "fields": [{ "key": "taskCount", "label": "Tasks", "value": "6" }] }
 * // kind: "chart"  — bars, in declaration order
 * { "points": [{ "label": "todo", "value": 2 }] }
 * ```
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@linxiraos/zeta";

/** The one tool this plugin registers; `ui.panels[].source.tool` names it. */
export const PANEL_DATA_TOOL = "example_panel_data";

/** Panels the tool answers for; the manifest's `args.panel` values. */
export const PANELS = ["tasks", "settings", "throughput"] as const;

export type PanelName = (typeof PANELS)[number];

interface Task {
	id: string;
	title: string;
	owner: string;
	state: "todo" | "doing" | "done";
}

/** The package-relative data file every view reads. */
export const DATA_FILE = "data/tasks.json";

/** The package-relative page the web-ui host mounts for the `html` panel. */
export const GUIDE_PAGE = "pages/index.html";

/** Read the task list from this package. Missing/corrupt data throws, loudly. */
export function readTasks(root: string = import.meta.dir): Task[] {
	const file = path.join(root, DATA_FILE);
	const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { tasks?: unknown };
	if (!Array.isArray(parsed.tasks)) {
		throw new Error(`${DATA_FILE}: expected { "tasks": [...] }`);
	}
	return parsed.tasks as Task[];
}

/** Counts per state, in the order a reader expects. */
export function countByState(tasks: readonly Task[]): Record<Task["state"], number> {
	const counts: Record<Task["state"], number> = { todo: 0, doing: 0, done: 0 };
	for (const task of tasks) {
		if (task.state in counts) counts[task.state] += 1;
	}
	return counts;
}

/**
 * The data for one panel, already shaped for the renderer. `t` is the host's
 * per-plugin translator, so the form's labels are localized while the raw
 * manifest strings (panel titles) stay static.
 */
export function panelData(
	panel: PanelName,
	tasks: readonly Task[],
	t: (key: string, fallback?: string) => string,
): Record<string, unknown> {
	const counts = countByState(tasks);
	if (panel === "tasks") {
		return {
			rows: tasks.map(task => ({
				id: task.id,
				title: task.title,
				owner: task.owner,
				state: t(`state.${task.state}`, task.state),
			})),
		};
	}
	if (panel === "throughput") {
		return {
			points: (["todo", "doing", "done"] as const).map(state => ({
				label: t(`state.${state}`, state),
				value: counts[state],
			})),
		};
	}
	return {
		fields: [
			{ key: "dataFile", label: t("settings.dataFile", "Data file"), value: DATA_FILE },
			{ key: "taskCount", label: t("settings.taskCount", "Tasks"), value: String(tasks.length) },
			{
				key: "locales",
				label: t("settings.locales", "Locales"),
				value: "en, zh",
			},
			{ key: "panelSource", label: t("settings.panelSource", "Panel data tool"), value: PANEL_DATA_TOOL },
		],
	};
}

function isPanelName(value: unknown): value is PanelName {
	return typeof value === "string" && (PANELS as readonly string[]).includes(value);
}

/**
 * The extension factory. It registers one tool (the panel data source) and one
 * command (the behaviour layer's user-facing entry) — nothing front-end
 * specific: the same registrations serve the TUI, the GUI and the browser.
 */
export default function examplePanel(pi: ExtensionAPI): void {
	// The host injects its schema builder, so this package needs no dependency
	// of its own: `pi.typebox.Type` is the same builder the built-in tools use.
	const Type = pi.typebox.Type;

	pi.registerTool({
		name: PANEL_DATA_TOOL,
		label: "Example panel data",
		description: "Return the example plugin's panel data (list, form or chart).",
		// Read-only: it reads the plugin package's own JSON and writes nothing.
		approval: "read",
		parameters: Type.Object({
			panel: Type.String({
				description: `Which panel to fill: ${PANELS.join(" | ")}`,
			}),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const panel = isPanelName(params?.panel) ? params.panel : "tasks";
			const data = panelData(panel, readTasks(), ctx.t);
			return {
				content: [{ type: "text" as const, text: JSON.stringify(data) }],
				details: data,
			};
		},
	});

	pi.registerCommand("example-panel", {
		description: "Print the example plugin's task counts",
		handler: async (_args, ctx) => {
			const tasks = readTasks();
			const counts = countByState(tasks);
			const line = ctx.t("command.counts", "{count} tasks: {todo} todo, {doing} doing, {done} done")
				.replace("{count}", String(tasks.length))
				.replace("{todo}", String(counts.todo))
				.replace("{doing}", String(counts.doing))
				.replace("{done}", String(counts.done));
			ctx.ui.notify(line);
			ctx.ui.notify(ctx.t("command.invite", "Open the plugin's web page in the browser."));
		},
	});
}
