"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { MarkdownBody } from "./MarkdownBody";

interface DocEntry {
  key: string;
  labelKey: string;
  path: (lang: "en" | "zh") => string;
}

const DOC_ENTRIES: DocEntry[] = [
  {
    key: "manual",
    labelKey: "web-docs-manual",
    path: (lang) => (lang === "zh" ? "user-guide.zh-CN.md" : "user-guide.md"),
  },
  {
    key: "architecture",
    labelKey: "web-docs-architecture",
    path: (lang) => (lang === "zh" ? "web-ui/architecture.zh-CN.md" : "web-ui/architecture.md"),
  },
  {
    key: "api",
    labelKey: "web-docs-api",
    path: (lang) => (lang === "zh" ? "web-ui/api.zh-CN.md" : "web-ui/api.md"),
  },
];

function extractHeadings(markdown: string): string[] {
  const headings: string[] = [];
  for (const line of markdown.split("\n")) {
    const match = /^##\s+(.+)$/.exec(line);
    if (match) headings.push(match[1].trim());
  }
  return headings;
}

interface DocsPanelProps {
  locale: string;
  t: (key: string) => string;
}

/** About / Usage panel: reads the packaged Markdown corpus via /api/docs/<path>. */
export function DocsPanel({ locale, t }: DocsPanelProps) {
  const lang: "en" | "zh" = locale === "zh-CN" ? "zh" : "en";
  const [selectedKey, setSelectedKey] = useState("manual");
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const selected = DOC_ENTRIES.find((entry) => entry.key === selectedKey) ?? DOC_ENTRIES[0];

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setError(null);
    // Encode per segment so `/` stays literal in the URL (the gateway route
    // matches `[A-Za-z0-9._/-]+` and would reject a `%2F`-encoded path).
    const encodedPath = selected.path(lang).split("/").map(encodeURIComponent).join("/");
    fetch(`/api/docs/${encodedPath}`)
      .then((res) => {
        if (res.status === 404) throw new Error(t("web-docs-not-found"));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ path: string; content: string }>;
      })
      .then((data) => {
        if (!cancelled) setContent(data.content);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [selected, lang, t]);

  const headings = content ? extractHeadings(content) : [];

  const scrollToHeading = useCallback((heading: string) => {
    const container = scrollRef.current;
    if (!container) return;
    const els = container.querySelectorAll("h2");
    for (const el of els) {
      if (el.textContent?.trim() === heading) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
    }
  }, []);

  const selectDoc = useCallback(
    (key: string) => {
      setSelectedKey(key);
      scrollRef.current?.scrollTo({ top: 0 });
    },
    [],
  );

  return (
    <div style={{ display: "flex", height: "100%", minHeight: 0 }}>
      {/* Chapter list */}
      <div
        style={{
          width: 220,
          flexShrink: 0,
          borderRight: "1px solid var(--border)",
          overflowY: "auto",
          padding: "12px 10px",
          background: "var(--bg-panel)",
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)", padding: "4px 8px 8px" }}>
          {t("web-docs-title")}
        </div>
        <select
          value={selectedKey}
          onChange={(e) => selectDoc(e.target.value)}
          aria-label={t("web-docs-title")}
          style={{
            width: "100%",
            padding: "6px 8px",
            marginBottom: 10,
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--text)",
            fontSize: 12,
          }}
        >
          {DOC_ENTRIES.map((entry) => (
            <option key={entry.key} value={entry.key}>
              {t(entry.labelKey)}
            </option>
          ))}
        </select>
        {headings.length > 0 && (
          <nav aria-label={t("web-docs-chapters")}>
            {headings.map((heading) => (
              <button
                key={heading}
                type="button"
                onClick={() => scrollToHeading(heading)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "5px 8px",
                  border: "none",
                  borderRadius: 6,
                  background: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: 12,
                  lineHeight: 1.35,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--bg-selected)";
                  e.currentTarget.style.color = "var(--text)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "none";
                  e.currentTarget.style.color = "var(--text-muted)";
                }}
              >
                {heading}
              </button>
            ))}
          </nav>
        )}
      </div>

      {/* Document body */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "16px 22px", background: "var(--bg)" }}>
        {error ? (
          <div style={{ padding: 24, fontSize: 12.5, color: "#f87171" }}>{error}</div>
        ) : content === null ? (
          <div style={{ padding: 24, fontSize: 12.5, color: "var(--text-muted)" }}>Loading…</div>
        ) : (
          <div style={{ maxWidth: 760 }}>
            <MarkdownBody>{content}</MarkdownBody>
          </div>
        )}
      </div>
    </div>
  );
}
