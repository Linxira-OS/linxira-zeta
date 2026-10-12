import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { MarkdownBody } = await jiti.import("./MarkdownBody.tsx");
const { closedSvgFences, normalizeDisplayMath } = await jiti.import("../lib/markdown.ts");

function renderMarkdown(markdown) {
  return renderToStaticMarkup(
    React.createElement(MarkdownBody, {
      cwd: "/home/me/project",
      onOpenFile() {},
    }, markdown),
  );
}

test("opens non-file markdown links in a safe new tab", () => {
  const html = renderMarkdown("[docs](https://example.com/docs)");

  assert.match(
    html,
    /<a (?=[^>]*href="https:\/\/example\.com\/docs")(?=[^>]*target="_blank")(?=[^>]*rel="noopener noreferrer")[^>]*>docs<\/a>/,
  );
  assert.doesNotMatch(html, /\snode=/);
});

test("keeps local file markdown links in the app", () => {
  const html = renderMarkdown("[file](components/MarkdownBody.tsx)");

  assert.match(html, /<a href="components\/MarkdownBody\.tsx">file<\/a>/);
  assert.doesNotMatch(html, /target=|rel=|\snode=/);
});

test("renders LaTeX parenthesis delimiters as inline math", () => {
  const html = renderMarkdown(String.raw`射线为 \(r_c = K^{-1}p\)。`);

  assert.match(html, /class="katex"/);
  assert.match(html, /r_c/);
});

test("renders paired LaTeX bracket delimiters as display math", () => {
  const html = renderMarkdown(String.raw`\[
P(\lambda)=o_b+\lambda r_b
\]`);
  const oneLineHtml = renderMarkdown(String.raw`\[P(\lambda)=o_b+\lambda r_b\]`);

  assert.match(html, /class="katex-display"/);
  assert.match(html, /lambda/);
  assert.match(oneLineHtml, /class="katex-display"/);
});

test("leaves an unmatched LaTeX bracket delimiter unchanged", () => {
  const markdown = String.raw`before
\[
x + y
after`;

  assert.equal(normalizeDisplayMath(markdown), markdown);
});

test("does not normalize LaTeX delimiters inside Markdown code", () => {
  const markdown = "    \\(indented\\)\n\n`code\n\\(inline\\)`\n\n```text\n\\[\nfenced\n\\]\n```";

  assert.equal(normalizeDisplayMath(markdown), markdown);
});

test("does not normalize LaTeX delimiters inside raw HTML code", () => {
  const markdown = "<code>\\(inline\\)</code>\n\n<pre>\n\\(block\\)\n</pre>";

  assert.equal(normalizeDisplayMath(markdown), markdown);
});

test("does not normalize escaped delimiters or link destinations", () => {
  const escaped = String.raw`Literal: \\(x+y\\).`;
  const link = String.raw`[docs](https://example.com/\(manual\))`;

  assert.equal(normalizeDisplayMath(escaped), escaped);
  assert.equal(normalizeDisplayMath(link), link);
});

test("draws a closed svg fence as a figure, not as code", () => {
  const html = renderMarkdown('```svg\n<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>\n```');

  assert.match(html, /figure-block-loading/);
  assert.match(html, />Source</);
  assert.doesNotMatch(html, /&lt;svg/);
});

test("keeps an unclosed svg fence as code while the reply streams", () => {
  const html = renderMarkdown('```svg\n<svg viewBox="0 0 10 10">\n  <circle cx="5" cy="5" r="4"/>');

  assert.doesNotMatch(html, /figure-block-loading/);
  assert.match(html, /&lt;svg/);
});

test("keeps a non-svg fence as code", () => {
  const html = renderMarkdown('```xml\n<svg viewBox="0 0 10 10"/>\n```');

  assert.doesNotMatch(html, /figure-block-loading/);
  assert.match(html, /&lt;svg/);
});

test("closedSvgFences reports the source of closed svg fences only", () => {
  const fences = closedSvgFences(
    [
      "```ts",
      "const a = 1;",
      "```",
      "",
      "```svg",
      '<svg viewBox="0 0 4 4" />',
      "```",
      "",
      "```svg",
      '<svg viewBox="0 0 8 8">',
      "  <rect width=\"8\" height=\"8\" />",
    ].join("\n"),
  );

  assert.deepEqual([...fences], ['<svg viewBox="0 0 4 4" />']);
});

test("closedSvgFences dedents content up to the opening fence's indentation", () => {
  const fences = closedSvgFences(["  ```svg", "  <svg />", "  ```"].join("\n"));

  assert.deepEqual([...fences], ["<svg />"]);
});
