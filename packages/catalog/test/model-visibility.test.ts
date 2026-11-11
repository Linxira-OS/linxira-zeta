import { describe, expect, it } from "bun:test";

import { isModelHiddenBySelectors } from "../src/models";

describe("hidden model selectors", () => {
	const sonnet = { provider: "anthropic", id: "claude-sonnet-4-5" };
	const openrouterSonnet = { provider: "openrouter", id: "anthropic/claude-sonnet-4-5" };

	it("hides an exact selector and ignores a copied thinking suffix", () => {
		expect(isModelHiddenBySelectors(sonnet, ["anthropic/claude-sonnet-4-5"])).toBe(true);
		expect(isModelHiddenBySelectors(sonnet, ["anthropic/claude-sonnet-4-5:high"])).toBe(true);
		expect(isModelHiddenBySelectors(sonnet, ["anthropic/claude-opus-4-5"])).toBe(false);
	});

	it("hides every model of a provider", () => {
		expect(isModelHiddenBySelectors(sonnet, ["anthropic/*"])).toBe(true);
		expect(isModelHiddenBySelectors(openrouterSonnet, ["anthropic/*"])).toBe(false);
	});

	it("supports a vendor prefix inside a provider", () => {
		expect(isModelHiddenBySelectors(openrouterSonnet, ["openrouter/anthropic/*"])).toBe(true);
		expect(isModelHiddenBySelectors(openrouterSonnet, ["openrouter/google/*"])).toBe(false);
	});

	it("hides a bare model id across providers", () => {
		expect(isModelHiddenBySelectors(sonnet, ["claude-sonnet-4-5"])).toBe(true);
		expect(isModelHiddenBySelectors(openrouterSonnet, ["claude-sonnet-4-5"])).toBe(false);
	});

	it("treats an empty list as visible and tolerates blank entries", () => {
		expect(isModelHiddenBySelectors(sonnet, [])).toBe(false);
		expect(isModelHiddenBySelectors(sonnet, undefined)).toBe(false);
		expect(isModelHiddenBySelectors(sonnet, ["", "   "])).toBe(false);
	});

	it("hides everything with a star", () => {
		expect(isModelHiddenBySelectors(sonnet, ["*"])).toBe(true);
	});
});
