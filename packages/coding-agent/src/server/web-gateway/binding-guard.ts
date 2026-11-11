/**
 * Binding-scope enforcement for bound device credentials.
 *
 * A device paired for one conversation/workspace must not reach anything else.
 * The target is resolved from the **real resource** a route operates on, never
 * from a caller-declared id that could simply be forged:
 *
 * - a session id in the path, or a live terminal's actual cwd;
 * - the project cwd a request carries in `x-zeta-cwd` (or `cwd`), which is what
 *   the file/git/board/settings handlers themselves use;
 * - canonical workspace ids come from the Host registry through
 *   {@link ResourceOwnership}, so an alias, a path, or a `?workspaceId=` lie
 *   cannot stand in for one.
 *
 * Anything that cannot be attributed (blobs, artifacts, global lists, a request
 * with no cwd) is refused for a bound credential instead of being allowed or
 * silently filtered. Identity/bootstrap routes are exempt so a bound client can
 * boot and answer a 2FA challenge instead of deadlocking.
 */

import { bindingAllows, type RequestTarget } from "../auth/binding";
import type { RemoteCredential } from "./remote-access";
import { credentialBinding } from "./remote-access";
import { terminalCwd } from "./terminal";

const SESSION_PATTERNS: readonly RegExp[] = [
	/^\/api\/sessions\/([^/]+)(?:\/|$)/u,
	/^\/api\/agent\/([^/]+)(?:\/|$)/u,
];

/** Routes whose resource is the project cwd the request carries. */
const CWD_ROUTE =
	/^\/api\/(?:files|file-index|git|git-actions|board|tracking|plan|settings|models|terminal)(?:\/|$)/u;

const TERMINAL_ID_PATTERN = /^\/api\/terminal\/([A-Za-z0-9-]{8,64})(?:\/|$)/u;

/**
 * Identity/bootstrap routes a bound device still needs.
 *
 * Refusing `bootstrap` outright would deadlock it. None of these carry another
 * conversation's content: the payload-scoped check for `query`/`command` runs
 * inside the host, and the device list is the account's own inventory.
 */
const BOUND_IDENTITY_ROUTES: Readonly<Record<string, true>> = {
	"/api/v1/bootstrap": true,
	"/api/v1/query": true,
	"/api/v1/events": true,
	"/api/v1/session/revoke": true,
	"/api/auth/2fa": true,
	"/api/auth/2fa/verify": true,
	"/api/remote/devices": true,
};

/**
 * Real ownership lookups supplied by the Studio lane.
 *
 * `workspaceOfSession` maps a conversation/session id to the canonical
 * workspace id; `workspaceOfCwd` maps a project directory to the same id. Both
 * return `undefined` when they cannot attribute the resource, which denies.
 */
export interface ResourceOwnership {
	workspaceOfSession(sessionId: string): Promise<string | undefined>;
	workspaceOfCwd(cwd: string): Promise<string | undefined>;
}

let ownership: ResourceOwnership | undefined;

/** Register (or clear) the ownership lookup used by binding checks. */
export function setResourceOwnership(next: ResourceOwnership | undefined): void {
	ownership = next;
}

/** The registered lookup bound to its owner (or `undefined` when unset). */
export function workspaceOfSessionResolver(): ((sessionId: string) => Promise<string | undefined>) | undefined {
	const current = ownership;
	if (current === undefined) return undefined;
	return (id: string) => current.workspaceOfSession(id);
}

export interface BindingDecision {
	readonly allowed: boolean;
	/** Resource the request was attributed to, for diagnostics and tests. */
	readonly target: RequestTarget | undefined;
}

/**
 * Resolve what a request really targets.
 *
 * `undefined` means "cannot be attributed" — a global list, a blob, or a cwd/
 * workspace the registry does not know. Declared `?workspaceId=` is only used
 * for routes that legitimately take it as their resource (none here: files and
 * terminals are attributed by cwd, sessions by path), so a forged query id can
 * never widen a binding.
 */
export async function requestTarget(
	pathname: string,
	url: URL,
	req: Request,
): Promise<RequestTarget | undefined> {
	for (const pattern of SESSION_PATTERNS) {
		const match = pattern.exec(pathname);
		if (match?.[1] !== undefined) return { sessionId: decodeURIComponent(match[1]) };
	}

	const terminalId = TERMINAL_ID_PATTERN.exec(pathname);
	if (terminalId?.[1] !== undefined) {
		const cwd = terminalCwd(terminalId[1]);
		return cwd === undefined ? undefined : workspaceTarget(cwd);
	}

	if (CWD_ROUTE.test(pathname)) {
		const cwd = req.headers.get("x-zeta-cwd")?.trim() || url.searchParams.get("cwd")?.trim() || "";
		return cwd === "" ? undefined : workspaceTarget(cwd);
	}

	return undefined;
}

/** Map a project cwd to the canonical workspace id through the Host registry. */
async function workspaceTarget(cwd: string): Promise<RequestTarget | undefined> {
	const workspaceId = await ownership?.workspaceOfCwd(cwd);
	return workspaceId === undefined || workspaceId === "" ? undefined : { workspaceId };
}

/**
 * Decide one request for a bound credential (`allowed` for unbound).
 *
 * Contradictory device/session bindings are narrower than either one, so they
 * refuse. A target that names both a session and a workspace is confirmed by
 * the resolver inside {@link bindingAllows}; a resolver that cannot confirm
 * denies.
 */
export async function bindingDecision(
	credential: RemoteCredential,
	pathname: string,
	url: URL,
	req: Request,
): Promise<BindingDecision> {
	const binding = credentialBinding(credential);
	if (binding === null) return { allowed: false, target: undefined };
	if (binding === undefined) return { allowed: true, target: undefined };
	if (BOUND_IDENTITY_ROUTES[pathname]) return { allowed: true, target: undefined };
	const target = await requestTarget(pathname, url, req);
	if (target === undefined) return { allowed: false, target: undefined };
	return { allowed: await bindingAllows(binding, target, workspaceOfSessionResolver()), target };
}

/** 403 payload for a binding refusal (distinct from a scope refusal). */
export function bindingScopeResponse(): Response {
	return Response.json({ error: "binding_scope" }, { status: 403, headers: { "cache-control": "no-store" } });
}
