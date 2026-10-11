export type { StatsLocale } from "../../locale";

import type { StatsLocale } from "../../locale";

/** Values a message may interpolate through `{name}` placeholders. */
export type TranslationParams = Record<string, string | number>;

/** A locale pack: the messages one locale overrides, keyed by slug. */
export interface LocalePack {
	readonly id: StatsLocale;
	readonly messages: Readonly<Record<string, string>>;
}

/**
 * Messages for every locale, keyed first by locale id. `undefined` is part of
 * the value type because a locale may override only some keys (English is the
 * fallback for the rest).
 */
export type MessagesByLocale = Readonly<Record<StatsLocale, Readonly<Record<string, string | undefined>>>>;
