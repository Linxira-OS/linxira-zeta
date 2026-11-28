import { describe, expect, it } from "bun:test";
import { ChatClient, DecisionClient, ImageClient, type ProviderManifest } from "@linxiraos/zeta/model-sdk";

function provider(capability: "chat" | "image" | "decision", options: Record<string, unknown> = {}): ProviderManifest {
	return {
		id: "acme",
		capabilities: {
			[capability]: {
				model: `acme-${capability}`,
				baseUrl: "https://api.acme.test/v1/",
				credential: { ref: "vault:acme" },
				...options,
			},
		},
	};
}

function jsonResponse(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function requestCapture() {
	const requests: { url: string; init: RequestInit | undefined }[] = [];
	return {
		requests,
		fetch: async (url: string | URL | Request, init?: RequestInit) => {
			requests.push({ url: String(url), init });
			return jsonResponse({
				model: "acme-chat",
				choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
				usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
			});
		},
	};
}

describe("OpenAI-compatible clients", () => {
	it("sends a chat request with declared defaults and parses the allowlisted response", async () => {
		const capture = requestCapture();
		const chat = new ChatClient({
			provider: provider("chat", {
				systemPrompt: "Be terse.",
				temperature: 0.2,
				maxTokens: 64,
				responseFormat: "json",
			}),
			fetch: capture.fetch,
			resolveCredential: async () => "sk-chat-secret",
		});

		const result = await chat.complete({
			messages: [{ role: "user", content: "hello" }],
			model: "acme-chat-mini",
		});

		expect(result).toEqual({
			text: "ok",
			model: "acme-chat",
			finishReason: "stop",
			usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
		});
		expect(capture.requests).toHaveLength(1);
		const [request] = capture.requests;
		expect(request!.url).toBe("https://api.acme.test/v1/chat/completions");
		expect(new Headers(request!.init!.headers).get("authorization")).toBe("Bearer sk-chat-secret");
		const body = JSON.parse(String(request!.init!.body));
		expect(body).toEqual({
			model: "acme-chat-mini",
			messages: [
				{ role: "system", content: "Be terse." },
				{ role: "user", content: "hello" },
			],
			temperature: 0.2,
			max_tokens: 64,
			response_format: { type: "json_object" },
		});
	});

	it("supports array content parts and omits a missing usage block", async () => {
		const chat = new ChatClient({
			provider: provider("chat"),
			fetch: async () =>
				jsonResponse({
					choices: [
						{
							message: {
								role: "assistant",
								content: [
									{ type: "text", text: "hello " },
									{ type: "text", text: "world" },
								],
							},
						},
					],
				}),
			resolveCredential: async () => "secret",
		});
		expect(await chat.complete({ messages: [{ role: "user", content: "hi" }] })).toEqual({
			text: "hello world",
		});
	});

	it("sends image generation defaults and returns both transport forms", async () => {
		const requests: RequestInit[] = [];
		const images = new ImageClient({
			provider: provider("image", { n: 2, size: "512x512", responseFormat: "b64_json" }),
			fetch: async (_url, init) => {
				requests.push(init!);
				return jsonResponse({
					data: [{ b64_json: "AAAA", revised_prompt: "a red cube" }, { url: "https://cdn.acme.test/2.png" }],
					model: "acme-image-v2",
				});
			},
			resolveCredential: async () => "sk-image-secret",
		});

		const result = await images.generate({ prompt: "a cube" });
		expect(result).toEqual({
			images: [{ base64: "AAAA", revisedPrompt: "a red cube" }, { url: "https://cdn.acme.test/2.png" }],
			model: "acme-image-v2",
		});
		expect(JSON.parse(String(requests[0]!.body))).toEqual({
			model: "acme-image",
			prompt: "a cube",
			n: 2,
			size: "512x512",
			response_format: "b64_json",
		});
	});

	it("asks a decision question and matches a declared choice case-insensitively", async () => {
		const requests: RequestInit[] = [];
		const decisions = new DecisionClient({
			provider: provider("decision", { temperature: 0, maxTokens: 16 }),
			fetch: async (_url, init) => {
				requests.push(init!);
				return jsonResponse({
					choices: [{ message: { role: "assistant", content: "  approve  " }, finish_reason: "stop" }],
				});
			},
			resolveCredential: async () => "sk-decision-secret",
		});

		const result = await decisions.judge({
			question: "Ship the release?",
			choices: ["approve", "reject"],
			context: { tests: "green", approvals: 2 },
		});

		expect(result.text).toBe("approve");
		expect(result.choice).toBe("approve");
		const body = JSON.parse(String(requests[0]!.body));
		expect(body.model).toBe("acme-decision");
		expect(body.temperature).toBe(0);
		expect(body.max_tokens).toBe(16);
		const userMessage = body.messages.find((message: { role: string }) => message.role === "user");
		expect(userMessage.content).toContain("Question: Ship the release?");
		expect(userMessage.content).toContain('Context:\n{"tests":"green","approvals":2}');
		expect(userMessage.content).toContain("- approve\n- reject");
	});

	it("parses a JSON-mode decision and returns the declared choice", async () => {
		const decisions = new DecisionClient({
			provider: provider("decision"),
			fetch: async () =>
				jsonResponse({
					choices: [{ message: { role: "assistant", content: '{"answer":"B","choice":"B"}' } }],
				}),
			resolveCredential: async () => "secret",
		});
		const result = await decisions.judge({
			question: "Pick",
			choices: ["A", "B"],
			responseFormat: "json",
		});
		expect(result).toEqual({ text: "B", choice: "B" });
	});

	it("returns invalid_response without echoing a provider body", async () => {
		const decisions = new DecisionClient({
			provider: provider("decision"),
			fetch: async () => jsonResponse({ error: { message: "secret provider detail" }, choices: [] }),
			resolveCredential: async () => "secret",
		});
		let thrown: unknown;
		try {
			await decisions.judge({ question: "Pick", choices: ["A"] });
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toMatchObject({ code: "invalid_response" });
		expect((thrown as Error).message).not.toContain("secret provider detail");
	});

	it("rejects an invalid request before resolving credentials", async () => {
		let resolved = false;
		const chat = new ChatClient({
			provider: provider("chat"),
			fetch: async () => jsonResponse({}),
			resolveCredential: async () => {
				resolved = true;
				return "secret";
			},
		});
		await expect(chat.complete({ messages: [] })).rejects.toMatchObject({ code: "invalid_request" });
		expect(resolved).toBe(false);
	});
});
