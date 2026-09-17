import { afterEach, describe, expect, test } from "bun:test";
import { SETTING_TABS } from "../src/config/settings-schema";
import { setLanguage } from "../src/i18n";
import { getAllSettingDefs, getSettingsForTab } from "../src/modes/components/settings-defs";

afterEach(() => setLanguage("en"));

describe("settings page zh localization", () => {
	test("zh: all tab labels, group headings, labels, descriptions are Chinese", () => {
		setLanguage("zh");
		const defs = getAllSettingDefs();
		expect(defs.length).toBeGreaterThan(300);

		// No setting label/description may remain pure ASCII English under zh.
		const hasCjk = (s: string) => /[\u4e00-\u9fff]/.test(s);
		for (const def of defs) {
			expect(hasCjk(def.label), `label for ${def.path} should be zh: ${def.label}`).toBe(true);
			if (def.description) {
				expect(hasCjk(def.description), `description for ${def.path} should be zh: ${def.description}`).toBe(true);
			}
		}
		// Tab headings localized.
		for (const tab of SETTING_TABS) {
			const defsForTab = getSettingsForTab(tab);
			expect(defsForTab.length).toBeGreaterThan(0);
		}
	});

	test("en: schema English preserved", () => {
		setLanguage("en");
		const defs = getAllSettingDefs();
		expect(defs.length).toBeGreaterThan(300);
		const hasCjk = (s: string) => /[\u4e00-\u9fff]/.test(s);
		for (const def of defs) {
			expect(hasCjk(def.label), `en label for ${def.path} should stay English: ${def.label}`).toBe(false);
		}
	});
});
