import { describe, expect, it } from "bun:test";
import {
	isPausedCapability,
	isProductCapability,
	pausedCapabilityReason,
	summarizeProviderCapabilities,
} from "@linxiraos/zeta/config/provider-capabilities";

describe("provider capability policy", () => {
	it("keeps chat as the implicit kind and exposes image/decision kinds", () => {
		expect(isProductCapability(undefined)).toBe(true);
		expect(isProductCapability("image")).toBe(true);
		expect(isProductCapability("judge")).toBe(true);
		expect(isProductCapability("rerank")).toBe(true);
	});

	it("pauses tts, stt and video with a product reason", () => {
		for (const kind of ["tts", "stt", "video"] as const) {
			expect(isPausedCapability(kind)).toBe(true);
			expect(pausedCapabilityReason(kind)).toContain("paused");
		}
	});

	it("summarizes visible capabilities and hides providers with only paused models", () => {
		const summary = summarizeProviderCapabilities([
			{ provider: "openai", kind: "chat" },
			{ provider: "openai", kind: "image" },
			{ provider: "openai", kind: "image" },
			{ provider: "audio-only", kind: "tts" },
			{ provider: "local", kind: "embedding" },
		]);
		expect(summary).toEqual([
			{ provider: "openai", capabilities: ["chat", "image"], modelCount: 3, paused: [] },
			{ provider: "local", capabilities: ["embedding"], modelCount: 1, paused: [] },
		]);
	});

	it("reports paused descriptors on a provider that also has visible models", () => {
		expect(
			summarizeProviderCapabilities([
				{ provider: "hybrid", kind: "tts" },
				{ provider: "hybrid", kind: "video" },
				{ provider: "hybrid" },
			]),
		).toEqual([{ provider: "hybrid", capabilities: ["chat"], modelCount: 3, paused: ["tts", "video"] }]);
	});
});
