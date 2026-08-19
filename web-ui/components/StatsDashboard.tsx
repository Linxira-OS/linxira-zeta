"use client";

import { useI18n } from "@/hooks/useI18n";

/**
 * Stats dashboard iframe bridge. The serve process injects
 * `NEXT_PUBLIC_STATS_URL` (the in-process stats dashboard port) into the web-ui
 * child; when absent (e.g. a standalone build) we show an empty-state hint.
 */
export function StatsDashboard() {
  const { t } = useI18n();
  const statsUrl = process.env.NEXT_PUBLIC_STATS_URL;

  if (!statsUrl) {
    return (
      <div
        style={{
          height: "100%",
          display: "grid",
          placeItems: "center",
          color: "var(--text-dim)",
          fontSize: 13,
          padding: 24,
          textAlign: "center",
        }}
      >
        <div style={{ display: "grid", gap: 12, justifyItems: "center" }}>
          <div>
            Stats dashboard is not running. Start the web server with{" "}
            <code style={{ fontFamily: "var(--font-mono)", margin: "0 4px" }}>zeta serve</code>{" "}
            to enable it.
          </div>
          <button
            type="button"
            onClick={() => window.open(statsUrl ?? "http://127.0.0.1:3847", "_blank")}
            style={{
              padding: "6px 16px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--bg-elevated)",
              color: "var(--text)",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            {t("open-stats")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <iframe
      src={statsUrl}
      title="Stats dashboard"
      style={{ width: "100%", height: "100%", border: "none", display: "block", background: "var(--bg)" }}
    />
  );
}
