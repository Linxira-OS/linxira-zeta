import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { SvgBlock } = await jiti.import("./SvgBlock.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

const svgSrc = `<svg viewBox="0 0 20 20" role="img">
  <rect width="20" height="20" fill="var(--accent)" />
</svg>`;

function renderSvg(props) {
  return renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(SvgBlock, props)));
}

test("SvgBlock renders source by default", () => {
  const html = renderSvg({ code: svgSrc });

  assert.match(html, />Preview</);
  assert.match(html, /&lt;svg/);
  assert.doesNotMatch(html, /figure-block-loading/);
});

test("SvgBlock shows a placeholder instead of the raw markup while previewing", () => {
  const html = renderSvg({ code: svgSrc, defaultPreview: true });

  assert.match(html, />Source</);
  assert.match(html, /figure-block-loading/);
  assert.doesNotMatch(html, /&lt;svg/);
  assert.doesNotMatch(html, /figure-block-error/);
});
