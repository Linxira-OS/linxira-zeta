"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getLocalePlugin, getSupportedLocales, resolveBrowserLocale } from "@/lib/i18n/registry";
import { translateMessage } from "@/lib/i18n/format";
import type { Locale, LocalePlugin, TranslationParams } from "@/lib/i18n/types";

const LOCALE_STORAGE_KEY = "zeta-locale";
const LEGACY_LANGUAGE_KEY = "zeta-lang";
const defaultLocale: Locale = "en";

interface I18nContextValue {
	locale: Locale;
	setLocale: (locale: Locale) => void;
	t: (key: string, params?: TranslationParams) => string;
	supportedLocales: LocalePlugin[];
	isZh: boolean;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function getMessages(): Record<string, Record<string, string>> {
	return Object.fromEntries(
		getSupportedLocales().flatMap((id) => {
			const plugin = getLocalePlugin(id);
			return plugin ? [[id, plugin.messages]] : [];
		}),
	);
}

function readInitialLocale(): Locale {
	try {
		const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
		if (stored === "en" || stored === "zh-CN") return stored;
		const legacy = window.localStorage.getItem(LEGACY_LANGUAGE_KEY);
		if (legacy === "zh") return "zh-CN";
		if (legacy === "en") return "en";
	} catch {
		// storage unavailable — fall through to browser language
	}
	return resolveBrowserLocale(
		window.navigator.languages.length ? window.navigator.languages : [window.navigator.language],
	);
}

function applyLocale(locale: Locale) {
	document.documentElement.lang = locale;
	const cl = document.documentElement.classList;
	cl.remove("lang-en", "lang-zh", "lang-cn");
	if (locale === "zh-CN") {
		cl.add("lang-zh", "lang-cn");
	} else {
		cl.add("lang-en");
	}
}

/**
 * Provides the Zeta Web UI locale state and key-based translation.
 * @param props React children
 * @returns a locale-aware React context node
 */
export function I18nProvider({ children }: { children: React.ReactNode }) {
	const [locale, setLocaleState] = useState<Locale>(defaultLocale);
	const [hydrated, setHydrated] = useState(false);
	const supportedLocales = useMemo(
		() =>
			getSupportedLocales()
				.map((id) => getLocalePlugin(id))
				.filter((plugin): plugin is LocalePlugin => Boolean(plugin)),
		[],
	);
	const messages = useMemo(() => getMessages(), []);

	useEffect(() => {
		const next = readInitialLocale();
		applyLocale(next);
		setLocaleState(next);
		setHydrated(true);
	}, []);

	const setLocale = useCallback((next: Locale) => {
		if (!getLocalePlugin(next)) return;
		applyLocale(next);
		setLocaleState(next);
		try {
			window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
		} catch {
			// storage failure does not affect in-page switching
		}
	}, []);

	const t = useCallback(
		(key: string, params?: TranslationParams) => translateMessage(locale, key, messages, params),
		[locale, messages],
	);

	const value = useMemo<I18nContextValue>(
		() => ({
			locale: hydrated ? locale : defaultLocale,
			setLocale,
			t,
			supportedLocales,
			isZh: (hydrated ? locale : defaultLocale) === "zh-CN",
		}),
		[hydrated, locale, setLocale, t, supportedLocales],
	);

	return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Access the current locale context; throws when used outside I18nProvider. */
export function useI18n(): I18nContextValue {
	const context = useContext(I18nContext);
	if (!context) throw new Error("useI18n must be used inside I18nProvider");
	return context;
}