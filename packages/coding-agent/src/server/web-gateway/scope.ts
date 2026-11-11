/**
 * Operation classification for remote credentials.
 *
 * Scope is decided by **what a route does**, not by its HTTP verb:
 * `POST /api/v1/query` is a read, `POST /api/terminal/:id/ticket` is a write,
 * and a WebSocket upgrade is a write because it opens a shell. Verb-based
 * classification is exactly how a read-only device used to slip through.
 */

export type OperationScope = "read" | "write" | "self";

/** Routes a `read` credential may call even though they are not `GET`. */
const READ_POST_ROUTES: Readonly<Record<string, true>> = {
	"/api/v1/query": true,
};

/**
 * Routes that manage the caller's own identity and are therefore available to
 * any authenticated credential (they cannot act on other resources).
 */
const SELF_ROUTES: Readonly<Record<string, true>> = {
	"/api/v1/pair": true,
	"/api/v1/session/revoke": true,
	"/api/auth/2fa": true,
	"/api/auth/2fa/verify": true,
};

/** Classify one request. Unknown mutations are writes. */
export function classifyOperation(pathname: string, method: string): OperationScope {
	if (method === "GET" || method === "HEAD") return "read";
	if (pathname in READ_POST_ROUTES) return "read";
	if (pathname in SELF_ROUTES) return "self";
	return "write";
}

/** Whether a credential's scope set satisfies the operation. */
export function scopeSatisfies(scopes: readonly string[], operation: OperationScope): boolean {
	if (operation === "self") return true;
	if (operation === "read") return true;
	return scopes.includes("write");
}
