import type { SessionInfo } from "./types";

/**
 * Session API client — single home for every session-list mutation the UI
 * performs over the gateway. Callers refresh their lists via the callbacks
 * they already own; nothing here caches.
 */

async function parseOk<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) throw new Error(`${fallback}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function fetchSessions(): Promise<{
  sessions: SessionInfo[];
  runningSessionIds?: string[];
}> {
  const res = await fetch("/api/sessions");
  return parseOk(res, "list sessions");
}

export async function fetchArchivedSessions(): Promise<SessionInfo[]> {
  const res = await fetch("/api/sessions/archived");
  const data = await parseOk<{ sessions?: SessionInfo[] }>(res, "list archived");
  return data.sessions ?? [];
}

export async function renameSession(id: string, name: string): Promise<void> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`rename session: HTTP ${res.status}`);
}

export async function deleteSession(id: string): Promise<void> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`delete session: HTTP ${res.status}`);
}

/** Delete several sessions; failures reject with the first error. */
export async function deleteSessions(ids: readonly string[]): Promise<void> {
  // Small overlap: sequential keeps gateway artifact cleanup ordered and the
  // UI progress honest; typical multi-select counts are small.
  for (const id of ids) {
    await deleteSession(id);
  }
}

/**
 * Delete every session under `projectRoot` (gateway prefix match — includes
 * sessions of its worktrees). Backend capability: handleDeleteProject.
 */
export async function deleteProjectSessions(
  projectRoot: string,
): Promise<void> {
  const res = await fetch("/api/projects", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: projectRoot }),
  });
  if (!res.ok) throw new Error(`delete project sessions: HTTP ${res.status}`);
}

export async function archiveSession(id: string): Promise<void> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(id)}/archive`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`archive session: HTTP ${res.status}`);
}

export async function unarchiveSession(id: string): Promise<void> {
  const res = await fetch(
    `/api/sessions/${encodeURIComponent(id)}/unarchive`,
    { method: "POST" },
  );
  if (!res.ok) throw new Error(`unarchive session: HTTP ${res.status}`);
}
