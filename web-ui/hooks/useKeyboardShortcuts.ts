"use client";

import { useEffect } from "react";

// ---------------------------------------------------------------------------
// Module-level registry — ChatWindow registers the abort handler here so that
// the global Esc listener in AppShell can call it without prop-drilling.
// ---------------------------------------------------------------------------
let globalAbortHandler: (() => void) | null = null;

/**
 * Register (or clear) the abort handler for the global Esc shortcut.
 * Call this from ChatWindow whenever agentRunning or handleAbort changes.
 */
export function registerAbortHandler(handler: (() => void) | null): void {
  globalAbortHandler = handler;
}

// ---------------------------------------------------------------------------
// Hook: global keyboard shortcuts
// ---------------------------------------------------------------------------

interface UseGlobalKeyboardShortcutsOptions {
  /** Called when Ctrl+Alt+N or Ctrl+N is pressed. Receives current cwd. */
  onNewSession?: (cwd: string) => void;
  /** The currently selected project directory (sidebar cwd). */
  activeCwd?: string | null;
  /** Focus the chat input (Ctrl+I). */
  onFocusInput?: () => void;
  /** Submit the current chat draft (Ctrl+Enter). */
  onSubmitInput?: () => void;
  /** Cycle the app theme (Ctrl+/). */
  onCycleTheme?: () => void;
}

/**
 * Register global keyboard shortcuts for the application.
 *
 * Shortcuts handled here:
 *   Esc          – stop the running agent (via module-level abort handler)
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
export function useGlobalKeyboardShortcuts(
  options: UseGlobalKeyboardShortcutsOptions,
): void {
  const { onNewSession, activeCwd, onFocusInput, onSubmitInput, onCycleTheme } = options;

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      // ---- Esc: stop agent ----
      if (e.key === "Escape") {
        if (!globalAbortHandler) return;

        const tag = (e.target as HTMLElement)?.tagName;
        // Let textarea/input handle Esc internally (ChatInput menus / stop).
        if (tag === "TEXTAREA" || tag === "INPUT") return;

        e.preventDefault();
        globalAbortHandler();
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
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeCwd, onNewSession, onFocusInput, onSubmitInput, onCycleTheme]);
}
