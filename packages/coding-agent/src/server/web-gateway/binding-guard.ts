/**
 * Binding-scope enforcement for bound device credentials.
 *
 * A device paired for one conversation/workspace must not reach anything else.
 * The plan is resolved from the request line only (path + query): REST bodies
 * are consumed by their handlers and must not be read twice here. Two route
 * families are therefore handled where the body is available:
 *
 * - `/api/v1/query|command` — checked inside `StudioHost`, which owns the body;
 * - `/api/v1/events` — delivery is already keyed by the authenticated session.
 *
 * Everything else either names a session/workspace (allowed only when it is the
 * bound one) or names nothing global (refused). A global list is refused rather
 * than silently filtered: a bound device is a narrow surface, and an empty
 * request must never widen it.
 *
 * `workspaceId` means the Host registry's canonical workspace identity — the
 * same key `history.workspaceId` and the gateway workspace rows use — never a
 * path or an alias.
 */

import { bindingAllows, type RequestTarget } from "../auth/binding";
import type { RemoteCredential } from "./remote-access";
import { credentialBinding } from "./remote-access";

const SESSION_PATTERNS: readonly RegExp[] = [
	/^\/api\/sessions\/([^/]+)(?:\/|$)/u,
	/^\/api\/agent\/([^/]+)(?:\/|$)/u,
];

const WORKSPACE_ROUTE =
	/^\/(?:api\/(?:files|file-index|git|git-actions|workspace|projects|terminal|board|tracking|plan)(?:\/|$))/u;

/**
 * Real ownership lookup supplied by the Studio lane.
 *
 * `workspaceOfSession` maps a conversation/session id to the canonical
 * workspace id from the Host registry. Without it a workspace-bound device that
 * asks for a session is refused (fail closed); registering it is what unlocks
 * that case.
 */
export interface ResourceOwnership {
	workspaceOfSession(sessionId: string): Promise<string | undefined>;
}

let ownership: ResourceOwnership | undefined;

/** Register (or clear) the ownership lookup used by binding checks. */
export function setResourceOwnership(next: ResourceOwnership | undefined): void {
	ownership = next;
}

/** The registered lookup, bound to its owner (or `undefined` when unset). */
export function workspaceOfSessionResolver(): ((sessionId: string) => Promise<string | undefined>) | undefined {
	const current = ownership;
	if (current === undefined) return undefined;
	return (id: string) => current.workspaceOfSession(id);
}

export interface BindingDecision {
	readonly allowed: boolean;
	/** Resource the request names, for diagnostics and tests. */
	readonly target: RequestTarget | undefined;
}

/**
 * Resolve what a REST request targets. `undefined` means "no identifiable
 * resource" — a global list or a machine-wide route.
 */
export function requestTarget(pathname: string, url: URL): RequestTarget | undefined {
	// Both sources contribute: a path id and a query id describe the same
	// request, and dropping either would let a mismatching one slip through.
	let pathSession: string | undefined;
	for (const pattern of SESSION_PATTERNS) {
		const match = pattern.exec(pathname);
		if (match?.[1] !== undefined) {
			pathSession = decodeURIComponent(match[1]);
			break;
		}
	}
	const querySession = url.searchParams.get("sessionId") ?? url.searchParams.get("session") ?? "";
	const sessionId = pathSession ?? (querySession !== "" ? querySession : undefined);
	const workspaceId = url.searchParams.get("workspaceId") ?? url.searchParams.get("workspace") ?? "";
	if (sessionId !== undefined || workspaceId !== "") {
		return {
			...(sessionId !== undefined ? { sessionId } : {}),
			...(workspaceId !== "" ? { workspaceId } : {}),
		};
	}
	// A workspace-scoped family with no id in the request cannot be attributed to
	// one workspace, so it is treated as global and refused for a bound device.
	if (WORKSPACE_ROUTE.test(pathname)) return undefined;
	return undefined;
}

/**
 * Decide one request for a bound credential (`allowed` for unbound).
 *
 * Field-by-field matching lives in {@link bindingAllows}: a target may carry an
 * extra id the binding does not fix (for example `session.create` always names
 * a workspace), as long as the bound ids match and the extra one is consistent
 * with them through the Host's real ownership lookup.
 */
export async function bindingDecision(
	credential: RemoteCredential,
	pathname: string,
	url: URL,
): Promise<BindingDecision> {
	const binding = credentialBinding(credential);
	// Contradictory device/session bindings: narrower than either one, so refuse.
	if (binding === null) return { allowed: false, target: undefined };
	if (binding === undefined) return { allowed: true, target: undefined };
	const target = requestTarget(pathname, url);
	if (target === undefined) return { allowed: false, target: undefined };
	return { allowed: await bindingAllows(binding, target, workspaceOfSessionResolver()), target };
}

/** 403 payload for a binding refusal (distinct from a scope refusal). */
export function bindingScopeResponse(): Response {
	return Response.json({ error: "binding_scope" }, { status: 403, headers: { "cache-control": "no-store" } });
}
