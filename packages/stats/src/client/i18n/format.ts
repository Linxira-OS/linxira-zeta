import type { MessagesByLocale, StatsLocale, TranslationParams } from "./types";

/** Substitute `{name}` placeholders; unknown names are left verbatim so a bug is visible, not silent. */
export function interpolateMessage(message: string, params: TranslationParams = {}): string {
	return message.replace(/\{([\w.-]+)\}/g, (token, name: string) => {
		const value = params[name];
		return value === undefined ? token : String(value);
	});
}

/**
 * Resolve a message for `locale`, falling back to English and finally to the
 * key itself. The key fallback is deliberate: a renamed key renders its slug
 * rather than blanking a card, so a missed rename is visible but not fatal.
 */
export function translateMessage(
	locale: StatsLocale,
	key: string,
	messages: MessagesByLocale,
	params: TranslationParams = {},
): string {
	const message = messages[locale]?.[key] ?? messages.en?.[key];
	if (message === undefined) {
		if (process.env.NODE_ENV !== "production") console.warn(`[stats.i18n] missing translation: ${key}`);
		return key;
	}
	return interpolateMessage(message, params);
}
