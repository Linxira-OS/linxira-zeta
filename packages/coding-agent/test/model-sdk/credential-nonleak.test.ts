import { afterEach, describe, expect, it, vi } from "bun:test";
import { ChatClient, ModelSdkError, type ModelFetch, type ProviderManifest } from "@linxiraos/zeta/model-sdk";

function thrown(fn: () => unknown): Error & { code?: string } {
	try {
		fn();
	} catch (error) {
		return error as Error & { code?: string };
	}
	throw new Error("Expected function to throw");
}

const SECRET = "sk-test-SECRET-1234567890";

function provider(): ProviderManifest {
	return {
		id: "vaulted",
		capabilities: {
			chat: {
				model: "vaulted-chat",
				baseUrl: "https://api.vaulted.test/v1",
				credential: { ref: "vault:vaulted/key" },
			},
		},
	};
}

function client(fetcher: ModelFetch, resolveCredential = async () => SECRET) {
	return new ChatClient({
		provider: provider(),
		fetch: fetcher,
		resolveCredential: vi.fn(resolveCredential),
	});
}

function assertNoSecret(value: unknown): void {
	const serialized =
		value instanceof Error ? [value.message, value.stack, JSON.stringify(value)].join("\n") : JSON.stringify(value);
	expect(serialized).not.toContain(SECRET);
}

describe("credential non-leakage", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("applies the resolved secret only to the Authorization header and never returns it", async () => {
		const captured: { authorization: string | null } = { authorization: null };
		const logs: string[] = [];
		vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
			logs.push(args.map(String).join(" "));
		});
		vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
			logs.push(args.map(String).join(" "));
		});
		const chat = client(async (_url, init) => {
			captured.authorization = new Headers(init?.headers).get("authorization");
			return new Response(
				JSON.stringify({
					model: "vaulted-chat",
					choices: [{ message: { role: "assistant", content: "hello" }, finish_reason: "stop" }],
					usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});

		const result = await chat.complete({ messages: [{ role: "user", content: "hi" }] });
		expect(captured.authorization).toBe(`Bearer ${SECRET}`);
		expect(result.text).toBe("hello");
		assertNoSecret(result);
		expect(logs.join("\n")).not.toContain(SECRET);
	});

	it("can place the credential in a provider-specific header without duplicating it", async () => {
		const captured: { headers: Headers | null } = { headers: null };
		const chat = new ChatClient({
			provider: provider(),
			fetch: async (_url, init) => {
				captured.headers = new Headers(init?.headers);
				return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			},
			resolveCredential: async () => SECRET,
			credentialHeader: "x-api-key",
			credentialPrefix: "",
		});

		const result = await chat.complete({ messages: [{ role: "user", content: "hi" }] });
		expect(captured.headers?.get("x-api-key")).toBe(SECRET);
		expect(captured.headers?.get("authorization")).toBeNull();
		expect(JSON.stringify(result)).not.toContain(SECRET);
	});

	it("does not copy an error response body into an HTTP error", async () => {
		const chat = client(async () => {
			return new Response(JSON.stringify({ error: { message: `Incorrect API key provided: ${SECRET}` } }), {
				status: 401,
				headers: { "content-type": "application/json" },
			});
		});

		let thrown: unknown;
		try {
			await chat.complete({ messages: [{ role: "user", content: "hi" }] });
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toMatchObject({ code: "http_error", status: 401 });
		assertNoSecret(thrown);
	});

	it("redacts a transport error that quotes the secret", async () => {
		const chat = client(async () => {
			throw new Error(`socket rejected bearer ${SECRET}`);
		});

		let thrown: unknown;
		try {
			await chat.complete({ messages: [{ role: "user", content: "hi" }] });
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toMatchObject({ code: "transport_error" });
		expect((thrown as Error).message).toContain("[redacted]");
		assertNoSecret(thrown);
	});

	it("sanitizes even a ModelSdkError thrown by a custom transport", async () => {
		const chat = client(async () => {
			throw new ModelSdkError(`custom transport saw ${SECRET}`, "transport_error");
		});

		let thrown: unknown;
		try {
			await chat.complete({ messages: [{ role: "user", content: "hi" }] });
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toMatchObject({ code: "transport_error" });
		assertNoSecret(thrown);
	});

	it("discards a resolver's error text because it may contain the secret", async () => {
		const chat = client(
			async () => {
				throw new Error("fetch must not run");
			},
			async () => {
				throw new Error(`vault returned ${SECRET}`);
			},
		);

		let thrown: unknown;
		try {
			await chat.complete({ messages: [{ role: "user", content: "hi" }] });
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toMatchObject({ code: "credential_unavailable" });
		assertNoSecret(thrown);
	});

	it("fails closed when the resolver returns an empty secret", async () => {
		const fetchCalls: unknown[] = [];
		const chat = client(
			async (...args) => {
				fetchCalls.push(args);
				return new Response("{}");
			},
			async () => "   ",
		);

		await expect(chat.complete({ messages: [{ role: "user", content: "hi" }] })).rejects.toMatchObject({
			code: "credential_unavailable",
		});
		expect(fetchCalls).toHaveLength(0);
	});

	it("rejects credential-like static headers instead of forwarding them", () => {
		expect(
			thrown(
				() =>
					new ChatClient({
						provider: provider(),
						fetch: async () => new Response("{}"),
						resolveCredential: async () => SECRET,
						headers: { Authorization: `Bearer ${SECRET}` },
					}),
			),
		).toMatchObject({ code: "invalid_request" });
	});
});
