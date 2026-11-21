import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
	jsx: { runtime: "automatic" },
	tsconfigPaths: true,
});
const { ShellLayout, ShellSlot } = await jiti.import("./ShellLayout.tsx");
const { DockRail } = await jiti.import("./DockRail.tsx");
const { SessionTabBar } = await jiti.import("./SessionTabBar.tsx");
const { ChatInput } = await jiti.import("@/components/ChatInput");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

const h = React.createElement;

/** Chrome regions the `panel` mode must not render at all. */
const CHROME_REGIONS = ["sidebar", "topbar", "tabs", "rail", "dockWindow"];

/** Textual shapes of the chrome nodes, as rendered. */
const CHROME_TEXT = [
	'data-shell-region="sidebar"',
	'data-shell-region="topbar"',
	'data-shell-region="tabs"',
	'data-shell-region="rail"',
	'data-shell-region="dockWindow"',
	'shell-col--sidebar',
	'shell-col--details',
	'id="session-sidebar"',
	'id="right-tool-dock"',
	"sidebar-container",
	"right-panel-container",
	'data-resize-handle="sidebar"',
	'data-resize-handle="right-panel"',
	'id="sidebar-body"',
	'id="top-bar"',
	'id="dock-body"',
	'role="tablist"',
	"tab-t1",
];

function tab(id) {
	return {
		id,
		kind: "session",
		sessionId: id,
		draftCwd: null,
		projectRoot: "/repo",
		title: `tab-${id}`,
		openedAt: 1,
		lastActiveAt: 1,
		explicitNew: false,
	};
}

/**
 * Mirrors AppShell's real slot wiring: the same slot names carrying the same
 * chrome components (DockRail, SessionTabBar) plus the real composer, so the
 * assertions below exercise the actual gate rather than a stub tree.
 */
function renderShell(mode) {
	return renderToStaticMarkup(
		h(
			I18nProvider,
			null,
			h(
				ShellLayout,
				{
					mode,
					sidebarOpen: true,
					sidebarCollapsed: false,
					detailOpen: true,
					isMobile: false,
					desktopChromeInset: 30,
				},
				h(ShellSlot, { name: "sidebar", key: "sidebar" }, h("div", { id: "sidebar-body" }, "sessions")),
				h(ShellSlot, { name: "topbar", key: "topbar" }, h("div", { id: "top-bar" }, "toolbar")),
				h(
					ShellSlot,
					{ name: "tabs", key: "tabs" },
					h(SessionTabBar, {
						tabs: [tab("t1")],
						activeTabId: "t1",
						runningTabIds: new Set(),
						streamingTabIds: new Set(),
						titleFor: entry => entry.title,
						onActivateTab: () => {},
						onCloseTab: () => {},
						onNewTab: () => {},
						isMobile: false,
					}),
				),
				h(
					ShellSlot,
					{ name: "center", key: "center" },
					h(ChatInput, { onSend: () => {}, onAbort: () => {}, isStreaming: false }),
				),
				h(
					ShellSlot,
					{ name: "rail", key: "rail" },
					h(DockRail, { activeId: null, onToggle: () => {}, trackingEnabled: true, hasSession: true }),
				),
				h(ShellSlot, { name: "dockWindow", key: "dockWindow" }, h("div", { id: "dock-body" }, "dock")),
			),
		),
	);
}

/** The rendered DOM without the component's own <style> sheet. */
function markupOf(html) {
	return html.replace(/<style>[\s\S]*?<\/style>/g, "");
}

/** Equivalent of `querySelectorAll("[data-shell-region]")` on the rendered DOM. */
function shellRegions(html) {
	return [...markupOf(html).matchAll(/data-shell-region="([^"]+)"/g)].map(match => match[1]).sort();
}

function gridStyleAttr(html) {
	const match = markupOf(html).match(/<div class="shell-grid[^"]*"[^>]*style="([^"]*)"/);
	return match ? match[1] : null;
}

test("full mode keeps every shell region in the DOM", () => {
	const html = markupOf(renderShell("full"));

	assert.deepEqual(shellRegions(html), [
		"center",
		"details",
		"dockWindow",
		"rail",
		"sidebar",
		"tabs",
		"topbar",
	]);
	assert.match(html, /data-shell-mode="full"/);
	for (const needle of CHROME_TEXT) {
		assert.ok(html.includes(needle), `full mode must render ${needle}`);
	}
	// The conversation column itself is always present.
	assert.match(html, /data-shell-region="center"/);
	assert.match(html, /<textarea/);
});

test("panel mode drops the sidebar, top bar, tab strip and right dock", () => {
	const html = markupOf(renderShell("panel"));

	assert.deepEqual(shellRegions(html), ["center"]);
	assert.match(html, /data-shell-mode="panel"/);
	for (const needle of CHROME_TEXT) {
		assert.ok(!html.includes(needle), `panel mode must not render ${needle}`);
	}
	for (const region of CHROME_REGIONS) {
		assert.ok(!shellRegions(html).includes(region), `panel mode must not render region ${region}`);
	}
});

test("panel mode still renders the conversation column and the composer", () => {
	const html = markupOf(renderShell("panel"));

	assert.match(html, /shell-col--center/);
	assert.match(html, /data-shell-region="center"/);
	assert.match(html, /<textarea/);
});

test("panel mode collapses the grid to one full-bleed track", () => {
	const panel = renderShell("panel");
	assert.equal(gridStyleAttr(panel), "grid-template-columns:minmax(0, 1fr);padding-top:0");
	assert.match(markupOf(panel), /class="shell-grid shell-grid--panel"/);
	// The host owns the frame: no safe-area padding, no track transition.
	assert.match(panel, /\.shell-grid--panel \{[^}]*padding-left: 0;/);
	assert.match(panel, /\.shell-grid--panel \{[^}]*padding-right: 0;/);
	assert.match(panel, /\.shell-grid--panel \{[^}]*transition: none;/);

	const full = renderShell("full");
	assert.match(gridStyleAttr(full), /^grid-template-columns:\d+px minmax\(0, 1fr\) \d+px;padding-top:30px$/);
	assert.ok(!markupOf(full).includes("shell-grid--panel"));
	assert.match(markupOf(full), /class="shell-grid"/);
});

test("default mode is full when the prop is omitted", () => {
	const html = markupOf(renderShell(undefined));

	assert.deepEqual(shellRegions(html), [
		"center",
		"details",
		"dockWindow",
		"rail",
		"sidebar",
		"tabs",
		"topbar",
	]);
	assert.match(html, /data-shell-mode="full"/);
});
