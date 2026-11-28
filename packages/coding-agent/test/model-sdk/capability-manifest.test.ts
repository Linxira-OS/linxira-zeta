import { describe, expect, it, vi } from "bun:test";
import {
	CAPABILITY_MANIFESTS,
	ChatClient,
	ImageClient,
	MODEL_CAPABILITIES,
	assertProviderCapability,
	capabilityManifest,
	isModelCapability,
	providerCapabilities,
	validateProviderCapability,
	validateProviderManifest,
	type ProviderManifest,
} from "@linxiraos/zeta/model-sdk";

function thrown(fn: () => unknown): Error & { code?: string; provider?: string; capability?: string } {
	try {
		fn();
	} catch (error) {
		return error as Error & { code?: string; provider?: string; capability?: string };
	}
	throw new Error("Expected function to throw");
}

function provider(overrides: Partial<ProviderManifest> = {}): ProviderManifest {
	return {
		id: "acme",
		capabilities: {
			chat: {
				model: "acme-chat",
				baseUrl: "https://api.acme.test/v1",
			},
		},
		...overrides,
	};
}

describe("capability manifest", () => {
	it("declares every capability with its required and optional fields", () => {
		expect([...MODEL_CAPABILITIES]).toEqual(["chat", "image", "decision", "embedding", "tts", "stt"]);
		for (const capability of MODEL_CAPABILITIES) {
			const manifest = capabilityManifest(capability);
			expect(manifest.capability).toBe(capability);
			expect(manifest.required).toContain("model");
			expect(manifest.required).toContain("baseUrl");
			expect(manifest.optional).toContain("credential");
			for (const name of manifest.required) {
				expect(manifest.fields[name]!.required).toBe(true);
			}
			for (const name of manifest.optional) {
				expect(manifest.fields[name]!.required).toBe(false);
			}
		}
		expect(CAPABILITY_MANIFESTS.chat.optional).toContain("temperature");
		expect(CAPABILITY_MANIFESTS.image.optional).toContain("size");
		expect(CAPABILITY_MANIFESTS.image.optional).toContain("n");
		expect(CAPABILITY_MANIFESTS.decision.optional).toContain("systemPrompt");
		expect(CAPABILITY_MANIFESTS.embedding.optional).toContain("dimensions");
		expect(CAPABILITY_MANIFESTS.tts.required).toContain("voice");
		expect(CAPABILITY_MANIFESTS.stt.optional).toContain("language");
	});

	it("validates and normalizes a declared capability", () => {
		const manifest = provider({
			capabilities: {
				image: {
					model: "acme-image",
					baseUrl: "https://api.acme.test/v1/",
					credential: { ref: "vault:acme" },
					size: "1024x1024",
					n: 2,
				},
			},
		});
		const validation = validateProviderCapability(manifest, "image");
		expect(validation.ok).toBe(true);
		if (!validation.ok) return;
		expect(validation.value).toMatchObject({
			provider: "acme",
			capability: "image",
			model: "acme-image",
			baseUrl: "https://api.acme.test/v1",
			credential: { ref: "vault:acme" },
			options: { size: "1024x1024", n: 2 },
		});
		expect(Object.isFrozen(validation.value.options)).toBe(true);
	});

	it("reports missing and unknown declarations without treating them as valid", () => {
		expect(validateProviderCapability(provider(), "image").ok).toBe(false);
		expect(validateProviderManifest(provider()).length).toBe(0);

		const unknown = {
			id: "acme",
			capabilities: {
				chat: { model: "m", baseUrl: "https://api.acme.test" },
				telepathy: { model: "m", baseUrl: "https://api.acme.test" },
			},
		} as unknown as ProviderManifest;
		const issues = validateProviderManifest(unknown);
		expect(issues).toContainEqual({
			path: "capabilities.telepathy",
			message: "unknown capability",
		});
	});

	it("rejects incomplete declarations with only field paths, never values", () => {
		const manifest = provider({
			capabilities: {
				chat: { model: "", baseUrl: "ftp://user:password@api.acme.test/v1", unknown: "secret-value" },
			},
		});
		const validation = validateProviderCapability(manifest, "chat");
		expect(validation.ok).toBe(false);
		if (validation.ok) return;
		expect(validation.issues.map(issue => issue.path)).toEqual(
			expect.arrayContaining(["capabilities.chat.model", "capabilities.chat.baseUrl", "capabilities.chat.unknown"]),
		);
		const serialized = JSON.stringify(validation.issues);
		expect(serialized).not.toContain("password");
		expect(serialized).not.toContain("secret-value");
	});

	it("rejects non-reference credentials and credential-bearing URLs without echoing them", () => {
		const manifest = provider({
			capabilities: {
				chat: {
					model: "acme-chat",
					baseUrl: "https://api.acme.test/v1?api_key=super-secret-value",
					credential: "sk-live-secret-value",
				},
			},
		});
		const validation = validateProviderCapability(manifest, "chat");
		expect(validation.ok).toBe(false);
		if (validation.ok) return;
		const messages = validation.issues.map(issue => `${issue.path}: ${issue.message}`).join("\n");
		expect(messages).toContain("credential");
		expect(messages).not.toContain("sk-live-secret-value");
	});

	it("throws typed errors with capability metadata", () => {
		expect(thrown(() => assertProviderCapability(provider(), "image"))).toMatchObject({
			code: "capability_missing",
			provider: "acme",
			capability: "image",
		});
		expect(thrown(() => assertProviderCapability(provider({ id: "" }), "chat"))).toMatchObject({
			code: "manifest_invalid",
		});
		expect(
			thrown(() => assertProviderCapability(provider({ capabilities: { chat: { model: "m" } } }), "chat")),
		).toMatchObject({ code: "capability_invalid", provider: "acme", capability: "chat" });
	});

	it("lists declared capabilities in canonical order and guards unknown kinds", () => {
		const manifest = provider({
			capabilities: {
				stt: { model: "m", baseUrl: "https://api.acme.test" },
				chat: { model: "m", baseUrl: "https://api.acme.test" },
			},
		});
		expect(providerCapabilities(manifest)).toEqual(["chat", "stt"]);
		expect(isModelCapability("chat")).toBe(true);
		expect(isModelCapability("telepathy")).toBe(false);
	});

	it("rejects a missing capability before resolving a credential or calling fetch", async () => {
		const fetchCalls: unknown[] = [];
		const resolveCredential = vi.fn(async () => "sk-must-not-be-resolved");
		const client = new ImageClient({
			provider: provider(),
			fetch: async (...args) => {
				fetchCalls.push(args);
				return new Response("{}");
			},
			resolveCredential,
		});

		await expect(client.generate({ prompt: "a cat" })).rejects.toMatchObject({
			code: "capability_missing",
			capability: "image",
		});
		expect(resolveCredential).not.toHaveBeenCalled();
		expect(fetchCalls).toHaveLength(0);
	});

	it("rejects an incomplete declaration before a call", async () => {
		const fetchCalls: unknown[] = [];
		const resolveCredential = vi.fn(async () => "sk-must-not-be-resolved");
		const client = new ChatClient({
			provider: provider({ capabilities: { chat: { model: "acme-chat" } } }),
			fetch: async (...args) => {
				fetchCalls.push(args);
				return new Response("{}");
			},
			resolveCredential,
		});

		await expect(client.complete({ messages: [{ role: "user", content: "hi" }] })).rejects.toMatchObject({
			code: "capability_invalid",
		});
		expect(resolveCredential).not.toHaveBeenCalled();
		expect(fetchCalls).toHaveLength(0);
	});
});
