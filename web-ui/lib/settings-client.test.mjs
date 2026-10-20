import assert from "node:assert/strict";
import test from "node:test";

// The client is UI-agnostic; importing the TS module directly exercises the
// exact headers/body the browser sends.
const { fetchSettings, syncGatewayState, updateSetting } = await import("./settings-client.ts");

/** Install a fetch stub capturing requests and answering with `body`. */
function stubFetch(body = {}) {
  const calls = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { calls, restore: () => (globalThis.fetch = previous) };
}

test("fetchSettings sends the workspace cwd so GET merges its project layer", async () => {
  const stub = stubFetch({ tabs: [], groups: {}, settings: [] });
  try {
    await fetchSettings("en", "C:\\repos\\alpha");
  } finally {
    stub.restore();
  }
  assert.equal(stub.calls.length, 1);
  assert.equal(stub.calls[0].url, "/api/settings?lang=en");
  assert.equal(new Headers(stub.calls[0].init.headers).get("x-zeta-cwd"), "C:\\repos\\alpha");
});

test("updateSetting sends the workspace cwd and reports the shadowing layer", async () => {
  const stub = stubFetch({ ok: true, value: "mnemopi", provenance: "project", overriddenBy: "project" });
  let result;
  try {
    result = await updateSetting("memory.backend", "local", "/home/ada/repo");
  } finally {
    stub.restore();
  }
  assert.equal(stub.calls[0].init.method, "PUT");
  assert.equal(new Headers(stub.calls[0].init.headers).get("x-zeta-cwd"), "/home/ada/repo");
  assert.equal(new Headers(stub.calls[0].init.headers).get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(stub.calls[0].init.body), { path: "memory.backend", value: "local" });
  assert.deepEqual(result, { ok: true, value: "mnemopi", provenance: "project", overriddenBy: "project" });
});

test("syncGatewayState forwards the cwd on reload", async () => {
  const stub = stubFetch({ ok: true });
  try {
    await syncGatewayState("/home/ada/repo");
  } finally {
    stub.restore();
  }
  assert.equal(stub.calls[0].url, "/api/settings/reload");
  assert.equal(stub.calls[0].init.method, "POST");
  assert.equal(new Headers(stub.calls[0].init.headers).get("x-zeta-cwd"), "/home/ada/repo");
});

test("omitting the cwd sends no x-zeta-cwd header", async () => {
  const stub = stubFetch({ tabs: [], groups: {}, settings: [] });
  try {
    await fetchSettings("zh");
  } finally {
    stub.restore();
  }
  assert.equal(new Headers(stub.calls[0].init.headers).has("x-zeta-cwd"), false);
});

test("updateSetting surfaces the gateway error message", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: "bad value" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  try {
    await assert.rejects(() => updateSetting("memory.backend", "nope"), /HTTP 500|bad value/);
  } finally {
    globalThis.fetch = previous;
  }
});
