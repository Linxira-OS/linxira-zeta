"use client";

import { useEffect, useRef, useState } from "react";
import { useLanguage, type Language } from "@/hooks/useLanguage";
import { useTheme } from "@/hooks/useTheme";

interface LangOption {
  id: Language;
  label: string;
  sub: string;
  flag: string;
}

const LANG_OPTIONS: LangOption[] = [
  { id: "en", label: "English", sub: "English", flag: "🇺🇸" },
  { id: "zh", label: "中文", sub: "Chinese (Simplified)", flag: "🇨🇳" },
];

const GlobeIcon = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    style={{ flexShrink: 0 }}
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

export function LanguagePicker() {
  const { lang, setLanguage } = useLanguage();
  const { isStarfield } = useTheme();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: "relative", flexShrink: 0 }}>
      {/* Button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          // Quick toggle on primary click or open dropdown on secondary
          setOpen((v) => !v);
        }}
        title={`Language: ${lang === "zh" ? "中文" : "English"} (Click to switch)`}
        aria-label="Switch language"
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 5,
          height: 36,
          padding: "0 10px",
          background: "none",
          border: "none",
          borderRight: "1px solid var(--border)",
          color: isStarfield ? "#d99b26" : "var(--text-muted)",
          cursor: "pointer",
          fontSize: 11,
          whiteSpace: "nowrap",
          transition: "color 0.12s, background 0.12s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--bg-hover)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "none";
        }}
      >
        <GlobeIcon />
        <span
          style={{
            fontFamily: "var(--font-mono, monospace)",
            letterSpacing: "0.04em",
            fontSize: 10,
            fontWeight: 600,
            opacity: 0.9,
          }}
        >
          {lang === "zh" ? "中文" : "EN"}
        </span>
        {/* Chevron */}
        <svg
          width="8"
          height="8"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s", flexShrink: 0 }}
          aria-hidden="true"
        >
          <polyline points="2 3.5 5 6.5 8 3.5" />
        </svg>
      </button>

      {/* Dropdown Menu */}
      {open && (
        <div
          role="listbox"
          aria-label="Select language"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            zIndex: 9000,
            minWidth: 170,
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.28)",
            borderRadius: isStarfield ? 0 : 8,
            overflow: "hidden",
            borderTop: isStarfield ? "2px solid #d99b26" : "1px solid var(--border)",
          }}
        >
          {isStarfield && (
            <div
              style={{
                padding: "6px 12px 4px",
                fontFamily: "var(--font-mono, monospace)",
                fontSize: 9,
                letterSpacing: "0.14em",
                color: "#d99b26",
                opacity: 0.7,
                textTransform: "uppercase",
                borderBottom: "1px solid #1e2d45",
              }}
            >
              ◈ Language / 语言
            </div>
          )}

          {LANG_OPTIONS.map((opt) => {
            const isActive = lang === opt.id;
            return (
              <button
                key={opt.id}
                role="option"
                aria-selected={isActive}
                onClick={() => {
                  setLanguage(opt.id);
                  setOpen(false);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  width: "100%",
                  padding: "8px 12px",
                  background: isActive ? "var(--bg-selected)" : "none",
                  border: "none",
                  borderLeft: isActive
                    ? isStarfield
                      ? "3px solid #d99b26"
                      : "3px solid var(--accent)"
                    : "3px solid transparent",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "background 0.1s",
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.background = "var(--bg-hover)";
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.background = "none";
                }}
              >
                <span style={{ fontSize: 14 }}>{opt.flag}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: isStarfield && isActive ? "#d99b26" : "var(--text)",
                      fontFamily: isStarfield ? "var(--font-mono, monospace)" : "inherit",
                    }}
                  >
                    {opt.label}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: "var(--text-dim)",
                      fontFamily: isStarfield ? "var(--font-mono, monospace)" : "inherit",
                    }}
                  >
                    {opt.sub}
                  </div>
                </div>

                {isActive && (
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={isStarfield ? "#d99b26" : "var(--accent)"}
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ flexShrink: 0 }}
                    aria-hidden="true"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
