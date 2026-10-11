import { describe, expect, it } from "bun:test";
import { interpolateMessage, translateMessage } from "../src/client/i18n/format";
import { enMessages, type MessageKey } from "../src/client/i18n/messages/en";
import { zhCNMessages } from "../src/client/i18n/messages/zh-CN";
import { resolveBrowserLocale, resolveLocaleTag } from "../src/locale";

/**
 * Messages that are deliberately identical in English and Chinese: product
 * names, unit symbols and code/JSON tokens. Anything else whose `zh-CN` value
 * equals its English one is an untranslated string that slipped through — the
 * one failure mode a key-set comparison cannot see.
 */
const IDENTICAL_OK = new Set<MessageKey>([
	"common.tokens",
	"common.tokens-per-second",
	"common.unknown",
	"common.range-1h",
	"common.range-24h",
	"common.range-7d",
	"common.range-30d",
	"common.range-90d",
	"nav.breadcrumb-stats",
]);

const PLACEHOLDERS = /\{([\w.-]+)\}/g;

function placeholders(message: string): string[] {
	return [...message.matchAll(PLACEHOLDERS)].map(match => match[1]).sort();
}

describe("stats i18n catalogues", () => {
	it("covers every English key in Simplified Chinese", () => {
		const missing = Object.keys(enMessages).filter(key => !(key in zhCNMessages));
		expect(missing).toEqual([]);
	});

	it("has no Chinese key that English lacks", () => {
		const extra = Object.keys(zhCNMessages).filter(key => !(key in enMessages));
		expect(extra).toEqual([]);
	});

	it("keeps placeholder sets identical across locales", () => {
		const mismatched = Object.keys(enMessages).filter(key => {
			const zh = zhCNMessages[key as MessageKey];
			if (zh === undefined) return false;
			return placeholders(enMessages[key as MessageKey]).join(",") !== placeholders(zh).join(",");
		});
		expect(mismatched).toEqual([]);
	});

	it("translates every key unless it is on the identical allowlist", () => {
		const untranslated = Object.keys(enMessages).filter(key => {
			const typed = key as MessageKey;
			const zh = zhCNMessages[typed];
			return zh !== undefined && zh === enMessages[typed] && !IDENTICAL_OK.has(typed);
		});
		expect(untranslated).toEqual([]);
	});
});

describe("stats locale resolution", () => {
	it("maps zh variants to Simplified Chinese and everything else to English", () => {
		expect(resolveLocaleTag("zh")).toBe("zh-CN");
		expect(resolveLocaleTag("zh-CN")).toBe("zh-CN");
		expect(resolveLocaleTag("zh-Hans")).toBe("zh-CN");
		expect(resolveLocaleTag("ZH_cn")).toBe("zh-CN");
		expect(resolveLocaleTag("en-US")).toBe("en");
		expect(resolveLocaleTag("tr-TR")).toBe("en");
		expect(resolveLocaleTag(undefined)).toBe("en");
		expect(resolveLocaleTag("")).toBe("en");
	});

	it("picks the first shipped browser language", () => {
		expect(resolveBrowserLocale(["de", "zh-CN", "en"])).toBe("zh-CN");
		expect(resolveBrowserLocale(["de", "fr"])).toBe("en");
		expect(resolveBrowserLocale([])).toBe("en");
		expect(resolveBrowserLocale(undefined)).toBe("en");
	});
});

describe("stats translation", () => {
	const messages = { en: enMessages, "zh-CN": zhCNMessages };

	it("interpolates placeholders and leaves unknown ones verbatim", () => {
		expect(interpolateMessage("Hello, {name} ({count})", { name: "Zeta", count: 2 })).toBe("Hello, Zeta (2)");
		expect(interpolateMessage("Keep {unknown}", {})).toBe("Keep {unknown}");
	});

	it("falls back to English, then to the key", () => {
		expect(translateMessage("zh-CN", "nav.providers", messages)).toBe("服务商");
		expect(translateMessage("zh-CN", "missing.key", messages)).toBe("missing.key");
	});
});
