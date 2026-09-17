"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useThemeSystem } from "@/contexts/useThemeSystem";
import type { ThemeMode } from "@/contexts/theme-system-context";

const MODE_LABELS: Record<ThemeMode, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

export function ThemePicker() {
  const {
    availableThemes,
    currentTheme,
    darkThemeId,
    lightThemeId,
    setDarkThemePreference,
    setLightThemePreference,
    setThemeMode,
    themeMode,
  } = useThemeSystem();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const lightThemes = useMemo(() => availableThemes.filter((theme) => theme.metadata.variant === "light"), [availableThemes]);
  const darkThemes = useMemo(() => availableThemes.filter((theme) => theme.metadata.variant === "dark"), [availableThemes]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: "relative", flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title="Choose theme"
        aria-label="Choose theme"
        aria-expanded={open}
        style={{
          alignItems: "center",
          background: "none",
          border: "none",
          borderRight: "1px solid var(--border)",
          color: "var(--text-muted)",
          cursor: "pointer",
          display: "flex",
          fontSize: 11,
          gap: 6,
          height: 36,
          padding: "0 10px",
        }}
      >
        <span aria-hidden="true">{currentTheme.metadata.variant === "dark" ? "◐" : "◑"}</span>
        <span>{currentTheme.metadata.name}</span>
        <span aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Theme settings"
          style={{
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            boxShadow: "0 10px 32px rgb(0 0 0 / 0.28)",
            display: "grid",
            gap: 10,
            left: 0,
            minWidth: 280,
            padding: 12,
            position: "absolute",
            top: "calc(100% + 4px)",
            zIndex: 9000,
          }}
        >
          <label style={{ color: "var(--text-dim)", display: "grid", fontSize: 11, gap: 4 }}>
            Appearance
            <select value={themeMode} onChange={(event) => setThemeMode(event.target.value as ThemeMode)} style={selectStyle}>
              {(Object.entries(MODE_LABELS) as Array<[ThemeMode, string]>).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label style={{ color: "var(--text-dim)", display: "grid", fontSize: 11, gap: 4 }}>
            Light preset
            <select value={lightThemeId} onChange={(event) => setLightThemePreference(event.target.value)} style={selectStyle}>
              {lightThemes.map((theme) => <option key={theme.metadata.id} value={theme.metadata.id}>{theme.metadata.name}</option>)}
            </select>
          </label>
          <label style={{ color: "var(--text-dim)", display: "grid", fontSize: 11, gap: 4 }}>
            Dark preset
            <select value={darkThemeId} onChange={(event) => setDarkThemePreference(event.target.value)} style={selectStyle}>
              {darkThemes.map((theme) => <option key={theme.metadata.id} value={theme.metadata.id}>{theme.metadata.name}</option>)}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  background: "var(--bg)",
  border: "1px solid var(--border)",
  color: "var(--text)",
  fontSize: 12,
  padding: "6px 8px",
};
