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

/** Local override written by the in-page switcher; survives reloads. */
const LOCALE_STORAGE_KEY = "zeta.stats.locale";

const localeListeners = new Set<() => void>();

let activeLocale: StatsLocale = "en";

// Resolve once at module load. Every `t()` caller imports this module first, so
// the stored choice, the host language the server injected into `<head>`, or
// the browser's own preference is already in effect by the time a component
// module is evaluated.
resolveInitialLocale();

/** The locale the dashboard renders in. */
export function getLocale(): StatsLocale {
	return activeLocale;
}

/** Subscribe to runtime switches (the topbar toggle); returns the unsubscribe. */
export function subscribeLocale(listener: () => void): () => void {
	localeListeners.add(listener);
	return () => {
		localeListeners.delete(listener);
	};
}

/** Install a locale by tag (`zh`, `zh-CN`, `zh-Hans`; anything else is English). */
export function setLocale(tag: string | undefined | null): StatsLocale {
	activeLocale = resolveLocaleTag(tag);
	return activeLocale;
}

/**
 * The user's explicit pick from the topbar: install it, remember it, and
 * re-render every subscriber.
 */
export function setUserLocale(tag: string): StatsLocale {
	const next = setLocale(tag);
	try {
		globalThis.localStorage?.setItem(LOCALE_STORAGE_KEY, next);
	} catch {
		// Private-mode storage denial only costs the choice at next reload.
	}
	for (const listener of [...localeListeners]) listener();
	return next;
}

/** A stored topbar choice, when it still parses as a supported locale. */
function storedLocale(): StatsLocale | undefined {
	try {
		const raw = globalThis.localStorage?.getItem(LOCALE_STORAGE_KEY);
		if (!raw) return undefined;
		const resolved = resolveLocaleTag(raw);
		return resolved === "en" || resolved === "zh-CN" ? resolved : undefined;
	} catch {
		return undefined;
	}
}

/**
 * The locale to boot with: an explicit topbar choice, then the host's language
 * when `zetacode stats` injected it, then the browser's own preference, then
 * English.
 */
export function resolveInitialLocale(): StatsLocale {
	const stored = storedLocale();
	if (stored) return setLocale(stored);
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
