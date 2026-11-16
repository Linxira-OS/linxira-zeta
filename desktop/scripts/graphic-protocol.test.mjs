import assert from "node:assert/strict";
import test from "node:test";
import { graphicAssetResponse } from "../dist/graphic-protocol.js";

// Official graphic-protocol cases adapted to the existing Host-served bundle.
// Desktop never guesses a local dist directory or exposes arbitrary files.
test("isolated graphic viewer forwards bundled modules and WASM through the Host session", async () => {
  const wasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]), calls = [];
  const source = new Map([["graphic-preview.html", "<html>viewer</html>"], ["assets/graphic-test.js", "export const ready = true;"], ["graphics-xite/assets/lib/tangents.wasm", wasm]]);
  const options = { base: "http://127.0.0.1:43141", async fetch(url, init) {
    calls.push({ url, init });
    const body = source.get(new URL(url).pathname.slice(1));
    return body === undefined ? new Response(null, { status: 404 }) : new Response(init.method === "HEAD" ? null : body);
  } };
  const get = (path, method = "GET") => graphicAssetResponse(new Request(`zeta-graphics://viewer/${path}`, { method }), options);
  const viewer = await get("graphic-preview.html");
  assert.equal(viewer.status, 200);
  assert.match(viewer.headers.get("content-type"), /text\/html/);
  assert.equal(viewer.headers.get("access-control-allow-origin"), "null");
  const policy = viewer.headers.get("content-security-policy");
  assert.match(policy, /sandbox allow-scripts;/);
  assert.ok(!policy.includes("allow-same-origin"));
  assert.match(policy, /script-src 'self' 'wasm-unsafe-eval';/);
  assert.ok(!policy.includes("'unsafe-eval'"));
  assert.equal(await (await get("assets/graphic-test.js")).text(), "export const ready = true;");
  const module = await get("graphics-xite/assets/lib/tangents.wasm");
  assert.equal(module.headers.get("content-type"), "application/wasm");
  assert.deepEqual(new Uint8Array(await module.arrayBuffer()), wasm);
  assert.equal(await (await get("graphic-preview.html", "HEAD")).text(), "");
  for (const call of calls) { assert.equal(call.init.credentials, "include"); assert.equal(call.init.redirect, "error"); assert.equal(new URL(call.url).origin, options.base); }
  const count = calls.length;
  for (const path of ["private.json", "index.html", "assets/private.json", "graphics-xite/%2e%2e%2fprivate.json", "graphics-xite/%2e%2e%2fassets/graphic-test.js", "graphics-xite/%5cprivate.png"]) assert.equal((await get(path)).status, 404);
  for (const path of ["graphic-preview.html?path=private.json", "graphic-preview.html#private"]) assert.equal((await get(path)).status, 400);
  assert.equal(calls.length, count);
  assert.equal((await graphicAssetResponse(new Request("zeta-graphics://foreign/graphic-preview.html"), options)).status, 400);
  assert.equal((await get("graphic-preview.html", "POST")).status, 400);
});

test("missing or redirected Host assets never become successful viewer documents", async () => {
  const request = new Request("zeta-graphics://viewer/graphic-preview.html");
  assert.equal((await graphicAssetResponse(request, { base: "http://127.0.0.1:43141", fetch: async () => new Response(null, { status: 404 }) })).status, 404);
  assert.equal((await graphicAssetResponse(request, { base: "http://127.0.0.1:43141", fetch: async () => new Response(null, { status: 302 }) })).status, 502);
});
