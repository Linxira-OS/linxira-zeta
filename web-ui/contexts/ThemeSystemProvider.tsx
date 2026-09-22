"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { CSSVariableGenerator } from "@/lib/theme/cssGenerator";
import {
	DENSITY_SCALE,
	DENSITY_STORAGE_KEY,
	DEFAULT_DENSITY,
	DEFAULT_RADIUS,
	isDensity,
	isRadius,
	MONO_FONT_STORAGE_KEY,
	RADIUS_STORAGE_KEY,
	RADIUS_UNIT_PX,
	UI_FONT_STORAGE_KEY,
} from "@/lib/theme/appearance";
import type { DensityPreference, RadiusPreference } from "@/lib/theme/appearance";
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
	density: DensityPreference;
	radius: RadiusPreference;
	uiFont: string;
	monoFont: string;
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
		return {
			themeMode: "dark",
			lightThemeId: DEFAULT_LIGHT_THEME_ID,
			darkThemeId: DEFAULT_DARK_THEME_ID,
			density: DEFAULT_DENSITY,
			radius: DEFAULT_RADIUS,
			uiFont: "",
			monoFont: "",
		};
	}

	const legacy = localStorage.getItem("zeta-theme");
	const mode = localStorage.getItem(THEME_MODE_STORAGE_KEY);
	return {
		themeMode: isThemeMode(mode) ? mode : legacy === "light" ? "light" : "dark",
		lightThemeId: localStorage.getItem(LIGHT_THEME_STORAGE_KEY) ?? DEFAULT_LIGHT_THEME_ID,
		darkThemeId:
			localStorage.getItem(DARK_THEME_STORAGE_KEY) ??
			(legacy === "starfield" ? "zeta-starfield" : DEFAULT_DARK_THEME_ID),
		density: readStoredValue(DENSITY_STORAGE_KEY, isDensity, DEFAULT_DENSITY),
		radius: readStoredValue(RADIUS_STORAGE_KEY, isRadius, DEFAULT_RADIUS),
		uiFont: readStoredValue(UI_FONT_STORAGE_KEY, isFontStack, ""),
		monoFont: readStoredValue(MONO_FONT_STORAGE_KEY, isFontStack, ""),
	};
}

/** Guard for stored font-stack overrides: a non-empty single-line string. */
function isFontStack(value: string | null): value is string {
	return value !== null && value.trim() !== "" && !value.includes("\n");
}

/** Read a localStorage preference, validated by `guard`, with a fallback. */
function readStoredValue<T extends string>(key: string, guard: (value: string | null) => value is T, fallback: T): T {
	try {
		const raw = window.localStorage.getItem(key);
		return guard(raw) ? raw : fallback;
	} catch {
		return fallback;
	}
}

/** Publish a font-stack override on the root element, or clear it when empty. */
function applyFontOverride(root: HTMLElement, property: string, value: string): void {
	const trimmed = value.trim();
	if (trimmed === "") root.style.removeProperty(property);
	else root.style.setProperty(property, trimmed);
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
		const variant: ThemeVariant =
			preferences.themeMode === "system" ? (systemPrefersDark ? "dark" : "light") : preferences.themeMode;
		return resolveTheme(variant === "dark" ? preferences.darkThemeId : preferences.lightThemeId, variant);
	}, [preferences, systemPrefersDark]);

	useLayoutEffect(() => {
		const restoreTransitions = suppressTransitions();
		generator.apply(currentTheme);
		document.body.style.backgroundColor = currentTheme.colors.surface.background;
		document
			.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
			?.setAttribute("content", currentTheme.colors.surface.background);
		return restoreTransitions;
	}, [currentTheme, generator]);

	// Republish web appearance preferences as root CSS custom properties so they
	// apply immediately; empty font values clear the override so the active
	// theme's stacks win again.
	useLayoutEffect(() => {
		const root = document.documentElement;
		root.style.setProperty("--padding-scale", String(DENSITY_SCALE[preferences.density]));
		root.style.setProperty("--radius-unit", `${RADIUS_UNIT_PX[preferences.radius]}px`);
		applyFontOverride(root, "--font-display", preferences.uiFont);
		applyFontOverride(root, "--font-mono", preferences.monoFont);
	}, [preferences]);

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
		localStorage.setItem(DENSITY_STORAGE_KEY, preferences.density);
		localStorage.setItem(RADIUS_STORAGE_KEY, preferences.radius);
		localStorage.setItem(UI_FONT_STORAGE_KEY, preferences.uiFont);
		localStorage.setItem(MONO_FONT_STORAGE_KEY, preferences.monoFont);
	}, [preferences]);

	useEffect(() => {
		const handleStorage = (event: StorageEvent) => {
			if (event.storageArea !== localStorage) return;
			if (
				![
					THEME_MODE_STORAGE_KEY,
					LIGHT_THEME_STORAGE_KEY,
					DARK_THEME_STORAGE_KEY,
					DENSITY_STORAGE_KEY,
					RADIUS_STORAGE_KEY,
					UI_FONT_STORAGE_KEY,
					MONO_FONT_STORAGE_KEY,
				].includes(event.key ?? "")
			)
				return;
			setPreferences(readPreferences());
		};
		window.addEventListener("storage", handleStorage);
		return () => window.removeEventListener("storage", handleStorage);
	}, []);

	const setThemeMode = useCallback((themeMode: ThemeMode) => {
		setPreferences(previous => (previous.themeMode === themeMode ? previous : { ...previous, themeMode }));
	}, []);

	const setTheme = useCallback((themeId: string) => {
		const theme = getThemeById(themeId);
		if (!theme) return;
		setPreferences(previous =>
			theme.metadata.variant === "dark"
				? { ...previous, themeMode: "dark", darkThemeId: theme.metadata.id }
				: { ...previous, themeMode: "light", lightThemeId: theme.metadata.id },
		);
	}, []);

	const setLightThemePreference = useCallback((lightThemeId: string) => {
		if (getThemeById(lightThemeId)?.metadata.variant !== "light") return;
		setPreferences(previous => ({ ...previous, lightThemeId }));
	}, []);

	const setDarkThemePreference = useCallback((darkThemeId: string) => {
		if (getThemeById(darkThemeId)?.metadata.variant !== "dark") return;
		setPreferences(previous => ({ ...previous, darkThemeId }));
	}, []);

	const setDensity = useCallback((density: DensityPreference) => {
		setPreferences(previous => (previous.density === density ? previous : { ...previous, density }));
	}, []);

	const setRadius = useCallback((radius: RadiusPreference) => {
		setPreferences(previous => (previous.radius === radius ? previous : { ...previous, radius }));
	}, []);

	const setUiFont = useCallback((uiFont: string) => {
		setPreferences(previous => (previous.uiFont === uiFont ? previous : { ...previous, uiFont: uiFont.trim() }));
	}, []);

	const setMonoFont = useCallback((monoFont: string) => {
		setPreferences(previous =>
			previous.monoFont === monoFont ? previous : { ...previous, monoFont: monoFont.trim() },
		);
	}, []);

	const value = useMemo(
		() => ({
			availableThemes: themes,
			currentTheme,
			themeMode: preferences.themeMode,
			lightThemeId: preferences.lightThemeId,
			darkThemeId: preferences.darkThemeId,
			density: preferences.density,
			radius: preferences.radius,
			uiFont: preferences.uiFont,
			monoFont: preferences.monoFont,
			setThemeMode,
			setTheme,
			setLightThemePreference,
			setDarkThemePreference,
			setDensity,
			setRadius,
			setUiFont,
			setMonoFont,
		}),
		[
			currentTheme,
			preferences,
			setDarkThemePreference,
			setDensity,
			setMonoFont,
			setRadius,
			setTheme,
			setThemeMode,
			setUiFont,
		],
	);

	return <ThemeSystemContext.Provider value={value}>{children}</ThemeSystemContext.Provider>;
}
