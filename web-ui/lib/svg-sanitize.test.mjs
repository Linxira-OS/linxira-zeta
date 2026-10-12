import assert from "node:assert/strict";
import test from "node:test";

import { SVG_SANITIZE_CONFIG, isSelfContainedReference, sanitizeSvg } from "./svg-sanitize.ts";

test("keeps same-document references and drops everything else", () => {
  assert.equal(isSelfContainedReference("href", "#marker"), true);
  assert.equal(isSelfContainedReference("href", "  #marker"), true);
  assert.equal(isSelfContainedReference("xlink:href", "  #marker"), true);
  assert.equal(isSelfContainedReference("href", "https://example.com/x.svg#marker"), false);
  assert.equal(isSelfContainedReference("href", "//example.com/x.svg"), false);
  assert.equal(isSelfContainedReference("src", "data:image/svg+xml;base64,AAAA"), false);
});

test("treats paint/filter references the same way", () => {
  assert.equal(isSelfContainedReference("filter", "url(#blur)"), true);
  assert.equal(isSelfContainedReference("clip-path", "url( '#clip' )"), true);
  assert.equal(isSelfContainedReference("fill", "url(https://example.com/x.svg#grad)"), false);
  assert.equal(isSelfContainedReference("style", "fill:url(#grad);stroke:var(--accent)"), true);
  assert.equal(isSelfContainedReference("style", "fill:url(http://example.com/x.svg#grad)"), false);
});

test("passes theme tokens and literals through", () => {
  assert.equal(isSelfContainedReference("fill", "currentColor"), true);
  assert.equal(isSelfContainedReference("stroke", "var(--accent)"), true);
  assert.equal(isSelfContainedReference("fill", "none"), true);
});

test("limits a figure to the SVG profile and bars the injection carriers", () => {
  assert.deepEqual(SVG_SANITIZE_CONFIG.USE_PROFILES, { svg: true, svgFilters: true });
  assert.deepEqual(SVG_SANITIZE_CONFIG.FORBID_TAGS, ["script", "foreignObject", "style"]);
});

test("refuses to sanitize without a DOM instead of passing markup through", () => {
  // Node has no DOM: DOMPurify would hand the source back untouched.
  assert.equal(sanitizeSvg('<svg onload="alert(1)"/>'), null);
});
