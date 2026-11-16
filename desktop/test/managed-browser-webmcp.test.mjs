import assert from "node:assert/strict";
import test from "node:test";
import { WEBMCP_FEATURE, applyWebMCPFeature, withWebMCPFeature } from "../dist/managed-browser-webmcp.js";

function commandLine(initial) {
  let value = initial;
  const appends = [];
  return {
    appends,
    get value() { return value; },
    getSwitchValue(name) { return name === "enable-features" ? value : ""; },
    appendSwitch(name, next) { appends.push([name, next]); value = next; },
  };
}

test("WebMCP feature merge appends once, preserves existing features and is idempotent", () => {
  assert.equal(WEBMCP_FEATURE, "WebMCPTesting");

  const absent = commandLine("");
  applyWebMCPFeature(absent);
  applyWebMCPFeature(absent);
  assert.deepEqual(absent.appends, [["enable-features", "WebMCPTesting"]]);
  assert.equal(absent.value, "WebMCPTesting");

  const existing = commandLine("foo");
  applyWebMCPFeature(existing);
  applyWebMCPFeature(existing);
  assert.deepEqual(existing.appends, [["enable-features", "foo,WebMCPTesting"]]);
  assert.equal(existing.value, "foo,WebMCPTesting");

  for (const configured of ["foo,WebMCPTesting", "foo, WebMCPTesting", "WebMCPTesting", "bar,WebMCPTesting,baz"]) {
    const present = commandLine(configured);
    applyWebMCPFeature(present);
    applyWebMCPFeature(present);
    assert.deepEqual(present.appends, [], configured);
    assert.equal(present.value, configured);
  }

  assert.equal(withWebMCPFeature(withWebMCPFeature("")), "WebMCPTesting");
  assert.equal(withWebMCPFeature("alpha,beta"), "alpha,beta,WebMCPTesting");
});
