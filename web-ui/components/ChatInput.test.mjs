import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { ChatInput, nextThinkingLevel, buildSlashCommandCatalog, filterSlashCommandsForQuery } = await jiti.import("./ChatInput.tsx");
// Alias-form import: resolves through the same jiti instance (and thus the
// same module cache) as ChatInput's internal "@/hooks/useI18n", so the
// provider context this test renders is the one ChatInput actually consumes.
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

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

test("slash catalog keeps builtin mode commands in existing sessions", () => {
  // Before the gateway command list loads (or when it returns none), the
  // docked existing-session composer must still offer the builtin mode
  // commands — the hero welcome card always did. One catalog builder serves
  // both composer variants and both agent (idle/streaming) states.
  const catalog = buildSlashCommandCatalog(undefined);
  const builtinNames = catalog.filter(c => c.source === "builtin").map(c => c.name);
  for (const name of ["plan", "plan-ultra", "exit-plan", "goal", "vibe"]) {
    assert.ok(builtinNames.includes(name), `builtin /${name} missing from catalog`);
  }
});

test("slash catalog dedupes gateway commands against builtin names (builtin wins)", () => {
  const catalog = buildSlashCommandCatalog([
    { name: "plan", description: "prompt-defined plan", source: "prompt" },
    { name: "deploy", description: "custom deploy", source: "prompt" },
  ]);
  const planEntries = catalog.filter(c => c.name === "plan");
  assert.equal(planEntries.length, 1);
  assert.equal(planEntries[0].source, "builtin");
  assert.ok(catalog.some(c => c.name === "deploy" && c.source === "prompt"));
});

test("query 'plan' ranks the exact builtin command first and matches the mode family", () => {
  const t = key => key;
  const matches = filterSlashCommandsForQuery(buildSlashCommandCatalog([]), "plan", t);
  assert.equal(matches[0].name, "plan");
  const names = matches.map(c => c.name);
  assert.ok(names.includes("plan-ultra"));
  assert.ok(names.includes("exit-plan"));
});
