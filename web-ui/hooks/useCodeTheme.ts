"use client";

import { useEffect, useMemo, useState } from "react";
import {
	createHighlighter,
	type BundledLanguage,
	type Highlighter,
	type ThemeRegistrationRaw,
	type ThemedToken,
} from "shiki";
import {
	createMarkdownShikiTheme,
	plainCodeLines,
	resolveShikiLang,
	SHIKI_PRELOAD_LANGS,
	shikiFontStyleToCss,
	type CodeToken,
} from "@/lib/shiki-theme";

export type ShikiHighlighter = Highlighter;

/**
 * Theme registration shared by every consumer. Because all of its colors are
 * `var(--md-syntax-*)` CSS variables, app theme switches never require Shiki
 * work — the browser restyles the existing DOM at paint time.
 */
const sharedTheme = createMarkdownShikiTheme();
const sharedThemeName = sharedTheme.name ?? "zeta-markdown-active";

let sharedHighlighterPromise: Promise<ShikiHighlighter> | null = null;

/**
 * Single highlighter for the whole app, created once with no grammars.
 * Languages load on demand (plus an idle-time preload of common ones); the
 * highlighter is never rebuilt when the app theme changes.
 */
function getSharedHighlighter(): Promise<ShikiHighlighter> {
	sharedHighlighterPromise ??= createHighlighter({
		themes: [sharedTheme],
		langs: [],
	})
		.then(highlighter => {
			scheduleIdleLanguagePreload(highlighter);
			return highlighter;
		})
		.catch(error => {
			// Drop the failed singleton so a later mount can retry.
			sharedHighlighterPromise = null;
			throw error;
		});
	return sharedHighlighterPromise;
}

/** Load the common language set opportunistically while the page is idle. */
function scheduleIdleLanguagePreload(highlighter: ShikiHighlighter): void {
	const queue: BundledLanguage[] = SHIKI_PRELOAD_LANGS.filter(
		lang => !highlighter.getLoadedLanguages().includes(lang),
	);
	if (queue.length === 0) return;

	const loadNext = (): void => {
		const lang = queue.shift();
		if (!lang) return;
		void ensureHighlighterLanguage(highlighter, lang).then(() => {
			if (queue.length > 0) requestIdleCallback(loadNext, { timeout: 2000 });
		});
	};
	requestIdleCallback(loadNext, { timeout: 1500 });
}

const languageLoadPromises = new Map<string, Promise<boolean>>();

/** Load one grammar, deduplicating concurrent requests for the same id. */
function ensureHighlighterLanguage(highlighter: ShikiHighlighter, lang: BundledLanguage): Promise<boolean> {
	const cached = languageLoadPromises.get(lang);
	if (cached) return cached;
	const promise = highlighter
		.loadLanguage(lang)
		.then(() => true)
		.catch(() => false);
	languageLoadPromises.set(lang, promise);
	return promise;
}

export interface CodeTheme {
	/** Shiki theme registration whose colors are `var(--md-syntax-*)` refs. */
	theme: ThemeRegistrationRaw;
	themeName: string;
	/** Shared highlighter; null until the async singleton has resolved. */
	highlighter: ShikiHighlighter | null;
	codeBg: string;
	codeFg: string;
}

export function useCodeTheme(): CodeTheme {
	const [highlighter, setHighlighter] = useState<ShikiHighlighter | null>(null);

	useEffect(() => {
		let active = true;
		getSharedHighlighter().then(
			instance => {
				if (active) setHighlighter(instance);
			},
			() => {},
		);
		return () => {
			active = false;
		};
	}, []);

	return {
		theme: sharedTheme,
		themeName: sharedThemeName,
		highlighter,
		codeBg: "var(--syntax-background)",
		codeFg: "var(--md-syntax-foreground)",
	};
}

export interface ShikiHighlightResult {
	/** Per-line token rows; plain text rows until highlighting is ready. */
	lines: CodeToken[][];
	/** False while the grammar is still loading, missing, or unsupported. */
	highlighted: boolean;
}

function toCodeTokens(tokens: ThemedToken[]): CodeToken[] {
	return tokens.map(token => ({
		text: token.content,
		style: {
			color: typeof token.color === "string" ? token.color : undefined,
			...shikiFontStyleToCss(token.fontStyle),
		},
	}));
}

/**
 * Tokenize `code` for `language` with the shared highlighter. Grammars load
 * on first use; while loading, callers receive plain (unstyled) lines so the
 * layout matches the eventual highlighted render.
 */
export function useShikiHighlight(code: string, language: string): ShikiHighlightResult {
	const { highlighter, themeName } = useCodeTheme();
	const lang = useMemo(() => resolveShikiLang(language), [language]);
	const [grammarTick, setGrammarTick] = useState(0);

	useEffect(() => {
		if (!highlighter || !lang) return;
		if (highlighter.getLoadedLanguages().includes(lang)) return;
		let active = true;
		ensureHighlighterLanguage(highlighter, lang).then(loaded => {
			if (active && loaded) setGrammarTick(tick => tick + 1);
		});
		return () => {
			active = false;
		};
	}, [highlighter, lang]);

	return useMemo(() => {
		// Re-tokenize when a newly loaded grammar arrives.
		void grammarTick;
		const plain: ShikiHighlightResult = {
			lines: plainCodeLines(code),
			highlighted: false,
		};
		if (!highlighter || !lang) return plain;
		if (!highlighter.getLoadedLanguages().includes(lang)) return plain;
		try {
			const { tokens } = highlighter.codeToTokens(code, {
				lang,
				theme: themeName,
			});
			return { lines: tokens.map(toCodeTokens), highlighted: true };
		} catch {
			return plain;
		}
		// grammarTick marks that the language grammar just finished loading.
	}, [highlighter, code, lang, grammarTick, themeName]);
}
