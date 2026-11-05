/**
 * Primary-modifier shortcut specs for the Studio chrome.
 *
 * Ported from OMP Studio (`apps/renderer/src/keyboard/shortcuts.ts`, MIT), with
 * the spec table retargeted onto the bindings Zeta actually installs — see
 * `hooks/useKeyboardShortcuts.ts`. A hint printed in a menu must be a binding
 * that works, so the table below is Zeta's, not Studio's.
 *
 * macOS uses ⌘ and leaves Ctrl to text editing (⌃K, ⌃A …) and the terminal;
 * elsewhere Ctrl (or Meta) is the primary modifier. Labels keep the Windows
 * spelling ("Ctrl ⇧ O", "Ctrl+Shift+O") and use the macOS symbols there ("⇧⌘O").
 */
import { PLATFORM, type RendererPlatform } from "../primitives/platform";

export interface ShortcutSpec {
	/** Key as printed: "K", "Enter", "1" … */
	readonly key: string;
	readonly shift?: boolean;
	readonly alt?: boolean;
	/** False for a chord without the primary modifier (Esc, a bare Enter). */
	readonly primary?: boolean;
	/** A different combination on macOS, e.g. redo is ⇧⌘Z there. */
	readonly mac?: Omit<ShortcutSpec, "mac">;
}

/** "kbd" is the menu style ("Ctrl ⇧ K"); "hint" is the inline style ("Ctrl+Shift+K"). */
export type ShortcutStyle = "kbd" | "hint";

export function isPrimaryModifier(
	event: Pick<KeyboardEvent, "ctrlKey" | "metaKey">,
	platform: RendererPlatform = PLATFORM,
): boolean {
	return platform === "darwin" ? event.metaKey && !event.ctrlKey : event.ctrlKey || event.metaKey;
}

const MAC_KEYS: Readonly<Record<string, string>> = { Enter: "↩", Backspace: "⌫", Escape: "⎋", Tab: "⇥" };

export function formatShortcut(spec: ShortcutSpec, style: ShortcutStyle = "kbd", platform: RendererPlatform = PLATFORM): string {
	if (platform === "darwin") {
		const mac = { ...spec, ...spec.mac };
		const key = MAC_KEYS[mac.key] ?? mac.key;
		if (mac.primary === false) return `${mac.alt ? "⌥" : ""}${mac.shift ? "⇧" : ""}${key}`;
		return `${mac.alt ? "⌥" : ""}${mac.shift ? "⇧" : ""}⌘${key}`;
	}
	const primary = spec.primary === false ? undefined : "Ctrl";
	if (style === "kbd") return [primary, spec.shift ? "⇧" : undefined, spec.alt ? "Alt" : undefined, spec.key].filter(Boolean).join(" ");
	return [primary, spec.shift ? "Shift" : undefined, spec.alt ? "Alt" : undefined, spec.key].filter(Boolean).join("+");
}

/** Both platforms' spellings, so palette search finds "ctrl k" and "⌘K" alike. */
export function shortcutSearchText(spec: ShortcutSpec): string {
	return `${formatShortcut(spec, "hint", "win32")} ${formatShortcut(spec, "kbd", "darwin")} cmd`;
}

/**
 * The shortcuts this surface advertises, one spec each — the bindings from
 * `hooks/useKeyboardShortcuts.ts` plus the standard text-editing chords the
 * titlebar's Edit menu dispatches.
 */
export const SHORTCUTS = Object.freeze({
	newSession: { key: "N" },
	commandPalette: { key: "K" },
	focusComposer: { key: "I" },
	submit: { key: "Enter" },
	cycleTheme: { key: "/" },
	abort: { key: "Escape", primary: false },
	undo: { key: "Z" },
	redo: { key: "Y", mac: { key: "Z", shift: true } },
	cut: { key: "X" },
	copy: { key: "C" },
	paste: { key: "V" },
	selectAll: { key: "A" },
} satisfies Record<string, ShortcutSpec>);
