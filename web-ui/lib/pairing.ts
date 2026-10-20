/**
 * Pairing payload handling for the web UI (mirror of the server's
 * `packages/coding-agent/src/server/pairing.ts` contract).
 *
 * A phone scans the QR from Settings → Remote Access, which opens
 * `https://host:port/#zeta-token=…`. The fragment is never sent to the server,
 * so the token does not land in access logs; on boot we move it into
 * `localStorage` (the same place the settings panel keeps it) and strip it
 * from the address bar so a later screenshot / shared link cannot leak it.
 */

export const PAIRING_FRAGMENT_KEY = "zeta-token";

/** Token carried by a pairing fragment, or `null` for unrelated hashes. */
export function parsePairingHash(hash: string): string | null {
  const raw = hash.replace(/^#/, "").trim();
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  const token = params.get(PAIRING_FRAGMENT_KEY)?.trim() ?? "";
  return token || null;
}

export interface PairingBootTarget {
  /** Location-like object: the real location in the browser, a fake in tests. */
  hash: string;
  pathname: string;
  search: string;
}

export interface PairingBootDeps {
  setToken: (token: string) => void;
  /** Replace the current history entry (drops the secret from the URL). */
  replaceUrl: (url: string) => void;
}

/**
 * Consume a pairing fragment once. Returns the paired token when one was
 * found, or `null` when there is nothing to do. The token is stored *before*
 * the URL is rewritten, so a failed history call still leaves the browser
 * authenticated.
 */
export function consumePairingFragment(location: PairingBootTarget, deps: PairingBootDeps): string | null {
  const token = parsePairingHash(location.hash);
  if (!token) return null;
  deps.setToken(token);
  try {
    deps.replaceUrl(`${location.pathname}${location.search}`);
  } catch {
    // The token is stored; a frozen history object must not break boot.
  }
  return token;
}
