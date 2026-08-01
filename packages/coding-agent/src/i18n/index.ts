import { settings } from "../config/settings";
import { en } from "./en";
import type { Messages } from "./messages";
import { zh } from "./zh";

export type { Messages };

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
 * `LC_MESSAGES` > `LANG` > `"en"`. The config override is resolved lazily
 * from the global settings singleton when no explicit override is passed.
 */
export function detectLanguage(override?: string | null): ZetaLanguage {
	for (const candidate of [override ?? resolveConfigOverride(), ...envCandidates()]) {
		const tag = normalize(candidate);
		if (tag) return setLanguage(tag);
	}
	return setLanguage("en");
}

function ensureDetected(): void {
	if (detected) return;
	detected = true;
	detectLanguage();
}

function resolveConfigOverride(): string | undefined {
	try {
		const value = settings.get("language");
		return typeof value === "string" ? value : undefined;
	} catch {
		// Settings not initialized yet — environment detection only.
		return undefined;
	}
}

function envCandidates(): Array<string | undefined> {
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
