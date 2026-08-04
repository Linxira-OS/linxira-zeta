"use client";

import { useCallback, useSyncExternalStore } from "react";
import { vs, vscDarkPlus, oneDark } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { useTheme } from "./useTheme";

export type CodeTheme = "auto" | "vs" | "vscDarkPlus" | "oneDark";

const STORAGE_KEY = "zeta-code-theme";

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): CodeTheme {
  if (typeof document === "undefined") return "auto";
  try {
    const val = localStorage.getItem(STORAGE_KEY);
    if (val === "vs" || val === "vscDarkPlus" || val === "oneDark" || val === "auto") {
      return val;
    }
  } catch {
    // ignore storage error
  }
  return "auto";
}

function getServerSnapshot(): CodeTheme {
  return "auto";
}

export function setCodeThemeStorage(next: CodeTheme) {
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // ignore storage error
  }
  listeners.forEach((cb) => cb());
}

export function useCodeTheme() {
  const codeTheme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const { isDark } = useTheme();

  const setCodeTheme = useCallback((next: CodeTheme) => {
    setCodeThemeStorage(next);
  }, []);

  let codeStyle = isDark ? vscDarkPlus : vs;
  let codeThemeName: "vs" | "vscDarkPlus" | "oneDark" = isDark ? "vscDarkPlus" : "vs";

  if (codeTheme === "vs") {
    codeStyle = vs;
    codeThemeName = "vs";
  } else if (codeTheme === "vscDarkPlus") {
    codeStyle = vscDarkPlus;
    codeThemeName = "vscDarkPlus";
  } else if (codeTheme === "oneDark") {
    codeStyle = oneDark;
    codeThemeName = "oneDark";
  }

  // Derive background color for syntax container
  const styleBg = codeStyle['pre[class*="language-"]']?.background || codeStyle['code[class*="language-"]']?.background;

  return {
    codeTheme,
    setCodeTheme,
    codeStyle,
    codeThemeName,
    codeBg: styleBg || null,
  };
}
