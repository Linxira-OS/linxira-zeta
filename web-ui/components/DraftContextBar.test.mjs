import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { DraftContextBar, fetchDraftBranches } = await jiti.import("./DraftContextBar.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

function renderWithLocales(element) {
  return renderToStaticMarkup(React.createElement(I18nProvider, null, element));
}

const originalFetch = globalThis.fetch;

test("workspace chip shows the draft cwd leaf name", () => {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ isGitRepository: false }),
  });
  try {
    const html = renderWithLocales(React.createElement(DraftContextBar, { cwd: "C:/dev/some-project" }));
    assert.match(html, /some-project/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("null cwd renders the select-workspace placeholder", () => {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ isGitRepository: false }),
  });
  try {
    const html = renderWithLocales(React.createElement(DraftContextBar, { cwd: null }));
    assert.match(html, /Select workspace/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("branch chip hides when the draft cwd is not a git repository", () => {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ isGitRepository: false }),
  });
  try {
    const html = renderWithLocales(React.createElement(DraftContextBar, { cwd: "C:/dev/plain" }));
    assert.doesNotMatch(html, /Branch/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("branch helper returns null for a non-git draft cwd", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ isGitRepository: false }),
  });
  try {
    assert.equal(await fetchDraftBranches("C:/dev/plain"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("branch helper returns normalized branch data for a git repo", async () => {
  globalThis.fetch = async url => {
    assert.match(String(url), /\/api\/git\/branches\?cwd=C%3A%2Fdev%2Frepo/);
    return {
      ok: true,
      status: 200,
      json: async () => ({ isGitRepository: true, current: "feat/webui", branches: [{ name: "main" }, { name: "feat/webui" }] }),
    };
  };
  try {
    const d = await fetchDraftBranches("C:/dev/repo");
    assert.equal(d.current, "feat/webui");
    assert.deepEqual(d.branches.map(b => b.name), ["main", "feat/webui"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("branch helper swallows fetch failures", async () => {
  globalThis.fetch = async () => {
    throw new Error("network down");
  };
  try {
    assert.equal(await fetchDraftBranches("C:/dev/repo"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
