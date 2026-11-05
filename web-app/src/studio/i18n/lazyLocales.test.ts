import { describe, expect, test } from "bun:test";
import { ensureLocale, translate } from "./I18nContext";
import { en } from "./locales/en";

function firstLeafPath(value: unknown, prefix = ""): string {
	if (typeof value === "string") return prefix;
	if (value !== null && typeof value === "object") {
		for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
			const path = firstLeafPath(child, prefix === "" ? key : `${prefix}.${key}`);
			if (path !== "") return path;
		}
	}
	return "";
}

function leaf(value: unknown, path: string): unknown {
	let current: unknown = value;
	for (const part of path.split(".")) {
		if (current === null || typeof current !== "object") return undefined;
		current = (current as Record<string, unknown>)[part];
	}
	return current;
}

describe("lazy locale dictionaries", () => {
	test("the bundled locale resolves keys through the same registry", () => {
		const path = firstLeafPath(en);
		expect(path).not.toBe("");
		expect(translate("en", path)).toBe(leaf(en, path) as string);
	});

	test("ensureLocale loads a non-bundled dictionary on demand", async () => {
		const path = firstLeafPath(en);
		const zh = await ensureLocale("zh");
		expect(Object.keys(zh).length).toBeGreaterThan(5);
		const value = leaf(zh, path);
		// The zh dictionary is a translation, not a copy: it must exist and be a string.
		expect(typeof value).toBe("string");
		expect(translate("zh", path)).toBe(value as string);
	});

	test("an unknown key falls back to the key itself", () => {
		expect(translate("en", "definitely.not.a.key")).toBe("definitely.not.a.key");
	});
});
