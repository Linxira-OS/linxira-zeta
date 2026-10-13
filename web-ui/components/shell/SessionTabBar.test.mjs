import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
	jsx: { runtime: "automatic" },
	tsconfigPaths: true,
});
const { SessionTabBar } = await jiti.import("./SessionTabBar.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

function tab(id, overrides = {}) {
	return {
		id,
		kind: "session",
		sessionId: id,
		draftCwd: null,
		projectRoot: "/repo",
		title: id,
		openedAt: 1,
		lastActiveAt: 1,
		explicitNew: false,
		...overrides,
	};
}

function render(props) {
	return renderToStaticMarkup(
		React.createElement(
			I18nProvider,
			null,
			React.createElement(SessionTabBar, {
				tabs: [],
				activeTabId: null,
				runningTabIds: new Set(),
				streamingTabIds: new Set(),
				titleFor: entry => entry.title,
				onActivateTab: () => {},
				onCloseTab: () => {},
				onNewTab: () => {},
				isMobile: false,
				...props,
			}),
		),
	);
}

test("renders one tab per open session and marks the active one", () => {
	const markup = render({
		tabs: [tab("t:a"), tab("t:b")],
		activeTabId: "t:b",
		titleFor: entry => (entry.id === "t:a" ? "Alpha" : "Beta"),
	});
	const tabs = markup.match(/role="tab"/g) ?? [];
	assert.equal(tabs.length, 2);
	assert.match(markup, /aria-label="Open sessions"/);
	const selected = markup.match(/aria-selected="true"[\s\S]*?<\/div>/g) ?? [];
	assert.equal(selected.length, 1);
	assert.match(markup, /Beta/);
	assert.match(markup, /Alpha/);
});

test("shows the running dot only for running tabs and dims cold ones", () => {
	const markup = render({
		tabs: [tab("t:a"), tab("t:b")],
		activeTabId: "t:a",
		runningTabIds: new Set(["t:b"]),
		// t:b is running but over the stream budget → cold (dimmed) dot.
		streamingTabIds: new Set(["t:a"]),
	});
	assert.equal((markup.match(/Agent is running/g) ?? []).length, 2);
	assert.match(markup, /opacity:0\.45/);
});

test("close buttons name their tab and the strip offers a new tab", () => {
	const markup = render({
		tabs: [tab("t:a", { title: "Alpha" })],
		activeTabId: "t:a",
		titleFor: () => "Alpha",
	});
	assert.match(markup, /aria-label="Close Alpha"/);
	assert.match(markup, /aria-label="New session tab"/);
});

test("a single project hides the project prefix, two projects show it", () => {
	const single = render({ tabs: [tab("t:a")], activeTabId: "t:a" });
	assert.doesNotMatch(single, />repo</);

	const twoProjects = render({
		tabs: [tab("t:a"), tab("t:b", { projectRoot: "/work/other" })],
		activeTabId: "t:a",
	});
	assert.match(twoProjects, />repo</);
	assert.match(twoProjects, />other</);
});

test("tab title attribute carries the workspace and session id", () => {
	const markup = render({ tabs: [tab("t:a", { sessionId: "sess-1" })], activeTabId: "t:a" });
	assert.match(markup, /title="t:a\n\/repo\nsess-1"/);
});
