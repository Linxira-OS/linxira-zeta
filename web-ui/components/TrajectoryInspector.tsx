"use client";

import type { AgentMessage } from "../lib/types";
import { useI18n } from "@/hooks/useI18n";

interface Props {
  /** Original session entry JSON for the selected message. */
  entryJson: unknown;
  /** The derived trajectory cell payload (what this view reconstructed). */
  derived: unknown;
  onClose: () => void;
}

/**
 * Right-hand inspector for a selected trajectory step: shows the raw session
 * entry JSON (pretty-printed) with a "reconstructed" marker on the derived
 * view — the trajectory table is derived, not a verbatim transcript.
 */
export function TrajectoryInspector({ entryJson, derived, onClose }: Props) {
  const { t } = useI18n();
  let rawText: string;
  try {
    rawText = JSON.stringify(entryJson, null, 2);
  } catch {
    rawText = String(entryJson);
  }
  let derivedText: string;
  try {
    derivedText = JSON.stringify(derived, null, 2);
  } catch {
    derivedText = String(derived);
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: 360,
        minWidth: 360,
        borderLeft: "1px solid var(--border)",
        background: "var(--bg-panel)",
        overflowY: "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          borderBottom: "1px solid var(--border)",
          fontSize: 12,
          fontWeight: 600,
          color: "var(--text)",
        }}
      >
        <span>{t("step-inspector")}</span>
        <button
          onClick={onClose}
          aria-label="Close inspector"
          style={{
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: 14,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>
      <div style={{ padding: "8px 12px" }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>
          Reconstructed (derived from session messages)
        </div>
        <pre
          style={{
            margin: 0,
            padding: 8,
            borderRadius: 6,
            background: "color-mix(in srgb, var(--bg) 60%, transparent)",
            fontSize: 11,
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
            color: "var(--text-dim)",
            maxHeight: 200,
            overflowY: "auto",
          }}
        >
          {derivedText}
        </pre>
        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", margin: "12px 0 4px" }}>
          Raw entry JSON
        </div>
        <pre
          style={{
            margin: 0,
            padding: 8,
            borderRadius: 6,
            background: "color-mix(in srgb, var(--bg) 60%, transparent)",
            fontSize: 11,
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
            color: "var(--text)",
          }}
        >
          {rawText}
        </pre>
      </div>
    </div>
  );
}

export type { AgentMessage };
