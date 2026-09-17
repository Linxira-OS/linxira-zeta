"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { CSSVariableGenerator } from "@/lib/theme/cssGenerator";
import {
  DARK_THEME_STORAGE_KEY,
  DEFAULT_DARK_THEME_ID,
  DEFAULT_LIGHT_THEME_ID,
  getDefaultTheme,
  getThemeById,
  LIGHT_THEME_STORAGE_KEY,
  THEME_MODE_STORAGE_KEY,
  themes,
} from "@/lib/theme/themes";
import type { Theme, ThemeVariant } from "@/lib/theme/types";
import { ThemeSystemContext, type ThemeMode } from "./theme-system-context";

interface ThemePreferences {
  themeMode: ThemeMode;
  lightThemeId: string;
  darkThemeId: string;
}

function isThemeMode(value: string | null): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark";
}

function resolveTheme(themeId: string, variant: ThemeVariant): Theme {
  const theme = getThemeById(themeId);
  return theme?.metadata.variant === variant ? theme : getDefaultTheme(variant);
}

function readPreferences(): ThemePreferences {
  if (typeof window === "undefined") {
    return { themeMode: "dark", lightThemeId: DEFAULT_LIGHT_THEME_ID, darkThemeId: DEFAULT_DARK_THEME_ID };
  }

  const legacy = localStorage.getItem("zeta-theme");
  const mode = localStorage.getItem(THEME_MODE_STORAGE_KEY);
  return {
    themeMode: isThemeMode(mode) ? mode : legacy === "light" ? "light" : "dark",
    lightThemeId: localStorage.getItem(LIGHT_THEME_STORAGE_KEY) ?? DEFAULT_LIGHT_THEME_ID,
    darkThemeId: localStorage.getItem(DARK_THEME_STORAGE_KEY) ?? (legacy === "starfield" ? "zeta-starfield" : DEFAULT_DARK_THEME_ID),
  };
}

function suppressTransitions(): () => void {
  const root = document.documentElement;
  root.classList.add("zeta-theme-switching");
  const frame = window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => root.classList.remove("zeta-theme-switching"));
  });
  return () => {
    window.cancelAnimationFrame(frame);
    root.classList.remove("zeta-theme-switching");
  };
}

export function ThemeSystemProvider({ children }: { children: ReactNode }) {
  const generator = useMemo(() => new CSSVariableGenerator(), []);
  const [preferences, setPreferences] = useState<ThemePreferences>(readPreferences);
  const [systemPrefersDark, setSystemPrefersDark] = useState(() =>
    typeof window === "undefined" ? true : window.matchMedia("(prefers-color-scheme: dark)").matches,
  );

  const currentTheme = useMemo(() => {
    const variant: ThemeVariant = preferences.themeMode === "system"
      ? systemPrefersDark ? "dark" : "light"
      : preferences.themeMode;
    return resolveTheme(variant === "dark" ? preferences.darkThemeId : preferences.lightThemeId, variant);
  }, [preferences, systemPrefersDark]);

  useLayoutEffect(() => {
    const restoreTransitions = suppressTransitions();
    generator.apply(currentTheme);
    document.body.style.backgroundColor = currentTheme.colors.surface.background;
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", currentTheme.colors.surface.background);
    return restoreTransitions;
  }, [currentTheme, generator]);

  useEffect(() => {
    if (preferences.themeMode !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemPrefersDark(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [preferences.themeMode]);

  useEffect(() => {
    localStorage.setItem(THEME_MODE_STORAGE_KEY, preferences.themeMode);
    localStorage.setItem(LIGHT_THEME_STORAGE_KEY, preferences.lightThemeId);
    localStorage.setItem(DARK_THEME_STORAGE_KEY, preferences.darkThemeId);
  }, [preferences]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.storageArea !== localStorage) return;
      if (![THEME_MODE_STORAGE_KEY, LIGHT_THEME_STORAGE_KEY, DARK_THEME_STORAGE_KEY].includes(event.key ?? "")) return;
      setPreferences(readPreferences());
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const setThemeMode = useCallback((themeMode: ThemeMode) => {
    setPreferences((previous) => previous.themeMode === themeMode ? previous : { ...previous, themeMode });
  }, []);

  const setTheme = useCallback((themeId: string) => {
    const theme = getThemeById(themeId);
    if (!theme) return;
    setPreferences((previous) => theme.metadata.variant === "dark"
      ? { ...previous, themeMode: "dark", darkThemeId: theme.metadata.id }
      : { ...previous, themeMode: "light", lightThemeId: theme.metadata.id });
  }, []);

  const setLightThemePreference = useCallback((lightThemeId: string) => {
    if (getThemeById(lightThemeId)?.metadata.variant !== "light") return;
    setPreferences((previous) => ({ ...previous, lightThemeId }));
  }, []);

  const setDarkThemePreference = useCallback((darkThemeId: string) => {
    if (getThemeById(darkThemeId)?.metadata.variant !== "dark") return;
    setPreferences((previous) => ({ ...previous, darkThemeId }));
  }, []);

  const value = useMemo(() => ({
    availableThemes: themes,
    currentTheme,
    themeMode: preferences.themeMode,
    lightThemeId: preferences.lightThemeId,
    darkThemeId: preferences.darkThemeId,
    setThemeMode,
    setTheme,
    setLightThemePreference,
    setDarkThemePreference,
  }), [currentTheme, preferences, setDarkThemePreference, setLightThemePreference, setTheme, setThemeMode]);

  return <ThemeSystemContext.Provider value={value}>{children}</ThemeSystemContext.Provider>;
}
