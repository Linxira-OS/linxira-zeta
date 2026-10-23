import { afterEach, describe, expect, it } from "bun:test";
import { getLocale, setLocale, setUserLocale, subscribeLocale, t } from "../src/client/i18n";

describe("stats locale switching", () => {
	afterEach(() => {
		setLocale("en");
	});

	it("switches copy at runtime and notifies subscribers", () => {
		const seen: string[] = [];
		const off = subscribeLocale(() => seen.push(getLocale()));

		setUserLocale("zh-CN");
		expect(getLocale()).toBe("zh-CN");
		expect(t("shell.language")).toBe("语言");
		expect(seen).toEqual(["zh-CN"]);

		setUserLocale("en");
		expect(t("shell.language")).toBe("Language");

		off();
		setUserLocale("zh-CN");
		expect(seen).toEqual(["zh-CN", "en"]);
	});

	it("keeps the new keys translated in both catalogues", () => {
		expect(t("shell.switch-language")).toBe("Switch dashboard language");
		setLocale("zh-CN");
		expect(t("shell.switch-language")).toBe("切换仪表盘语言");
	});
});
