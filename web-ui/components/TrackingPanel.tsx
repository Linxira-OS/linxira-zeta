"use client";

import { useState, useEffect, useCallback } from "react";
import { MarkdownBody } from "./MarkdownBody";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TrackingStatus {
  phase: string;
  progress: string;
  blockers: string[];
  decisions: string[];
  lastUpdated: string;
}

interface TrackingAction {
  timestamp: string;
  action: string;
  detail?: string;
}

interface TrackingData {
  index: string | null;
  status: TrackingStatus | null;
  actions: TrackingAction[];
  sessions: { name: string; content: string }[];
}

type SubTab = "overview" | "status" | "plans" | "logs" | "sessions" | "charts";

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: "overview", label: "概览" },
  { id: "status", label: "状态" },
  { id: "plans", label: "计划" },
  { id: "logs", label: "日志" },
  { id: "sessions", label: "会话" },
  { id: "charts", label: "图表" },
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  cwd: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TrackingPanel({ cwd }: Props) {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>("overview");
  const [data, setData] = useState<TrackingData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!cwd) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tracking?cwd=${encodeURIComponent(cwd)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setData((await res.json()) as TrackingData);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ------------------------------------------------------------------
  // Render helpers
  // ------------------------------------------------------------------

  const renderOverview = () => {
    if (!data) return null;
    if (!data.index) {
      return (
        <div style={{ padding: 16, color: "var(--text-dim)", fontSize: 13 }}>
          暂无项目概览。Agent 可通过 tracking_update 工具创建 INDEX.md。
        </div>
      );
    }
    return (
      <div style={{ padding: "12px 16px", overflow: "auto", flex: 1 }}>
        <MarkdownBody cwd={cwd ?? undefined}>{data.index}</MarkdownBody>
      </div>
    );
  };

  const renderStatus = () => {
    if (!data) return null;
    if (!data.status) {
      return (
        <div style={{ padding: 16, color: "var(--text-dim)", fontSize: 13 }}>
          暂无状态信息。
        </div>
      );
    }
    const s = data.status;
    const rows: [string, string][] = [
      ["阶段", s.phase || "-"],
      ["进度", s.progress || "-"],
      ["阻碍", s.blockers.length > 0 ? s.blockers.join("；") : "-"],
      ["决策", s.decisions.length > 0 ? s.decisions.join("；") : "-"],
      ["更新时间", s.lastUpdated ? new Date(s.lastUpdated).toLocaleString() : "-"],
    ];
    return (
      <div style={{ padding: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "8px 16px", fontSize: 13 }}>
          {rows.map(([label, value]) => (
            <div key={label} style={{ display: "contents" }}>
              <div style={{ color: "var(--text-dim)", whiteSpace: "nowrap", fontWeight: 500 }}>{label}</div>
              <div style={{ color: "var(--text)", wordBreak: "break-word" }}>{value}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderPlans = () => {
    if (!data) return null;
    if (data.sessions.length === 0) {
      return (
        <div style={{ padding: 16, color: "var(--text-dim)", fontSize: 13 }}>
          暂无同步的计划文件。
        </div>
      );
    }
    return (
      <div style={{ padding: "12px 16px", overflow: "auto", flex: 1 }}>
        {data.sessions.map((s) => (
          <details key={s.name} style={{ marginBottom: 12 }}>
            <summary style={{ cursor: "pointer", color: "var(--text)", fontSize: 13, fontWeight: 500, padding: "4px 0" }}>
              {s.name.replace(/\.md$/, "")}
            </summary>
            <div style={{ padding: "8px 0 8px 12px", borderLeft: "2px solid var(--border)" }}>
              <MarkdownBody cwd={cwd ?? undefined}>{s.content}</MarkdownBody>
            </div>
          </details>
        ))}
      </div>
    );
  };

  const renderLogs = () => {
    if (!data) return null;
    if (data.actions.length === 0) {
      return (
        <div style={{ padding: 16, color: "var(--text-dim)", fontSize: 13 }}>
          暂无操作日志。
        </div>
      );
    }
    const reversed = [...data.actions].reverse();
    return (
      <div style={{ padding: 16, overflow: "auto", flex: 1 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {reversed.map((a, i) => (
            <div key={i} style={{ display: "flex", gap: 12, fontSize: 12, lineHeight: 1.5 }}>
              <div style={{ color: "var(--text-dim)", whiteSpace: "nowrap", fontFamily: "var(--font-mono)", flexShrink: 0 }}>
                {new Date(a.timestamp).toLocaleString()}
              </div>
              <div style={{ color: "var(--text)" }}>
                <span style={{ fontWeight: 600 }}>{a.action}</span>
                {a.detail ? <span style={{ color: "var(--text-muted)" }}> — {a.detail}</span> : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderSessions = () => {
    if (!data) return null;
    if (data.sessions.length === 0) {
      return (
        <div style={{ padding: 16, color: "var(--text-dim)", fontSize: 13 }}>
          暂无会话摘要。
        </div>
      );
    }
    return (
      <div style={{ padding: 16, overflow: "auto", flex: 1 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {data.sessions.map((s) => (
            <div key={s.name} style={{ padding: 10, background: "var(--bg-panel)", borderRadius: 6, border: "1px solid var(--border)" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>
                {s.name.replace(/\.md$/, "")}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", maxHeight: 120, overflow: "hidden", position: "relative" }}>
                {s.content.slice(0, 300)}
                {s.content.length > 300 ? (
                  <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 30, background: "linear-gradient(transparent, var(--bg-panel))" }} />
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderCharts = () => {
    if (!data) return null;
    if (data.actions.length === 0) {
      return (
        <div style={{ padding: 16, color: "var(--text-dim)", fontSize: 13 }}>
          暂无操作数据，无法生成图表。Agent 执行 tracking_update 记录操作后，图表将自动更新。
        </div>
      );
    }

    // --- Compute stats ---
    const ops = data.actions.map((a) => a.action);
    const opCounts = new Map<string, number>();
    for (const op of ops) {
      opCounts.set(op, (opCounts.get(op) ?? 0) + 1);
    }
    const sortedOps = [...opCounts.entries()].sort((a, b) => b[1] - a[1]);

    // --- Timeline: group by date ---
    const dateCounts = new Map<string, number>();
    for (const a of data.actions) {
      const date = a.timestamp.slice(0, 10);
      dateCounts.set(date, (dateCounts.get(date) ?? 0) + 1);
    }
    const sortedDates = [...dateCounts.entries()].sort();
    const maxDateCount = Math.max(1, ...dateCounts.values());

    // --- SVG timeline chart ---
    const chartW = Math.max(280, sortedDates.length * 32);
    const chartH = 120;
    const barW = Math.max(8, Math.min(24, (chartW - 40) / sortedDates.length - 4));
    const chartPad = { top: 10, right: 10, bottom: 30, left: 10 };

    const timelineBars = sortedDates.map(([date, count], i) => {
      const barH = Math.max(2, (count / maxDateCount) * (chartH - chartPad.top - chartPad.bottom));
      const x = chartPad.left + i * ((chartW - chartPad.left - chartPad.right) / sortedDates.length) + 2;
      const y = chartH - chartPad.bottom - barH;
      const label = date.slice(5); // MM-DD
      return (
        <g key={date}>
          <rect
            x={x}
            y={y}
            width={barW}
            height={barH}
            rx={2}
            fill="var(--chart-1)"
            opacity={0.7}
          />
          <text
            x={x + barW / 2}
            y={chartH - 6}
            textAnchor="middle"
            fill="var(--text-dim)"
            fontSize={9}
            fontFamily="var(--font-mono)"
          >
            {label}
          </text>
        </g>
      );
    });

    // --- Operation distribution reads the active preset's chart series. ---
    const opBars = sortedOps.slice(0, 8).map(([op, count], i) => {
      const color = `var(--chart-${(i % 8) + 1})`;
      const pct = Math.round((count / data.actions.length) * 100);
      return (
          <div key={op} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <div style={{ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0 }} />
          <div style={{ width: 80, fontSize: 11, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={op}>
            {op}
          </div>
          <div style={{ flex: 1, height: 8, background: "var(--bg-hover)", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 4, minWidth: pct > 0 ? 2 : 0, transition: "width 0.3s" }} />
          </div>
          <div style={{ width: 48, fontSize: 11, color: "var(--text-muted)", textAlign: "right", fontFamily: "var(--font-mono)" }}>
            {count} ({pct}%)
          </div>
        </div>
      );
    });

    return (
      <div style={{ padding: 16, overflow: "auto", flex: 1 }}>
        {/* Summary cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: 8, marginBottom: 16 }}>
          {[
            { label: "总操作", value: data.actions.length },
            { label: "操作类型", value: opCounts.size },
            { label: "活跃天数", value: dateCounts.size },
            { label: "计划文件", value: data.sessions.length },
          ].map((s) => (
            <div key={s.label} style={{ padding: "10px 12px", background: "var(--bg-panel)", borderRadius: 6, border: "1px solid var(--border)", textAlign: "center" }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: "var(--accent)", fontFamily: "var(--font-mono)" }}>{s.value}</div>
              <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Timeline */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>操作时间线</div>
          <div style={{ overflowX: "auto", background: "var(--bg-panel)", borderRadius: 6, border: "1px solid var(--border)", padding: 8 }}>
            <svg width={chartW} height={chartH} viewBox={`0 0 ${chartW} ${chartH}`}>
              {timelineBars}
            </svg>
          </div>
        </div>

        {/* Operation distribution */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>操作分布</div>
          <div style={{ background: "var(--bg-panel)", borderRadius: 6, border: "1px solid var(--border)", padding: 12 }}>
            {opBars}
          </div>
        </div>
      </div>
    );
  };

  // ------------------------------------------------------------------
  // Main render
  // ------------------------------------------------------------------

  if (loading) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 13 }}>
        加载中...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: 24, color: "var(--text-muted)" }}>
        <div style={{ fontSize: 13, color: "var(--status-error-foreground)" }}>加载失败</div>
        <div style={{ fontSize: 12 }}>{error}</div>
        <button
          onClick={fetchData}
          style={{
            marginTop: 8, padding: "4px 16px", fontSize: 12,
            background: "var(--bg-panel)", border: "1px solid var(--border)",
            borderRadius: 4, color: "var(--text)", cursor: "pointer",
          }}
        >
          重试
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 13 }}>
        无数据
      </div>
    );
  }

  const subTabContent: Record<SubTab, () => React.ReactNode> = {
    overview: renderOverview,
    status: renderStatus,
    plans: renderPlans,
    logs: renderLogs,
    sessions: renderSessions,
    charts: renderCharts,
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--bg)" }}>
      {/* Sub-tab bar */}
      <div style={{ display: "flex", alignItems: "center", flexShrink: 0, background: "var(--bg-panel)", borderBottom: "1px solid var(--border)", height: 32 }}>
        {SUB_TABS.map((tab) => {
          const isActive = tab.id === activeSubTab;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id)}
              style={{
                display: "flex", alignItems: "center",
                height: 32, padding: "0 14px",
                background: isActive ? "var(--bg)" : "transparent",
                border: "none",
                borderBottom: isActive ? "2px solid var(--accent)" : "2px solid transparent",
                color: isActive ? "var(--text)" : "var(--text-muted)",
                cursor: "pointer", fontSize: 12, whiteSpace: "nowrap",
                transition: "color 0.1s, background 0.1s",
              }}
            >
              {tab.label}
            </button>
          );
        })}
        <button
          onClick={fetchData}
          title="刷新"
          style={{
            marginLeft: "auto", marginRight: 4,
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 28, height: 28,
            background: "none", border: "none",
            color: "var(--text-dim)", cursor: "pointer",
            borderRadius: 4,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>
      </div>

      {/* Sub-tab content */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {subTabContent[activeSubTab]()}
      </div>
    </div>
  );
}