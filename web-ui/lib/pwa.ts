/**
 * PWA plumbing for the web UI.
 *
 * The app is served by the user's own `zetacode serve` (LAN, reverse proxy, or
 * tunnel), so installability must not depend on a CDN: a static manifest plus
 * a same-origin service worker give an installable icon and an offline shell.
 *
 * Registration is deliberately conservative: only over a secure context (or
 * localhost, which browsers treat as secure), and only in a production build —
 * a dev server reload loop must never fight a cached shell. `NEXT_PUBLIC_ZETA_SW=1`
 * forces it on for a manual check.
 */

export const PWA_MANIFEST_PATH = "/manifest.webmanifest";
export const SERVICE_WORKER_PATH = "/sw.js";
export const SERVICE_WORKER_SCOPE = "/";
/** Cache name prefix the service worker owns (see public/sw.js). */
export const PWA_CACHE_PREFIX = "zeta-shell-";

export interface ServiceWorkerRegistrationLike {
  scope: string;
}

export interface ServiceWorkerEnvironment {
  /** `navigator.serviceWorker` (undefined in older/unsupported browsers). */
  serviceWorker?: {
    register: (scriptURL: string, options?: { scope?: string; updateViaCache?: "imports" | "all" | "none" }) => Promise<ServiceWorkerRegistrationLike>;
    controller?: unknown;
  };
  isSecureContext?: boolean;
  hostname?: string;
  nodeEnv?: string;
  /** Explicit override (tests / NEXT_PUBLIC_ZETA_SW). */
  force?: boolean;
}

function isLocalhost(hostname: string | undefined): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

/** Whether this environment should register the offline shell. */
export function shouldRegisterServiceWorker(env: ServiceWorkerEnvironment): boolean {
  if (!env.serviceWorker) return false;
  if (!env.force) {
    if (env.nodeEnv !== "production") return false;
    if (!env.isSecureContext && !isLocalhost(env.hostname)) return false;
  }
  return true;
}

/**
 * Register the shell worker. Returns the registration, or `null` when the
 * environment does not qualify or the browser rejected the registration —
 * failure is never fatal to the app.
 */
export async function registerServiceWorker(
  env: ServiceWorkerEnvironment,
): Promise<ServiceWorkerRegistrationLike | null> {
  if (!shouldRegisterServiceWorker(env)) return null;
  try {
    return await env.serviceWorker!.register(SERVICE_WORKER_PATH, {
      scope: SERVICE_WORKER_SCOPE,
      updateViaCache: "none",
    });
  } catch {
    return null;
  }
}

/** Browser-backed environment (the only caller outside tests). */
export function browserServiceWorkerEnvironment(): ServiceWorkerEnvironment {
  if (typeof window === "undefined" || typeof navigator === "undefined") return {};
  return {
    serviceWorker: navigator.serviceWorker as ServiceWorkerEnvironment["serviceWorker"],
    isSecureContext: window.isSecureContext,
    hostname: window.location.hostname,
    nodeEnv: process.env.NODE_ENV,
    force: process.env.NEXT_PUBLIC_ZETA_SW === "1",
  };
}
