import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { PlanApproval } = await jiti.import("./PlanApproval.tsx");

test("PlanApproval renders plan title, preview toggle and the four action buttons", () => {
  const html = renderToStaticMarkup(
    React.createElement(PlanApproval, {
      planFilePath: "local://auth-plan.md",
      planTitle: "Auth refresh",
      planMarkdown: "# Auth refresh\n\nSteps.",
      onApprove() {},
    }),
  );
  assert.ok(html.includes("Auth refresh"), "renders plan title in the header");
  assert.ok(html.includes("Preview"), "renders the expand/collapse toggle");
  for (const label of ["Execute (preserve context)", "Summarize &amp; execute", "New session &amp; execute", "Cancel"]) {
    assert.ok(html.includes(label), `renders action button "${label}"`);
  }
});
