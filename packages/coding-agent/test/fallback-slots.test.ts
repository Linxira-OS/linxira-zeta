import { describe, expect, it } from "bun:test";

import { composeFallbackSlots, readFallbackSlots } from "@linxiraos/zeta/config/fallback-slots";

describe("fixed fallback slots", () => {
	it("reads Fallback 1/2 and preserves every extra entry", () => {
		expect(readFallbackSlots(["a/one", "b/two", "c/three", "d/four"])).toEqual({
			fallback1: "a/one",
			fallback2: "b/two",
			extras: ["c/three", "d/four"],
		});
		expect(readFallbackSlots(undefined)).toEqual({ extras: [] });
	});

	it("allows an empty Fallback 2 and composes to a one-entry chain", () => {
		expect(composeFallbackSlots("a/one", undefined, [])).toEqual({ ok: true, chain: ["a/one"] });
	});

	it("writes [] when both slots are empty and no extras exist", () => {
		expect(composeFallbackSlots(undefined, undefined, [])).toEqual({ ok: true, chain: [] });
	});

	it("never silently drops extra entries", () => {
		expect(composeFallbackSlots("a/one", undefined, ["c/three"])).toEqual({
			ok: true,
			chain: ["a/one", "c/three"],
		});
		expect(composeFallbackSlots(undefined, undefined, ["c/three"])).toEqual({
			ok: false,
			reason: "extras-with-empty-slots",
		});
	});

	it("requires Fallback 1 before Fallback 2", () => {
		expect(composeFallbackSlots(undefined, "b/two", [])).toEqual({
			ok: false,
			reason: "fallback2-without-fallback1",
		});
	});

	it("drops extras only with the explicit clearExtras choice", () => {
		expect(composeFallbackSlots("a/one", "b/two", ["c/three"], { clearExtras: true })).toEqual({
			ok: true,
			chain: ["a/one", "b/two"],
		});
	});
});
