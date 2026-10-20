/**
 * The example plugin's own test — dependency-free on purpose.
 *
 * It runs with nothing installed (`bun test test` from this directory, or from
 * a freshly unzipped copy of the release asset), because it stubs the host
 * instead of importing it: the point is that a plugin is a directory of files
 * plus a manifest, not a workspace package.
 *
 * What is asserted is the whole triangle the plugin claims:
 *   1. the manifest declares four panels of three native kinds plus one page,
 *   2. every declarative panel's `source.tool` is the tool the factory
 *      registers, and calling it produces that panel's shape,
 *   3. the en/zh catalogues are key-identical, so `ctx.t` has both languages.
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import examplePanel, { GUIDE_PAGE, PANELS, PANEL_DATA_TOOL, panelData, readTasks } from "../index.ts";

const ROOT = path.resolve(import.meta.dir, "..");

interface PanelDecl {
	id: string;
	title: string;
	kind: string;
	source?: { tool: string; args?: Record<string, unknown> };
	entry?: string;
	columns?: string[];
}

function readJson<T>(relative: string): T {
	return JSON.parse(fs.readFileSync(path.join(ROOT, relative), "utf8")) as T;
}

const manifest = readJson<{ ui?: { panels?: PanelDecl[] } }>("plugin.json");
const panels = manifest.ui?.panels ?? [];

/** The smallest host stand-in: capture what the factory registers. */
function fakeHost(): {
	api: Parameters<typeof examplePanel>[0];
	tools: Map<string, { execute: (...args: never[]) => Promise<{ details?: unknown }> }>;
	commands: Map<string, { handler: (args: string[], ctx: unknown) => Promise<void> }>;
} {
	const tools = new Map<string, { execute: (...args: never[]) => Promise<{ details?: unknown }> }>();
	const commands = new Map<string, { handler: (args: string[], ctx: unknown) => Promise<void> }>();
	const string = (options?: Record<string, unknown>) => ({ type: "string", ...options });
	const api = {
		// The host injects its whole builder namespace; only these two are used.
		typebox: { Type: { Object: (shape: unknown) => shape, String: string } },
		registerTool: (tool: { name: string }) => {
			tools.set(tool.name, tool as never);
		},
		registerCommand: (name: string, command: { handler: (args: string[], ctx: unknown) => Promise<void> }) => {
			commands.set(name, command);
		},
	};
	return { api: api as Parameters<typeof examplePanel>[0], tools, commands };
}

describe("example-panel manifest", () => {
	test("declares three declarative kinds and one html page", () => {
		expect(panels.map(panel => panel.kind)).toEqual(["list", "form", "chart", "html"]);
		const html = panels.filter(panel => panel.kind === "html");
		expect(html).toHaveLength(1);
		expect(html[0].entry).toBe(GUIDE_PAGE);
		expect(fs.existsSync(path.join(ROOT, GUIDE_PAGE))).toBe(true);
	});

	test("every declarative panel points at the plugin's one tool with a known panel", () => {
		const declarative = panels.filter(panel => panel.kind !== "html");
		expect(declarative.length).toBeGreaterThanOrEqual(3);
		for (const panel of declarative) {
			expect(panel.source?.tool).toBe(PANEL_DATA_TOOL);
			expect(PANELS).toContain(panel.source?.args?.panel as never);
		}
		// The list panel names the cells the native renderer draws.
		const list = panels.find(panel => panel.kind === "list");
		expect(list?.columns).toEqual(["id", "title", "owner", "state"]);
	});
});

describe("example-panel behaviour", () => {
	test("the factory registers the data tool and the command", () => {
		const { api, tools, commands } = fakeHost();
		examplePanel(api);
		expect([...tools.keys()]).toEqual([PANEL_DATA_TOOL]);
		expect([...commands.keys()]).toEqual(["example-panel"]);
	});

	test("the data tool returns each declared panel's shape", async () => {
		const { api, tools } = fakeHost();
		examplePanel(api);
		const tool = tools.get(PANEL_DATA_TOOL);
		expect(tool).toBeDefined();
		const identify = (key: string, fallback?: string) => fallback ?? key;
		const ctx = { t: identify };
		for (const panel of panels.filter(decl => decl.kind !== "html")) {
			const result = await tool!.execute(
				"call-1",
				{ panel: panel.source?.args?.panel },
				undefined,
				undefined,
				ctx as never,
			);
			const details = result.details as Record<string, unknown>;
			if (panel.kind === "list") {
				const rows = details.rows as Array<Record<string, string>>;
				expect(rows.length).toBe(readTasks().length);
				for (const column of panel.columns ?? []) expect(rows[0]).toHaveProperty(column);
				continue;
			}
			if (panel.kind === "chart") {
				const points = details.points as Array<{ label: string; value: number }>;
				expect(points.map(point => point.label)).toEqual(["todo", "doing", "done"]);
				expect(points.every(point => typeof point.value === "number")).toBe(true);
				continue;
			}
			const fields = details.fields as Array<{ key: string; label: string; value: string }>;
			expect(fields.map(field => field.key)).toEqual(["dataFile", "taskCount", "locales", "panelSource"]);
		}
	});

	test("panelData localizes state labels through the host translator", () => {
		const tasks = readTasks();
		const zh = readJson<Record<string, string>>("locales/zh.json");
		const translate = (key: string, fallback?: string) => zh[key] ?? fallback ?? key;
		const data = panelData("tasks", tasks, translate);
		expect((data.rows as Array<{ state: string }>)[0].state).toBe(zh["state.done"]);
		const counts = panelData("throughput", tasks, translate);
		expect((counts.points as Array<{ label: string }>)[0].label).toBe(zh["state.todo"]);
	});
});

describe("example-panel locale pair", () => {
	test("en and zh declare the same keys and no empty values", () => {
		const en = readJson<Record<string, string>>("locales/en.json");
		const zh = readJson<Record<string, string>>("locales/zh.json");
		expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
		for (const [key, value] of Object.entries({ ...en, ...zh })) {
			expect(typeof value).toBe("string");
			expect(value.trim().length, `${key} is empty`).toBeGreaterThan(0);
		}
	});

	test("the package manifest points at both catalogues", () => {
		const pkg = readJson<{ zeta?: { extensions?: string[]; locales?: Record<string, string> } }>("package.json");
		expect(pkg.zeta?.extensions).toEqual(["./index.ts"]);
		expect(pkg.zeta?.locales).toEqual({ en: "locales/en.json", zh: "locales/zh.json" });
		for (const file of Object.values(pkg.zeta?.locales ?? {})) {
			expect(fs.existsSync(path.join(ROOT, file))).toBe(true);
		}
	});
});
