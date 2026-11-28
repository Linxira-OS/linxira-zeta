import { describe, expect, it, vi } from "bun:test";
import {
	MappedModelClient,
	arrayNode,
	compileApiMapping,
	expressionNode,
	literalNode,
	objectNode,
	refNode,
	templateNode,
	type ApiMappingSpec,
	type ProviderManifest,
} from "@linxiraos/zeta/model-sdk";

function thrown(fn: () => unknown): Error & { code?: string } {
	try {
		fn();
	} catch (error) {
		return error as Error & { code?: string };
	}
	throw new Error("Expected function to throw");
}

function provider(capabilities: ProviderManifest["capabilities"]): ProviderManifest {
	return { id: "custom", capabilities };
}

const customProvider = provider({
	decision: {
		model: "custom-judge",
		baseUrl: "https://api.custom.test",
		credential: { ref: "vault:custom" },
	},
});

const mapping: ApiMappingSpec = {
	request: {
		method: "POST",
		path: "/v2/ask",
		headers: {
			"x-source": expressionNode("concat('sdk-', input.kind)"),
			"x-version": literalNode("2026-01"),
			"x-optional": expressionNode("input.missing"),
		},
		body: objectNode({
			question: refNode("input.messages[0].content"),
			history: expressionNode("length(input.messages) - 1"),
			model: refNode("input.model"),
			flag: expressionNode("input.kind === 'urgent' ? 'fast' : 'normal'"),
			tags: arrayNode([literalNode("sdk"), expressionNode("lower(input.kind)")]),
			metadata: objectNode({
				nested: expressionNode("get(input, 'meta.value', 'fallback')"),
				omitted: expressionNode("input.missing"),
			}),
			summary: templateNode("kind:", refNode("input.kind"), "/", expressionNode("upper(input.model)")),
		}),
	},
	response: {
		body: objectNode({
			text: expressionNode("response.result.choices[0].message.content"),
			requestId: refNode("response.requestId"),
			question: refNode("request.messages[0].content"),
			contextValue: expressionNode("context.value ?? 'none'"),
		}),
	},
};

describe("declarative request/response mapping", () => {
	it("maps a canonical request into a nonstandard provider shape", () => {
		const compiled = compileApiMapping(mapping);
		const request = compiled.request(
			{
				kind: "urgent",
				model: "judge-7",
				messages: [
					{ role: "user", content: "Ship it?" },
					{ role: "assistant", content: "Checking" },
				],
				meta: { value: 42 },
			},
			{ tenant: "acme" },
		);

		expect(request).toEqual({
			method: "POST",
			path: "/v2/ask",
			headers: {
				"x-source": "sdk-urgent",
				"x-version": "2026-01",
			},
			body: {
				question: "Ship it?",
				history: 1,
				model: "judge-7",
				flag: "fast",
				tags: ["sdk", "urgent"],
				metadata: { nested: 42 },
				summary: "kind:urgent/JUDGE-7",
			},
		});
	});

	it("maps a nonstandard response into canonical output using the original request and context", () => {
		const compiled = compileApiMapping(mapping);
		const response = compiled.response(
			{
				result: { choices: [{ message: { content: "approved" } }] },
				requestId: "req-9",
			},
			{
				kind: "normal",
				model: "judge-7",
				messages: [{ role: "user", content: "Ship it?" }],
				meta: { value: 42 },
			},
			{ value: "ctx" },
		);

		expect(response).toEqual({
			text: "approved",
			requestId: "req-9",
			question: "Ship it?",
			contextValue: "ctx",
		});
	});

	it("rejects unsafe or nonstandard mappings at compile time", () => {
		const invalid = (patch: Partial<ApiMappingSpec> | ((spec: ApiMappingSpec) => ApiMappingSpec)) => {
			const base: ApiMappingSpec = {
				request: { method: "POST", path: "/v1/x", body: objectNode({}) },
				response: { body: objectNode({}) },
			};
			if (typeof patch === "function") return patch(base);
			return { ...base, ...patch };
		};

		expect(
			thrown(() => compileApiMapping(invalid({ request: { path: "https://evil.test/x", body: objectNode({}) } }))),
		).toMatchObject({ code: "mapping_invalid" });
		expect(
			thrown(() => compileApiMapping(invalid({ request: { path: "/v1/../admin", body: objectNode({}) } }))),
		).toMatchObject({ code: "mapping_invalid" });
		expect(
			thrown(() =>
				compileApiMapping(
					invalid({
						request: {
							path: "/v1/x",
							headers: { authorization: expressionNode("input.secret") },
							body: objectNode({}),
						},
					}),
				),
			),
		).toMatchObject({ code: "mapping_invalid" });
		expect(
			thrown(() =>
				compileApiMapping(
					invalid({
						request: { path: "/v1/x", body: objectNode({ value: refNode("response.value") }) },
					}),
				),
			),
		).toMatchObject({ code: "mapping_invalid" });
		expect(
			thrown(() =>
				compileApiMapping(
					invalid({
						request: { path: "/v1/x", body: objectNode({ value: refNode("input.__proto__") }) },
					}),
				),
			),
		).toMatchObject({ code: "mapping_invalid" });
		expect(
			thrown(() =>
				compileApiMapping(invalid({ request: { path: "/v1/x", body: expressionNode("globalThis.value") } })),
			),
		).toMatchObject({ code: "expression_unknown_identifier" });
	});

	it("enforces mapping-level expression and graph limits", () => {
		const twoExpressions: ApiMappingSpec = {
			request: {
				path: "/v1/x",
				body: objectNode({ a: expressionNode("input.a"), b: expressionNode("input.b") }),
			},
			response: { body: objectNode({}) },
		};
		expect(thrown(() => compileApiMapping(twoExpressions, { limits: { maxExpressions: 1 } }))).toMatchObject({
			code: "mapping_invalid",
		});
		expect(thrown(() => compileApiMapping(twoExpressions, { limits: { maxTotalSourceLength: 5 } }))).toMatchObject({
			code: "mapping_invalid",
		});
		expect(() => compileApiMapping(twoExpressions, { expressionLimits: { maxSteps: 1 } })).not.toThrow();
	});

	it("fails closed when a dynamic path is not a safe relative path", () => {
		const compiled = compileApiMapping({
			request: {
				path: expressionNode("input.path"),
				body: objectNode({}),
			},
			response: { body: objectNode({}) },
		});
		expect(thrown(() => compiled.request({ path: "https://evil.test/x" }))).toMatchObject({
			code: "mapping_invalid",
		});
		expect(thrown(() => compiled.request({ path: 42 }))).toMatchObject({ code: "mapping_failed" });
	});

	it("drives the generic mapped client with credential injection", async () => {
		const calls: { url: string; init: RequestInit }[] = [];
		const client = new MappedModelClient({
			provider: customProvider,
			capability: "decision",
			mapping,
			fetch: async (url, init) => {
				calls.push({ url: String(url), init: init! });
				return new Response(
					JSON.stringify({
						result: { choices: [{ message: { content: "approved" } }] },
						requestId: "req-42",
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			},
			resolveCredential: vi.fn(async () => "sk-custom-secret"),
		});

		const result = await client.call(
			{
				kind: "urgent",
				model: "judge-7",
				messages: [{ role: "user", content: "Ship it?" }],
			},
			{ context: { value: "ctx" } },
		);

		expect(result).toEqual({
			text: "approved",
			requestId: "req-42",
			question: "Ship it?",
			contextValue: "ctx",
		});
		expect(calls).toHaveLength(1);
		expect(calls[0]!.url).toBe("https://api.custom.test/v2/ask");
		expect(new Headers(calls[0]!.init.headers).get("authorization")).toBe("Bearer sk-custom-secret");
		expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({
			question: "Ship it?",
			model: "judge-7",
			flag: "fast",
			tags: ["sdk", "urgent"],
		});
	});

	it("rejects a missing provider capability before resolving credentials or fetching", async () => {
		const fetchCalls: unknown[] = [];
		const resolveCredential = vi.fn(async () => "sk-never");
		const client = new MappedModelClient({
			provider: provider({
				chat: { model: "chat-only", baseUrl: "https://api.custom.test" },
			}),
			capability: "decision",
			mapping,
			fetch: async (...args) => {
				fetchCalls.push(args);
				return new Response("{}");
			},
			resolveCredential,
		});
		await expect(client.call({ messages: [{ content: "hi" }] })).rejects.toMatchObject({
			code: "capability_missing",
		});
		expect(resolveCredential).not.toHaveBeenCalled();
		expect(fetchCalls).toHaveLength(0);
	});
});
