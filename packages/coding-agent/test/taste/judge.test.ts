/**
 * The optional semantic step, tier by tier.
 *
 * The invariants under test are the ones the plan promises a user:
 * T0 is the default and never calls anything; a judge model contributes a
 * *calibrated* posterior (T2); a chat model contributes classification only and
 * its self-reported confidence is discarded (T1); and an unanswered or failed
 * call degrades to T0 instead of inventing a number.
 */
import { afterEach, describe, expect, it } from "bun:test";
import type { Model } from "@linxiraos/pi-ai";
import { buildModel } from "@linxiraos/pi-catalog/build";
import { type FetchImpl, TempDir } from "@linxiraos/pi-utils";
import type { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { Settings } from "@linxiraos/zeta/config/settings";
import { scoreWithJudge, type TasteJudgeDeps } from "@linxiraos/zeta/taste/judge";

const roots: TempDir[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) root.removeSync();
});

function fakeModel(overrides: Partial<Model> = {}): Model {
	return buildModel({
		provider: "typesafe",
		id: "jev-1.14",
		name: "jev-1.14",
		api: "typesafe",
		baseUrl: "https://judge.example",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: null,
		kind: "judge",
		...overrides,
	} as Parameters<typeof buildModel>[0]);
}

function deps(models: Model[], settings: Settings, fetch?: FetchImpl): { deps: TasteJudgeDeps; calls: () => number } {
	let calls = 0;
	const registry = {
		getAvailable: () => models,
		getApiKey: async () => "test-key",
		resolver: () => "test-key",
		resolveModelHeaders: async () => ({}),
	} as unknown as ModelRegistry;
	const spy = fetch ? async (...args: Parameters<typeof fetch>) => (calls++, fetch(...args)) : undefined;
	return {
		deps: { settings, modelRegistry: registry, sessionId: "session-taste", ...(spy ? { fetch: spy } : {}) },
		calls: () => calls,
	};
}

const INPUT = {
	statement: "Prefers explicit return types on exported functions",
	evidence: "I always want explicit return types on exports.",
};

function settings(values: Record<string, unknown> = {}): Settings {
	const root = TempDir.createSync("@taste-judge-");
	roots.push(root);
	return Settings.isolated(values);
}

describe("taste judge tiers", () => {
	it("stays in T0 and calls nothing when no role resolves", async () => {
		let called = false;
		const fetchSpy: FetchImpl = async () => {
			called = true;
			return new Response("{}", { status: 200 });
		};
		const { deps: judgeDeps } = deps([], settings(), fetchSpy);
		expect(await scoreWithJudge(INPUT, judgeDeps)).toBeUndefined();
		expect(called).toBe(false);
	});

	it("T2 turns a judge answer into a calibrated posterior", async () => {
		const body = {
			model: "jev-test",
			answers: {
				is_preference: { type: "noul", noul: 0.9 },
				category: { type: "choice", choice: "typescript", confidence: 0.8 },
				polarity: { type: "choice", choice: "prefer", confidence: 0.9 },
				strength: { type: "score", score: 2 },
			},
		};
		const fetchSpy: FetchImpl = async () => Response.json(body);
		const { deps: judgeDeps, calls } = deps(
			[fakeModel()],
			settings({ modelRoles: { taste: "typesafe/jev-1.14" } }),
			fetchSpy,
		);

		const judgment = await scoreWithJudge(INPUT, judgeDeps);
		expect(calls()).toBe(1);
		expect(judgment).toMatchObject({
			tier: "T2",
			role: "taste",
			category: "typescript",
			polarity: "prefer",
		});
		expect(judgment?.posterior).toEqual({ p: 0.9, strength: 1 });
	});

	it("T2 distrusts a low-confidence category and records it as other", async () => {
		const body = {
			model: "jev-test",
			answers: {
				is_preference: { type: "noul", noul: 0.7 },
				category: { type: "choice", choice: "testing", confidence: 0.2 },
				polarity: { type: "choice", choice: "avoid", confidence: 0.9 },
				strength: { type: "score", score: 1 },
			},
		};
		const fetchSpy: FetchImpl = async () => Response.json(body);
		const { deps: judgeDeps } = deps(
			[fakeModel()],
			settings({ modelRoles: { taste: "typesafe/jev-1.14" } }),
			fetchSpy,
		);
		const judgment = await scoreWithJudge(INPUT, judgeDeps);
		expect(judgment?.category).toBe("other");
		expect(judgment?.polarity).toBe("avoid");
	});

	describe("T1 through a real chat transport", () => {
		let stop: (() => void) | undefined;
		afterEach(() => {
			stop?.();
			stop = undefined;
		});

		function serve(classification: Record<string, unknown>): string {
			const text = JSON.stringify(classification);
			const events = [
				{
					type: "message_start",
					message: {
						id: "msg_taste",
						type: "message",
						role: "assistant",
						model: "claude-haiku-4-5",
						content: [],
						usage: { input_tokens: 1, output_tokens: 0 },
					},
				},
				{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
				{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
				{ type: "content_block_stop", index: 0 },
				{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
				{ type: "message_stop" },
			];
			const body = new TextEncoder().encode(
				events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""),
			);
			const server = Bun.serve({
				hostname: "127.0.0.1",
				port: 0,
				fetch: () => new Response(body, { headers: { "content-type": "text/event-stream" } }),
			});
			stop = () => server.stop(true);
			return server.url.toString();
		}

		function chatModel(baseUrl: string): Model {
			return fakeModel({
				provider: "anthropic",
				id: "claude-haiku-4-5",
				api: "anthropic-messages",
				kind: "chat",
				baseUrl,
			});
		}

		it("classifies and discards the model's own confidence", async () => {
			const baseUrl = serve({ is_preference: true, category: "cli", polarity: "prefer", confidence: 0.99 });
			const { deps: judgeDeps } = deps(
				[chatModel(baseUrl)],
				settings({ modelRoles: { taste: "anthropic/claude-haiku-4-5" } }),
			);

			const judgment = await scoreWithJudge(INPUT, judgeDeps);
			expect(judgment).toEqual({
				tier: "T1",
				role: "taste",
				model: "anthropic/claude-haiku-4-5",
				category: "cli",
				polarity: "prefer",
			});
			// The uncalibrated number never becomes a posterior.
			expect(judgment?.posterior).toBeUndefined();
		});

		it("returns nothing when the model says the statement is not a preference", async () => {
			const baseUrl = serve({ is_preference: false, category: "other", polarity: "prefer" });
			const { deps: judgeDeps } = deps(
				[chatModel(baseUrl)],
				settings({ modelRoles: { taste: "anthropic/claude-haiku-4-5" } }),
			);
			expect(await scoreWithJudge(INPUT, judgeDeps)).toBeUndefined();
		});
	});

	it("walks the role chain and prefers the explicit role over the fallbacks", async () => {
		const tasteModel = fakeModel({ id: "judge-a" });
		const judgeModel = fakeModel({ id: "judge-b" });
		const fetchSpy: FetchImpl = async () =>
			Response.json({
				model: "jev-test",
				answers: {
					is_preference: { type: "noul", noul: 0.6 },
					category: { type: "choice", choice: "other", confidence: 0.9 },
					polarity: { type: "choice", choice: "prefer", confidence: 0.9 },
					strength: { type: "score", score: 0 },
				},
			});
		const { deps: judgeDeps } = deps(
			[tasteModel, judgeModel],
			settings({ modelRoles: { taste: "typesafe/judge-a", judge: "typesafe/judge-b" } }),
			fetchSpy,
		);
		const judgment = await scoreWithJudge(INPUT, judgeDeps);
		expect(judgment?.role).toBe("taste");
		expect(judgment?.model).toContain("judge-a");
	});

	it("falls back to judge then smol when taste is unset", async () => {
		const judgeModel = fakeModel({ id: "judge-b", provider: "typesafe" });
		const fetchSpy: FetchImpl = async () =>
			Response.json({
				model: "jev-test",
				answers: {
					is_preference: { type: "noul", noul: 0.6 },
					category: { type: "choice", choice: "other", confidence: 0.9 },
					polarity: { type: "choice", choice: "prefer", confidence: 0.9 },
					strength: { type: "score", score: 0 },
				},
			});
		const { deps: judgeDeps } = deps([judgeModel], settings({ modelRoles: { judge: "typesafe/judge-b" } }), fetchSpy);
		expect((await scoreWithJudge(INPUT, judgeDeps))?.role).toBe("judge");
	});

	it("degrades to T0 when the call fails", async () => {
		const fetchSpy: FetchImpl = async () => new Response("nope", { status: 500 });
		const { deps: judgeDeps } = deps(
			[fakeModel()],
			settings({ modelRoles: { taste: "typesafe/jev-1.14" } }),
			fetchSpy,
		);
		expect(await scoreWithJudge(INPUT, judgeDeps)).toBeUndefined();
	});
});
