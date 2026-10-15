import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

/** Chrome the panel surface must never render, whatever is mounted inside it. */
const CHROME_SELECTORS = [
	'data-shell-region="sidebar"',
	'data-shell-region="topbar"',
	'data-shell-region="tabs"',
	'data-shell-region="rail"',
	'data-shell-region="dockWindow"',
	'shell-col--sidebar',
	'shell-col--details',
	'shell-grid',
	'id="session-sidebar"',
	'id="right-tool-dock"',
	"sidebar-container",
	"right-panel-container",
	'role="tablist"',
];

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });

function makeFixturePlugin() {
	const root = mkdtempSync(path.join(tmpdir(), "zeta-web-plugin-page-"));
	const packageDir = path.join(root, "node_modules", "@linxiraos", "pi-messenger");
	mkdirSync(path.join(packageDir, "ui"), { recursive: true });
	writeFileSync(
		path.join(packageDir, "package.json"),
		JSON.stringify({ name: "@linxiraos/pi-messenger", version: "1.2.1", zeta: { extensions: ["./index.ts"] } }),
	);
	writeFileSync(
		path.join(packageDir, "ui", "board.html"),
		"<html><head><title>Task Board</title></head><body><script src=\"./board.js\"></script></body></html>",
	);
	writeFileSync(path.join(packageDir, "ui", "board.js"), "fetch('/api/tracking');\n");
	process.env.ZETA_WEB_PLUGIN_ROOTS = root;
	return root;
}

const fixtureRoot = makeFixturePlugin();
process.on("exit", () => rmSync(fixtureRoot, { recursive: true, force: true }));

const { PageSurface } = await jiti.import("@/components/shell/PageSurface");
const { default: PluginPage } = await jiti.import("@/app/plugins/view/[pluginId]/[[...path]]/page.tsx");

function assertNoChrome(html, label) {
	for (const selector of CHROME_SELECTORS) {
		assert.ok(!html.includes(selector), `${label} must not render ${selector}`);
	}
}

test("the panel surface is the page's own content and nothing else", () => {
	const html = renderToStaticMarkup(
		React.createElement(PageSurface, { label: "Task Board" }, React.createElement("div", { id: "content" }, "hi")),
	);

	assert.match(html, /data-shell-mode="panel"/);
	assert.match(html, /data-shell-region="center"/);
	assert.match(html, /aria-label="Task Board"/);
	assert.match(html, /id="content"/);
	assertNoChrome(html, "the panel surface");
});

test("a plugin page mounts in the panel surface, framed by its own asset url", async () => {
	const view = await PluginPage({ params: Promise.resolve({ pluginId: "pi-messenger", path: ["ui", "board.html"] }) });
	const html = renderToStaticMarkup(view);

	assertNoChrome(html, "the plugin page");
	assert.match(html, /data-shell-mode="panel"/);
	assert.match(html, /data-plugin-page="frame"/);
	assert.match(html, /src="\/api\/plugin-assets\/pi-messenger\/ui\/board\.html"/);
	assert.match(html, /title="Task Board"/);
	assert.match(html, /sandbox="allow-scripts allow-same-origin/);
});

test("an unknown plugin or page states what is missing instead of a blank surface", async () => {
	const unknownPlugin = renderToStaticMarkup(
		await PluginPage({ params: Promise.resolve({ pluginId: "nope", path: [] }) }),
	);
	assertNoChrome(unknownPlugin, "the unknown-plugin state");
	assert.match(unknownPlugin, /Plugin not installed: nope/);

	const unknownPage = renderToStaticMarkup(
		await PluginPage({ params: Promise.resolve({ pluginId: "pi-messenger", path: ["ui", "missing.html"] }) }),
	);
	assertNoChrome(unknownPage, "the unknown-page state");
	assert.match(unknownPage, /No such page: ui\/missing\.html/);
	assert.match(unknownPage, /ui\/board\.html/);
});

test("the bare plugin url lists the pages it ships", async () => {
	const html = renderToStaticMarkup(await PluginPage({ params: Promise.resolve({ pluginId: "pi-messenger", path: [] }) }));

	assertNoChrome(html, "the plugin page index");
	assert.match(html, /Task Board/);
	assert.match(html, /href="\.\/ui\/board\.html"/);
});
