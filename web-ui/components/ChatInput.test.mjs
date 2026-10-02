import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { ChatInput, nextThinkingLevel } = await jiti.import("./ChatInput.tsx");
// Absolute Windows-style path so jiti reuses the exact module instance that
// ChatInput's own "@/hooks/useI18n" resolution caches (slash-form resolves to
// a second copy whose context never sees this provider).
const { I18nProvider } = await jiti.import(
  "C:\\Users\\ETPau\\Documents\\GITHUB\\zeta-webui\\web-ui\\hooks\\useI18n.tsx",
);

function renderWithLocales(element) {
  return renderToStaticMarkup(React.createElement(I18nProvider, null, element));
}

const baseProps = {
  onSend: () => {},
  onAbort: () => {},
  isStreaming: false,
};

test("context usage indicator is absent without data (no dead space)", () => {
  const html = renderWithLocales(React.createElement(ChatInput, baseProps));
  assert.doesNotMatch(html, /Context usage/);
  assert.doesNotMatch(html, /aria-label="[^"]*%/);

  const nullPercent = renderWithLocales(
    React.createElement(ChatInput, {
      ...baseProps,
      contextUsage: { percent: null, contextWindow: 200000, tokens: 50000 },
    }),
  );
  assert.doesNotMatch(nullPercent, /Context usage/);
});

test("context usage indicator renders icon plus percent with a detailed tooltip", () => {
  const html = renderWithLocales(
    React.createElement(ChatInput, {
      ...baseProps,
      contextUsage: { percent: 41.6, contextWindow: 200000, tokens: 83200 },
    }),
  );
  assert.match(html, /42%/);
  assert.match(html, /aria-label="Context usage: 42%"/);
  assert.match(html, /title="83k of 200k tokens \(42% of context window\)"/);
  assert.match(html, /stroke-dasharray="/i, "usage ring drawn proportionally");
});

function thinkingProps(level, available) {
  return {
    ...baseProps,
    thinkingLevel: level,
    onThinkingLevelChange: () => {},
    ...(available ? { availableThinkingLevels: available } : {}),
  };
}

test("thinking button title carries the Alt+T cycle hint with the live level", () => {
  const html = renderWithLocales(React.createElement(ChatInput, thinkingProps("medium")));
  assert.match(html, /title="Change reasoning level: medium \(Alt\+T\)"/);
});

test("nextThinkingLevel cycles the full ladder with wraparound", () => {
  assert.equal(nextThinkingLevel("auto"), "off");
  assert.equal(nextThinkingLevel("off"), "minimal");
  assert.equal(nextThinkingLevel("medium"), "high");
  assert.equal(nextThinkingLevel("max"), "auto");
});

test("nextThinkingLevel: missing current advances from auto; unknown wraps to auto", () => {
  assert.equal(nextThinkingLevel(undefined), "off");
  assert.equal(nextThinkingLevel("bogus"), "auto");
});

test("nextThinkingLevel restricts the cycle to available levels but keeps auto", () => {
  const available = ["minimal", "high"];
  assert.equal(nextThinkingLevel("auto", available), "minimal");
  assert.equal(nextThinkingLevel("minimal", available), "high");
  assert.equal(nextThinkingLevel("high", available), "auto");
  assert.equal(nextThinkingLevel("max", available), "auto", "unavailable current falls back to cycle head");
});
