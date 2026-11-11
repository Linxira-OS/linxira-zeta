/**
 * Binding scope for a paired device.
 *
 * A device may be paired for one conversation or one workspace ("this tablet
 * shows only the `web` repo chat"). The binding is part of the credential, not
 * a client-side filter: the host asks whether the resource a request targets
 * lies inside the bound scope, and refuses it when it does not. A request with
 * no identifiable resource is refused too, so omitting `sessionId` cannot
 * widen the scope.
 *
 * Two rules matter for security:
 *
 * 1. **Narrow only.** When a session carries a binding as well as its device,
 *    the effective binding is the **intersection**; a session binding can never
 *    widen the device grant, and contradictory bindings are invalid (deny).
 * 2. **Fail closed.** A malformed persisted binding is an invalid credential,
 *    never "no binding". `parseBinding` reports the difference, and callers drop
 *    the record instead of granting it.
 *
 * `workspaceId` is the Host registry's canonical workspace identity (the same
 * key `history.workspaceId` uses) — never a path or an alias.
 */

import { type } from "@linxiraos/zeta-schema";

export interface DeviceBinding {
	readonly sessionId?: string;
	readonly workspaceId?: string;
}

const bindingSchema = type({
	"sessionId?": "string",
	"workspaceId?": "string",
});

/** Result of validating a stored or client-supplied binding. */
export type BindingParse =
	| { readonly ok: true; readonly binding?: DeviceBinding }
	| { readonly ok: false; readonly reason: "malformed" | "empty" };

/**
 * Validate a binding.
 *
 * `{ ok: true, binding: undefined }` means "the value was absent, so this
 * credential is unbound". `{ ok: false }` means the value was present but
 * unusable — a persisted record with that value must be dropped and a
 * client-supplied one rejected, because treating it as "unbound" would turn a
 * damaged restriction into a wider grant.
 */
export function parseBinding(raw: unknown): BindingParse {
	if (raw === undefined || raw === null) return { ok: true };
	const parsed = bindingSchema(raw);
	if (parsed instanceof type.errors) return { ok: false, reason: "malformed" };
	const sessionId = parsed.sessionId?.trim() ?? "";
	const workspaceId = parsed.workspaceId?.trim() ?? "";
	if (sessionId === "" && workspaceId === "") return { ok: false, reason: "empty" };
	return {
		ok: true,
		binding: {
			...(sessionId !== "" ? { sessionId } : {}),
			...(workspaceId !== "" ? { workspaceId } : {}),
		},
	};
}

/**
 * Effective binding for a credential.
 *
 * The session's binding may only **narrow** the device's binding: every field
 * the session fixes must agree with the device, and the result carries the
 * union of fixed fields (which is the narrower scope). `null` means the two
 * contradict each other — the caller must refuse the request.
 */
export function effectiveBinding(
	deviceBinding: DeviceBinding | undefined,
	sessionBinding: DeviceBinding | undefined,
): DeviceBinding | undefined | null {
	if (deviceBinding === undefined) return sessionBinding;
	if (sessionBinding === undefined) return deviceBinding;
	if (
		deviceBinding.sessionId !== undefined &&
		sessionBinding.sessionId !== undefined &&
		deviceBinding.sessionId !== sessionBinding.sessionId
	) {
		return null;
	}
	if (
		deviceBinding.workspaceId !== undefined &&
		sessionBinding.workspaceId !== undefined &&
		deviceBinding.workspaceId !== sessionBinding.workspaceId
	) {
		return null;
	}
	return {
		...(deviceBinding.sessionId ?? sessionBinding.sessionId
			? { sessionId: deviceBinding.sessionId ?? sessionBinding.sessionId }
			: {}),
		...(deviceBinding.workspaceId ?? sessionBinding.workspaceId
			? { workspaceId: deviceBinding.workspaceId ?? sessionBinding.workspaceId }
			: {}),
	};
}

/** What a request targets. Absent fields mean "this request names no such resource". */
export interface RequestTarget {
	readonly sessionId?: string;
	readonly workspaceId?: string;
}

/**
 * Resolve a session to its canonical workspace id. Supplied by the Host, which
 * owns the registry; `undefined` means "could not confirm", which denies.
 */
export type WorkspaceOfSession = (sessionId: string) => Promise<string | undefined>;

/**
 * Whether `target` lies inside `binding`.
 *
 * Fields are evaluated independently, so a request may carry an extra id that
 * the binding does not mention, as long as the ids it *does* fix match and the
 * extra one is consistent with them:
 *
 * - `sessionId` in the binding: the target must name that session.
 * - `workspaceId` in the binding: the target must resolve to that workspace —
 *   directly when it names one, or through {@link WorkspaceOfSession} when it
 *   names only a session.
 *
 * A target that names nothing is outside every binding.
 */
export async function bindingAllows(
	binding: DeviceBinding | undefined,
	target: RequestTarget | undefined,
	resolveWorkspace?: WorkspaceOfSession,
): Promise<boolean> {
	if (binding === undefined) return true;
	if (target === undefined) return false;
	const namesSession = target.sessionId !== undefined && target.sessionId !== "";
	const namesWorkspace = target.workspaceId !== undefined && target.workspaceId !== "";
	if (!namesSession && !namesWorkspace) return false;

	if (binding.sessionId !== undefined) {
		if (!namesSession || target.sessionId !== binding.sessionId) return false;
	}

	if (binding.workspaceId !== undefined) {
		if (namesWorkspace) {
			if (target.workspaceId !== binding.workspaceId) return false;
		} else {
			// Session-only target: ask the Host which workspace really owns it.
			const owner = await resolveWorkspace?.(target.sessionId as string);
			if (owner === undefined || owner !== binding.workspaceId) return false;
		}
	}
	return true;
}
