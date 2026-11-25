/**
 * The language choices of the setup flow.
 *
 * The 19.2 setup wizard lives in the host (`coding-agent/src/ui/setup`), so a
 * TUI scene controller cannot mount itself: this module keeps the choice data
 * and its host-injectable strings, and the host renders them in its own
 * language scene.
 */
import { tuiText } from "../../i18n";

/** The catalogues the coding agent ships; values match `cfgLanguage`. */
export type SetupLanguage = "en" | "zh";

/** One choice of the language step. */
export interface SetupLanguageItem {
	readonly value: SetupLanguage;
	readonly label: string;
	readonly description: string;
}

/** The language choices, in display order. */
export const SETUP_LANGUAGE_ITEMS: readonly SetupLanguageItem[] = [
	{ value: "en", label: "English", description: "English interface" },
	{ value: "zh", label: "简体中文", description: "Chinese interface" },
];

/** Title of the language step. */
export function setupLanguageTitle(): string {
	return tuiText("setupLanguageTitle", "Choose language");
}

/** Subtitle of the language step. */
export function setupLanguageSubtitle(): string {
	return tuiText("setupLanguageSubtitle", "Choose the language for the CLI and settings.");
}

/** Hint under the choices: the choice applies to the rest of onboarding immediately. */
export function setupLanguageHint(): string {
	return tuiText("setupLanguageHint", "The choice applies to the rest of onboarding immediately.");
}

/** Index of `language` in {@link SETUP_LANGUAGE_ITEMS}; the first entry when unknown. */
export function setupLanguageIndex(language: string | undefined): number {
	const index = SETUP_LANGUAGE_ITEMS.findIndex(item => item.value === language);
	return index >= 0 ? index : 0;
}
