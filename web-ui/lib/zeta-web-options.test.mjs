import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { parseLaunchOptions } = require("../bin/zeta-web-options.js");

test("opens the browser by default", () => {
  assert.deepEqual(parseLaunchOptions([], {}), {
    port: "30141",
    hostname: "127.0.0.1",
    openBrowser: true,
  });
});

test("supports the no-open CLI option", () => {
  assert.equal(parseLaunchOptions(["--no-open"], {}).openBrowser, false);
});

test("supports truthy ZETA_WEB_NO_OPEN and the legacy OMP_WEB_NO_OPEN fallback", () => {
  for (const env of ["ZETA_WEB_NO_OPEN", "OMP_WEB_NO_OPEN"]) {
    for (const value of ["1", "true", "TRUE", "yes", "on"]) {
      assert.equal(parseLaunchOptions([], { [env]: value }).openBrowser, false);
    }
  }
});

test("does not disable browser opening for false no-open values", () => {
  for (const env of ["ZETA_WEB_NO_OPEN", "OMP_WEB_NO_OPEN"]) {
    for (const value of ["0", "false", "off", ""]) {
      assert.equal(parseLaunchOptions([], { [env]: value }).openBrowser, true);
    }
  }
});

test("preserves port and hostname options", () => {
  assert.deepEqual(
    parseLaunchOptions(["-p", "8080", "-H", "0.0.0.0"], {}),
    {
      port: "8080",
      hostname: "0.0.0.0",
      openBrowser: true,
    },
  );
});

test("supports ZETA_WEB_HOSTNAME without trusting the ambient system HOSTNAME", () => {
  assert.equal(
    parseLaunchOptions([], { HOSTNAME: "container-id" }).hostname,
    "127.0.0.1",
  );
  assert.equal(
    parseLaunchOptions([], { ZETA_WEB_HOSTNAME: "0.0.0.0" }).hostname,
    "0.0.0.0",
  );
});
