/**
 * Remote-access token plumbing for the web UI.
 *
 * The gateway enforces loopback-or-token access: requests that reach it
 * through a non-loopback host (LAN IP, tunnel, reverse proxy) must present the
 * configured `remote.token`. Local requests (127.0.0.1 / localhost) pass
 * without a token, so normal desktop use is unaffected.
 *
 * When the user configures `remote.token` in the settings panel, the raw value
 * is also stored in `localStorage` here; every `/api/*` fetch then attaches it
 * as `X-Zeta-Token`, so a browser opened via the LAN IP keeps working.
 */

const STORAGE_KEY = "zeta-remote-token";

export function getRemoteToken(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setRemoteToken(token: string | undefined): void {
  try {
    if (token) {
      window.localStorage.setItem(STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // storage unavailable — remote access simply won't authenticate
  }
}

let installed = false;

/** Patch `window.fetch` once so every `/api/*` request carries the token. */
export function installRemoteTokenFetch(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const original = window.fetch.bind(window);
  // Keep fetch's static helpers (e.g. `preconnect`) that lib.dom attaches.
  window.fetch = Object.assign(
    (input: RequestInfo | URL, init?: RequestInit) => {
      const token = getRemoteToken();
      if (token && typeof input === "string" && input.startsWith("/api/")) {
        init = {
          ...init,
          headers: { ...init?.headers, "X-Zeta-Token": token },
        };
      }
      return original(input, init);
    },
    original,
  ) as typeof fetch;
}
