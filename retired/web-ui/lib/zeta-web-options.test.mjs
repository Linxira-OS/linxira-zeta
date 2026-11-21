import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { DEFAULT_GATEWAY_PORT, parseLaunchOptions, resolveGatewayUrl } = require("../bin/zeta-web-options.js");

test("opens the browser by default", () => {
  assert.deepEqual(parseLaunchOptions([], {}), {
    port: "30141",
    hostname: "127.0.0.1",
    openBrowser: true,
    gatewayUrl: "http://127.0.0.1:43143",
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
      gatewayUrl: "http://127.0.0.1:43143",
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

test("the gateway default matches the serve block, not the upstream 30142", () => {
  assert.equal(DEFAULT_GATEWAY_PORT, "43143");
  assert.equal(resolveGatewayUrl(undefined, {}), "http://127.0.0.1:43143");
});

test("gateway origin precedence: --gateway, then ZETA_WEB_GATEWAY_URL, then the port env", () => {
  assert.equal(
    resolveGatewayUrl("http://127.0.0.1:5000/", { ZETA_WEB_GATEWAY_URL: "http://127.0.0.1:6000" }),
    "http://127.0.0.1:5000",
  );
  assert.equal(
    resolveGatewayUrl(undefined, { ZETA_WEB_GATEWAY_URL: "http://10.0.0.2:7000/" }),
    "http://10.0.0.2:7000",
  );
  assert.equal(resolveGatewayUrl(undefined, { ZETA_WEB_GATEWAY_PORT: "8123" }), "http://127.0.0.1:8123");
});
