import { afterEach, describe, expect, test } from "bun:test";
import { SETTING_TABS } from "@linxiraos/pi-tui/overlays/settings-defs";
import { setLanguage } from "../src/i18n";
import { createSettingsHost } from "../src/config/settings-ui";

afterEach(() => setLanguage("en"));

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
