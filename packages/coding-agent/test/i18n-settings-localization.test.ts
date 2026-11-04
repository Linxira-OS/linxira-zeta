import { afterEach, describe, expect, test } from "bun:test";
import { SETTING_TABS } from "@linxiraos/pi-tui/overlays/settings-defs";
import { createSettingsHost } from "../src/config/settings-ui";
import { resetSettingsForTest, Settings } from "../src/config/settings";
import { currentLanguage, setLanguage } from "../src/i18n";

afterEach(() => {
	resetSettingsForTest();
	setLanguage("en");
});

describe("settings page zh localization", () => {
	test("zh: all labels and descriptions are Chinese", () => {
		setLanguage("zh");
		const host = createSettingsHost();
		expect(host.entries.length).toBeGreaterThan(300);

		// No setting label/description may remain pure ASCII English under zh.
		const hasCjk = (s: string) => /[\u4e00-\u9fff]/.test(s);
		for (const entry of host.entries) {
			expect(hasCjk(entry.ui?.label ?? ""), `label for ${entry.path} should be zh: ${entry.ui?.label}`).toBe(true);
			if (entry.ui?.description) {
				expect(
					hasCjk(entry.ui.description),
					`description for ${entry.path} should be zh: ${entry.ui.description}`,
				).toBe(true);
			}
		}
		// Every tab still yields entries.
		for (const tab of SETTING_TABS) {
			const forTab = host.entries.filter(entry => entry.ui?.tab === tab);
			expect(forTab.length).toBeGreaterThan(0);
		}
	});

	test("en: schema English preserved", () => {
		setLanguage("en");
		const host = createSettingsHost();
		expect(host.entries.length).toBeGreaterThan(300);
		const hasCjk = (s: string) => /[\u4e00-\u9fff]/.test(s);
		for (const entry of host.entries) {
			expect(
				hasCjk(entry.ui?.label ?? ""),
				`en label for ${entry.path} should stay English: ${entry.ui?.label}`,
			).toBe(false);
		}
	});
});

describe("settings language is the effective language", () => {
	test("an unconfigured setting wins over startup-prepaint detection and environment", async () => {
		resetSettingsForTest();
		// A Chinese pre-settings detection must not survive Settings.init: the
		// schema default is en and the settings panel already shows en.
		setLanguage("zh");
		Bun.env.LC_ALL = "zh_CN.UTF-8";
		try {
			await Settings.init({ inMemory: true });
			const host = createSettingsHost();
			expect(currentLanguage()).toBe("en");
			expect(host.get("language")).toBe("en");
			expect(host.entries.find(entry => entry.path === "language")?.defaultValue).toBe("en");
		} finally {
			delete Bun.env.LC_ALL;
		}
	});

	test("changing language through the settings host updates the catalogue", async () => {
		resetSettingsForTest();
		try {
			await Settings.init({ inMemory: true });
			const host = createSettingsHost();
			host.set("language", "zh");
			expect(currentLanguage()).toBe("zh");
			expect(host.get("language")).toBe("zh");
			host.set("language", "en");
			expect(currentLanguage()).toBe("en");
			expect(host.get("language")).toBe("en");
		} finally {
			delete Bun.env.LC_ALL;
		}
	});
});
