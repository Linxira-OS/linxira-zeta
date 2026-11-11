import { describe, expect, test } from "bun:test";
import type { SessionHistoryEntry, WorkspaceId, WorkspaceListReadModel } from "@linxiraos/studio-contract";

import { collectHistoryRecents } from "./emptyRecents";

const DEFAULT_ID = "ws-default" as WorkspaceId;
const ALPHA_ID = "ws-alpha" as WorkspaceId;

const inventory: WorkspaceListReadModel = {
  workspaces: [
    { workspaceId: DEFAULT_ID, name: "zeta", lastOpenedAt: null, active: true },
    { workspaceId: ALPHA_ID, name: "alpha", lastOpenedAt: "2026-01-01T00:00:00.000Z", active: false },
  ],
  defaultWorkspaceId: DEFAULT_ID,
  activeWorkspaceId: ALPHA_ID,
};

function entry(historyId: string, lastActiveAt: string, workspace?: { workspaceId?: WorkspaceId; workspaceName?: string }): SessionHistoryEntry {
  return {
    historyId,
    threadId: `thread-${historyId}`,
    environmentId: "env",
    startedAt: "2026-01-01T00:00:00.000Z",
    lastActiveAt,
    messageCount: 1,
    status: "active",
    ...workspace,
  } as unknown as SessionHistoryEntry;
}

describe("recent chat project labels", () => {
  test("each row names its own workspace and the default is localized", () => {
    const rows = collectHistoryRecents({
      entries: [
        entry("default", "2026-01-03T00:00:00.000Z", { workspaceId: DEFAULT_ID, workspaceName: "zeta" }),
        entry("alpha", "2026-01-02T00:00:00.000Z", { workspaceId: ALPHA_ID, workspaceName: "stale-basename" }),
        entry("legacy", "2026-01-01T00:00:00.000Z"),
      ],
      workspaces: inventory,
      lang: "en",
    });
    expect(rows.map(row => row.project)).toEqual(["Default workspace", "alpha", ""]);
  });

  test("a hidden workspace keeps the Host-provided name", () => {
    const rows = collectHistoryRecents({
      entries: [entry("alpha", "2026-01-02T00:00:00.000Z", { workspaceId: ALPHA_ID, workspaceName: "alpha" })],
      workspaces: {
        workspaces: [inventory.workspaces[0]!],
        defaultWorkspaceId: DEFAULT_ID,
      },
      lang: "en",
    });
    expect(rows[0]?.project).toBe("alpha");
  });

  test("IM-origin conversations never appear as personal recents", () => {
    const rows = collectHistoryRecents({
      entries: [
        { ...entry("im", "2026-01-04T00:00:00.000Z", { workspaceId: ALPHA_ID, workspaceName: "alpha" }), origin: { kind: "im", channel: "feishu" } },
        entry("personal", "2026-01-03T00:00:00.000Z", { workspaceId: ALPHA_ID, workspaceName: "alpha" }),
      ],
      workspaces: inventory,
      lang: "en",
    });
    expect(rows.map(row => row.id)).toEqual(["personal"]);
  });
});
