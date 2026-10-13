import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { FullHistoryPanel, FullHistoryFrame } = await jiti.import("@/components/FullHistoryPanel");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

function renderPane(element) {
  return renderToStaticMarkup(React.createElement(I18nProvider, null, element));
}

// The panel fetches the export in a client effect, so a static render is the
// pre-fetch state: a loading hint, never an iframe or an error.
test("full-history panel starts in the loading state", () => {
  const html = renderPane(React.createElement(FullHistoryPanel, { sessionId: "session-1", sessionName: "Plan" }));
  assert.match(html, /Loading full history/);
  assert.doesNotMatch(html, /<iframe/);
});

// Isolation contract: the exported document is untrusted session text, so the
// frame must stay on an opaque origin (no allow-same-origin) while keeping the
// export's own controls alive (allow-scripts).
test("full-history frame sandboxes the export without granting its origin", () => {
  const html = renderPane(
    React.createElement(FullHistoryFrame, { html: "<!doctype html><p>entry</p>", title: "Plan" }),
  );
  assert.match(html, /data-testid="full-history-frame"/);
  assert.match(html, /<iframe/);
  assert.match(html, /sandbox="allow-scripts"/);
  assert.doesNotMatch(html, /allow-same-origin/);
  assert.doesNotMatch(html, /\ssrc="/);
  assert.match(html, /srcdoc="[^"]*&lt;p&gt;entry&lt;\/p&gt;"/i);
  assert.match(html, /allow="clipboard-write"/);
});

// Regression guard for the reported bug: nothing in the web UI may hand a
// session export URL to a window opener. A `window.open` on an API URL
// resolves through the desktop shell's window-open handler into
// `shell.openExternal`, dropping the user out of the app into the system
// browser. (OAuth logins deliberately do leave for the provider's browser and
// are not export URLs, so they stay out of scope here.)
test("no web-ui source opens a session export through window.open", () => {
  const webUiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const offenders = [];
  for (const dir of ["components", "hooks", "lib"]) {
    const walk = current => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx|mjs)$/.test(entry.name)) {
          const text = fs.readFileSync(full, "utf8");
          if (/window\.open\([^)]*\/api\/sessions\/[^)]*export/.test(text)) {
            offenders.push(path.relative(webUiRoot, full));
          }
        }
      }
    };
    walk(path.join(webUiRoot, dir));
  }
  assert.deepEqual(offenders, []);
});
