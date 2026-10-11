import { resolveBrowserLocale, resolveLocaleTag } from "../../locale";
import { translateMessage } from "./format";
import { enLocale, type MessageKey } from "./messages/en";
import { zhCNLocale } from "./messages/zh-CN";
import type { MessagesByLocale, StatsLocale, TranslationParams } from "./types";

/** The inline global the server stamps into `<head>` (see `server.ts`); read through `globalThis` so this module compiles without a DOM lib. */
function injectedLocale(): string | undefined {
	return (globalThis as { __ZETA_STATS_LOCALE__?: string }).__ZETA_STATS_LOCALE__;
}

const messages: MessagesByLocale = { en: enLocale.messages, "zh-CN": zhCNLocale.messages };

let activeLocale: StatsLocale = "en";

// Resolve once at module load. Every `t()` caller imports this module first, so
// the host language the server injected into `<head>` (or the browser's own
// preference) is already in effect by the time a component module is evaluated
// — including module-level label tables such as the range selector's.
resolveInitialLocale();

/** The locale the dashboard renders in. Fixed at boot; there is no in-page switcher. */
export function getLocale(): StatsLocale {
	return activeLocale;
}

/** Install a locale by tag (`zh`, `zh-CN`, `zh-Hans`; anything else is English). */
export function setLocale(tag: string | undefined | null): StatsLocale {
	activeLocale = resolveLocaleTag(tag);
	return activeLocale;
}

/**
 * The locale to boot with: the host's language when `zeta-c stats` injected it,
 * then the browser's own preference, then English.
 */
export function resolveInitialLocale(): StatsLocale {
	const injected = injectedLocale();
	if (injected) return setLocale(injected);
	if (typeof navigator === "undefined") return "en";
	return setLocale(resolveBrowserLocale(navigator.languages));
}

/**
 * Translate `key` in the active locale; `{name}` placeholders substitute from
 * `params`. The key type is the English catalogue, so an unknown key is a
 * compile error rather than a silently blank card.
 */
export function t(key: MessageKey, params?: TranslationParams): string {
	return translateMessage(activeLocale, key, messages, params);
}

export type { MessageKey, StatsLocale, TranslationParams };
