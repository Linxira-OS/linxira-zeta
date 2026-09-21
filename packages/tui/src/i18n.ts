/**
 * Host-injectable UI text source for @linxiraos/pi-tui.
 *
 * pi-tui must not depend on the coding-agent i18n bundle (dependency
 * direction: coding-agent -> pi-tui). Instead, every user-visible string in
 * a tui component goes through `tuiText(key, englishFallback)`: the inline
 * English is the permanent fallback, and the host (coding-agent) registers
 * a text source that resolves keys against its localised catalogue. The
 * source is consulted on every call, so a runtime language switch takes
 * effect immediately without rebuilding components.
 *
 * Key naming: reuse the coding-agent Messages key verbatim when one exists
 * (e.g. `ssFooterSuffix`); otherwise add a new flat camelCase key namespaced
 * by the panel (e.g. `mcpAddStepTransport`) to Messages/en/zh.
 */

export type TuiTextSource = (key: string) => string | undefined;

let textSource: TuiTextSource | undefined;

/**
 * Register the host text source. Pass `undefined` to reset to English
 * fallbacks (the default; also the headless behavior — no rendering surface
 * exists without the interactive CLI host).
 */
export function setTuiTextSource(source: TuiTextSource | undefined): void {
	textSource = source;
}

/**
 * Resolve a UI string: host catalogue first, inline English fallback second.
 * Called per render, so language switches apply live.
 */
export function tuiText(key: string, fallback: string): string {
	return textSource?.(key) ?? fallback;
}

/**
 * Resolve a formatted UI string (`*Fmt` keys). `%s` / `%d` placeholders in
 * the resolved text are substituted positionally with `args`.
 */
export function tuiTextFmt(key: string, fallback: string, ...args: (string | number)[]): string {
	const template = textSource?.(key) ?? fallback;
	let index = 0;
	return template.replace(/%[sd]/g, () => String(args[index++] ?? ""));
}
