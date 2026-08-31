"use client";

import { useContext } from "react";
import { ThemeSystemContext } from "./theme-system-context";

export function useThemeSystem() {
  const context = useContext(ThemeSystemContext);
  if (!context) throw new Error("useThemeSystem must be used within ThemeSystemProvider");
  return context;
}
