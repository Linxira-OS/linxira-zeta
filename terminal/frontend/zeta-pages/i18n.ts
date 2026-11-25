/**
 * Page-local i18n shim over the terminal dictionary.
 *
 * The moved pages were written against the Studio `useI18n()` shape. Terminal
 * owns the catalogue (`terminal/frontend/i18n/index.ts`), so this shim exposes
 * `resolvedLanguage` and accepts the pages' dynamic keys while keeping every
 * string in that dictionary.
 */
import { getLocale, t as terminalT, useI18n as useTerminalI18n, type Locale, type MessageKey } from "../i18n";

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

const translate: Translate = (key, vars) => terminalT(key as MessageKey, vars);

export function useI18n(): {
	t: Translate;
	resolvedLanguage: Locale;
	locale: Locale;
	setLocale: (locale: Locale) => void;
} {
	const { locale, setLocale } = useTerminalI18n();
	return { t: translate, resolvedLanguage: locale, locale, setLocale };
}

/** Localized literal helper used by `hostError.ts`. */
export function pickLocale(zh: string, en: string): string {
	return getLocale().startsWith("zh") ? zh : en;
}

export { translate as t };
export type { Locale };
