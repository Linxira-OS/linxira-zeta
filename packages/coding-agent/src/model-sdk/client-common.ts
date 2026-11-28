/**
 * Shared client setup: validate the declared capability first, then resolve
 * the credential, then build the one request-scoped header map. The secret is
 * returned only as request-scoped material for header construction and error
 * scrubbing; clients never store it on themselves.
 */
import {
	assertProviderCapability,
	normalizeBaseUrl,
	type ProviderManifest,
	type ValidatedCapability,
} from "./capabilities";
import { resolveCredentialSecret } from "./credentials";
import { ModelSdkError } from "./errors";
import { assertHeaderMap, assertNoCredentialHeaders } from "./http";
import type { CredentialResolver, ModelCapability, ModelFetch } from "./types";

export interface ClientOptions {
	readonly provider: ProviderManifest;
	readonly fetch: ModelFetch;
	readonly resolveCredential: CredentialResolver;
	/** Overrides the declaration's base URL; still validated as HTTP(S). */
	readonly baseUrl?: string;
	readonly headers?: Readonly<Record<string, string>>;
	/** Header receiving the resolved credential; defaults to `authorization`. */
	readonly credentialHeader?: string;
	/** Prefix before the secret; defaults to `"Bearer "`. */
	readonly credentialPrefix?: string;
	readonly timeoutMs?: number;
	readonly maxResponseBytes?: number;
}

export interface PreparedCall {
	readonly declaration: ValidatedCapability;
	readonly baseUrl: string;
	readonly headers: Readonly<Record<string, string>>;
	readonly secret?: string;
}

/** Validates options shared by every client at construction time. */
export function assertClientOptions(options: ClientOptions): void {
	if (typeof options.fetch !== "function") {
		throw new ModelSdkError("Model SDK client requires a fetch implementation.", "invalid_request");
	}
	if (typeof options.resolveCredential !== "function") {
		throw new ModelSdkError("Model SDK client requires a credential resolver callback.", "invalid_request");
	}
	assertHeaderMap(options.headers, "headers");
	const credentialHeader = options.credentialHeader?.toLowerCase() ?? "authorization";
	if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(credentialHeader)) {
		throw new ModelSdkError("credentialHeader must be a valid HTTP header name.", "invalid_request");
	}
	if (credentialHeader === "__proto__" || credentialHeader === "prototype" || credentialHeader === "constructor") {
		throw new ModelSdkError("credentialHeader must not be a prototype key.", "invalid_request");
	}
	if (options.credentialPrefix !== undefined && /[\r\n]/.test(options.credentialPrefix)) {
		throw new ModelSdkError("credentialPrefix must be a single-line string.", "invalid_request");
	}
	assertNoCredentialHeaders(options.headers, credentialHeader);
}

/**
 * Capability validation deliberately runs before credential resolution so an
 * unsupported provider is rejected before a credential is touched and before
 * a network call is possible.
 */
export async function prepareCapabilityCall(
	options: ClientOptions,
	capability: ModelCapability,
	signal: AbortSignal | undefined,
): Promise<PreparedCall> {
	assertClientOptions(options);
	const declaration = assertProviderCapability(options.provider, capability);
	const baseUrl = options.baseUrl === undefined ? declaration.baseUrl : normalizeBaseUrl(options.baseUrl);
	let secret: string | undefined;
	if (declaration.credential !== undefined) {
		secret = await resolveCredentialSecret(options.resolveCredential, declaration.credential, {
			provider: declaration.provider,
			capability,
			signal,
		});
	}
	const headers: Record<string, string> = {
		accept: "application/json",
		"content-type": "application/json",
	};
	if (options.headers !== undefined) {
		for (const [name, value] of Object.entries(options.headers)) headers[name] = value;
	}
	if (secret !== undefined) {
		const header = options.credentialHeader?.toLowerCase() ?? "authorization";
		headers[header] = `${options.credentialPrefix ?? "Bearer "}${secret}`;
	}
	return { declaration, baseUrl, headers, ...(secret === undefined ? {} : { secret }) };
}
