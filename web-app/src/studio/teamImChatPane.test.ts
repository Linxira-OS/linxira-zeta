/**
 * IM chat list consumer state. Real history rows only: the number is derived
 * from the current list, older than three days is excluded, and a missing
 * latest-task summary stays empty instead of borrowing the first user message.
 */
import { describe, expect, test } from "bun:test";
import type { SessionHistoryEntry } from "@linxiraos/studio-contract";
import { buildRecentImRows } from "./teamImChatModel";

const NOW = Date.parse("2026-11-12T12:00:00.000Z");

function row(
  id: string,
  minutesAgo: number,
  origin: SessionHistoryEntry["origin"],
  overrides: Partial<SessionHistoryEntry> = {},
): SessionHistoryEntry {
  const at = new Date(NOW - minutesAgo * 60_000).toISOString();
  return {
    historyId: `history-${id}` as never,
    threadId: `thread-${id}` as never,
    environmentId: "env" as never,
    sessionId: `session-${id}` as never,
    title: `Chat ${id}`,
    startedAt: at,
    lastActiveAt: at,
    messageCount: 1,
    status: "active",
    origin,
    ...overrides,
  };
}

describe("IM chat list", () => {
  test("derives workspace/session numbers from the current list, not a stored id", () => {
    const rows = buildRecentImRows(
      [
        row("a", 10, { kind: "im", channel: "feishu", workspaceAlias: "core" }),
        row("b", 20, { kind: "im", channel: "feishu", workspaceAlias: "core" }),
        row("c", 30, { kind: "im", channel: "wechat", workspaceAlias: "ops" }),
      ],
      NOW,
    );
    expect(rows.map(item => item.number)).toEqual(["01-00001", "01-00002", "02-00001"]);
    expect(rows.every(item => !item.number.includes("session-"))).toBe(true);
  });

  test("keeps only IM-origin sessions from the last three days", () => {
    const rows = buildRecentImRows(
      [
        row("fresh", 60, { kind: "im", channel: "feishu" }),
        row("old", 4 * 24 * 60, { kind: "im", channel: "feishu" }),
        row("team", 10, { kind: "team", teamId: "acme" }),
        row("personal", 10, undefined),
      ],
      NOW,
    );
    expect(rows.map(item => item.entry.historyId)).toEqual(["history-fresh"]);
  });

  test("missing latest-task summary stays unknown, never the first user message", () => {
    const rows = buildRecentImRows(
      [row("a", 5, { kind: "im", channel: "feishu", workspaceAlias: "core" })],
      NOW,
    );
    expect(rows[0]?.summary).toBe("");
    expect(rows[0]?.status).toBe("in-progress");
    expect(rows[0]?.label).toBe("Chat a");
  });

  test("an archived row is marked archived", () => {
    const rows = buildRecentImRows(
      [row("a", 5, { kind: "im", channel: "feishu" }, { status: "archived" })],
      NOW,
    );
    expect(rows[0]?.status).toBe("archived");
  });
});
