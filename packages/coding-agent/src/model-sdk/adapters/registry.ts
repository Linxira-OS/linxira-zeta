/**
 * Read-only adapter from the runtime model registry/catalog to the model SDK.
 *
 * The catalog speaks in model kinds (`judge`, `tiny`, `search`, …); the SDK
 * speaks in provider capabilities (`decision`, `chat`, …). This module owns
 * that translation, applies the product's paused-capability gate, and builds
 * credential references that a {@link createRegistryCredentialResolver}
 * callback can resolve without the manifest ever containing a secret.
 */
import { isAuthenticated } from "../../config/model-provider-discovery";
import {
	isPausedCapability,
	PAUSED_MODEL_CAPABILITIES,
	type PausedModelCapability,
} from "../../config/provider-capabilities";
import { normalizeBaseUrl, type ProviderManifest } from "../capabilities";
import { CredentialError, ModelSdkError } from "../errors";
import type { CredentialReference, CredentialResolver, ModelCapability } from "../types";

/** The subset of a catalog model this adapter needs. */
export interface RegistryCatalogModel {
	readonly id: string;
	readonly provider: string;
	readonly name?: string;
	readonly baseUrl: string;
	readonly kind?: string;
}

/** Structural slice of `ModelRegistry` used to project provider manifests. */
export interface RegistryManifestSource {
	getAvailable(kind?: "all"): readonly RegistryCatalogModel[];
	readonly authStorage?: {
		readonly keys: {
			source(provider: string): unknown;
			keyless(provider: string): boolean;
		};
	};
}

/** Structural slice of `ModelRegistry` used to resolve credential references. */
export interface RegistryCredentialSource {
	getApiKeyForProvider(
		provider: string,
		sessionId?: string,
		options?: { readonly baseUrl?: string; readonly modelId?: string; readonly signal?: AbortSignal },
	): Promise<string | undefined>;
}

export interface RegistryProviderManifestOptions {
	/**
	 * Overrides credential-reference projection. Returning `undefined` omits
	 * the credential, e.g. for a keyless endpoint.
	 */
	readonly credentialReference?: (provider: string) => CredentialReference | undefined;
}

/** One catalog model behind an adapted capability, retained for candidate selection. */
export interface RegistryModelRef {
	readonly id: string;
	readonly name: string;
	readonly baseUrl: string;
	readonly catalogKind: string;
}

/**
 * Provider manifest plus the full model list per capability and the gated
 * paused kinds. The manifest names the first model per capability as its
 * representative; `models` retains every model and its own base URL.
 */
export interface AdaptedProviderManifest {
	readonly manifest: ProviderManifest;
	readonly models: Readonly<Partial<Record<ModelCapability, readonly RegistryModelRef[]>>>;
	readonly paused: readonly PausedModelCapability[];
}

const REGISTRY_CREDENTIAL_PREFIX = "registry:";

/** Catalog kind to SDK capability, before the paused gate. */
const CATALOG_KIND_TO_CAPABILITY: Readonly<Record<string, ModelCapability>> = Object.freeze({
	chat: "chat",
	tiny: "chat",
	judge: "decision",
	image: "image",
	embedding: "embedding",
	tts: "tts",
	stt: "stt",
});

/** SDK capability for a catalog kind; `undefined` for unsupported kinds. */
export function sdkCapabilityForCatalogKind(kind: string | undefined): ModelCapability | undefined {
	const normalized = kind?.trim() || "chat";
	if (!Object.prototype.hasOwnProperty.call(CATALOG_KIND_TO_CAPABILITY, normalized)) return undefined;
	return CATALOG_KIND_TO_CAPABILITY[normalized];
}

/** Stable non-secret reference produced by the registry adapter. */
export function registryCredentialReference(provider: string): CredentialReference {
	const trimmed = provider.trim();
	if (trimmed === "") {
		throw new ModelSdkError("Registry credential reference requires a provider.", "invalid_request");
	}
	return Object.freeze({ ref: `${REGISTRY_CREDENTIAL_PREFIX}${trimmed}` });
}

/** Provider encoded in a registry credential reference, or `undefined` for another reference kind. */
export function providerFromRegistryCredentialReference(reference: CredentialReference): string | undefined {
	if (reference === null || typeof reference !== "object" || typeof reference.ref !== "string") {
		return undefined;
	}
	if (!reference.ref.startsWith(REGISTRY_CREDENTIAL_PREFIX)) return undefined;
	const provider = reference.ref.slice(REGISTRY_CREDENTIAL_PREFIX.length).trim();
	return provider === "" ? undefined : provider;
}

function automaticCredentialReference(
	registry: RegistryManifestSource,
	provider: string,
): CredentialReference | undefined {
	const keys = registry.authStorage?.keys;
	if (keys === undefined) return undefined;
	try {
		if (keys.keyless(provider)) return undefined;
		if (keys.source(provider) === undefined) return undefined;
	} catch {
		return undefined;
	}
	return registryCredentialReference(provider);
}

interface ProviderGroup {
	readonly provider: string;
	readonly models: RegistryCatalogModel[];
	readonly paused: Set<PausedModelCapability>;
}

function groupRegistryModels(registry: RegistryManifestSource): Map<string, ProviderGroup> {
	const groups = new Map<string, ProviderGroup>();
	for (const model of registry.getAvailable("all")) {
		const provider = model.provider?.trim();
		if (!provider) continue;
		const group = groups.get(provider) ?? { provider, models: [], paused: new Set() };
		groups.set(provider, group);
		const kind = model.kind?.trim() || "chat";
		if (isPausedCapability(kind)) {
			group.paused.add(kind);
			continue;
		}
		if (typeof model.id !== "string" || model.id.trim() === "") continue;
		if (typeof model.baseUrl !== "string" || model.baseUrl.trim() === "") continue;
		if (sdkCapabilityForCatalogKind(kind) !== undefined) group.models.push(model);
	}
	return groups;
}

function projectModels(group: ProviderGroup): Partial<Record<ModelCapability, RegistryModelRef[]>> {
	const models: Partial<Record<ModelCapability, RegistryModelRef[]>> = {};
	for (const model of group.models) {
		const capability = sdkCapabilityForCatalogKind(model.kind);
		if (capability === undefined) continue;
		const list = (models[capability] ??= []);
		const id = model.id.trim();
		if (list.some(existing => existing.id === id)) continue;
		let baseUrl: string;
		try {
			baseUrl = normalizeBaseUrl(model.baseUrl);
		} catch {
			continue;
		}
		list.push({
			id,
			name: model.name?.trim() || id,
			baseUrl,
			catalogKind: model.kind?.trim() || "chat",
		});
	}
	return models;
}

function projectManifest(
	provider: string,
	models: Partial<Record<ModelCapability, RegistryModelRef[]>>,
	credential: CredentialReference | undefined,
): ProviderManifest {
	const capabilities: Record<string, Readonly<Record<string, unknown>>> = {};
	for (const [capability, refs] of Object.entries(models)) {
		const first = refs?.[0];
		if (first === undefined) continue;
		capabilities[capability] = {
			model: first.id,
			baseUrl: first.baseUrl,
			...(credential === undefined ? {} : { credential }),
		};
	}
	return { id: provider, capabilities };
}

/**
 * Projects every available catalog provider into at most one SDK manifest.
 * Providers with only paused capabilities are omitted; paused capabilities are
 * returned for diagnostics but never declared to the SDK.
 */
export function adaptRegistryProviderManifests(
	registry: RegistryManifestSource,
	options: RegistryProviderManifestOptions = {},
): AdaptedProviderManifest[] {
	const adapters: AdaptedProviderManifest[] = [];
	const groups = groupRegistryModels(registry);
	for (const provider of [...groups.keys()].sort()) {
		const group = groups.get(provider)!;
		const models = projectModels(group);
		if (Object.keys(models).length === 0) continue;
		const credential =
			options.credentialReference === undefined
				? automaticCredentialReference(registry, group.provider)
				: options.credentialReference(group.provider);
		const manifest = projectManifest(group.provider, models, credential);
		adapters.push({
			manifest,
			models,
			paused: PAUSED_MODEL_CAPABILITIES.filter(capability => group.paused.has(capability)),
		});
	}
	return adapters;
}

/** One provider's adapted manifest; `undefined` when it has no product-visible capability. */
export function adaptRegistryProviderManifest(
	registry: RegistryManifestSource,
	provider: string,
	options: RegistryProviderManifestOptions = {},
): AdaptedProviderManifest | undefined {
	const id = provider.trim();
	return adaptRegistryProviderManifests(registry, options).find(entry => entry.manifest.id === id);
}

export interface RegistryCredentialResolverOptions {
	readonly sessionId?: string;
	readonly baseUrl?: string;
	readonly modelId?: string;
}

/**
 * Adapts `ModelRegistry` credential lookup to the SDK callback. The reference
 * must name the same provider as the pending call; this prevents a manifest
 * from redirecting one provider's credential to another endpoint. Underlying
 * error text is discarded because it is not guaranteed to be secret-free.
 */
export function createRegistryCredentialResolver(
	registry: RegistryCredentialSource,
	options: RegistryCredentialResolverOptions = {},
): CredentialResolver {
	return async (reference, context) => {
		const provider = providerFromRegistryCredentialReference(reference);
		if (provider === undefined) {
			throw new CredentialError("Credential reference is not a registry reference.", {
				provider: context.provider,
				capability: context.capability,
			});
		}
		if (provider !== context.provider) {
			throw new CredentialError("Credential reference does not match the requesting provider.", {
				provider: context.provider,
				capability: context.capability,
			});
		}
		if (context.signal?.aborted) {
			throw new ModelSdkError("Credential resolution was aborted.", "request_aborted", {
				provider: context.provider,
				capability: context.capability,
			});
		}
		let apiKey: string | undefined;
		try {
			apiKey = await registry.getApiKeyForProvider(provider, options.sessionId, {
				baseUrl: options.baseUrl,
				modelId: options.modelId,
				signal: context.signal,
			});
		} catch {
			if (context.signal?.aborted) {
				throw new ModelSdkError("Credential resolution was aborted.", "request_aborted", {
					provider: context.provider,
					capability: context.capability,
				});
			}
			throw new CredentialError(`Registry credential lookup failed for provider "${provider}".`, {
				provider: context.provider,
				capability: context.capability,
			});
		}
		if (typeof apiKey !== "string" || !isAuthenticated(apiKey) || apiKey.trim() === "") {
			throw new CredentialError(`No usable registry credential is configured for provider "${provider}".`, {
				provider: context.provider,
				capability: context.capability,
			});
		}
		return apiKey;
	};
}
