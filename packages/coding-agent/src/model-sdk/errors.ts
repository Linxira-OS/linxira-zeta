/**
 * Error surface for the model SDK.
 *
 * A resolved credential must never reach a log, a persisted error, or a
 * message. Every error created here takes already-safe text; callers that
 * quote transport errors route them through {@link redactSecrets} together
 * with the resolved secret. Provider response bodies are never copied into an
 * error, because a provider may echo the credential it rejected.
 */
import type { JsonValue, ModelCapability } from "./types";

export type ModelSdkErrorCode =
	| "capability_missing"
	| "capability_invalid"
	| "manifest_invalid"
	| "credential_unavailable"
	| "credential_invalid"
	| "invalid_request"
	| "invalid_response"
	| "http_error"
	| "transport_error"
	| "request_aborted"
	| "request_timeout"
	| "mapping_invalid"
	| "mapping_failed"
	| "expression_syntax"
	| "expression_limit"
	| "expression_unknown_identifier"
	| "expression_unknown_function"
	| "expression_type"
	| "expression_unsafe_access"
	| "expression_invalid_environment"
	| "decision_policy_invalid";

export interface ModelSdkErrorOptions {
	readonly provider?: string;
	readonly capability?: ModelCapability | string;
	readonly status?: number;
	/** Safe, structured context. Never place a secret or raw provider body here. */
	readonly details?: Readonly<Record<string, JsonValue>>;
}

/** Base error for the SDK. Its JSON form contains only sanitized fields. */
export class ModelSdkError extends Error {
	readonly code: ModelSdkErrorCode;
	readonly provider?: string;
	readonly capability?: string;
	readonly status?: number;
	readonly details?: Readonly<Record<string, JsonValue>>;

	constructor(message: string, code: ModelSdkErrorCode, options: ModelSdkErrorOptions = {}) {
		super(message);
		this.name = "ModelSdkError";
		this.code = code;
		if (options.provider !== undefined) this.provider = options.provider;
		if (options.capability !== undefined) this.capability = options.capability;
		if (options.status !== undefined) this.status = options.status;
		if (options.details !== undefined) this.details = options.details;
	}

	toJSON(): Record<string, unknown> {
		return {
			name: this.name,
			code: this.code,
			message: this.message,
			provider: this.provider,
			capability: this.capability,
			status: this.status,
			details: this.details,
		};
	}
}

/** A provider declaration is missing or does not satisfy its capability manifest. */
export class CapabilityError extends ModelSdkError {
	constructor(
		message: string,
		code: "capability_missing" | "capability_invalid" | "manifest_invalid",
		options: ModelSdkErrorOptions = {},
	) {
		super(message, code, options);
		this.name = "CapabilityError";
	}
}

/** Credential resolution failed or produced an unusable value. */
export class CredentialError extends ModelSdkError {
	constructor(message: string, options: ModelSdkErrorOptions = {}) {
		super(message, "credential_unavailable", options);
		this.name = "CredentialError";
	}
}

/** Declarative mapping definition or evaluation failed. */
export class MappingError extends ModelSdkError {
	constructor(message: string, code: "mapping_invalid" | "mapping_failed" = "mapping_failed") {
		super(message, code);
		this.name = "MappingError";
	}
}

/** Sandboxed expression compilation or evaluation failed. */
export class ExpressionError extends ModelSdkError {
	constructor(message: string, code: ModelSdkErrorCode = "expression_syntax", options: ModelSdkErrorOptions = {}) {
		super(message, code, options);
		this.name = "ExpressionError";
	}
}

/** Candidate scoring policy is malformed. */
export class DecisionPolicyError extends ModelSdkError {
	constructor(message: string) {
		super(message, "decision_policy_invalid");
		this.name = "DecisionPolicyError";
	}
}

const SECRET_PATTERNS: readonly RegExp[] = [
	/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi,
	/(x-api-key\s*[:=]\s*)[^\s,;]+/gi,
	/(api[_-]?key\s*[:=]\s*)[^\s,;]+/gi,
	/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{4,}\b/g,
	/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
];

/**
 * Removes resolved secrets and common credential shapes from text. Used on
 * transport/fetch error messages before they become SDK errors.
 */
export function redactSecrets(text: string, secrets: readonly (string | undefined)[] = []): string {
	let result = text;
	for (const secret of secrets) {
		if (typeof secret !== "string" || secret.length === 0) continue;
		result = result.split(secret).join("[redacted]");
		let encoded = secret;
		try {
			encoded = encodeURIComponent(secret);
		} catch {
			// A lone surrogate cannot be URI-encoded; the exact replacement above is enough.
		}
		if (encoded !== secret) result = result.split(encoded).join("[redacted]");
	}
	for (const pattern of SECRET_PATTERNS) {
		result = result.replace(pattern, (_match, prefix: string | undefined) =>
			prefix ? `${prefix}[redacted]` : "[redacted]",
		);
	}
	return result;
}

/** Safe message text for an unknown thrown value. */
export function safeErrorMessage(error: unknown, secrets: readonly (string | undefined)[] = []): string {
	const raw = error instanceof Error ? error.message : String(error);
	return redactSecrets(raw, secrets);
}
