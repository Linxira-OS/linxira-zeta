import { describe, expect, test } from "bun:test";
import { sameBytes } from "./generated-freshness";

describe("sameBytes", () => {
	test("is true for byte-identical output", () => {
		expect(sameBytes(new Uint8Array([]), new Uint8Array([]))).toBe(true);
		expect(sameBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
	});

	test("is false for any divergence, including a length-only one", () => {
		expect(sameBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
		expect(sameBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2]))).toBe(false);
		expect(sameBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
	});
});
