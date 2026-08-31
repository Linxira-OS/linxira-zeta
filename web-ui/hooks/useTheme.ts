"use client";

import { useCallback, useContext } from "react";
import { ThemeSystemContext } from "@/contexts/theme-system-context";
import { getDefaultTheme } from "@/lib/theme/themes";

export type Theme = string;

type ToggleOrigin = { x: number; y: number };

export function useTheme() {
  const context = useContext(ThemeSystemContext);
  const currentTheme = context?.currentTheme ?? getDefaultTheme("dark");
  const setTheme = context?.setTheme ?? (() => {});
  const setThemeMode = context?.setThemeMode ?? (() => {});
  const theme = currentTheme.metadata.id;

  const setThemeWithTransition = useCallback((next: Theme, origin?: ToggleOrigin) => {
    void origin;
    setTheme(next);
  }, [setTheme]);

  const cycleTheme = useCallback((origin?: ToggleOrigin) => {
    void origin;
    const nextThemeId = theme === "zeta-dark"
      ? "zeta-light"
      : theme === "zeta-light"
        ? "zeta-starfield"
        : "zeta-dark";
    setTheme(nextThemeId);
  }, [setTheme, theme]);

  const toggleTheme = useCallback((origin?: ToggleOrigin) => {
    void origin;
    setTheme(currentTheme.metadata.variant === "dark" ? "zeta-light" : "zeta-dark");
  }, [currentTheme.metadata.variant, setTheme]);

  return {
    theme,
    cycleTheme,
    toggleTheme,
    setTheme: setThemeWithTransition,
    setThemeMode,
    isDark: currentTheme.metadata.variant === "dark",
    isStarfield: theme === "zeta-starfield",
  };
}
