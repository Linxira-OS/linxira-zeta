import { describe, expect, test } from "bun:test";

import {
	hasProviderWideHiddenRule,
	hiddenSelectorsForProvider,
	isModelHidden,
	revealModel,
	visibleModels,
} from "./modelVisibility";

const sonnet = { provider: "anthropic", id: "claude-sonnet-4-5" };
const opus = { provider: "anthropic", id: "claude-opus-4-5" };
const openrouterSonnet = { provider: "openrouter", id: "anthropic/claude-sonnet-4-5" };
const all = [sonnet, opus, openrouterSonnet];

describe("work studio hidden models", () => {
	test("hides exact selectors and copied thinking suffixes", () => {
		expect(isModelHidden(sonnet, ["anthropic/claude-sonnet-4-5"])).toBe(true);
		expect(isModelHidden(sonnet, ["anthropic/claude-sonnet-4-5:high"])).toBe(true);
		expect(isModelHidden(sonnet, ["anthropic/claude-opus-4-5"])).toBe(false);
	});

	test("hides provider-wide and vendor-prefixed rules", () => {
		expect(isModelHidden(sonnet, ["anthropic/*"])).toBe(true);
		expect(isModelHidden(sonnet, ["openrouter/*"])).toBe(false);
		expect(isModelHidden(openrouterSonnet, ["openrouter/anthropic/*"])).toBe(true);
		expect(isModelHidden(openrouterSonnet, ["openrouter/google/*"])).toBe(false);
	});

	test("visibleModels keeps order and drops hidden rows", () => {
		expect(visibleModels(all, ["anthropic/*"])).toEqual([openrouterSonnet]);
		expect(visibleModels(all, [])).toEqual(all);
		expect(visibleModels(all, undefined)).toEqual(all);
	});

	test("bulk hide writes exact selectors for one provider only", () => {
		expect(hiddenSelectorsForProvider(all, "anthropic")).toEqual([
			"anthropic/claude-sonnet-4-5",
			"anthropic/claude-opus-4-5",
		]);
	});

	test("revealModel clears every rule covering the model, including provider globs", () => {
		expect(revealModel(["anthropic/*", "anthropic/claude-opus-4-5", "openrouter/*"], sonnet)).toEqual([
			"anthropic/claude-opus-4-5",
			"openrouter/*",
		]);
	});

	test("reports whether a provider-wide rule covers the model", () => {
		expect(hasProviderWideHiddenRule(sonnet, ["anthropic/*"])).toBe(true);
		expect(hasProviderWideHiddenRule(sonnet, ["anthropic/claude-sonnet-4-5"])).toBe(false);
	});

	test("exact selectors match ids whose real suffix looks like a thinking level", () => {
		// Real nanogpt catalog rows (5966-model bundle): hiding a provider writes
		// these exact selectors, so stripping the suffix first would leave them
		// visible and also make "show this model" unable to clear the rule.
		const codingRouterHigh = { provider: "nanogpt", id: "nanogpt/coding-router:high" };
		const opusThinkingLow = { provider: "nanogpt", id: "anthropic/claude-opus-4.6:thinking:low" };
		const literals = [codingRouterHigh, opusThinkingLow];

		expect(isModelHidden(codingRouterHigh, ["nanogpt/nanogpt/coding-router:high"])).toBe(true);
		expect(isModelHidden(opusThinkingLow, ["nanogpt/anthropic/claude-opus-4.6:thinking:low"])).toBe(true);
		expect(visibleModels(literals, hiddenSelectorsForProvider(literals, "nanogpt"))).toEqual([]);
		expect(revealModel(["nanogpt/nanogpt/coding-router:high", "nanogpt/*"], codingRouterHigh)).toEqual([]);

		// The same boundary on the bare-id form, and reveal must clear that rule.
		const bareLiteral = { provider: "nanogpt", id: "coding-router:high" };
		const bareBase = { provider: "nanogpt", id: "coding-router" };
		expect(isModelHidden(bareLiteral, ["coding-router:high"])).toBe(true);
		expect(revealModel(["coding-router:high"], bareLiteral)).toEqual([]);
		// A copied role suffix still hides its base model (the pre-existing rule).
		expect(isModelHidden(sonnet, ["anthropic/claude-sonnet-4-5:high"])).toBe(true);
		expect(isModelHidden(bareBase, ["coding-router:high"])).toBe(true);
		expect(revealModel(["coding-router:high"], bareBase)).toEqual([]);
	});
});
