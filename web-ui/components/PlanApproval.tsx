"use client";

import { useCallback, useState } from "react";

interface PlanApprovalProps {
  planFilePath: string;
  planTitle: string;
  planMarkdown: string;
  onApprove: (mode: "preserve" | "compact" | "fresh" | "cancel") => void;
}

export function PlanApproval({ planFilePath, planTitle, planMarkdown, onApprove }: PlanApprovalProps) {
  const [expanded, setExpanded] = useState(false);

  const handleApprove = useCallback(
    (mode: "preserve" | "compact" | "fresh" | "cancel") => {
      onApprove(mode);
    },
    [onApprove],
  );

  return (
    <div
      style={{
        background: "var(--zeta-alias-bg)",
        border: "1px solid var(--zeta-alias-border)",
        borderRadius: 8,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--zeta-alias-text)" }}>📋 {planTitle}</span>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          style={{
            background: "none",
            border: "none",
            color: "var(--zeta-alias-text-muted)",
            cursor: "pointer",
            fontSize: 12,
            padding: "2px 6px",
          }}
        >
          {expanded ? "Collapse" : "Preview"}
        </button>
      </div>

      {/* Plan content */}
      {expanded && (
        <div
          style={{
            background: "var(--zeta-alias-bg-panel)",
            borderRadius: 6,
            padding: 12,
            maxHeight: 320,
            overflowY: "auto",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
            color: "var(--zeta-alias-text)",
          }}
        >
          {planMarkdown}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <ActionButton
          label="Execute (preserve context)"
          onClick={() => handleApprove("preserve")}
          color="var(--zeta-alias-status-success)"
        />
        <ActionButton
          label="Summarize & execute"
          onClick={() => handleApprove("compact")}
          color="var(--zeta-alias-status-info)"
        />
        <ActionButton
          label="New session & execute"
          onClick={() => handleApprove("fresh")}
          color="var(--zeta-alias-status-warning)"
        />
        <ActionButton
          label="Cancel"
          onClick={() => handleApprove("cancel")}
          color="var(--zeta-alias-status-error)"
        />
      </div>
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  color,
}: {
  label: string;
  onClick: () => void;
  color: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "6px 14px",
        border: `1px solid ${color}`,
        borderRadius: 6,
        background: "transparent",
        color,
        cursor: "pointer",
        fontSize: 12,
        fontWeight: 500,
      }}
    >
      {label}
    </button>
  );
}