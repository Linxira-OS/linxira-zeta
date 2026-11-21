/**
 * Web-layer appearance preferences (density, corner radius, font overrides).
 *
 * These live outside the gateway settings store: ThemeSystemProvider persists
 * them to localStorage and republishes them as CSS custom properties on the
 * document root, so they apply immediately without any gateway round-trip.
 *
 * - density  → `--padding-scale` multiplies the Tailwind spacing scale
 * - radius   → `--radius-unit` is the base corner radius in px
 * - uiFont   → `--font-display` (empty string = follow the active theme)
 * - monoFont → `--font-mono`    (empty string = follow the active theme)
 */
export type DensityPreference = "compact" | "standard" | "relaxed";
export type RadiusPreference = "none" | "small" | "medium" | "large";

export const DENSITY_STORAGE_KEY = "zeta-density";
export const RADIUS_STORAGE_KEY = "zeta-radius";
export const UI_FONT_STORAGE_KEY = "zeta-ui-font";
export const MONO_FONT_STORAGE_KEY = "zeta-mono-font";

export const DEFAULT_DENSITY: DensityPreference = "standard";
export const DEFAULT_RADIUS: RadiusPreference = "medium";

/** Multipliers applied to the Tailwind spacing scale via `--padding-scale`. */
export const DENSITY_SCALE: Record<DensityPreference, number> = {
	compact: 0.9,
	standard: 1,
	relaxed: 1.15,
};

/** Base corner radius in px, published as `--radius-unit`. */
export const RADIUS_UNIT_PX: Record<RadiusPreference, number> = {
	none: 0,
	small: 4,
	medium: 8,
	large: 12,
};

export function isDensity(value: string | null): value is DensityPreference {
	return value === "compact" || value === "standard" || value === "relaxed";
}

export function isRadius(value: string | null): value is RadiusPreference {
	return value === "none" || value === "small" || value === "medium" || value === "large";
}

/**
 * Serif UI preset. Roadmap font hard rule: system stacks with CJK fallbacks,
 * never remote fonts.
 */
export const SERIF_UI_FONT_STACK = 'Georgia, "Times New Roman", "Songti SC", SimSun, "Noto Serif CJK SC", serif';
