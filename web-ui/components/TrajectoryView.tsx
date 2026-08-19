"use client";

import { useMemo, useState } from "react";
import { deriveTrajectory, type TrajectoryCell as TrajectoryCellData } from "../lib/trajectory";
import type { AgentMessage } from "../lib/types";
import { TrajectoryCell } from "./TrajectoryCell";
import { TrajectoryInspector } from "./TrajectoryInspector";

interface Props {
  messages: AgentMessage[];
  /** Session entry ids, parallel to `messages` — used to fetch the raw entry for inspection. */
  entryIds?: string[];
  onLoadEntryJson?: (entryId: string) => Promise<unknown>;
}

interface Selection {
  cell: TrajectoryCellData;
  entryId?: string;
  raw?: unknown;
}

/**
 * Trajectory view — a table of turns (user prompt → assistant cells) with
 * token counts and durations. Clicking a step opens the raw-entry inspector.
 */
export function TrajectoryView({ messages, entryIds, onLoadEntryJson }: Props) {
  const turns = useMemo(() => deriveTrajectory(messages), [messages]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [loadingRaw, setLoadingRaw] = useState(false);

  const inspect = async (cell: TrajectoryCellData) => {
    const entryId = entryIds?.[cell.sourceMessageIndex];
    let raw: unknown = undefined;
    if (entryId && onLoadEntryJson) {
      setLoadingRaw(true);
      try {
        raw = await onLoadEntryJson(entryId);
      } catch {
        raw = { error: "entry not found" };
      } finally {
        setLoadingRaw(false);
      }
    }
    setSelection({ cell, entryId, raw });
  };

  const totalTokens = turns.reduce(
    (acc, turn) => ({
      input: acc.input + turn.totalTokens.input,
      output: acc.output + turn.totalTokens.output,
      cacheRead: acc.cacheRead + turn.totalTokens.cacheRead,
    }),
    { input: 0, output: 0, cacheRead: 0 },
  );

  return (
    <div style={{ display: "flex", height: "100%", minHeight: 0 }}>
      <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 8,
            fontSize: 12,
            color: "var(--text-muted)",
          }}
        >
          <span>
            {turns.length} turns
          </span>
          <span>
            in {totalTokens.input.toLocaleString()} / out {totalTokens.output.toLocaleString()}
            {totalTokens.cacheRead > 0 ? ` / cache ${totalTokens.cacheRead.toLocaleString()}` : ""}
          </span>
        </div>
        {turns.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--text-dim)", fontSize: 13 }}>
            No turns yet.
          </div>
        ) : (
          turns.map((turn, turnIndex) => (
            <div key={turnIndex} style={{ marginBottom: 16 }}>
              <div
                style={{
                  padding: "6px 10px",
                  borderRadius: 8,
                  background: "color-mix(in srgb, var(--accent) 8%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--accent) 25%, transparent)",
                  fontSize: 13,
                  color: "var(--text)",
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                }}
              >
                {turn.userText || "(empty prompt)"}
                {turn.durationMs !== null && turn.durationMs !== undefined && (
                  <span style={{ marginLeft: 8, color: "var(--text-dim)", fontSize: 11 }}>
                    {turn.durationMs}ms
                  </span>
                )}
              </div>
              <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 2 }}>
                {turn.cells.map((cell, cellIndex) => (
                  <TrajectoryCell
                    key={cellIndex}
                    cell={cell}
                    onClick={() => void inspect(cell)}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
      {selection && (
        <TrajectoryInspector
          entryJson={loadingRaw ? { loading: true } : selection.raw ?? selection.cell}
          derived={selection.cell}
          onClose={() => setSelection(null)}
        />
      )}
    </div>
  );
}
