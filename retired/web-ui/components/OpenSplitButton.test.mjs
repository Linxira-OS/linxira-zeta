import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const {
  OpenSplitButton,
  OpenTargetMenu,
  buildOpenMenuEntries,
  buildOpenRequestBody,
  desktopTargetIdFor,
  readStoredDefaultTarget,
  resolveDefaultTargetId,
  writeStoredDefaultTarget,
} = await jiti.import("./OpenSplitButton.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

function renderWithLocales(element) {
  return renderToStaticMarkup(React.createElement(I18nProvider, null, element));
}

/** Minimal Map-backed Storage stand-in (the harness has no window.localStorage). */
function fakeStorage() {
  const map = new Map();
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key),
    clear: () => map.clear(),
  };
}

test("menu entries merge gateway targets with desktop-host targets without duplicates", () => {
  const gateway = [
    { type: "terminal", label: "PowerShell", available: true },
    { type: "explorer", label: "File Manager", available: false },
    { type: "editor", editor: "vscode", label: "VS Code", available: false },
    { type: "terminal-ide", label: "Zeta IDE", available: true },
    { type: "terminal-editor", label: "Zeta Editor", available: false },
  ];
  // Desktop host executes file-manager and editor targets itself.
  const merged = buildOpenMenuEntries(gateway, [
    { id: "file-manager", label: "File manager" },
    { id: "editor:vscode", label: "VS Code" },
    { id: "mystery-host-target", label: "Mystery" },
  ]);

  const byId = new Map(merged.map(entry => [entry.id, entry]));
  assert.equal(merged.length, gateway.length, "host ids overlay gateway ids one-to-one");
  assert.equal(byId.get("explorer").available, true, "host file-manager replaces the grayed explorer entry");
  assert.equal(byId.get("editor:vscode").available, true, "host editor entry replaces the grayed one");
  assert.equal(byId.get("terminal").available, true, "gateway-direct targets survive the merge");
  assert.equal(byId.get("terminal-ide").available, true, "gateway-direct targets survive the merge");
  assert.equal(byId.has("mystery-host-target"), false, "unknown host ids are dropped");
});

test("menu entries keep the gateway merge intact when no host bridge reports targets", () => {
  const merged = buildOpenMenuEntries([
    { type: "terminal", label: "pwsh", available: true },
    { type: "explorer", label: "File Manager", available: true },
  ]);
  assert.deepEqual(merged.map(entry => entry.id), ["terminal", "explorer"]);
});

test("default target resolution prefers the stored choice, then the gateway suggestion, then availability", () => {
  const entries = [
    { id: "terminal", type: "terminal", label: "PowerShell", available: true },
    { id: "explorer", type: "explorer", label: "File Manager", available: true },
    { id: "editor:zed", type: "editor", label: "Zed", available: false },
  ];
  assert.equal(resolveDefaultTargetId(entries, "explorer"), "explorer");
  // Stored id is unavailable now (e.g. uninstalled): fall back to the gateway default.
  assert.equal(resolveDefaultTargetId(entries, "editor:zed", "terminal"), "terminal");
  assert.equal(resolveDefaultTargetId(entries, null, "explorer"), "explorer");
  assert.equal(resolveDefaultTargetId(entries, null, null), "terminal", "first available wins");
  assert.equal(resolveDefaultTargetId([{ id: "terminal", type: "terminal", label: "T", available: false }], null, null), null);
});

test("open request bodies map editor ids onto the editor target field", () => {
  assert.deepEqual(buildOpenRequestBody("editor:vscode", "C:/ws"), { target: "editor", editor: "vscode", path: "C:/ws" });
  assert.deepEqual(buildOpenRequestBody("terminal-ide", null), { target: "terminal-ide" });
  assert.deepEqual(buildOpenRequestBody("explorer", "/ws"), { target: "explorer", path: "/ws" });
});

test("only file-manager-style targets route through the desktop bridge", () => {
  assert.equal(desktopTargetIdFor("explorer"), "file-manager");
  assert.equal(desktopTargetIdFor("editor:cursor"), "editor:cursor");
  assert.equal(desktopTargetIdFor("terminal"), null);
  assert.equal(desktopTargetIdFor("terminal-ide"), null);
  assert.equal(desktopTargetIdFor("terminal-editor"), null);
});

test("default target persists in localStorage under the spec key", () => {
  const store = fakeStorage();
  assert.equal(readStoredDefaultTarget(store), null);
  writeStoredDefaultTarget("terminal-ide", store);
  assert.equal(readStoredDefaultTarget(store), "terminal-ide");
});

test("menu marks the default entry and grays unavailable ones with a not-found hint", () => {
  const entries = [
    { id: "terminal", type: "terminal", label: "PowerShell", available: true },
    { id: "editor:vscode", type: "editor", label: "VS Code", available: false },
  ];
  const html = renderWithLocales(
    React.createElement(OpenTargetMenu, { entries, defaultId: "terminal", onSelect: () => {} }),
  );
  assert.match(html, /Terminal/);
  assert.match(html, /· PowerShell/, "resolved shell name renders as detail");
  assert.match(html, /\(default\)/);
  assert.match(html, /disabled/);
  assert.match(html, /VS Code not found/);
});

test("menu renders platform labels and the empty state", () => {
  const html = renderWithLocales(
    React.createElement(OpenTargetMenu, {
      entries: [
        { id: "explorer", type: "explorer", label: "File Manager", available: true },
        { id: "terminal-ide", type: "terminal-ide", label: "Zeta IDE", available: true },
        { id: "terminal-editor", type: "terminal-editor", label: "Zeta Editor", available: true },
      ],
      defaultId: null,
      onSelect: () => {},
    }),
  );
  assert.match(html, /File Manager/);
  assert.match(html, /Zeta IDE/);
  assert.match(html, /Zeta Editor/);

  const empty = renderWithLocales(
    React.createElement(OpenTargetMenu, { entries: [], defaultId: null, onSelect: () => {} }),
  );
  assert.match(empty, /No apps found/);
});

test("split button renders both halves with the open label and chevron", () => {
  const html = renderWithLocales(React.createElement(OpenSplitButton, { activeCwd: "C:/ws" }));
  assert.match(html, /Open/);
  assert.match(html, /aria-haspopup="menu"/);
  assert.match(html, /Open with default target/);
  assert.match(html, /Choose open target/);
});
