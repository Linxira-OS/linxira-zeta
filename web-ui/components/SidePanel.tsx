"use client";

import type { SessionStatsInfo } from "@/lib/pi-types";

export interface ContextUsageInfo {
  percent: number | null;
  contextWindow: number;
  tokens: number | null;
}

export interface ModelInfo {
  provider: string;
  modelId: string;
}

interface SidePanelProps {
  stats: SessionStatsInfo | null;
  contextUsage: ContextUsageInfo | null;
  model: ModelInfo | null;
  thinkingLevel: string;
  onClose: () => void;
}

const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  );
}

function Value({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12.5, color: "var(--text)", fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere" }}>{children}</div>;
}

/**
 * Right-hand session panel: model, context usage, token totals, and cost.
 * Pure display — every value arrives via props from the AppShell's existing
 * ChatWindow subscriptions, so the panel never talks to the gateway itself.
 */
export function SidePanel({ stats, contextUsage, model, thinkingLevel, onClose }: SidePanelProps) {
  const pct = contextUsage?.percent;
  const pctColor = pct === null || pct === undefined ? "var(--text-muted)" : pct > 90 ? "var(--status-error-foreground)" : pct > 70 ? "var(--status-warning-foreground)" : "var(--text)";
  const cost = stats?.cost ?? 0;

  return (
    <aside
      aria-label="Session panel"
      style={{
        width: 280,
        flexShrink: 0,
        background: "var(--bg-panel)",
        borderLeft: "1px solid var(--border)",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text)" }}>Session</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close session panel"
          style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 4px" }}
        >
          ×
        </button>
      </div>

      <Panel title="Model">
        <Value>{model ? `${model.provider}/${model.modelId}` : "—"}</Value>
        {thinkingLevel && (
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>thinking: {thinkingLevel}</div>
        )}
      </Panel>

      <Panel title="Context">
        {contextUsage?.contextWindow ? (
          <>
            <Value>
              <span style={{ color: pctColor }}>{pct !== null && pct !== undefined ? `${pct.toFixed(0)}%` : "?"}</span>
              <span style={{ color: "var(--text-muted)" }}> of {fmt(contextUsage.contextWindow)}</span>
            </Value>
            {contextUsage.tokens !== null && contextUsage.tokens !== undefined && (
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{fmt(contextUsage.tokens)} tokens in context</div>
            )}
          </>
        ) : (
          <Value>—</Value>
        )}
      </Panel>

      <Panel title="Tokens">
        {stats ? (
          <>
            <Value>
              ↑ {fmt(stats.tokens.input)} <span style={{ color: "var(--text-muted)" }}>in</span>
            </Value>
            <Value>
              ↓ {fmt(stats.tokens.output)} <span style={{ color: "var(--text-muted)" }}>out</span>
            </Value>
            {(stats.tokens.cacheRead > 0 || stats.tokens.cacheWrite > 0) && (
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                cache read {fmt(stats.tokens.cacheRead)} · write {fmt(stats.tokens.cacheWrite)}
              </div>
            )}
          </>
        ) : (
          <Value>—</Value>
        )}
      </Panel>

      <Panel title="Cost">
        <Value>{cost > 0 ? `$${cost.toFixed(4)}` : "—"}</Value>
      </Panel>
    </aside>
  );
}
