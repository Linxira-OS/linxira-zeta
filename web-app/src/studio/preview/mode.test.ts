import { describe, expect, test } from "bun:test";
import { previewForcedByQuery } from "./mode";

describe("preview query gate", () => {
	test("production builds ignore ?preview=1", () => {
		expect(previewForcedByQuery("?preview=1", false)).toBe(false);
		expect(previewForcedByQuery("?preview=1&route=workbench", false)).toBe(false);
	});

	test("development builds honour an explicit preview=1", () => {
		expect(previewForcedByQuery("?preview=1", true)).toBe(true);
		expect(previewForcedByQuery("?route=home&preview=1", true)).toBe(true);
	});

	test("anything other than preview=1 stays real data", () => {
		expect(previewForcedByQuery("", true)).toBe(false);
		expect(previewForcedByQuery("?preview=0", true)).toBe(false);
		expect(previewForcedByQuery("?preview=", true)).toBe(false);
		expect(previewForcedByQuery("?preview=true", true)).toBe(false);
	});
});
