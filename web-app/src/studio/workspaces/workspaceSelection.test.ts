import { describe, expect, test } from "bun:test";
import type { WorkspaceId, WorkspaceListReadModel } from "@linxiraos/studio-contract";

import { historyWorkspaceId, reconcileWorkspaceSelection, workspaceLabel } from "./workspaceSelection";

const DEFAULT_ID = "ws-default" as WorkspaceId;
const ALPHA_ID = "ws-alpha" as WorkspaceId;

const inventory: WorkspaceListReadModel = {
  workspaces: [
    { workspaceId: DEFAULT_ID, name: "zeta", lastOpenedAt: null, active: true },
    { workspaceId: ALPHA_ID, name: "alpha", lastOpenedAt: "2026-01-01T00:00:00.000Z", active: false },
  ],
  defaultWorkspaceId: DEFAULT_ID,
  // `active` may name a different row than the default; neither replaces a view.
  activeWorkspaceId: ALPHA_ID,
};

describe("workspace selection reconciliation", () => {
  test("an explicit project survives an inventory refresh and adopts a renamed row", () => {
    const renamed: WorkspaceListReadModel = {
      ...inventory,
      workspaces: inventory.workspaces.map(workspace =>
        workspace.workspaceId === ALPHA_ID ? { ...workspace, name: "alpha-renamed" } : workspace,
      ),
    };
    const selected = { id: ALPHA_ID, name: "alpha" };
    expect(reconcileWorkspaceSelection(selected, renamed)).toEqual({ id: ALPHA_ID, name: "alpha-renamed" });
    expect(reconcileWorkspaceSelection(selected, inventory)).toBe(selected);
  });

  test("a viewed session wins over the current selection and the default", () => {
    expect(reconcileWorkspaceSelection({ id: DEFAULT_ID, name: "zeta" }, inventory, {
      workspaceId: ALPHA_ID,
      workspaceName: "stale-basename",
    })).toEqual({ id: ALPHA_ID, name: "alpha" });
  });

  test("a hidden viewed workspace keeps the identity the Host reported", () => {
    const visibleOnly: WorkspaceListReadModel = {
      workspaces: inventory.workspaces.filter(workspace => workspace.workspaceId !== ALPHA_ID),
      defaultWorkspaceId: DEFAULT_ID,
    };
    expect(reconcileWorkspaceSelection(null, visibleOnly, {
      workspaceId: ALPHA_ID,
      workspaceName: "alpha",
    })).toEqual({ id: ALPHA_ID, name: "alpha" });
  });

  test("an unknown viewed id without a name never falls back to the current project", () => {
    expect(reconcileWorkspaceSelection({ id: DEFAULT_ID, name: "zeta" }, inventory, {
      workspaceId: "ws-unknown" as WorkspaceId,
    })).toBeNull();
  });

  test("no viewed or explicit selection starts at the default, not the active row", () => {
    expect(reconcileWorkspaceSelection(null, inventory)).toEqual({ id: DEFAULT_ID, name: "zeta" });
  });

  test("labels the default workspace locally without renaming other rows", () => {
    expect(workspaceLabel({ id: DEFAULT_ID, name: "zeta" }, inventory, "Default workspace")).toBe("Default workspace");
    expect(workspaceLabel({ id: ALPHA_ID, name: "alpha" }, inventory, "Default workspace")).toBe("alpha");
    expect(workspaceLabel(null, inventory, "Default workspace")).toBeUndefined();
  });
});

describe("history workspace ownership", () => {
  test("resident identity, then the entry's own workspace, then an explicit workspace", () => {
    expect(historyWorkspaceId({ workspaceId: ALPHA_ID } as never, DEFAULT_ID, "ws-explicit" as WorkspaceId)).toBe(DEFAULT_ID);
    expect(historyWorkspaceId({ workspaceId: ALPHA_ID } as never, undefined, "ws-explicit" as WorkspaceId)).toBe(ALPHA_ID);
    expect(historyWorkspaceId({} as never, undefined, "ws-explicit" as WorkspaceId)).toBe("ws-explicit");
    expect(historyWorkspaceId({} as never)).toBeUndefined();
  });
});
