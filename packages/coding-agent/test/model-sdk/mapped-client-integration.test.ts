import { describe, expect, it } from "bun:test";
import {
	MappedModelClient,
	adaptRegistryProviderManifests,
	createRegistryCredentialResolver,
	expressionNode,
	literalNode,
	objectNode,
	refNode,
	type ApiMappingSpec,
	type RegistryCatalogModel,
	type RegistryManifestSource,
} from "@linxiraos/zeta/model-sdk";

const SECRET = "sk-mapped-SECRET-987654";

const model: RegistryCatalogModel = {
	provider: "custom",
	id: "custom-judge",
	name: "Custom Judge",
	baseUrl: "https://api.custom.test",
	kind: "judge",
};

const registry: RegistryManifestSource = {
	getAvailable: () => [model],
	authStorage: {
		keys: {
			source: () => ({ kind: "api_key" }),
			keyless: () => false,
		},
	},
};

const mapping: ApiMappingSpec = {
	request: {
		method: "POST",
		path: "/v1/decide",
		headers: {
			"x-tenant": refNode("context.tenant"),
			"x-source": literalNode("zeta-model-sdk"),
		},
		body: objectNode({
			input: refNode("input.question"),
			candidates: refNode("input.choices"),
			model: literalNode("custom-judge"),
			options: objectNode({ reasoning: literalNode(true) }),
		}),
	},
	response: {
		body: objectNode({
			answer: expressionNode("response.output.text"),
			selected: expressionNode("response.output.choice"),
			traceId: refNode("response.meta.trace"),
		}),
	},
};

describe("MappedModelClient integration", () => {
	it("uses registry-adapted manifests and credentials against a nonstandard API", async () => {
		const adapted = adaptRegistryProviderManifests(registry)[0]!;
		const calls: { url: string; init: RequestInit }[] = [];
		const client = new MappedModelClient({
			provider: adapted.manifest,
			capability: "decision",
			mapping,
			fetch: async (url, init) => {
				calls.push({ url: String(url), init: init! });
				return new Response(
					JSON.stringify({
						output: { text: "yes", choice: "yes" },
						meta: { trace: "trace-42" },
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			},
			resolveCredential: createRegistryCredentialResolver({
				async getApiKeyForProvider(provider) {
					expect(provider).toBe("custom");
					return SECRET;
				},
			}),
		});

		const result = await client.call(
			{ question: "Ship the release?", choices: ["yes", "no"] },
			{ context: { tenant: "acme" } },
		);

		expect(result).toEqual({ answer: "yes", selected: "yes", traceId: "trace-42" });
		expect(JSON.stringify(result)).not.toContain(SECRET);
		expect(JSON.stringify(adapted.manifest)).not.toContain(SECRET);
		expect(calls).toHaveLength(1);
		expect(calls[0]!.url).toBe("https://api.custom.test/v1/decide");
		expect(new Headers(calls[0]!.init.headers).get("x-tenant")).toBe("acme");
		expect(new Headers(calls[0]!.init.headers).get("authorization")).toBe(`Bearer ${SECRET}`);
		expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
			input: "Ship the release?",
			candidates: ["yes", "no"],
			model: "custom-judge",
			options: { reasoning: true },
		});
	});
});
