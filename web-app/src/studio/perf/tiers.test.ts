/**
 * Tier classification + DOM write helpers.
 *
 * Ported from upstream PR #20 (`apps/renderer/src/perf/tiers.test.ts`, vitest →
 * `bun:test`). The CSS half of the feature keys off the same three `<html>`
 * attributes; it can only be verified against the *built* stylesheet (computed
 * `backdrop-filter` / `box-shadow` / `--bd-blur` / infinite-animation count per
 * tier), because no JS DOM applies the cascade that matters here.
 *
 * `bun test` has no DOM, so the tests use a minimal attribute bag instead of
 * `document.createElement`; the helpers only ever call `setAttribute` /
 * `getAttribute`.
 */
import { describe, expect, it } from "bun:test";

import {
	TIER_ATTRIBUTES,
	applyTier,
	attributesForTier,
	currentTier,
	readTierInput,
	tierOf,
} from "./tiers";

/** Minimal `Element` stand-in: the tier helpers only use set/getAttribute. */
class FakeElement {
	readonly attributes = new Map<string, string>();

	setAttribute(name: string, value: string): void {
		this.attributes.set(name, value);
	}

	getAttribute(name: string): string | null {
		return this.attributes.get(name) ?? null;
	}
}

describe("tierOf", () => {
	it("treats a healthy, motion-enabled machine as L0", () => {
		expect(tierOf({ gpu: "hardware", perf: "normal", motion: "on" })).toBe("L0");
	});

	it("maps motion off to L1", () => {
		expect(tierOf({ gpu: "hardware", perf: "normal", motion: "off" })).toBe("L1");
	});

	it("maps software compositing to L2", () => {
		expect(tierOf({ gpu: "software", perf: "normal", motion: "on" })).toBe("L2");
	});

	it("maps a low perf profile on a hardware GPU to L2", () => {
		expect(tierOf({ gpu: "hardware", perf: "low", motion: "on" })).toBe("L2");
	});

	it("maps software compositing plus low perf to L3", () => {
		expect(tierOf({ gpu: "software", perf: "low", motion: "on" })).toBe("L3");
	});

	it("never lowers a degraded tier because the user turned motion off", () => {
		// L1 is a sub-layer of L2/L3: motion off on a software-GPU machine must still
		// keep the effect cut, otherwise forcing reduced motion would "upgrade" it.
		expect(tierOf({ gpu: "software", perf: "normal", motion: "off" })).toBe("L2");
		expect(tierOf({ gpu: "software", perf: "low", motion: "off" })).toBe("L3");
	});

	it("falls back to L0 when the profile is unknown", () => {
		expect(tierOf({})).toBe("L0");
		expect(tierOf({ gpu: null, perf: null, motion: null })).toBe("L0");
	});
});

describe("attributesForTier", () => {
	it("round-trips every tier through tierOf", () => {
		for (const tier of ["L0", "L1", "L2", "L3"] as const) {
			expect(tierOf(attributesForTier(tier))).toBe(tier);
		}
	});
});

describe("applyTier", () => {
	it("writes the three semantic attributes onto the root element", () => {
		const root = new FakeElement() as unknown as Element;
		applyTier(root, "L2");
		expect(root.getAttribute(TIER_ATTRIBUTES.gpu)).toBe("software");
		expect(root.getAttribute(TIER_ATTRIBUTES.motion)).toBe("on");
		expect(root.getAttribute(TIER_ATTRIBUTES.perf)).toBe("normal");
		expect(currentTier(root)).toBe("L2");
	});

	it("reads back exactly what it wrote for every tier", () => {
		const root = new FakeElement() as unknown as Element;
		applyTier(root, "L3");
		expect(readTierInput(root)).toEqual({ gpu: "software", motion: "on", perf: "low" });
		applyTier(root, "L0");
		expect(readTierInput(root)).toEqual({ gpu: "hardware", motion: "on", perf: "normal" });
	});

	it("is a no-op without a root", () => {
		expect(() => applyTier(null, "L1")).not.toThrow();
		expect(() => applyTier(undefined, "L1")).not.toThrow();
	});

	it("ignores unknown attribute values instead of guessing a tier", () => {
		const root = new FakeElement() as unknown as Element;
		root.setAttribute("data-gpu", "banana");
		root.setAttribute("data-motion", "on");
		expect(readTierInput(root)).toEqual({ gpu: null, motion: "on", perf: null });
		expect(currentTier(root)).toBe("L0");
	});
});
