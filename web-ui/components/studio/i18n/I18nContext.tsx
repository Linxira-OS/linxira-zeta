/**
 * Studio i18n bridge — Studio's message keys, Zeta's single language store.
 *
 * The ported renderer calls `useI18n()` / `t("shell.…")` against Studio's
 * dictionaries (2,700 keys each). Zeta already owns the locale choice
 * (`zeta-locale`, `useI18n().setLocale`, `<html lang>`). Having two stores would
 * let the shell and the transcript disagree, so this provider **reads** Zeta's
 * locale and **writes** back to it:
 *
 *   Zeta `en`     ⇄ Studio `en`
 *   Zeta `zh-CN`  ⇄ Studio `zh`
 *
 * `t()` resolves against Studio's dictionary first and falls back to Zeta's
 * messages, so a key that only exists on one side still renders.
 */

"use client";

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useI18n as useZetaI18n } from "@/hooks/useI18n";
import { en } from "./locales/en";
import { zh } from "./locales/zh";
import type { AppLanguage, Locale, TranslationParams } from "./types";

const dictionaries: Record<Locale, Record<string, string>> = {
	zh: zh as unknown as Record<string, string>,
	en: en as unknown as Record<string, string>,
};

interface StudioI18nValue {
	readonly language: AppLanguage;
	readonly resolvedLanguage: Locale;
	readonly t: (key: string, params?: TranslationParams) => string;
	readonly setLanguage: (language: AppLanguage) => void;
}

const StudioI18nContext = createContext<StudioI18nValue | null>(null);

function interpolate(template: string, params: TranslationParams | undefined): string {
	if (!params) return template;
	return template.replace(/\{([\w.-]+)\}/g, (token, name: string) =>
		name in params ? String(params[name]) : token,
	);
}

export function StudioI18nProvider({ children }: { children: ReactNode }) {
	const zeta = useZetaI18n();
	const resolved: Locale = zeta.locale.startsWith("zh") ? "zh" : "en";

	const t = useCallback(
		(key: string, params?: TranslationParams) => {
			const message = dictionaries[resolved][key] ?? dictionaries.en[key];
			if (message !== undefined) return interpolate(message, params);
			// Fall back to Zeta's own pack so shared keys keep their wording.
			const fallback = zeta.t(key, params as Record<string, string | number> | undefined);
			return fallback === key ? key : fallback;
		},
		[resolved, zeta],
	);

	const setLanguage = useCallback(
		(language: AppLanguage) => {
			if (language === "system") {
				const nav = typeof navigator === "undefined" ? "" : (navigator.languages?.[0] ?? navigator.language ?? "");
				zeta.setLocale(nav.toLowerCase().startsWith("zh") ? "zh-CN" : "en");
				return;
			}
			zeta.setLocale(language === "zh" ? "zh-CN" : "en");
		},
		[zeta],
	);

	const value = useMemo<StudioI18nValue>(
		() => ({ language: resolved, resolvedLanguage: resolved, t, setLanguage }),
		[resolved, t, setLanguage],
	);

	return <StudioI18nContext.Provider value={value}>{children}</StudioI18nContext.Provider>;
}

/** Studio-shaped hook for ported components. */
export function useI18n(): StudioI18nValue {
	const value = useContext(StudioI18nContext);
	if (!value) throw new Error("useI18n must be used inside <StudioI18nProvider>");
	return value;
}

/** Non-hook accessor for the few modules that translate outside React. */
let activeT: ((key: string, params?: TranslationParams) => string) | null = null;

export function setStudioTranslator(t: ((key: string, params?: TranslationParams) => string) | null): void {
	activeT = t;
}

export function t(key: string, params?: TranslationParams): string {
	if (activeT) return activeT(key, params);
	const message = dictionaries.en[key];
	return message === undefined ? key : interpolate(message, params);
}

export { dictionaries };
export type { Locale, TranslationParams, AppLanguage };
