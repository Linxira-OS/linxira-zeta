import type { SessionHistoryEntry, WorkspaceId, WorkspaceListReadModel } from "@linxiraos/studio-contract";

export type WorkspaceSelection = { readonly id: string; readonly name: string };

/** Resolve the viewed session first, retaining hidden/temporarily absent identities. */
export function reconcileWorkspaceSelection(
  current: WorkspaceSelection | null,
  inventory: WorkspaceListReadModel | undefined,
  viewed?: Pick<SessionHistoryEntry, "workspaceId" | "workspaceName">,
): WorkspaceSelection | null {
  const id = viewed?.workspaceId ?? current?.id ?? inventory?.defaultWorkspaceId ?? inventory?.activeWorkspaceId;
  if (id === undefined) return null;
  const row = inventory?.workspaces.find(workspace => workspace.workspaceId === id);
  const name = row?.name ?? viewed?.workspaceName ?? (current?.id === id ? current.name : undefined);
  if (name === undefined) return null;
  return current?.id === id && current.name === name ? current : { id, name };
}

export function workspaceLabel(
  workspace: WorkspaceSelection | null | undefined,
  inventory: WorkspaceListReadModel | undefined,
  defaultLabel: string,
): string | undefined {
  if (!workspace) return undefined;
  return workspace.id === (inventory?.defaultWorkspaceId ?? inventory?.activeWorkspaceId) ? defaultLabel : workspace.name;
}

/** A cold history row never borrows another project's current selection. */
export function historyWorkspaceId(
  entry: SessionHistoryEntry,
  residentWorkspaceId?: WorkspaceId,
  explicitWorkspaceId?: WorkspaceId,
): WorkspaceId | undefined {
  return residentWorkspaceId ?? entry.workspaceId ?? explicitWorkspaceId;
}
