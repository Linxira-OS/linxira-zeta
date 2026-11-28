/**
 * Credential reference handling.
 *
 * A reference is a durable, non-secret identifier. Resolution happens per
 * request in {@link resolveCredentialSecret}; the returned secret lives only
 * in the immediate call frame and the outbound header. It is never stored on a
 * client, included in an error, or cached here.
 */
import { CredentialError, ModelSdkError } from "./errors";
import type { CredentialReference, CredentialResolutionContext, CredentialResolver } from "./types";

/** Creates a credential reference from a host-defined identifier. */
export function credentialReference(ref: string): CredentialReference {
	const trimmed = ref.trim();
	if (trimmed === "") {
		throw new ModelSdkError("Credential reference must be a non-empty string.", "credential_invalid");
	}
	return Object.freeze({ ref: trimmed });
}

/** Strict runtime guard for `{ ref: string }` values. */
export function isCredentialReference(value: unknown): value is CredentialReference {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	if (!("ref" in value) || Object.keys(value).length !== 1) return false;
	return typeof value.ref === "string" && value.ref.trim() !== "";
}

/**
 * Resolves a reference to a secret. Failure intentionally discards the
 * resolver's error text because it is not known to be secret-free.
 */
export async function resolveCredentialSecret(
	resolver: CredentialResolver,
	reference: CredentialReference,
	context: CredentialResolutionContext,
): Promise<string> {
	if (context.signal?.aborted) {
		throw new ModelSdkError("Credential resolution was aborted.", "request_aborted", {
			provider: context.provider,
			capability: context.capability,
		});
	}
	let resolved: unknown;
	try {
		resolved = await resolver(reference, context);
	} catch {
		throw new CredentialError(`Credential reference for provider "${context.provider}" could not be resolved.`, {
			provider: context.provider,
			capability: context.capability,
		});
	}
	if (typeof resolved !== "string" || resolved.trim() === "") {
		throw new CredentialError(
			`Credential reference for provider "${context.provider}" resolved to no usable secret.`,
			{ provider: context.provider, capability: context.capability },
		);
	}
	if (/[\r\n]/.test(resolved)) {
		throw new CredentialError(`Credential for provider "${context.provider}" contains invalid header characters.`, {
			provider: context.provider,
			capability: context.capability,
		});
	}
	return resolved;
}
