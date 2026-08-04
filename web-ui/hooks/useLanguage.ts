"use client";

import { useCallback, useSyncExternalStore } from "react";

export type Language = "en" | "zh";

const STORAGE_KEY = "zeta-lang";
const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): Language {
  if (typeof document === "undefined") return "en";
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "zh" || stored === "en") return stored;
    return navigator.language?.startsWith("zh") ? "zh" : "en";
  } catch {
    return "en";
  }
}

function getServerSnapshot(): Language {
  return "en";
}

function applyLanguage(lang: Language) {
  if (typeof document === "undefined") return;
  const cl = document.documentElement.classList;
  cl.remove("lang-en", "lang-zh", "lang-cn");
  if (lang === "zh") {
    cl.add("lang-zh", "lang-cn");
    document.documentElement.lang = "zh-CN";
  } else {
    cl.add("lang-en");
    document.documentElement.lang = "en";
  }
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // ignore storage errors
  }
  listeners.forEach((cb) => cb());
}

export function useLanguage() {
  const lang = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setLanguage = useCallback((next: Language) => {
    applyLanguage(next);
  }, []);

  const toggleLanguage = useCallback(() => {
    const current = getSnapshot();
    const next: Language = current === "en" ? "zh" : "en";
    applyLanguage(next);
  }, []);

  const t = useCallback(
    (enText: string, zhText: string) => (lang === "zh" ? zhText : enText),
    [lang]
  );

  return {
    lang,
    setLanguage,
    toggleLanguage,
    t,
    isZh: lang === "zh",
  };
}
