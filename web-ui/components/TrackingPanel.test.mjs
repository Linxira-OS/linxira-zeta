import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
	jsx: { runtime: "automatic" },
	tsconfigPaths: true,
});
const { TrackingMarkdownList } = await jiti.import("./TrackingPanel.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

function renderList(props) {
	return renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(TrackingMarkdownList, props)));
}

// The panel's Summaries tab used to be declared in its payload type and never
// rendered. It shares this listing with the Plans tab, so exercising the listing
// is what proves the summaries family reaches the panel.
test("renders every summary entry as a titled, expandable markdown block", () => {
	const html = renderList({
		entries: [
			{ name: "compaction-2026-09-08T00-03-00-000Z.md", content: "# Goal\nShip the summaries tab." },
			{ name: "compaction-2026-09-07T11-00-00-000Z.md", content: "# Goal\nSecond summary." },
		],
		cwd: "/home/me/project",
		emptyLabel: "No compaction summaries yet.",
	});

	// File suffix is stripped in the summary line, contents render as markdown.
	assert.match(html, /<summary[^>]*>compaction-2026-09-08T00-03-00-000Z<\/summary>/);
	assert.match(html, /Ship the summaries tab\./);
	assert.match(html, /compaction-2026-09-07T11-00-00-000Z/);
	assert.match(html, /Second summary\./);
	assert.doesNotMatch(html, /\.md</);
	assert.doesNotMatch(html, /No compaction summaries yet\./);
});

test("shows the empty label instead of an empty list", () => {
	const html = renderList({ entries: [], cwd: null, emptyLabel: "No compaction summaries yet." });

	assert.match(html, /No compaction summaries yet\./);
	assert.doesNotMatch(html, /<summary/);
});
