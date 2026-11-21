"use client";

import { useEffect } from "react";

// ---------------------------------------------------------------------------
// Module-level registry — each mounted ChatWindow registers its abort handler
// here, keyed by tab id, so the global Esc listener in AppShell can reach the
// active tab's run without prop-drilling. Keyed rather than single-valued:
// session tabs keep their ChatWindow mounted while hidden, and a single slot
// would let a background tab overwrite the active tab's handler (Esc used to
// abort whichever tab rendered last).
// ---------------------------------------------------------------------------
const abortHandlers = new Map<string, () => void>();

/**
 * Register (or clear) one tab's abort handler. Call from ChatWindow whenever
 * `tabId`, agentRunning or handleAbort changes; pass null when the tab has
 * nothing running or is unmounting.
 */
export function registerAbortHandler(tabId: string, handler: (() => void) | null): void {
	if (handler) abortHandlers.set(tabId, handler);
	else abortHandlers.delete(tabId);
}

/** The handler Esc should run, or null when that tab has nothing running. */
export function abortHandlerFor(tabId: string | null): (() => void) | null {
	return tabId ? (abortHandlers.get(tabId) ?? null) : null;
}

// ---------------------------------------------------------------------------
// Hook: global keyboard shortcuts
// ---------------------------------------------------------------------------

interface UseGlobalKeyboardShortcutsOptions {
	/** Called when Ctrl+Alt+N or Ctrl+N is pressed. Receives current cwd. */
	onNewSession?: (cwd: string) => void;
	/** The currently selected project directory (sidebar cwd). */
	activeCwd?: string | null;
	/** Tab whose run Esc aborts (only the active tab is ever stopped). */
	activeTabId?: string | null;
	/** Focus the chat input (Ctrl+I). */
	onFocusInput?: () => void;
	/** Submit the current chat draft (Ctrl+Enter). */
	onSubmitInput?: () => void;
	/** Cycle the app theme (Ctrl+/). */
	onCycleTheme?: () => void;
	/** Toggle the command palette (Ctrl+K). */
	onTogglePalette?: () => void;
}

/**
 * Register global keyboard shortcuts for the application.
 *
 * Shortcuts handled here:
 *   Esc          – stop the active tab's run (via the module-level registry,
 *                  keyed by tab id: a hidden tab must never be aborted)
 *   Ctrl+Alt+N   – create a new session in the active project directory
 *   Ctrl+N       – create a new session (same action; Ctrl+Alt+N kept for
 *                  compatibility with the original binding)
 *   Ctrl+I       – focus the chat input
 *   Ctrl+Enter   – submit the current chat draft
 *   Ctrl+/       – cycle the app theme
 *
 * Note: Esc inside <textarea> or <input> is deliberately NOT handled here.
 * ChatInput manages its own Esc logic (closing slash / @ file menus, stopping
 * the agent when no menu is open) because it needs intimate knowledge of menu
 * state that is local to that component.
 *
 * Ctrl+I/Ctrl+Enter also skip when the event originates inside a contenteditable
 * or input (IME composition); the textarea is driven by ChatInput's own keys.
 */
export function useGlobalKeyboardShortcuts(options: UseGlobalKeyboardShortcutsOptions): void {
	const { onNewSession, activeCwd, activeTabId, onFocusInput, onSubmitInput, onCycleTheme, onTogglePalette } = options;

	useEffect(() => {
		const handler = (e: KeyboardEvent): void => {
			// ---- Esc: stop the active tab's run ----
			if (e.key === "Escape") {
				const abort = abortHandlerFor(activeTabId ?? null);
				if (!abort) return;

				const tag = (e.target as HTMLElement)?.tagName;
				// Let textarea/input handle Esc internally (ChatInput menus / stop).
				if (tag === "TEXTAREA" || tag === "INPUT") return;

				e.preventDefault();
				abort();
				return;
			}

			// ---- New session: Ctrl+N (kept) / Ctrl+Alt+N (legacy alias) ----
			if (e.key === "n" && e.ctrlKey && !e.shiftKey && !e.metaKey) {
				if (!activeCwd || !onNewSession) return;
				e.preventDefault();
				onNewSession(activeCwd);
				return;
			}

			// ---- Focus chat input: Ctrl+I ----
			if (e.key === "i" && e.ctrlKey && !e.shiftKey && !e.metaKey && !e.altKey) {
				if (!onFocusInput) return;
				e.preventDefault();
				onFocusInput();
				return;
			}

			// ---- Submit chat draft: Ctrl+Enter ----
			if (e.key === "Enter" && e.ctrlKey && !e.shiftKey && !e.metaKey && !e.altKey) {
				if (!onSubmitInput) return;
				e.preventDefault();
				onSubmitInput();
				return;
			}

			// ---- Cycle theme: Ctrl+/ ----
			if (e.key === "/" && e.ctrlKey && !e.shiftKey && !e.metaKey && !e.altKey) {
				if (!onCycleTheme) return;
				e.preventDefault();
				onCycleTheme();
				return;
			}

			// ---- Command palette: Ctrl+K ----
			if (e.key === "k" && e.ctrlKey && !e.shiftKey && !e.metaKey && !e.altKey) {
				if (!onTogglePalette) return;
				e.preventDefault();
				onTogglePalette();
			}
		};

		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [activeCwd, activeTabId, onNewSession, onFocusInput, onSubmitInput, onCycleTheme, onTogglePalette]);
}
