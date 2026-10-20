/**
 * The shipped example plugin, exercised through the real host.
 *
 * `plugins/official/example-panel/` is the teaching plugin: a behaviour layer
 * (one tool, one command), declarative panels (`plugin.json` → `ui.panels`) and
 * a web-ui page. Its own test stubs the host so it runs from an unzipped copy
 * with nothing installed; this suite is the other half — the same files loaded
 * by the host's real extension loader and locale loader, so a host-side rename
 * cannot leave the example quietly broken.
 *
 * The native rendering itself is the GUI's: `cargo test -p zetawork-gui`
 * covers `plugin_panels` against the same manifest text.
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { loadExtensions } from "@linxiraos/zeta/extensibility/extensions/loader";
import { clearPluginLocaleCache, loadPluginLocaleCatalog } from "@linxiraos/zeta/extensibility/plugins/locales";
import { panelCommandArgs, readPanelData } from "@linxiraos/zeta/extensibility/plugins/panels";
import { parsePluginUi } from "@linxiraos/zeta/extensibility/plugins/parser";
import type { PluginManifest } from "@linxiraos/zeta/extensibility/plugins/types";
import { setLanguage } from "../src/i18n";

const REPO_ROOT = path.resolve(import.meta.dir, "../../..");
const PLUGIN_ROOT = path.join(REPO_ROOT, "plugins", "official", "example-panel");
const PLUGIN_ENTRY = path.join(PLUGIN_ROOT, "index.ts");

const catalogued = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, "plugin.json"), "utf8")) as {
	id: string;
	ui?: unknown;
};
const manifest = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, "package.json"), "utf8")) as {
	name: string;
	version: string;
	zeta: PluginManifest;
};

describe("example-panel through the host", () => {
	test("the real extension loader registers the data tool and the command", async () => {
		const { extensions, errors } = await loadExtensions([PLUGIN_ENTRY], REPO_ROOT);
		expect(errors).toEqual([]);
		expect(extensions).toHaveLength(1);
		const [extension] = extensions;
		expect([...extension.tools.keys()]).toEqual(["example_panel_data"]);
		expect([...extension.commands.keys()]).toEqual(["example-panel"]);
	});

	test("the declared panels parse, and every declarative one names that tool", () => {
		const parsed = parsePluginUi(catalogued.ui);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		const panels = parsed.ui.panels ?? [];
		expect(panels.map(panel => panel.kind)).toEqual(["list", "form", "chart", "html"]);
		for (const panel of panels) {
			if (panel.kind === "html") {
				expect(fs.existsSync(path.join(PLUGIN_ROOT, panel.entry))).toBe(true);
				continue;
			}
			expect(panel.source.tool).toBe("example_panel_data");
		}
	});

	test("the html panel's entry is exactly the page path web-ui addresses", () => {
		const parsed = parsePluginUi(catalogued.ui);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		const html = parsed.ui.panels?.find(panel => panel.kind === "html");
		expect(html?.kind).toBe("html");
		if (html?.kind !== "html") return;
		// The same URL scheme the web-ui page host mounts; the desktop's plugin
		// column points its webview at this, never at a scheme of its own.
		expect(`/plugins/view/${catalogued.id}/${html.entry}`).toBe("/plugins/view/example-panel/pages/index.html");
	});

	test("the headless panel call a native host runs returns each panel's data", async () => {
		// Exactly what `zetacode plugins panel <plugin> <panel> --json` does, and
		// what the desktop's plugin column shells out to.
		expect(panelCommandArgs("example-panel", "tasks")).toEqual([
			"plugins",
			"panel",
			"example-panel",
			"tasks",
			"--json",
		]);
		const tasks = await readPanelData(PLUGIN_ROOT, "tasks");
		expect(tasks.plugin).toBe("example-panel");
		expect(tasks.kind).toBe("list");
		expect((tasks.data as { rows: Array<Record<string, string>> }).rows.length).toBeGreaterThan(0);

		const chart = await readPanelData(PLUGIN_ROOT, "throughput");
		expect(chart.kind).toBe("chart");
		expect((chart.data as { points: Array<{ value: number }> }).points).toHaveLength(3);

		// The html kind runs nothing: it reports the page the host navigates to.
		const page = await readPanelData(PLUGIN_ROOT, "guide");
		expect(page.kind).toBe("html");
		expect(page.data).toEqual({ entry: "pages/index.html" });

		await expect(readPanelData(PLUGIN_ROOT, "nope")).rejects.toThrow(/has no panel "nope"/);
	});

	test("the tool returns localized panel data through the plugin's catalogue", async () => {
		const catalog = await loadPluginLocaleCatalog({ path: PLUGIN_ROOT, manifest: manifest.zeta });
		expect(catalog?.tables.zh).toBeDefined();
		expect(catalog?.tables.en).toBeDefined();

		const { extensions } = await loadExtensions([PLUGIN_ENTRY], REPO_ROOT);
		const tool = extensions[0]?.tools.get("example_panel_data")?.definition;
		expect(tool).toBeDefined();
		if (!tool) return;

		setLanguage("zh");
		try {
			const list = await tool.execute("call-list", { panel: "tasks" }, undefined, undefined, {
				t: catalog?.t ?? ((key: string, fallback?: string) => fallback ?? key),
			} as never);
			const rows = (list.details?.rows ?? []) as Array<{ state: string }>;
			expect(rows.length).toBeGreaterThan(0);
			expect(rows.map(row => row.state)).toContain(catalog?.t("state.done") ?? "state.done");
			// The form's labels come from the tool, so they are localized too.
			const form = await tool.execute("call-form", { panel: "settings" }, undefined, undefined, {
				t: catalog?.t ?? ((key: string, fallback?: string) => fallback ?? key),
			} as never);
			const fields = (form.details?.fields ?? []) as Array<{ label: string }>;
			expect(fields.map(field => field.label)).toContain(catalog?.t("settings.dataFile") ?? "settings.dataFile");
		} finally {
			setLanguage("en");
			clearPluginLocaleCache();
		}
	});
});
