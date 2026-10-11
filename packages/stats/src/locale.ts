/**
 * Locale resolution shared by the stats server (which stamps the host's
 * language into the served HTML) and the client bundle (which renders it).
 * Lives outside `client/` so the server never imports browser code.
 */

/** Locales the dashboard ships: English and Simplified Chinese. */
export type StatsLocale = "en" | "zh-CN";

/**
 * Map a language tag to a shipped locale. Any `zh` variant is Simplified
 * Chinese (the dashboard ships no Traditional pack); everything else —
 * including browser tags such as `tr-TR` — is English, matching the
 * dashboard's single number/date convention rather than the browser's.
 */
export function resolveLocaleTag(tag: string | undefined | null): StatsLocale {
	const normalized = tag?.trim().toLowerCase() ?? "";
	if (normalized === "zh" || normalized.startsWith("zh-") || normalized.startsWith("zh_")) return "zh-CN";
	return "en";
}

/** Pick the first shipped locale from a `navigator.languages` list; English when none match. */
export function resolveBrowserLocale(languages: readonly string[] | undefined): StatsLocale {
	for (const language of languages ?? []) {
		const resolved = resolveLocaleTag(language);
		if (resolved !== "en") return resolved;
	}
	return "en";
}
