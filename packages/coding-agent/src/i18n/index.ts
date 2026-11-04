import { en } from "./en";
import type { Messages } from "./messages";
import { zh } from "./zh";

export type { Messages };

/**
 * Late-bound config-override resolver. The startup-prepaint module graph must
 * stay isolated from `config/settings` (and its transitive catalog /
 * internal-urls weight), so instead of a static import the settings layer
 * *registers* the resolver via `registerLanguageConfigOverride` during boot.
 * Before registration (or before settings init) the override is simply
 * absent — detection falls back to the environment, which is the documented
 * behavior for an uninitialized settings singleton.
 */
let configLanguageOverride: (() => string | undefined) | undefined;

/**
 * Register the config-layer language override resolver. Called by the settings
 * bootstrap; replaces any previously registered resolver.
 */
export function registerLanguageConfigOverride(resolve: (() => string | undefined) | undefined): void {
	configLanguageOverride = resolve;
}

/** Languages this distribution ships catalogues for. */
export type ZetaLanguage = "en" | "zh";

/** All supported language tags, in display order. */
export const LANGUAGE_TAGS: readonly ZetaLanguage[] = ["en", "zh"];

const CATALOGUES: Record<ZetaLanguage, Messages> = { en, zh };

let active: Messages | null = null;
let current: ZetaLanguage = "en";
let detected = false;

/**
 * The active message catalogue. Reads lazily trigger `detectLanguage()` once
 * (config override → environment → English), so any render path that touches
 * `M` before settings are initialized still gets stable, English text, and
 * `/language` switches take effect immediately afterwards via `setLanguage`.
 */
export const M: Messages = new Proxy(en, {
	get: (_target, prop) => {
		ensureDetected();
		const value = active?.[prop as keyof Messages];
		return value;
	},
});

/** The resolved language tag installed by the latest detection/set call. */
export function currentLanguage(): ZetaLanguage {
	ensureDetected();
	return current;
}

/**
 * Install a catalogue by tag. Returns the tag so callers can echo it back.
 * Used by `/language` and by `detectLanguage` once a candidate resolves.
 * Marks detection as done so the lazy `M`/`currentLanguage()` probe never
 * overwrites an explicit choice with environment detection.
 */
export function setLanguage(tag: ZetaLanguage): ZetaLanguage {
	detected = true;
	active = CATALOGUES[tag];
	current = tag;
	return tag;
}

/**
 * Resolve and install the language catalogue.
 *
 * Priority: `override` (e.g. config `language`) > `ZETA_LANG` > `LC_ALL` >
 * `LC_MESSAGES` > `LANG` > `"en"`. Once settings are initialized, the
 * `language` setting (including its schema default `en`) is authoritative;
 * environment detection only covers the startup window before settings load.
 * Do not fall back to `Intl`/the OS locale: on a Chinese Windows install the
 * setting is still the schema default `en`, and the OS locale used to make the
 * UI Chinese while Settings showed `en`. A fresh install is English until the
 * user chooses Chinese in onboarding or Settings.
 */
export function detectLanguage(override?: string | null): ZetaLanguage {
	for (const candidate of [override ?? resolveConfigOverride(), ...envCandidates()]) {
		const tag = normalize(candidate);
		if (tag) return setLanguage(tag);
		// An explicit-but-unrecognized locale (e.g. `fr_FR`) is a real
		// configuration and falls through to English — it must not leak into
		// a later locale fallback. POSIX sentinels (`C`, `C.UTF-8`, `POSIX`)
		// are not real choices: Git Bash/MSYS set LANG=C.UTF-8 on Windows, so
		// they are skipped and the explicit variables after them still speak.
		if (candidate && !isPosixSentinel(candidate)) return setLanguage("en");
	}
	return setLanguage("en");
}

function isPosixSentinel(candidate: string): boolean {
	const s = candidate.trim().toLowerCase().replaceAll("_", "-");
	return s === "c" || s === "c.utf-8" || s === "posix";
}

function ensureDetected(): void {
	if (detected) return;
	detected = true;
	detectLanguage();
}

function resolveConfigOverride(): string | undefined {
	try {
		return configLanguageOverride?.();
	} catch {
		// Settings layer not registered / not initialized — env detection only.
		return undefined;
	}
}

function envCandidates(): Array<string | undefined> {
	// Deliberately no `Intl` system-locale fallback: it made a Chinese Windows
	// install render in Chinese while the persisted setting was still `en`.
	return [Bun.env.ZETA_LANG, Bun.env.LC_ALL, Bun.env.LC_MESSAGES, Bun.env.LANG];
}

/** Map a locale string (e.g. `zh_CN.UTF-8`, `zh-Hans-CN`) to a known tag. */
function normalize(candidate: string | undefined): ZetaLanguage | "" {
	if (!candidate) return "";
	const s = candidate.trim().toLowerCase().replaceAll("_", "-");
	if (s === "") return "";
	if (s.startsWith("zh") || s.includes("chinese") || s.includes("中文")) return "zh";
	if (s.startsWith("en") || s.includes("english")) return "en";
	return "";
}
