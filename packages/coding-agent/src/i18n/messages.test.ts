import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { resetSettingsForTest, Settings, settings } from "../config/settings";
import { en } from "./en";
import { currentLanguage, detectLanguage, M, setLanguage, type ZetaLanguage } from "./index";
import { zh } from "./zh";

const ENV_KEYS = ["ZETA_LANG", "LC_ALL", "LC_MESSAGES", "LANG"] as const;

afterEach(() => {
	for (const key of ENV_KEYS) delete Bun.env[key];
	setLanguage("en");
});

// Fields that intentionally read the same or differ structurally between
// languages: local language names ("中文" in both en and zh), proper nouns
// that stay untranslated (glyph/theme names like "Nerd Font", "Titanium"),
// and plural-suffix fields that are empty in zh (Chinese has no plural "s").
const intentionallyIdentical: Partial<Record<keyof typeof en, true>> = {
	languageEnLabel: true,
	languageZhLabel: true,
	setupGlyphLabelNerd: true,
	setupGlyphLabelUnicode: true,
	setupGlyphLabelAscii: true,
	setupThemeTitaniumLabel: true,
	setupThemeLightLabel: true,
	mcpHelpAddUsage: true,
	mcpHelpSearchUsage: true,
	sshHelpAddUsage: true,
	psBadgeNpm: true,
	mhModelsScopeSuffix: true,
	ftPluralS: true,
	agwPluralS: true,
	scpAutoLabelFmt: true,
};

describe("catalogue completeness", () => {
	test("every catalogue covers the same non-empty fields", () => {
		const enKeys = Object.keys(en).sort();
		const zhKeys = Object.keys(zh).sort();
		expect(zhKeys).toEqual(enKeys);
		expect(enKeys.length).toBeGreaterThan(0);
		for (const key of enKeys) {
			// Plural-suffix fields are legitimately empty in zh (Chinese has
			// no plural marker); every other field must carry real text.
			if (key in intentionallyIdentical) continue;
			expect(en[key as keyof typeof en]).not.toBe("");
			expect(zh[key as keyof typeof zh]).not.toBe("");
		}
	});

	test("translations are not accidental English copies", () => {
		for (const key of Object.keys(en) as Array<keyof typeof en>) {
			if (key in intentionallyIdentical) continue;
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

	test("unset language falls back to environment detection", async () => {
		const tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-i18n-"));
		try {
			resetSettingsForTest();
			await Settings.init({ inMemory: true, cwd: tmpdir });
			Bun.env.LC_ALL = "zh_CN.UTF-8";
			expect(detectLanguage()).toBe("zh");
			expect(M.welcomeBack).toBe("欢迎回来！");
		} finally {
			resetSettingsForTest();
			await fs.rm(tmpdir, { recursive: true, force: true });
		}
	});

	test("explicit language override beats environment detection", async () => {
		const tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-i18n-"));
		try {
			resetSettingsForTest();
			await Settings.init({ inMemory: true, cwd: tmpdir });
			settings.override("language", "en");
			Bun.env.LC_ALL = "zh_CN.UTF-8";
			expect(detectLanguage()).toBe("en");
		} finally {
			resetSettingsForTest();
			await fs.rm(tmpdir, { recursive: true, force: true });
		}
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
