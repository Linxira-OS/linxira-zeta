import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
	jsx: { runtime: "automatic" },
	tsconfigPaths: true,
});
const { ContextRingPanelChrome, ContextRingReportView } = await jiti.import("@/components/context-ring/ContextRingView");
const { contextRingPanelEntry, ContextRingIcon } = await jiti.import("@/components/context-ring/panel-entry");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

function render(element) {
	return renderToStaticMarkup(React.createElement(I18nProvider, null, element));
}

function report(overrides = {}) {
	return {
		sessionId: "s1",
		model: { provider: "anthropic", modelId: "claude-sonnet-4" },
		contextWindow: 200_000,
		usedTokens: 50_000,
		percent: 25,
		categories: [
			{ id: "systemPrompt", tokens: 2_000 },
			{ id: "systemTools", tokens: 8_000 },
			{ id: "systemContext", tokens: 0 },
			{ id: "skills", tokens: 5_000 },
			{ id: "messages", tokens: 35_000 },
		],
		freeTokens: 120_000,
		autoCompactBufferTokens: 30_000,
		compaction: { enabled: true, thresholdTokens: 170_000, thresholdPercent: 85, speculationPercent: 75 },
		usage: { input: 1_000, output: 2_000, reasoning: 100, cacheRead: 3_000, cacheWrite: 500, total: 6_600 },
		calls: {
			userMessages: 3,
			assistantMessages: 4,
			toolCalls: 9,
			toolResults: 9,
			totalMessages: 16,
			premiumRequests: 0,
		},
		cost: 0.0123,
		routedModels: null,
		...overrides,
	};
}

test("report view renders the occupancy, the composition and the category legend", () => {
	const html = render(React.createElement(ContextRingReportView, { report: report() }));

	assert.match(html, /class="context-ring-panel"/);
	assert.match(html, /25%/);
	assert.match(html, /50k \/ 200k/);
	// One legend row per reported category; the zero-token category is dropped.
	assert.equal((html.match(/context-ring-panel__legend-row/g) ?? []).length, 4);
	assert.equal((html.match(/context-ring-panel__seg /g) ?? []).length, 4);
	assert.match(html, /System prompt/);
	assert.match(html, /Tool schemas/);
	assert.match(html, /4% of used/);
	assert.match(html, /occupancy|context-ring__arc/);
});

test("report view marks the auto-compaction threshold and shows the distance to it", () => {
	const html = render(React.createElement(ContextRingReportView, { report: report() }));
	assert.match(html, /context-ring-panel__mark/);
	assert.match(html, /left:85%/);
	assert.match(html, /170,000 \(85%\)/);
	assert.match(html, /120,000/);
	assert.match(html, /Until auto-compaction/);
});

test("report view drops the marker and reports the disabled state without a threshold", () => {
	const html = render(
		React.createElement(ContextRingReportView, {
			report: report({
				compaction: { enabled: false, thresholdTokens: null, thresholdPercent: null, speculationPercent: null },
			}),
		}),
	);
	assert.doesNotMatch(html, /context-ring-panel__mark/);
	assert.match(html, /Auto-compaction is off/);
	assert.doesNotMatch(html, /Until auto-compaction/);
});

test("report view falls back to the live reading when the report has no window", () => {
	const html = render(
		React.createElement(ContextRingReportView, {
			report: report({ contextWindow: 0, percent: 0, categories: [] }),
			livePercent: 42,
		}),
	);
	assert.match(html, /42%/);
	assert.doesNotMatch(html, /context-ring-panel__legend-row/);
});

test("report view renders the session counters and the cache hit rate", () => {
	const html = render(React.createElement(ContextRingReportView, { report: report() }));
	assert.match(html, /75\.0%/);
	assert.match(html, /\$0\.0123/);
	assert.match(html, /Tool calls/);
	assert.match(html, /16/);
});

test("report view says so when the provider reports no cache accounting", () => {
	const html = render(
		React.createElement(ContextRingReportView, {
			report: report({
				usage: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			}),
		}),
	);
	assert.match(html, /Not reported/);
});

test("report view shows a genuine zero cache hit rate when prompt tokens were uncached", () => {
	const html = render(
		React.createElement(ContextRingReportView, {
			report: report({
				usage: { input: 1_000, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 1_000 },
			}),
		}),
	);
	assert.match(html, /0\.0%/);
	assert.doesNotMatch(html, /Not reported/);
});

test("report view flags a stale snapshot", () => {
	const html = render(React.createElement(ContextRingReportView, { report: report(), stale: true }));
	assert.match(html, /context-ring-panel__notice/);
	assert.match(html, /refresh failed/i);
});

test("chrome renders the empty state without a session", () => {
	const html = render(
		React.createElement(ContextRingPanelChrome, {
			sessionId: null,
			report: null,
			loading: false,
			error: null,
			running: false,
		}),
	);
	assert.match(html, /data-testid="context-ring-no-session"/);
	assert.match(html, /No active session/);
});

test("chrome renders the loading state while the first snapshot is in flight", () => {
	const html = render(
		React.createElement(ContextRingPanelChrome, {
			sessionId: "s1",
			report: null,
			loading: true,
			error: null,
			running: true,
		}),
	);
	assert.match(html, /data-testid="context-ring-loading"/);
});

test("chrome renders the idle state for a non-running session", () => {
	const html = render(
		React.createElement(ContextRingPanelChrome, {
			sessionId: "s1",
			report: null,
			loading: false,
			error: null,
			running: false,
		}),
	);
	assert.match(html, /data-testid="context-ring-not-running"/);
});

test("chrome surfaces a fetch failure and keeps the last snapshot", () => {
	const failed = render(
		React.createElement(ContextRingPanelChrome, {
			sessionId: "s1",
			report: null,
			loading: false,
			error: "HTTP 500",
			running: true,
		}),
	);
	assert.match(failed, /data-testid="context-ring-error"/);
	assert.match(failed, /HTTP 500/);

	const stale = render(
		React.createElement(ContextRingPanelChrome, {
			sessionId: "s1",
			report: report(),
			loading: false,
			error: "HTTP 500",
			running: true,
		}),
	);
	assert.doesNotMatch(stale, /data-testid="context-ring-error"/);
	assert.match(stale, /context-ring-panel__notice/);
});

test("chrome titles the panel and names the model", () => {
	const html = render(
		React.createElement(ContextRingPanelChrome, {
			sessionId: "s1",
			report: report(),
			loading: false,
			error: null,
			running: true,
		}),
	);
	assert.match(html, />Context</);
	assert.match(html, /anthropic\/claude-sonnet-4/);
});

test("panel entry exposes the dock contract the shell registers", () => {
	assert.equal(contextRingPanelEntry.id, "context");
	assert.equal(contextRingPanelEntry.titleKey, "context-ring.title");
	assert.equal(contextRingPanelEntry.ariaKey, "context-ring.panel-aria");
	assert.equal(contextRingPanelEntry.surface, "rail");
	assert.equal(contextRingPanelEntry.kind, "dock");
	assert.equal(contextRingPanelEntry.widthTier, "regular");
	assert.equal(contextRingPanelEntry.exclusive, true);
	assert.ok(React.isValidElement(contextRingPanelEntry.icon));
});

test("context ring icon renders at the requested size", () => {
	const html = renderToStaticMarkup(React.createElement(ContextRingIcon, { size: 20 }));
	assert.match(html, /width="20"/);
	assert.match(html, /aria-hidden="true"/);
});
