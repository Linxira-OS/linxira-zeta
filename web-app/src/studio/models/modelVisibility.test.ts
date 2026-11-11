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
});
