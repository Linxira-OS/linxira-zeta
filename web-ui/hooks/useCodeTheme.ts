"use client";

import { useContext, useMemo } from "react";
import { ThemeSystemContext } from "@/contexts/theme-system-context";
import { getDefaultTheme } from "@/lib/theme/themes";

export type CodeTheme = "active";

export function useCodeTheme() {
  const context = useContext(ThemeSystemContext);
  const currentTheme = context?.currentTheme ?? getDefaultTheme("dark");
  const codeStyle = useMemo(() => ({
    'pre[class*="language-"]': {
      background: "var(--syntax-background)",
      color: "var(--syntax-foreground)",
    },
    'code[class*="language-"]': {
      background: "transparent",
      color: "var(--syntax-foreground)",
    },
    comment: { color: "var(--syntax-comment)", fontStyle: "italic" },
    keyword: { color: "var(--syntax-keyword)" },
    string: { color: "var(--syntax-string)" },
    number: { color: "var(--syntax-number)" },
    function: { color: "var(--syntax-function)" },
    variable: { color: "var(--syntax-variable)" },
    "class-name": { color: "var(--syntax-type)" },
    operator: { color: "var(--syntax-operator)" },
    property: { color: "var(--syntax-property)" },
  }), []);

  return {
    codeTheme: "active" as const,
    codeStyle,
    codeThemeName: currentTheme.metadata.id,
    codeBg: "var(--syntax-background)",
  };
}
