import { describe, expect, it } from "bun:test";
import {
	mergeFallbackChains,
	normalizeFallbackChain,
	normalizeFallbackChains,
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
});

describe("effective fallback chains", () => {
	it("normalizes configured chains and copies the default without aliasing", async () => {
		const { expandDefaultRetryFallbackChains } = await import("@linxiraos/zeta/session/retry-fallback-chains");
		const normalized = expandDefaultRetryFallbackChains({ default: ["a/one", "a/one", "b/two"] }, [
			"default",
			"coder",
		]);
		expect(normalized.default).toEqual(["a/one", "b/two"]);
		expect(normalized.coder).toEqual(["a/one", "b/two"]);
		normalized.coder.push("c/three");
		expect(normalized.default).toEqual(["a/one", "b/two"]);
	});
});
