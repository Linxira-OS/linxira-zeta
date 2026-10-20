import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { MediaImage } = await jiti.import("./MediaImage.tsx");

function render(props) {
  return renderToStaticMarkup(React.createElement(MediaImage, props));
}

test("a deferred blob source renders a placeholder instead of an unauthenticated <img>", () => {
  const html = render({ src: "/api/blobs/deadbeef" });
  assert.match(html, /data-zeta-media="deferred"/);
  assert.doesNotMatch(html, /<img/);
});

test("inline data URLs render immediately", () => {
  const html = render({ src: "data:image/png;base64,QUJD" });
  assert.match(html, /<img[^>]+src="data:image\/png;base64,QUJD"/);
  assert.match(html, /loading="lazy"/);
});

test("an existing object URL is passed through", () => {
  const html = render({ src: "blob:https://zeta.example/1234" });
  assert.match(html, /src="blob:https:\/\/zeta\.example\/1234"/);
});
