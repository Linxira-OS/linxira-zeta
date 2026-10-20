/**
 * Plugin manifest `ui.panels` — validation of the declarative panel block.
 *
 * The parser is the only gate between a hand-written manifest and a host that
 * draws what it is told, so every rejection names the entry that is wrong:
 * a typo must surface as a diagnostic, never as a panel that quietly never
 * appears. The panels themselves are rendered by the Rust host
 * (`main/crates/zetawork-gui/src/plugin_panels.rs`); this suite pins the
 * declaration side, including the backward-compatibility rule that a plugin
 * without `ui` behaves exactly as before.
 */
import { describe, expect, it } from "bun:test";
import { parsePluginUi } from "../src/extensibility/plugins/parser";

const toolSource = { tool: "example_panel_data", args: { panel: "tasks" } };

describe("parsePluginUi — accepted declarations", () => {
	it("accepts every panel kind and keeps declaration order", () => {
		const result = parsePluginUi({
			panels: [
				{ id: "tasks", title: "Tasks", kind: "list", source: toolSource, columns: ["id", "title"] },
				{ id: "settings", title: "Settings", kind: "form", source: { tool: "data" } },
				{ id: "throughput", title: "By state", kind: "chart", source: { tool: "data", args: {} } },
				{ id: "guide", title: "Guide", kind: "html", entry: "pages/index.html" },
			],
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.ui.panels?.map(panel => panel.kind)).toEqual(["list", "form", "chart", "html"]);
		expect(result.ui.panels?.[0]).toEqual({
			id: "tasks",
			title: "Tasks",
			kind: "list",
			source: toolSource,
			columns: ["id", "title"],
		});
		expect(result.ui.panels?.[3]).toEqual({ id: "guide", title: "Guide", kind: "html", entry: "pages/index.html" });
	});

	it("treats an absent ui block and an empty panels list as 'no panels'", () => {
		expect(parsePluginUi(undefined)).toEqual({ ok: true, ui: {} });
		expect(parsePluginUi({})).toEqual({ ok: true, ui: {} });
		expect(parsePluginUi({ panels: [] })).toEqual({ ok: true, ui: { panels: [] } });
	});

	it("normalizes a windows-style or ./-prefixed html entry", () => {
		const result = parsePluginUi({
			panels: [
				{ id: "a", title: "A", kind: "html", entry: ".\\pages\\a.html" },
				{ id: "b", title: "B", kind: "html", entry: "pages/b.HTM" },
			],
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.ui.panels?.map(panel => ("entry" in panel ? panel.entry : ""))).toEqual([
			"pages/a.html",
			"pages/b.HTM",
		]);
	});
});

describe("parsePluginUi — rejected declarations", () => {
	const reject = (ui: unknown): string => {
		const result = parsePluginUi(ui);
		expect(result.ok).toBe(false);
		return result.ok ? "" : result.error;
	};

	it("rejects an unknown panel kind, naming the entry", () => {
		const error = reject({ panels: [{ id: "tasks", title: "Tasks", kind: "table", source: toolSource }] });
		expect(error).toContain("`ui.panels[0].kind`");
		expect(error).toContain("list, form, chart, html");
	});

	it("rejects a declarative panel without a source", () => {
		const error = reject({ panels: [{ id: "tasks", title: "Tasks", kind: "list" }] });
		expect(error).toContain("`ui.panels[0].source`");
		expect(error).toContain("tool");
	});

	it("rejects a source without a tool name", () => {
		const error = reject({ panels: [{ id: "tasks", title: "Tasks", kind: "chart", source: { args: {} } }] });
		expect(error).toContain("`ui.panels[0].source.tool`");
	});

	it("rejects non-object source args", () => {
		const error = reject({
			panels: [{ id: "tasks", title: "Tasks", kind: "list", source: { tool: "data", args: ["panel"] } }],
		});
		expect(error).toContain("`ui.panels[0].source.args`");
	});

	it("rejects an html panel without an entry", () => {
		const error = reject({ panels: [{ id: "guide", title: "Guide", kind: "html" }] });
		expect(error).toContain("`ui.panels[0].entry`");
	});

	it("rejects an html panel that also declares a source", () => {
		const error = reject({
			panels: [{ id: "guide", title: "Guide", kind: "html", entry: "a.html", source: toolSource }],
		});
		expect(error).toContain("`ui.panels[0].source`");
		expect(error).toContain("html");
	});

	it("rejects an entry that is not html, absolute, or escapes the package", () => {
		expect(reject({ panels: [{ id: "g", title: "G", kind: "html", entry: "pages/index.md" }] })).toContain(
			"`ui.panels[0].entry`",
		);
		expect(reject({ panels: [{ id: "g", title: "G", kind: "html", entry: "/etc/index.html" }] })).toContain(
			"relative",
		);
		expect(reject({ panels: [{ id: "g", title: "G", kind: "html", entry: "../index.html" }] })).toContain(
			"must not leave the plugin package",
		);
	});

	it("rejects bad ids, missing titles, duplicate ids and columns on a non-list panel", () => {
		expect(reject({ panels: [{ id: "Tasks", title: "Tasks", kind: "list", source: toolSource }] })).toContain(
			"`ui.panels[0].id`",
		);
		expect(reject({ panels: [{ id: "tasks", kind: "list", source: toolSource }] })).toContain("`ui.panels[0].title`");
		expect(
			reject({
				panels: [
					{ id: "tasks", title: "A", kind: "list", source: toolSource },
					{ id: "tasks", title: "B", kind: "form", source: toolSource },
				],
			}),
		).toContain("`ui.panels[1].id` duplicates");
		expect(reject({ panels: [{ id: "s", title: "S", kind: "form", source: toolSource, columns: ["a"] }] })).toContain(
			"only meaningful for a list panel",
		);
	});

	it("rejects a non-array panels field and a non-object ui block", () => {
		expect(reject({ panels: { id: "tasks" } })).toContain("`ui.panels` must be an array");
		expect(reject("panels")).toContain("`ui` must be an object");
	});
});

describe("parsePluginUi — backward compatibility", () => {
	it("leaves a manifest without ui untouched, which is what every existing plugin declares", () => {
		const manifest: { version: string; extensions: string[]; locales: Record<string, string>; ui?: unknown } = {
			version: "1.0.0",
			extensions: ["./index.ts"],
			locales: { en: "locales/en.json" },
		};
		expect(parsePluginUi(manifest.ui)).toEqual({ ok: true, ui: {} });
	});
});
