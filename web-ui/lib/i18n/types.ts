/** Built-in UI languages. */
export type Locale = "en" | "zh-CN";

/** Simple interpolation params for translation strings. */
export type TranslationParams = Record<string, string | number>;

/** A registrable locale pack. */
export interface LocalePlugin {
	/** Unique locale id. */
	id: string;
	/** Display name shown in the language menu. */
	label: string;
	/** Translation messages keyed by stable key. */
	messages: Record<string, string>;
}