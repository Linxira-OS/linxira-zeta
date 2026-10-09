import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { StatsDashboard, StatsDownNotice } = await jiti.import("@/components/StatsDashboard");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

function renderPane(element) {
  return renderToStaticMarkup(React.createElement(I18nProvider, null, element));
}

// Without a stats URL the pane starts in its resolving state: a loading
// hint, never an iframe or the not-running notice.
test("StatsDashboard without a stats URL renders the loading state", () => {
  delete process.env.NEXT_PUBLIC_STATS_URL;
  const html = renderPane(React.createElement(StatsDashboard));
  assert.match(html, /data-testid="stats-pane-loading"/);
  assert.doesNotMatch(html, /<iframe/);
  assert.doesNotMatch(html, /data-testid="stats-pane-down"/);
});

// A build-time NEXT_PUBLIC_STATS_URL mounts the iframe immediately (the
// reachability probe runs later in a client effect).
test("StatsDashboard with an injected stats URL embeds the iframe directly", () => {
  process.env.NEXT_PUBLIC_STATS_URL = "http://127.0.0.1:3847";
  try {
    const html = renderPane(React.createElement(StatsDashboard));
    assert.match(html, /data-testid="stats-pane-frame"/);
    assert.match(html, /<iframe[^>]+src="http:\/\/127\.0\.0\.1:3847"/);
  } finally {
    delete process.env.NEXT_PUBLIC_STATS_URL;
  }
});

// Degraded state: the unreachable-service notice names the command to fix
// it and offers a retry. Locale-neutral: the command is identical in every
// locale, so assert on it instead of translated prose.
test("StatsDownNotice shows the start command and a retry button", () => {
  const html = renderPane(React.createElement(StatsDownNotice, { onRetry: () => {} }));
  assert.match(html, /data-testid="stats-pane-down-message"/);
  assert.match(html, /<code[^>]*>zetacode stats<\/code>/);
  assert.match(html, /<button/);
});

test("StatsDownNotice omits the retry button without a handler", () => {
  const html = renderPane(React.createElement(StatsDownNotice));
  assert.match(html, /zetacode stats/);
  assert.doesNotMatch(html, /<button/);
});
