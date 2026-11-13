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
 * Routes that manage the caller's **own** identity and cannot touch another
 * resource. They are matched with a method: `GET /api/auth/2fa` is a status
 * read, while enroll/confirm/disable/recovery/policy are credential mutations
 * and must not ride in on a "self" exemption.
 */
function isSelfRoute(pathname: string, method: string): boolean {
	if (pathname === "/api/v1/pair" || pathname === "/api/v1/session/revoke") return true;
	if (pathname === "/api/auth/2fa") return method === "GET" || method === "HEAD";
	if (pathname === "/api/auth/2fa/verify") return method === "POST";
	return false;
}

/** Classify one request. Unknown mutations are writes. */
export function classifyOperation(pathname: string, method: string): OperationScope {
	if (method === "GET" || method === "HEAD") return "read";
	if (pathname in READ_POST_ROUTES) return "read";
	if (isSelfRoute(pathname, method)) return "self";
	return "write";
}

/**
 * Whether a credential's scope set satisfies the operation.
 *
 * Scopes are explicit grants, the same way `device-registry` stores them: a
 * device is issued `["read", "write"]` unless an operator narrows it, `write`
 * does **not** imply `read`, and an empty set reaches nothing — not even its
 * own identity routes.
 */
export function scopeSatisfies(scopes: readonly string[], operation: OperationScope): boolean {
	if (operation === "write") return scopes.includes("write");
	return scopes.includes("read");
}
