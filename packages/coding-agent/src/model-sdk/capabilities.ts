/**
 * Capability manifest and provider-declaration validator.
 *
 * A provider exposes a capability only by declaring it with at least the
 * manifest's required fields. Clients run {@link assertProviderCapability}
 * before resolving a credential or touching the network, so a provider that
 * cannot do chat (for example) is rejected before any billable call.
 */
import { CapabilityError, ModelSdkError } from "./errors";
import { isCredentialReference } from "./credentials";
import { MODEL_CAPABILITIES, type CredentialReference, type ModelCapability } from "./types";

export type CapabilityFieldType = "string" | "number" | "integer" | "boolean" | "object";

export interface CapabilityFieldSpec {
	readonly type: CapabilityFieldType;
	readonly required: boolean;
	readonly description: string;
	readonly nonEmpty?: boolean;
	readonly min?: number;
	readonly max?: number;
	readonly enum?: readonly string[];
}

export interface CapabilityManifest {
	readonly capability: ModelCapability;
	readonly required: readonly string[];
	readonly optional: readonly string[];
	readonly fields: Readonly<Record<string, CapabilityFieldSpec>>;
}

function manifest(
	capability: ModelCapability,
	fields: Readonly<Record<string, CapabilityFieldSpec>>,
): CapabilityManifest {
	const required: string[] = [];
	const optional: string[] = [];
	for (const [name, spec] of Object.entries(fields)) {
		if (spec.required) required.push(name);
		else optional.push(name);
	}
	return Object.freeze({
		capability,
		required: Object.freeze(required),
		optional: Object.freeze(optional),
		fields: Object.freeze(fields),
	});
}

const TRANSPORT_FIELDS: Readonly<Record<string, CapabilityFieldSpec>> = {
	model: { type: "string", required: true, nonEmpty: true, description: "Provider model identifier." },
	baseUrl: {
		type: "string",
		required: true,
		nonEmpty: true,
		description: "HTTP(S) base URL; path components are preserved.",
	},
	credential: {
		type: "object",
		required: false,
		description: "Reference to a host-held credential, never the secret itself.",
	},
};

export const CAPABILITY_MANIFESTS: Readonly<Record<ModelCapability, CapabilityManifest>> = Object.freeze({
	chat: manifest("chat", {
		...TRANSPORT_FIELDS,
		systemPrompt: { type: "string", required: false, description: "Optional system prompt prepended to requests." },
		maxTokens: { type: "integer", required: false, min: 1, description: "Default completion token budget." },
		temperature: { type: "number", required: false, min: 0, max: 2, description: "Default sampling temperature." },
		responseFormat: {
			type: "string",
			required: false,
			enum: ["text", "json"],
			description: "Default response format.",
		},
	}),
	image: manifest("image", {
		...TRANSPORT_FIELDS,
		size: { type: "string", required: false, description: "Requested image dimensions." },
		quality: { type: "string", required: false, description: "Provider quality selector." },
		style: { type: "string", required: false, description: "Provider style selector." },
		responseFormat: {
			type: "string",
			required: false,
			enum: ["url", "b64_json"],
			description: "Default image transport format.",
		},
		n: { type: "integer", required: false, min: 1, max: 10, description: "Default image count." },
	}),
	decision: manifest("decision", {
		...TRANSPORT_FIELDS,
		systemPrompt: { type: "string", required: false, description: "Optional judge instruction." },
		maxTokens: { type: "integer", required: false, min: 1, description: "Default decision token budget." },
		temperature: { type: "number", required: false, min: 0, max: 2, description: "Default sampling temperature." },
		responseFormat: {
			type: "string",
			required: false,
			enum: ["text", "json"],
			description: "Default response format.",
		},
	}),
	embedding: manifest("embedding", {
		...TRANSPORT_FIELDS,
		dimensions: { type: "integer", required: false, min: 1, description: "Requested vector dimensions." },
		encodingFormat: {
			type: "string",
			required: false,
			enum: ["float", "base64"],
			description: "Vector encoding on the wire.",
		},
	}),
	tts: manifest("tts", {
		...TRANSPORT_FIELDS,
		voice: { type: "string", required: true, nonEmpty: true, description: "Provider voice identifier." },
		responseFormat: {
			type: "string",
			required: false,
			enum: ["mp3", "opus", "aac", "flac", "wav", "pcm"],
			description: "Audio container format.",
		},
		speed: { type: "number", required: false, min: 0.25, max: 4, description: "Speech speed multiplier." },
	}),
	stt: manifest("stt", {
		...TRANSPORT_FIELDS,
		language: { type: "string", required: false, description: "Expected spoken language." },
		prompt: { type: "string", required: false, description: "Transcription hint." },
		temperature: { type: "number", required: false, min: 0, max: 1, description: "Decoding temperature." },
		responseFormat: {
			type: "string",
			required: false,
			enum: ["json", "text", "verbose_json"],
			description: "Transcription response shape.",
		},
	}),
});

/** A provider's declaration surface: capability name to field values. */
export interface ProviderManifest {
	readonly id: string;
	readonly name?: string;
	readonly capabilities: Partial<Record<ModelCapability, Readonly<Record<string, unknown>>>>;
}

export interface CapabilityValidationIssue {
	/** Dotted path such as `capabilities.image.model`; never includes a value. */
	readonly path: string;
	readonly message: string;
}

export interface ValidatedCapability {
	readonly provider: string;
	readonly capability: ModelCapability;
	readonly model: string;
	readonly baseUrl: string;
	readonly credential?: CredentialReference;
	/** Valid optional fields exactly as declared. */
	readonly options: Readonly<Record<string, unknown>>;
}

export type CapabilityValidation =
	| { readonly ok: true; readonly value: ValidatedCapability }
	| { readonly ok: false; readonly issues: readonly CapabilityValidationIssue[] };

/** Runtime type guard for manifest/capability input from configuration. */
export function isModelCapability(value: unknown): value is ModelCapability {
	return typeof value === "string" && (MODEL_CAPABILITIES as readonly string[]).includes(value);
}

/** Manifest lookup; exported so UIs can render required/optional field names. */
export function capabilityManifest(capability: ModelCapability): CapabilityManifest {
	return CAPABILITY_MANIFESTS[capability];
}

/** Whether a provider declares a capability, regardless of field validity. */
export function hasProviderCapability(manifest: ProviderManifest, capability: ModelCapability): boolean {
	return providerCapabilities(manifest).includes(capability);
}

/** Declared capabilities in the canonical manifest order. */
export function providerCapabilities(manifest: ProviderManifest): ModelCapability[] {
	if (manifest === null || typeof manifest !== "object") return [];
	const declarations: Readonly<Record<string, unknown>> | undefined = manifest.capabilities;
	if (declarations === undefined || declarations === null || typeof declarations !== "object") return [];
	return MODEL_CAPABILITIES.filter(capability => Object.prototype.hasOwnProperty.call(declarations, capability));
}

function parseBaseUrl(value: unknown): string | undefined {
	if (typeof value !== "string" || value.trim() === "") return undefined;
	let url: URL;
	try {
		url = new URL(value.trim());
	} catch {
		return undefined;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
	if (url.username !== "" || url.password !== "") return undefined;
	// Query strings and fragments on a base URL are a common place to smuggle
	// credentials and are not needed for endpoint addressing.
	if (url.search !== "" || url.hash !== "") return undefined;
	return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/**
 * Normalizes a base URL supplied outside a manifest. Throws without echoing
 * the value so a misconfigured credential-bearing URL cannot leak through an
 * error message.
 */
export function normalizeBaseUrl(value: string): string {
	const normalized = parseBaseUrl(value);
	if (normalized === undefined) {
		throw new ModelSdkError(
			"Provider base URL must be an absolute HTTP(S) URL without credentials, query, or fragment.",
			"invalid_request",
		);
	}
	return normalized;
}

function validateField(
	capability: ModelCapability,
	name: string,
	spec: CapabilityFieldSpec,
	value: unknown,
): { readonly value?: unknown; readonly issue?: CapabilityValidationIssue } {
	const path = `capabilities.${capability}.${name}`;
	if (value === undefined) {
		return spec.required ? { issue: { path, message: "required field is missing" } } : { value: undefined };
	}
	switch (spec.type) {
		case "string": {
			if (typeof value !== "string") {
				return { issue: { path, message: "must be a string" } };
			}
			if (spec.nonEmpty && value.trim() === "") {
				return { issue: { path, message: "must be a non-empty string" } };
			}
			if (spec.enum !== undefined && !spec.enum.includes(value)) {
				return { issue: { path, message: `must be one of: ${spec.enum.join(", ")}` } };
			}
			return { value };
		}
		case "number":
		case "integer": {
			if (typeof value !== "number" || !Number.isFinite(value)) {
				return { issue: { path, message: "must be a finite number" } };
			}
			if (spec.type === "integer" && !Number.isInteger(value)) {
				return { issue: { path, message: "must be an integer" } };
			}
			if (spec.min !== undefined && value < spec.min) {
				return { issue: { path, message: `must be >= ${spec.min}` } };
			}
			if (spec.max !== undefined && value > spec.max) {
				return { issue: { path, message: `must be <= ${spec.max}` } };
			}
			return { value };
		}
		case "boolean":
			return typeof value === "boolean" ? { value } : { issue: { path, message: "must be a boolean" } };
		case "object":
			if (name === "credential") {
				return isCredentialReference(value)
					? { value }
					: { issue: { path, message: "must be a { ref: string } credential reference" } };
			}
			return value !== null && typeof value === "object" && !Array.isArray(value)
				? { value }
				: { issue: { path, message: "must be an object" } };
	}
}

function validateDeclaration(
	providerId: string,
	capability: ModelCapability,
	declaration: unknown,
): CapabilityValidation {
	const issues: CapabilityValidationIssue[] = [];
	const prefix = `capabilities.${capability}`;
	if (declaration === null || typeof declaration !== "object" || Array.isArray(declaration)) {
		return {
			ok: false,
			issues: [{ path: prefix, message: "declaration must be an object" }],
		};
	}
	// The guard above proves this is an object; every field read is validated below.
	const record = declaration as Readonly<Record<string, unknown>>;
	const spec = CAPABILITY_MANIFESTS[capability];
	const options: Record<string, unknown> = {};
	let credential: CredentialReference | undefined;
	for (const [name, fieldSpec] of Object.entries(spec.fields)) {
		const validated = validateField(capability, name, fieldSpec, record[name]);
		if (validated.issue !== undefined) {
			issues.push(validated.issue);
			continue;
		}
		if (validated.value === undefined) continue;
		if (name === "model" || name === "baseUrl" || name === "credential") continue;
		options[name] = validated.value;
	}
	for (const name of Object.keys(record)) {
		if (!Object.prototype.hasOwnProperty.call(spec.fields, name)) {
			issues.push({ path: `${prefix}.${name}`, message: "unknown field" });
		}
	}
	const model = record.model;
	const baseUrl = record.baseUrl;
	const normalizedBaseUrl = typeof baseUrl === "string" ? parseBaseUrl(baseUrl) : undefined;
	if (typeof baseUrl === "string" && normalizedBaseUrl === undefined) {
		issues.push({
			path: `${prefix}.baseUrl`,
			message: "must be an absolute HTTP(S) URL without credentials, query, or fragment",
		});
	}
	if (isCredentialReference(record.credential)) {
		credential = Object.freeze({ ref: record.credential.ref.trim() });
	}
	if (issues.length > 0) return { ok: false, issues };
	return {
		ok: true,
		value: {
			provider: providerId,
			capability,
			model: (model as string).trim(),
			baseUrl: normalizedBaseUrl!,
			...(credential === undefined ? {} : { credential }),
			options: Object.freeze(options),
		},
	};
}

function readProviderId(manifest: ProviderManifest): string | undefined {
	if (manifest === null || typeof manifest !== "object") return undefined;
	const { id } = manifest;
	return typeof id === "string" && id.trim() !== "" ? id.trim() : undefined;
}

/**
 * Validates one declared capability. Missing declarations and invalid fields
 * are returned as issues, not thrown, so callers can render diagnostics.
 */
export function validateProviderCapability(
	manifest: ProviderManifest,
	capability: ModelCapability,
): CapabilityValidation {
	const providerId = readProviderId(manifest);
	if (providerId === undefined) {
		return { ok: false, issues: [{ path: "id", message: "provider id must be a non-empty string" }] };
	}
	if (!isModelCapability(capability)) {
		return {
			ok: false,
			issues: [{ path: "capability", message: "unknown capability" }],
		};
	}
	const declarations = manifest.capabilities;
	if (declarations === null || typeof declarations !== "object" || Array.isArray(declarations)) {
		return {
			ok: false,
			issues: [{ path: "capabilities", message: "must be an object" }],
		};
	}
	if (!Object.prototype.hasOwnProperty.call(declarations, capability)) {
		return {
			ok: false,
			issues: [
				{
					path: `capabilities.${capability}`,
					message: "provider does not declare this capability",
				},
			],
		};
	}
	return validateDeclaration(providerId, capability, declarations[capability]);
}

/** Validates the provider identity, capability names, and every declaration. */
export function validateProviderManifest(manifest: ProviderManifest): readonly CapabilityValidationIssue[] {
	const issues: CapabilityValidationIssue[] = [];
	const providerId = readProviderId(manifest);
	if (providerId === undefined) {
		issues.push({ path: "id", message: "provider id must be a non-empty string" });
	}
	if (manifest === null || typeof manifest !== "object") {
		issues.push({ path: "capabilities", message: "must be an object" });
		return issues;
	}
	const declarations = manifest.capabilities;
	if (declarations === null || typeof declarations !== "object" || Array.isArray(declarations)) {
		issues.push({ path: "capabilities", message: "must be an object" });
		return issues;
	}
	for (const capability of Object.keys(declarations)) {
		if (!isModelCapability(capability)) {
			issues.push({ path: `capabilities.${capability}`, message: "unknown capability" });
			continue;
		}
		if (providerId === undefined) continue;
		const validation = validateDeclaration(providerId, capability, declarations[capability]);
		if (!validation.ok) issues.push(...validation.issues);
	}
	return issues;
}

/**
 * Throws before a call when the provider cannot serve `capability` or its
 * declaration is incomplete. The returned normalized declaration is the only
 * shape clients read.
 */
export function assertProviderCapability(manifest: ProviderManifest, capability: ModelCapability): ValidatedCapability {
	const providerId = readProviderId(manifest);
	if (providerId === undefined) {
		throw new CapabilityError('Provider manifest is missing a valid "id".', "manifest_invalid", { capability });
	}
	const validation = validateProviderCapability(manifest, capability);
	if (!validation.ok) {
		const missing = validation.issues.some(issue => issue.path === `capabilities.${capability}`);
		if (missing) {
			throw new CapabilityError(
				`Provider "${providerId}" does not declare the "${capability}" capability.`,
				"capability_missing",
				{ provider: providerId, capability },
			);
		}
		throw new CapabilityError(
			`Provider "${providerId}" has an invalid "${capability}" declaration: ${validation.issues
				.map(issue => issue.path)
				.join(", ")}.`,
			"capability_invalid",
			{
				provider: providerId,
				capability,
				details: {
					issues: validation.issues.map(issue => ({ path: issue.path, message: issue.message })),
				},
			},
		);
	}
	return validation.value;
}
