import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { en } from "./locales/en";
import type { AppLanguage, I18nContextValue, Locale, TranslationParams } from "./types";
import { useAppSettings } from "../settings/appSettings";

/**
 * Per-locale dictionaries, loaded on demand. English is bundled because it is
 * the fallback for every lookup; the other locales arrive as their own chunks
 * (a `zh` session pays one extra request and never downloads nothing it uses,
 * an `en` session never pays for `zh`'s ~140 KB of copy).
 */
type Dictionary = typeof en;

const dictionaries: Partial<Record<Locale, Dictionary>> = { en };

const localeLoaders: Partial<Record<Locale, () => Promise<Dictionary>>> = {
  zh: () => import("./locales/zh").then(module => module.zh as Dictionary),
};

/** Load a locale dictionary if it is not in memory yet. Idempotent. */
export async function ensureLocale(locale: Locale): Promise<Dictionary> {
  const loaded = dictionaries[locale];
  if (loaded !== undefined) return loaded;
  const loader = localeLoaders[locale];
  if (loader === undefined) return dictionaries.en as Dictionary;
  const dictionary = await loader();
  dictionaries[locale] = dictionary;
  return dictionary;
}

export function detectSystemLanguage(): Locale {
  try {
    const nav = typeof navigator !== "undefined" ? navigator : undefined;
    const lang = (nav?.language || (nav?.languages && nav.languages[0]) || "").toLowerCase();
    if (lang.startsWith("zh")) {
      return "zh";
    }
    if (lang.startsWith("en")) {
      return "en";
    }
  } catch {
    /* fallback to English if navigator is not accessible */
  }
  return "en";
}

export function resolveLanguage(preference?: AppLanguage): Locale {
  if (preference === "zh" || preference === "en") {
    return preference;
  }
  return detectSystemLanguage();
}

function lookupKey(dict: Record<string, unknown>, path: string): string | undefined {
  const parts = path.split(".");
  let current: unknown = dict;
  for (const part of parts) {
    if (current && typeof current === "object" && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof current === "string" ? current : undefined;
}

export function formatTranslation(template: string, params?: TranslationParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    return key in params ? String(params[key]) : match;
  });
}

export function translate(locale: Locale, key: string, params?: TranslationParams): string {
  const dict = dictionaries[locale] ?? (dictionaries.en as Dictionary);
  const direct = lookupKey(dict as unknown as Record<string, unknown>, key);
  if (direct !== undefined) {
    return formatTranslation(direct, params);
  }
  // Fallback to the other locale when the key is missing here
  const fallbackDict = dictionaries[locale === "zh" ? "en" : "zh"] ?? (dictionaries.en as Dictionary);
  const fallback = lookupKey(fallbackDict as unknown as Record<string, unknown>, key);
  if (fallback !== undefined) {
    return formatTranslation(fallback, params);
  }
  // If key not found at all, return the key itself
  return key;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children, forcedLanguage }: { children: ReactNode; forcedLanguage?: AppLanguage }) {
  const { settings, update } = useAppSettings();
  const language = forcedLanguage ?? settings.language;
  const resolvedLanguage = resolveLanguage(language);
  const [loadedLocale, setLoadedLocale] = useState<Locale | undefined>(
    () => (dictionaries[resolvedLanguage] === undefined ? undefined : resolvedLanguage),
  );

  useEffect(() => {
    if (dictionaries[resolvedLanguage] !== undefined) {
      setLoadedLocale(resolvedLanguage);
      return;
    }
    let cancelled = false;
    void ensureLocale(resolvedLanguage).then(() => {
      if (!cancelled) setLoadedLocale(resolvedLanguage);
    });
    return () => {
      cancelled = true;
    };
  }, [resolvedLanguage]);

  const ready = loadedLocale === resolvedLanguage;

  const value = useMemo<I18nContextValue>(() => {
    return {
      language,
      resolvedLanguage,
      t: (key: string, params?: TranslationParams) => translate(resolvedLanguage, key, params),
      setLanguage: (next: AppLanguage) => update({ language: next }),
    };
  }, [language, resolvedLanguage, update, ready]);

  // Hold the tree for the single chunk fetch of a non-bundled locale, so the
  // first painted string is already in the user's language.
  if (!ready) return null;
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (context !== null) {
    return context;
  }
  // Fallback when used outside provider
  const resolvedLanguage = detectSystemLanguage();
  return {
    language: "system",
    resolvedLanguage,
    t: (key: string, params?: TranslationParams) => translate(resolvedLanguage, key, params),
    setLanguage: () => undefined,
  };
}
