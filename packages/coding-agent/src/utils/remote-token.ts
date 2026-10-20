/**
 * Remote-access token primitives shared by `zetacode serve`, the gateway
 * access gate, the pairing endpoint, and the web-config rotation helpers.
 *
 * The active token lives in plaintext in `web.yml` (it must be shown once for
 * pairing), while every token that was rotated away or revoked is stored only
 * as its SHA-256 hash — the config file then never keeps a growing list of
 * live secrets.
 */

import { createHash, randomBytes } from "node:crypto";

/** Placeholder the config GET returns for a configured secret. */
export const MASKED_TOKEN = "••••";

/** Hash form stored in `remote.revokedTokens`. */
export function hashRemoteToken(token: string): string {
	return createHash("sha256").update(token, "utf8").digest("hex");
}

/** A fresh 32-byte URL-safe token (43 chars, no padding). */
export function generateRemoteToken(): string {
	return randomBytes(32).toString("base64url");
}

/**
 * Whether `provided` is the configured active token and not revoked.
 *
 * `provided` may carry a `Bearer ` prefix (the gateway passes the raw
 * Authorization header). `revokedTokens` holds hashes; a rotated-away token is
 * therefore rejected even if some client still presents it. A masked
 * placeholder never authenticates.
 */
export function isRemoteTokenAccepted(
	remote: { token?: string; revokedTokens?: string[] } | undefined,
	provided: string | null | undefined,
): boolean {
	const active = remote?.token?.trim() ?? "";
	if (active === "" || active === MASKED_TOKEN) return false;
	const candidate = (provided ?? "").replace(/^Bearer\s+/i, "").trim();
	if (candidate === "" || candidate !== active) return false;
	return !(remote?.revokedTokens ?? []).includes(hashRemoteToken(candidate));
}
