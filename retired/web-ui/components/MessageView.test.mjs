import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { MessageView } = await jiti.import("./MessageView.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

function render(element) {
  return renderToStaticMarkup(React.createElement(I18nProvider, null, element));
}

const toolCallMessage = {
  role: "assistant",
  content: [{ type: "toolCall", toolCallId: "c1", toolName: "browser", input: {} }],
};

function toolResultsWith(content) {
  return new Map([
    [
      "c1",
      {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "browser",
        isError: false,
        content,
      },
    ],
  ]);
}

test("a deferred tool-result image waits for an authenticated blob fetch, not a raw <img src>", () => {
  // What a `deferMedia` history load now emits: the blob URL, not a notice.
  // The phone cannot use a bare <img src> here — the remote gate needs the
  // X-Zeta-Token header, so MediaImage fetches the bytes and renders the
  // object URL once the element is near the viewport.
  const html = render(
    React.createElement(MessageView, {
      message: toolCallMessage,
      toolResults: toolResultsWith([
        { type: "text", text: "screenshot" },
        { type: "image", source: { type: "url", url: "/api/blobs/abc123" } },
      ]),
    }),
  );

  assert.match(html, /data-zeta-media="deferred"/);
  assert.doesNotMatch(html, /<img[^>]+src="\/api\/blobs\//);
});

test("a live tool-result image renders from its inline base64", () => {
  const html = render(
    React.createElement(MessageView, {
      message: toolCallMessage,
      toolResults: toolResultsWith([{ type: "image", data: "QUJD", mimeType: "image/png" }]),
    }),
  );

  assert.match(html, /<img[^>]+src="data:image\/png;base64,QUJD"/);
});

test("assistant-native images render as blocks", () => {
  const html = render(
    React.createElement(MessageView, {
      message: { role: "assistant", content: [{ type: "image", data: "QUJD", mimeType: "image/png" }] },
    }),
  );

  assert.match(html, /<img[^>]+src="data:image\/png;base64,QUJD"/);
});
