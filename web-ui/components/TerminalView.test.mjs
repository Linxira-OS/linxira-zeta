import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { TerminalView } = await jiti.import("@/components/TerminalView");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

function renderTerminal(props = {}) {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(TerminalView, {
      cwd: "/repo",
      instanceId: "t1",
      instances: ["t1"],
      knownSessionId: null,
      onSessionCreated: () => {},
      openFileRequest: null,
      ...props,
    })),
  );
}

// SSR renders the shell of the pane only: the xterm/WS boot runs in a
// client effect, so the static markup must be self-consistent without them.

test("TerminalView renders the pane skeleton with a connecting status", () => {
  const html = renderTerminal();
  assert.match(html, /data-testid="terminal-view"/);
  assert.match(html, /aria-label="terminal-connecting"/);
  // Locale-neutral assertion: the reconnecting hint shows next to the dot.
  assert.match(html, /terminal-connecting/);
});

test("TerminalView renders one chip per slot plus the explicit new-terminal entry", () => {
  const html = renderTerminal({ instances: ["t1", "t2"], instanceId: "t2" });
  assert.match(html, /data-testid="terminal-slots"/);
  // The active slot is marked for assistive tech, the other one is not.
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
  assert.equal((html.match(/aria-pressed="false"/g) ?? []).length, 1);
  // "New terminal" (a new slot) is always offered; Stop/Restart need state.
  assert.equal((html.match(/<button/g) ?? []).length, 3);
  assert.doesNotMatch(html, /terminal-kill|terminal-restart/);
});

test("TerminalView container keeps a flex-fill body for the xterm mount", () => {
  const html = renderTerminal();
  // The xterm mount point is the second child div (flex:1) after the status row.
  assert.match(html, /<div style="flex:1;min-height:0;padding:4px 6px;background:var\(--bg\)"><\/div>/);
});
