/**
 * Shared types for the model SDK.
 *
 * Everything crossing an SDK boundary is plain JSON data: provider manifests,
 * mapped request/response bodies, and sandbox environments. Keeping the
 * boundary JSON-only is what lets the sandbox reject executable values and
 * lets callers serialize configuration without accidental code loading.
 */

/** Capabilities a provider can declare, and the SDK can gate calls on. */
export const MODEL_CAPABILITIES = ["chat", "image", "decision", "embedding", "tts", "stt"] as const;

export type ModelCapability = (typeof MODEL_CAPABILITIES)[number];

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface JsonObject {
	[key: string]: JsonValue;
}

/**
 * Reference to a credential held by the host runtime. It deliberately carries
 * no secret material: a {@link CredentialResolver} maps the reference to the
 * secret at call time. Clients retain the resolved value only in request-scoped
 * headers and error-scrubbing context; it is never persisted or logged.
 */
export interface CredentialReference {
	readonly ref: string;
}

/** Context supplied to a credential resolver; no secret has been resolved yet. */
export interface CredentialResolutionContext {
	readonly provider: string;
	readonly capability: ModelCapability;
	readonly signal?: AbortSignal;
}

/**
 * Resolves a credential reference to a bearer secret. Returning `undefined`
 * (or an empty string) means "not available" and makes the pending call fail
 * closed. Implementations may cache; the SDK does not.
 */
export type CredentialResolver = (
	reference: CredentialReference,
	context: CredentialResolutionContext,
) => string | undefined | null | Promise<string | undefined | null>;

/**
 * Fetch implementation injected by the host, so the SDK owns no transport.
 * A narrow callable type rather than `typeof fetch`, which carries Bun-only
 * extras such as `preconnect` that a test or custom transport should not fake.
 */
export type ModelFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
