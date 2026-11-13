/**
 * Authenticated fetch for the host surfaces that predate the Studio client.
 *
 * The primary remote credential is the device-bound `studio_session` cookie,
 * which the browser attaches itself. This module exists for the narrow case
 * where a page still has to prove itself with a header — a native shell, or a
 * scripted probe — and for a single bootstrap exchange inside a browser tab.
 *
 * It deliberately holds the credential **in memory only**: nothing is written
 * to `localStorage`/`sessionStorage`, so a reload loses it and an XSS cannot
 * read it back. The cookie remains the durable credential.
 */

type AuthToken = string | null;

let token: AuthToken = null;

/** Set (or clear) the in-memory bearer token used by {@link authFetch}. */
export function setAuthToken(next: AuthToken): void {
	token = next !== null && next.trim() !== "" ? next.trim() : null;
}

/** Whether an in-memory bearer token is currently installed. */
export function hasAuthToken(): boolean {
	return token !== null;
}

/**
 * `fetch` with the in-memory bearer token, if any.
 *
 * `credentials: "include"` is the default for same-origin requests, but it is
 * stated explicitly because the cookie is the credential that matters on a
 * remote origin.
 */
export function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	const headers = new Headers(init?.headers);
	if (token !== null && !headers.has("authorization")) headers.set("authorization", `Bearer ${token}`);
	return fetch(input, { ...init, headers, credentials: init?.credentials ?? "include" });
}

