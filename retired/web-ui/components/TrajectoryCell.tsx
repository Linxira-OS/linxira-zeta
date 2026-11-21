"use client";

import type { TrajectoryCell as TrajectoryCellData } from "../lib/trajectory";

interface Props {
  cell: TrajectoryCellData;
  onClick: () => void;
}

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 8,
  padding: "6px 10px",
  borderRadius: 8,
  cursor: "pointer",
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  lineHeight: 1.5,
};

export function TrajectoryCell({ cell, onClick }: Props) {
  if (cell.kind === "thinking") {
    return (
      <div
        onClick={onClick}
        style={{ ...rowStyle, background: "color-mix(in srgb, var(--zeta-alias-accent) 6%, transparent)", color: "var(--zeta-alias-text-muted)" }}
        title="Click to inspect"
      >
        <span style={{ flexShrink: 0, color: "var(--zeta-alias-accent)" }}>think</span>
        <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {(cell.text ?? "").slice(0, 240)}
          {(cell.text?.length ?? 0) > 240 ? " …" : ""}
        </span>
      </div>
    );
  }

  if (cell.kind === "tool") {
    return (
      <div
        onClick={onClick}
        style={{ ...rowStyle, background: "color-mix(in srgb, var(--zeta-alias-text) 4%, transparent)" }}
        title="Click to inspect"
      >
        <span style={{ flexShrink: 0, color: cell.isError ? "var(--zeta-alias-status-error-foreground)" : "var(--zeta-alias-text)" }}>
          {cell.toolName}
        </span>
        {cell.durationMs !== null && cell.durationMs !== undefined && (
          <span style={{ flexShrink: 0, color: "var(--zeta-alias-text-dim)" }}>{cell.durationMs}ms</span>
        )}
        {cell.isError === true && (
          <span style={{ flexShrink: 0, color: "var(--zeta-alias-status-error-foreground)" }}>error</span>
        )}
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      style={{ ...rowStyle, background: "none", color: "var(--zeta-alias-text)" }}
      title="Click to inspect"
    >
      <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
        {(cell.text ?? "").slice(0, 320)}
        {(cell.text?.length ?? 0) > 320 ? " …" : ""}
      </span>
      {cell.tokenInput !== undefined && cell.tokenInput > 0 && (
        <span style={{ flexShrink: 0, marginLeft: "auto", color: "var(--zeta-alias-text-dim)" }}>
          in {cell.tokenInput}
          {cell.tokenCacheRead !== undefined && cell.tokenCacheRead > 0 ? ` / cache ${cell.tokenCacheRead}` : ""}
        </span>
      )}
    </div>
  );
}
