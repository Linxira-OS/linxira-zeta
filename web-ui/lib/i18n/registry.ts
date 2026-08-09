import { enLocale } from "./messages/en.ts";
import { zhCNLocale } from "./messages/zh-CN.ts";
import type { Locale, LocalePlugin } from "./types.ts";

const localePlugins = new Map<string, LocalePlugin>();

/** Register a locale pack; duplicate ids throw to avoid silent translation loss. */
export function registerLocale(plugin: LocalePlugin): void {
	if (!plugin.id.trim()) throw new Error("Locale id must not be empty");
	if (localePlugins.has(plugin.id)) throw new Error(`Locale already registered: ${plugin.id}`);
	localePlugins.set(plugin.id, plugin);
}

/** Look up a registered locale pack by id. */
export function getLocalePlugin(id: string): LocalePlugin | undefined {
	return localePlugins.get(id);
}

/** Stable registration order of supported locale ids. */
export function getSupportedLocales(): string[] {
	return [...localePlugins.keys()];
}

/** Map a browser language list to a built-in locale; falls back to English. */
export function resolveBrowserLocale(languages: readonly string[]): Locale {
	for (const language of languages) {
		const normalized = language.toLowerCase();
		if (normalized === "en" || normalized.startsWith("en-")) return "en";
		if (normalized === "zh" || normalized.startsWith("zh-")) return "zh-CN";
	}
	return "en";
}

registerLocale(enLocale);
registerLocale(zhCNLocale);