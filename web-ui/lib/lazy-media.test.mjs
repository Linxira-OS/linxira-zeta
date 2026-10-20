import assert from "node:assert/strict";
import test from "node:test";

const { BlobMediaCache, isDeferredMediaUrl } = await import("./lazy-media.ts");

function makeCache(overrides = {}) {
  const calls = [];
  const revoked = [];
  let nextUrl = 0;
  const cache = new BlobMediaCache({
    fetchImpl: async (input) => {
      calls.push(String(input));
      return new Response(new Blob(["png-bytes"]), { status: 200 });
    },
    createObjectUrl: () => `blob:zeta/${nextUrl++}`,
    revokeObjectUrl: (url) => revoked.push(url),
    ...overrides,
  });
  return { cache, calls, revoked };
}

test("recognizes blob-store paths only", () => {
  assert.equal(isDeferredMediaUrl("/api/blobs/abc123"), true);
  assert.equal(isDeferredMediaUrl("/api/sessions/x"), false);
  assert.equal(isDeferredMediaUrl("data:image/png;base64,QUJD"), false);
  assert.equal(isDeferredMediaUrl("https://h/api/blobs/x"), false);
});

test("dedupes repeated and concurrent loads into one fetch", async () => {
  const { cache, calls } = makeCache();
  const [first, second] = await Promise.all([cache.load("/api/blobs/a"), cache.load("/api/blobs/a")]);
  assert.equal(first, "blob:zeta/0");
  assert.equal(second, first);
  assert.equal(await cache.load("/api/blobs/a"), first);
  assert.deepEqual(calls, ["/api/blobs/a"]);
});

test("sends the request through fetch so the remote token header applies", async () => {
  const seen = [];
  const cache = new BlobMediaCache({
    fetchImpl: async (input, init) => {
      seen.push({ input, init });
      return new Response(new Blob(["x"]));
    },
    createObjectUrl: () => "blob:zeta/1",
    revokeObjectUrl: () => {},
  });
  await cache.load("/api/blobs/auth");
  assert.equal(seen[0].input, "/api/blobs/auth");
  assert.equal(seen[0].init.credentials, "same-origin");
});

test("a failed fetch rejects, drops the entry, and allows a retry", async () => {
  let attempt = 0;
  const cache = new BlobMediaCache({
    fetchImpl: async () => {
      attempt += 1;
      return attempt === 1 ? new Response("nope", { status: 401 }) : new Response(new Blob(["ok"]));
    },
    createObjectUrl: () => "blob:zeta/retry",
    revokeObjectUrl: () => {},
  });
  await assert.rejects(cache.load("/api/blobs/f"), /HTTP 401/);
  assert.equal(await cache.load("/api/blobs/f"), "blob:zeta/retry");
  assert.equal(attempt, 2);
});

test("evicts and revokes past the object-URL cap", async () => {
  const { cache, revoked } = makeCache({ maxEntries: 2 });
  await cache.load("/api/blobs/1");
  await cache.load("/api/blobs/2");
  await cache.load("/api/blobs/3");
  assert.equal(cache.size, 2);
  assert.deepEqual(revoked, ["blob:zeta/0"]);
  // The most recent entry survives.
  assert.equal(await cache.load("/api/blobs/3"), "blob:zeta/2");
});

test("clear revokes every live object URL", async () => {
  const { cache, revoked } = makeCache();
  await cache.load("/api/blobs/a");
  await cache.load("/api/blobs/b");
  cache.clear();
  assert.equal(cache.size, 0);
  assert.deepEqual(revoked.sort(), ["blob:zeta/0", "blob:zeta/1"]);
});
