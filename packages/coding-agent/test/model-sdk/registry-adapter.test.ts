import { describe, expect, it } from "bun:test";
import type { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import {
	adaptRegistryProviderManifests,
	assertProviderCapability,
	createRegistryCredentialResolver,
	providerFromRegistryCredentialReference,
	registryCredentialReference,
	sdkCapabilityForCatalogKind,
	validateProviderManifest,
	type RegistryCatalogModel,
	type RegistryManifestSource,
} from "@linxiraos/zeta/model-sdk";

/** Compile-time proof that the structural adapter slices fit the real registry. */
function acceptsRealModelRegistry(registry: ModelRegistry): void {
	adaptRegistryProviderManifests(registry);
	createRegistryCredentialResolver(registry, { sessionId: "session" });
}
void acceptsRealModelRegistry;

const BASE_URL = "https://api.acme.test/v1";

function model(
	provider: string,
	id: string,
	kind: string,
	overrides: Partial<RegistryCatalogModel> = {},
): RegistryCatalogModel {
	return { provider, id, name: id, baseUrl: BASE_URL, kind, ...overrides };
}

function fakeRegistry(
	models: readonly RegistryCatalogModel[],
	auth: Readonly<Record<string, "api_key" | "keyless">> = {},
): RegistryManifestSource {
	return {
		getAvailable: () => models,
		authStorage: {
			keys: {
				source: provider => (auth[provider] === "api_key" ? { kind: "api_key" } : undefined),
				keyless: provider => auth[provider] === "keyless",
			},
		},
	};
}

describe("registry ProviderManifest adapter", () => {
	const models = [
		model("acme", "acme-chat", "chat"),
		model("acme", "acme-tiny", "tiny"),
		model("acme", "acme-judge", "judge"),
		model("acme", "acme-image", "image"),
		model("acme", "acme-embedding", "embedding"),
		model("acme", "acme-tts", "tts"),
		model("acme", "acme-stt", "stt"),
		model("acme", "acme-video", "video"),
		model("acme", "acme-search", "search"),
		model("keyless", "keyless-chat", "chat"),
		model("paused-only", "paused-only-tts", "tts"),
		model("paused-only", "paused-only-stt", "stt"),
	];

	it("maps judge to decision, folds tiny into chat, and gates paused capabilities", () => {
		const adapted = adaptRegistryProviderManifests(
			fakeRegistry(models, { acme: "api_key", keyless: "keyless", "paused-only": "api_key" }),
		);
		expect(adapted.map(entry => entry.manifest.id)).toEqual(["acme", "keyless"]);

		const acme = adapted.find(entry => entry.manifest.id === "acme")!;
		expect(Object.keys(acme.manifest.capabilities).sort()).toEqual(["chat", "decision", "embedding", "image"]);
		expect(acme.models.chat?.map(ref => ref.id)).toEqual(["acme-chat", "acme-tiny"]);
		expect(acme.models.decision?.map(ref => ref.id)).toEqual(["acme-judge"]);
		expect(acme.paused).toEqual(["tts", "stt", "video"]);
		expect(acme.manifest.capabilities.tts).toBeUndefined();
		expect(acme.manifest.capabilities.stt).toBeUndefined();
		expect(acme.manifest.capabilities).not.toHaveProperty("video");
		expect(acme.manifest.capabilities.chat).toMatchObject({
			model: "acme-chat",
			baseUrl: BASE_URL,
			credential: { ref: "registry:acme" },
		});

		const keyless = adapted.find(entry => entry.manifest.id === "keyless")!;
		expect(keyless.manifest.capabilities.chat).not.toHaveProperty("credential");
		expect(keyless.paused).toEqual([]);
		expect(validateProviderManifest(acme.manifest)).toEqual([]);
		expect(assertProviderCapability(acme.manifest, "decision")).toMatchObject({
			provider: "acme",
			capability: "decision",
			model: "acme-judge",
		});
	});

	it("exposes kind translation and credential references without secrets", () => {
		expect(sdkCapabilityForCatalogKind("judge")).toBe("decision");
		expect(sdkCapabilityForCatalogKind("tiny")).toBe("chat");
		expect(sdkCapabilityForCatalogKind("tts")).toBe("tts");
		expect(sdkCapabilityForCatalogKind("search")).toBeUndefined();
		expect(sdkCapabilityForCatalogKind(undefined)).toBe("chat");

		const reference = registryCredentialReference("acme");
		expect(reference).toEqual({ ref: "registry:acme" });
		expect(providerFromRegistryCredentialReference(reference)).toBe("acme");
		expect(providerFromRegistryCredentialReference({ ref: "vault:acme" })).toBeUndefined();
		expect(JSON.stringify(reference)).not.toContain("sk-");
	});

	it("omits providers without a product-visible capability", () => {
		const adapted = adaptRegistryProviderManifests(
			fakeRegistry([model("paused-only", "tts", "tts"), model("search-only", "search", "search")], {
				"paused-only": "api_key",
			}),
		);
		expect(adapted).toEqual([]);
	});

	it("retains model-level metadata for candidate selection", () => {
		const adapted = adaptRegistryProviderManifests(fakeRegistry([model("acme", "m1", "chat")]))[0]!;
		expect(adapted.models.chat).toEqual([{ id: "m1", name: "m1", baseUrl: BASE_URL, catalogKind: "chat" }]);
	});
});

describe("registry CredentialResolver adapter", () => {
	const secret = "sk-registry-SECRET-123456";
	const context = { provider: "acme", capability: "decision" as const };

	it("resolves the provider's registry key and forwards request scope", async () => {
		const calls: unknown[] = [];
		const resolver = createRegistryCredentialResolver(
			{
				async getApiKeyForProvider(provider, sessionId, options) {
					calls.push({ provider, sessionId, options });
					return secret;
				},
			},
			{ sessionId: "session-1", baseUrl: "https://api.acme.test/v1", modelId: "acme-judge" },
		);
		const signal = new AbortController().signal;
		await expect(resolver(registryCredentialReference("acme"), { ...context, signal })).resolves.toBe(secret);
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({
			provider: "acme",
			sessionId: "session-1",
			options: { baseUrl: "https://api.acme.test/v1", modelId: "acme-judge", signal },
		});
	});

	it("never exposes the key in a failed lookup error", async () => {
		const resolver = createRegistryCredentialResolver({
			async getApiKeyForProvider() {
				throw new Error(`registry rejected ${secret}`);
			},
		});
		let thrown: unknown;
		try {
			await resolver(registryCredentialReference("acme"), context);
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toMatchObject({ code: "credential_unavailable", provider: "acme", capability: "decision" });
		const serialized = `${(thrown as Error).message}\n${JSON.stringify(thrown)}`;
		expect(serialized).not.toContain(secret);
		expect(serialized).not.toContain("registry rejected");
	});

	it("rejects a reference for another provider before touching auth", async () => {
		let called = false;
		const resolver = createRegistryCredentialResolver({
			async getApiKeyForProvider() {
				called = true;
				return secret;
			},
		});
		await expect(resolver(registryCredentialReference("other"), context)).rejects.toMatchObject({
			code: "credential_unavailable",
		});
		expect(called).toBe(false);
	});

	it("rejects non-registry references and missing/keyless credentials", async () => {
		const resolver = createRegistryCredentialResolver({
			async getApiKeyForProvider() {
				return "N/A";
			},
		});
		await expect(resolver({ ref: "vault:acme" }, context)).rejects.toMatchObject({
			code: "credential_unavailable",
		});
		await expect(resolver(registryCredentialReference("acme"), context)).rejects.toMatchObject({
			code: "credential_unavailable",
		});
	});
});
