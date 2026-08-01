import { afterEach, describe, expect, test } from "bun:test";
import { M, currentLanguage, detectLanguage, setLanguage, type ZetaLanguage } from "./index";
import { en } from "./en";
import { zh } from "./zh";

const ENV_KEYS = ["ZETA_LANG", "LC_ALL", "LC_MESSAGES", "LANG"] as const;

afterEach(() => {
	for (const key of ENV_KEYS) delete Bun.env[key];
	setLanguage("en");
});

describe("catalogue completeness", () => {
	test("every catalogue covers the same non-empty fields", () => {
		const enKeys = Object.keys(en).sort();
		const zhKeys = Object.keys(zh).sort();
		expect(zhKeys).toEqual(enKeys);
		expect(enKeys.length).toBeGreaterThan(0);
		for (const key of enKeys) {
			expect(en[key as keyof typeof en]).not.toBe("");
			expect(zh[key as keyof typeof zh]).not.toBe("");
		}
	});

	test("translations are not accidental English copies", () => {
		// Local names of the languages themselves legitimately match across
		// catalogues (e.g. "中文" in both en and zh), so exclude them.
		const selfNames = new Set<keyof typeof en>(["languageEnLabel", "languageZhLabel"]);
		for (const key of Object.keys(en) as Array<keyof typeof en>) {
			if (selfNames.has(key)) continue;
			expect(zh[key]).not.toBe(en[key]);
		}
	});
});

describe("detectLanguage", () => {
	test("override wins over every environment variable", () => {
		Bun.env.ZETA_LANG = "en";
		Bun.env.LANG = "zh_CN.UTF-8";
		expect(detectLanguage("zh")).toBe("zh");
		expect(M.welcomeBack).toBe("欢迎回来！");
	});

	test("ZETA_LANG beats LC_* and LANG", () => {
		Bun.env.ZETA_LANG = "zh";
		Bun.env.LC_ALL = "en_US";
		expect(detectLanguage()).toBe("zh");
		expect(M.welcomeBack).toBe("欢迎回来！");
	});

	test("LC_ALL > LC_MESSAGES > LANG", () => {
		Bun.env.LC_ALL = "zh_CN.UTF-8";
		Bun.env.LC_MESSAGES = "en_US";
		Bun.env.LANG = "en_US";
		expect(detectLanguage()).toBe("zh");
	});

	test("unknown locale falls through to English", () => {
		Bun.env.LANG = "fr_FR.UTF-8";
		expect(detectLanguage()).toBe("en");
	});

	test("POSIX underscore and BCP-47 hyphen spellings both resolve", () => {
		Bun.env.LANG = "zh_CN.UTF-8";
		expect(detectLanguage()).toBe("zh");
		Bun.env.LANG = "zh-Hans-CN";
		expect(detectLanguage()).toBe("zh");
	});

	test("M switches live after setLanguage", () => {
		expect(currentLanguage()).toBe("en");
		expect(M.welcomeBack).toBe("Welcome back!");
		setLanguage("zh");
		expect(currentLanguage()).toBe("zh");
		expect(M.welcomeBack).toBe("欢迎回来！");
	});
});

describe("setLanguage", () => {
	test("installs the requested catalogue and echoes the tag", () => {
		expect(setLanguage("zh")).toBe("zh");
		expect(currentLanguage() satisfies ZetaLanguage).toBe("zh");
	});
});
