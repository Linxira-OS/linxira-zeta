import { describe, expect, it } from "bun:test";
import {
	findScopedFallbackChain,
	mergeFallbackChains,
	normalizeFallbackChain,
	normalizeFallbackChains,
	normalizeScopedFallbackChains,
	parseFallbackEntry,
} from "@linxiraos/zeta/config/fallback-normalize";

describe("fallback normalization", () => {
	it("drops an exact duplicate provider/model and keeps the first spelling", () => {
		const result = normalizeFallbackChain(["dc-ss/gpt-6.1-sol", " dc-ss/gpt-6.1-sol "]);
		expect(result.chain).toEqual(["dc-ss/gpt-6.1-sol"]);
		expect(result.duplicates).toEqual([{ removed: "dc-ss/gpt-6.1-sol", kept: "dc-ss/gpt-6.1-sol" }]);
	});

	it("treats the same model at different thinking levels as distinct but reports it", () => {
		const result = normalizeFallbackChain(["dc-ss/gpt-6.1-sol:high", "dc-ss/gpt-6.1-sol:max"]);
		expect(result.chain).toHaveLength(2);
		expect(result.duplicates).toEqual([]);
		expect(result.sameModelDifferentEffort).toEqual([
			{ modelKey: "dc-ss/gpt-6.1-sol", thinkingLevels: ["high", "max"] },
		]);
	});

	it("keeps the same model id under different providers", () => {
		const result = normalizeFallbackChain(["commandcode/deepseek-v4.1-flash", "opencode-go/deepseek-v4.1-flash"]);
		expect(result.chain).toEqual(["commandcode/deepseek-v4.1-flash", "opencode-go/deepseek-v4.1-flash"]);
	});

	it("preserves order and never truncates a longer chain", () => {
		const chain = ["a/one", "b/two", "c/three", "d/four"];
		expect(normalizeFallbackChain(chain).chain).toEqual(chain);
	});

	it("ignores empty entries and reports duplicates per key", () => {
		const result = normalizeFallbackChains({
			default: ["a/one", "", "a/one"],
			"a/one": ["b/two"],
		});
		expect(result.default.chain).toEqual(["a/one"]);
		expect(result["a/one"].chain).toEqual(["b/two"]);
	});

	it("parses a thinking suffix without mistaking it for part of the id", () => {
		expect(parseFallbackEntry("provider/model:high")).toEqual({
			raw: "provider/model:high",
			modelKey: "provider/model",
			identity: "provider/model:high",
			thinkingLevel: "high",
		});
	});

	it("merges primary before secondary without repeating identities", () => {
		expect(mergeFallbackChains(["a/one", "b/two"], ["b/two:high", "c/three"])).toEqual([
			"a/one",
			"b/two",
			"b/two:high",
			"c/three",
		]);
	});

	it("collapses an effort alias and a dotted revision spelling onto one identity", () => {
		const result = normalizeFallbackChain(["openai/gpt-5.5:hi", "openai/gpt-5-5:high"]);
		expect(result.chain).toEqual(["openai/gpt-5.5:hi"]);
		expect(result.duplicates).toEqual([{ removed: "openai/gpt-5-5:high", kept: "openai/gpt-5.5:hi" }]);
		expect(result.sameModelDifferentEffort).toEqual([]);
	});

	it("collapses catalog aliases through the resolver instead of counting them twice", () => {
		const resolveModel = (entry: { modelKey: string }) => {
			if (entry.modelKey === "provider/short" || entry.modelKey === "provider/full-model") {
				return { provider: "provider", id: "full-model" };
			}
			return undefined;
		};
		const result = normalizeFallbackChain(["provider/short:med", "provider/full-model:medium"], { resolveModel });
		expect(result.chain).toEqual(["provider/short:med"]);
		expect(result.duplicates).toEqual([{ removed: "provider/full-model:medium", kept: "provider/short:med" }]);
	});

	it("keeps resume, retry, role, agent and mode chains in separate scopes", () => {
		const scoped = normalizeScopedFallbackChains({
			resume: { default: ["resume/one", "resume/one"] },
			retry: { default: ["retry/two"] },
			role: { slow: ["role/three"] },
			agent: { reviewer: ["agent/four"] },
			mode: { vibe: ["mode/five"] },
		});
		expect(scoped.resume.default.chain).toEqual(["resume/one"]);
		expect(scoped.retry.default.chain).toEqual(["retry/two"]);
		expect(scoped.role.slow.chain).toEqual(["role/three"]);
		expect(scoped.agent.reviewer.chain).toEqual(["agent/four"]);
		expect(scoped.mode.vibe.chain).toEqual(["mode/five"]);

		// A key that exists only in another scope must not satisfy this lookup.
		expect(findScopedFallbackChain(scoped, [{ scope: "mode", key: "default" }])).toBeUndefined();
		expect(findScopedFallbackChain(scoped, [{ scope: "resume", key: "default" }])?.chain.chain).toEqual([
			"resume/one",
		]);
	});

	it("treats an explicitly empty scoped chain as no fallbacks, not as a miss", () => {
		const scoped = normalizeScopedFallbackChains({ retry: { default: [] } });
		const found = findScopedFallbackChain(scoped, [
			{ scope: "retry", key: "default" },
			{ scope: "agent", key: "default" },
		]);
		expect(found?.scope).toBe("retry");
		expect(found?.chain.chain).toEqual([]);
	});
});
