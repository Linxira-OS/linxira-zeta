"use client";

import { createContext } from "react";
import type { Theme, ThemeVariant } from "@/lib/theme/types";

export type ThemeMode = "system" | ThemeVariant;

export interface ThemeSystemContextValue {
  availableThemes: Theme[];
  currentTheme: Theme;
  themeMode: ThemeMode;
  lightThemeId: string;
  darkThemeId: string;
  setThemeMode(mode: ThemeMode): void;
  setTheme(themeId: string): void;
  setLightThemePreference(themeId: string): void;
  setDarkThemePreference(themeId: string): void;
}

export const ThemeSystemContext = createContext<ThemeSystemContextValue | null>(null);
