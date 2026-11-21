/**
 * Zeta web UI service worker — offline shell only.
 *
 * Contract (mirrored by `lib/pwa.ts` and its test):
 * - precache the shell (`/`), the offline page, the manifest, and the icons;
 * - never touch `/api/*` (agent state, blobs, SSE) — those must always be
 *   live or fail visibly, and caching them would leak data between sessions;
 * - navigation is network-first with the cached shell as an offline fallback,
 *   so an installed phone app opens instantly but never serves stale UI;
 * - hashed `/_next/static/*` assets are cache-first (immutable by name).
 */

const CACHE_PREFIX = "zeta-shell-";
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const OFFLINE_PATH = "/offline.html";
const PRECACHE_URLS = [
  "/",
  OFFLINE_PATH,
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isStaticAsset(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/");
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put("/", copy)).catch(() => {});
          }
          return response;
        })
        .catch(() =>
          caches
            .match("/")
            .then((cached) => cached ?? caches.match(OFFLINE_PATH))
            .then((cached) => cached ?? new Response("Zeta is offline", { status: 503 })),
        ),
    );
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
            }
            return response;
          }),
      ),
    );
  }
});
