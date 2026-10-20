import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pwa = await import("./pwa.ts");

const publicUrl = (name) => new URL(`../public/${name}`, import.meta.url);

test("the manifest is installable: identity, standalone display, 192/512/maskable icons", async () => {
  const manifest = JSON.parse(await readFile(publicUrl("manifest.webmanifest"), "utf8"));
  assert.equal(manifest.name, "Zeta");
  assert.equal(manifest.short_name, "Zeta");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.theme_color, "#111827");
  const sizes = new Set(manifest.icons.map((icon) => icon.sizes));
  assert.ok(sizes.has("192x192"));
  assert.ok(sizes.has("512x512"));
  assert.ok(manifest.icons.some((icon) => icon.purpose === "maskable"));
  assert.equal(typeof manifest.id, "string");
});

test("every manifest icon is a real PNG file on disk", async () => {
  const manifest = JSON.parse(await readFile(publicUrl("manifest.webmanifest"), "utf8"));
  for (const icon of manifest.icons) {
    const bytes = await readFile(publicUrl(icon.src.replace(/^\//, "")));
    assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], icon.src);
  }
  const apple = await readFile(publicUrl("icons/apple-touch-icon.png"));
  assert.equal(apple[0], 0x89);
});

test("the service worker caches only the shell and never /api", async () => {
  const sw = await readFile(publicUrl("sw.js"), "utf8");
  assert.match(sw, /const CACHE_PREFIX = "zeta-shell-";/);
  assert.match(sw, /const OFFLINE_PATH = "\/offline\.html";/);
  assert.match(sw, /"\/manifest\.webmanifest"/);
  assert.match(sw, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(sw, /request\.mode === "navigate"/);
  // The precache list must not contain an API route.
  const precache = /const PRECACHE_URLS = \[([\s\S]*?)\];/.exec(sw);
  assert.ok(precache, "PRECACHE_URLS must exist");
  assert.doesNotMatch(precache[1], /\/api\//);
});

test("the offline shell page exists and is self-contained", async () => {
  const html = await readFile(publicUrl("offline.html"), "utf8");
  assert.match(html, /Zeta is offline/);
  assert.match(html, /location\.reload\(\)/);
  assert.doesNotMatch(html, /<script src=/);
});

test("registration is limited to production secure contexts (or localhost)", () => {
  const worker = { register: async () => ({ scope: "/" }) };
  assert.equal(pwa.shouldRegisterServiceWorker({}), false);
  assert.equal(pwa.shouldRegisterServiceWorker({ serviceWorker: worker }), false);
  assert.equal(
    pwa.shouldRegisterServiceWorker({ serviceWorker: worker, nodeEnv: "production", isSecureContext: true }),
    true,
  );
  assert.equal(
    pwa.shouldRegisterServiceWorker({
      serviceWorker: worker,
      nodeEnv: "development",
      isSecureContext: true,
    }),
    false,
  );
  assert.equal(
    pwa.shouldRegisterServiceWorker({
      serviceWorker: worker,
      nodeEnv: "production",
      isSecureContext: false,
      hostname: "zeta.example.com",
    }),
    false,
  );
  assert.equal(
    pwa.shouldRegisterServiceWorker({
      serviceWorker: worker,
      nodeEnv: "production",
      isSecureContext: false,
      hostname: "localhost",
    }),
    true,
  );
  assert.equal(pwa.shouldRegisterServiceWorker({ serviceWorker: worker, force: true }), true);
});

test("registration uses the shell worker with a fresh check for updates", async () => {
  const calls = [];
  const registration = await pwa.registerServiceWorker({
    serviceWorker: {
      register: async (scriptURL, options) => {
        calls.push({ scriptURL, options });
        return { scope: options?.scope ?? "/" };
      },
    },
    force: true,
  });
  assert.equal(registration.scope, "/");
  assert.deepEqual(calls, [
    { scriptURL: "/sw.js", options: { scope: "/", updateViaCache: "none" } },
  ]);
  assert.equal(pwa.PWA_MANIFEST_PATH, "/manifest.webmanifest");
  assert.equal(pwa.PWA_CACHE_PREFIX, "zeta-shell-");
});

test("a rejected registration is not fatal", async () => {
  const registration = await pwa.registerServiceWorker({
    serviceWorker: {
      register: async () => {
        throw new Error("blocked");
      },
    },
    force: true,
  });
  assert.equal(registration, null);
});
