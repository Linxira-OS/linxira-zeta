import type { Locale, TranslationParams } from "./types.ts";

type MessagesByLocale = Record<string, Record<string, string>>;

/** Substitute simple `{key}` placeholders in a translation message. */
export function interpolateMessage(message: string, params: TranslationParams = {}): string {
	return message.replace(/\{([\w.-]+)\}/g, (token, name: string) => {
		const value = params[name];
		return value === undefined ? token : String(value);
	});
}

/**
 * Resolve a message for the current locale, falling back to English.
 * @returns the translated string, or the key itself when neither locale has it
 */
export function translateMessage(
	locale: Locale,
	key: string,
	messages: MessagesByLocale,
	params: TranslationParams = {},
): string {
	const message = messages[locale]?.[key] ?? messages.en?.[key];
	if (message === undefined) {
		if (process.env.NODE_ENV !== "production") console.warn(`[i18n] Missing translation: ${key}`);
		return key;
	}
	return interpolateMessage(message, params);
}

/** Format a date as locale-aware relative time. */
export function formatRelativeTime(date: Date | string, locale: Locale, now = new Date()): string {
	const target = date instanceof Date ? date : new Date(date);
	const diffMs = target.getTime() - now.getTime();
	const absMs = Math.abs(diffMs);
	const [unit, divisor] = absMs < 60_000
		? (["second", 1_000] as const)
		: absMs < 3_600_000
			? (["minute", 60_000] as const)
			: absMs < 86_400_000
				? (["hour", 3_600_000] as const)
				: (["day", 86_400_000] as const);
	const value = Math.round(diffMs / divisor);
	return new Intl.RelativeTimeFormat(locale, { numeric: "always" }).format(value, unit);
}