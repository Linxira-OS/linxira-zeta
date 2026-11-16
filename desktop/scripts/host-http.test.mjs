import assert from "node:assert/strict";
import test from "node:test";
import { localHostConnection } from "../dist/host-http.js";
import { StudioHttp } from "../dist/remote/http.js";

test("local Host mutations bootstrap CSRF through the existing Electron cookie jar", async () => {
  const calls = [];
  const host = localHostConnection({ base: "http://127.0.0.1:43141/", cookie: async () => "studio_session=local-cookie", async fetch(url, init) {
    calls.push({ url, init });
    if (url.endsWith("/bootstrap")) return Response.json({}, { headers: { "x-studio-csrf": "csrf-from-host" } });
    return Response.json({ ok: true });
  } });
  await host.gateway("/api/terminal/ensure", { method: "POST", body: JSON.stringify({ cols: 80, rows: 24 }) });
  assert.deepEqual(calls.map(call => new URL(call.url).pathname), ["/api/v1/bootstrap", "/api/terminal/ensure"]);
  for (const call of calls) assert.equal(call.init.credentials, "include");
  assert.equal(calls[1].init.headers.get("x-studio-csrf"), "csrf-from-host");
  assert.equal(calls[1].init.headers.get("content-type"), "application/json");
  assert.equal(calls[1].init.headers.has("authorization"), false);
  await host.query({ queryName: "workspace.file.inspect", input: { workspaceId: "ws-a", path: "file.txt" } });
  assert.equal(calls.at(-1).init.headers.has("x-studio-csrf"), false);
  await assert.rejects(host.gateway("https://foreign.example/api/v1/query"), /Invalid/);
});

test("local Host never falls back to an implicit credential after bootstrap or device denial", async () => {
  let calls = 0;
  const host = localHostConnection({ base: "http://127.0.0.1:43141", cookie: async () => undefined, fetch: async () => { calls++; return new Response("revoked", { status: 401 }); } });
  await assert.rejects(host.gateway("/api/terminal/ensure", { method: "POST", body: "{}" }), /bootstrap failed/);
  assert.equal(calls, 1);
  await assert.rejects(host.query({ queryName: "workspace.file.inspect" }), /revoked/);
  assert.equal(calls, 2);
});

test("SSH StudioHttp keeps the session cookie and CSRF for terminal mutations and private preparation", async () => {
  const original = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/bootstrap")) return Response.json({}, { headers: { "set-cookie": "studio_session=ssh-cookie; HttpOnly; Path=/", "x-studio-csrf": "ssh-csrf" } });
    return Response.json({ ok: true });
  };
  try {
    const host = new StudioHttp("http://127.0.0.1:43999");
    await host.ensureSession();
    await host.gateway("/api/terminal/ensure", { method: "POST", body: "{}" });
    assert.equal(new Headers(calls[1].init.headers).get("cookie"), "studio_session=ssh-cookie");
    assert.equal(new Headers(calls[1].init.headers).get("x-studio-csrf"), "ssh-csrf");
    await host.query({ queryName: "workspace.file.inspect", input: { workspaceId: "ws-a", path: "file.txt" } });
    assert.equal(new Headers(calls[2].init.headers).get("cookie"), "studio_session=ssh-cookie");
    assert.equal(new Headers(calls[2].init.headers).get("x-studio-csrf"), null);
    await host.command({ commandName: "browser.observe.prepare", input: { sessionId: "session-a", tabId: "tab-a" } }, "context-a");
    assert.equal(new Headers(calls[3].init.headers).get("x-studio-context"), "context-a");
    assert.equal(new Headers(calls[3].init.headers).get("x-studio-csrf"), "ssh-csrf");
    assert.equal(new Headers(calls[3].init.headers).get("authorization"), null);
  } finally { globalThis.fetch = original; }
});
