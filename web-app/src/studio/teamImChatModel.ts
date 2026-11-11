/**
 * IM chat list projection over canonical history rows. The visible number is
 * derived from the current list (workspace 2 digits, session 5 digits); it is
 * never persisted as a short id. Only IM-origin sessions from the last three
 * days are eligible. A missing latest-task summary stays empty.
 */
import type { SessionHistoryEntry } from "@linxiraos/studio-contract";

export const IM_RECENT_MS = 3 * 24 * 60 * 60 * 1000;

export interface RecentImRow {
  readonly entry: SessionHistoryEntry;
  readonly number: string;
  readonly label: string;
  readonly summary: string;
  readonly status: "in-progress" | "idle" | "archived";
  readonly channel?: string;
  readonly workspaceAlias?: string;
}

export function buildRecentImRows(entries: readonly SessionHistoryEntry[], now: number): RecentImRow[] {
  const recent = entries
    .filter(entry => entry.origin?.kind === "im")
    .filter(entry => {
      const at = Date.parse(entry.lastActiveAt);
      return Number.isFinite(at) && now - at <= IM_RECENT_MS;
    })
    .sort((left, right) => Date.parse(right.lastActiveAt) - Date.parse(left.lastActiveAt));

  const groups = new Map<string, SessionHistoryEntry[]>();
  for (const entry of recent) {
    const origin = entry.origin;
    const key =
      origin?.kind === "im"
        ? (origin.workspaceAlias ?? origin.botSessionId ?? origin.channel ?? "default")
        : "default";
    const rows = groups.get(key) ?? [];
    rows.push(entry);
    groups.set(key, rows);
  }

  const rows: RecentImRow[] = [];
  let workspaceIndex = 0;
  for (const [key, group] of groups) {
    workspaceIndex += 1;
    let sessionIndex = 0;
    for (const entry of group) {
      sessionIndex += 1;
      const origin = entry.origin?.kind === "im" ? entry.origin : undefined;
      rows.push({
        entry,
        number: `${String(workspaceIndex).padStart(2, "0")}-${String(sessionIndex).padStart(5, "0")}`,
        label: entry.title?.trim() || origin?.workspaceAlias || origin?.channel || key,
        summary: entry.summary?.trim() || "",
        status:
          entry.status === "archived"
            ? "archived"
            : entry.status === "active"
              ? "in-progress"
              : "idle",
        ...(origin?.channel ? { channel: origin.channel } : {}),
        ...(origin?.workspaceAlias ? { workspaceAlias: origin.workspaceAlias } : {}),
      });
    }
  }
  return rows;
}
