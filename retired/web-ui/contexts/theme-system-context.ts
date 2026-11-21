"use client";

import { createContext } from "react";
import type { DensityPreference, RadiusPreference } from "@/lib/theme/appearance";
import type { Theme, ThemeVariant } from "@/lib/theme/types";

export type ThemeMode = "system" | ThemeVariant;

export interface ThemeSystemContextValue {
	availableThemes: Theme[];
	currentTheme: Theme;
	themeMode: ThemeMode;
	lightThemeId: string;
	darkThemeId: string;
	density: DensityPreference;
	radius: RadiusPreference;
	/** UI font stack override; "" = follow the active theme. */
	uiFont: string;
	/** Monospace font stack override; "" = follow the active theme. */
	monoFont: string;
	setThemeMode(mode: ThemeMode): void;
	setTheme(themeId: string): void;
	setLightThemePreference(themeId: string): void;
	setDarkThemePreference(themeId: string): void;
	setDensity(density: DensityPreference): void;
	setRadius(radius: RadiusPreference): void;
	setUiFont(font: string): void;
	setMonoFont(font: string): void;
}

export const ThemeSystemContext = createContext<ThemeSystemContextValue | null>(null);
