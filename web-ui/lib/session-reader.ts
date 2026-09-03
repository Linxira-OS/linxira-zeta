import { readFileSync } from "fs";
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync, writeFileSync } from "fs";
import { join, normalize as normalizePath } from "path";
import type { SessionEntry, SessionHeader, SessionInfo } from "./types";
import { sessionPathKey } from "./session-path";
import { resolveProject, type ProjectInfo } from "./worktree";

import { getOmpAgentDir } from "./file-paths";
export { getOmpAgentDir as getAgentDir };

async function loadAllSessions(): Promise<SessionInfo[]> {
  // Session browsing is gateway-owned (see document/web-gateway.md); the web-ui
  // process scans session files directly so readonly lists work without loading
  // the Bun-only runtime package.
  const knownPaths = new Set<string>();
  const rawSessions: Array<{
    path: string;
    id: string;
    cwd: string;
    name?: string;
    created: string;
    modified: string;
    firstMessage?: string;
    parentSessionPath?: string;
  }> = [];
  const sessionsDir = join(getOmpAgentDir(), "sessions");
  if (existsSync(sessionsDir)) {
    try {
      const subdirs = readdirSync(sessionsDir);
      for (const sub of subdirs) {
        const dirPath = join(sessionsDir, sub);
        if (!statSync(dirPath).isDirectory()) continue;
        const files = readdirSync(dirPath).filter((f) => f.endsWith(".jsonl"));
        for (const file of files) {
          const filePath = join(dirPath, file);
          if (knownPaths.has(sessionPathKey(filePath))) continue;

          const header = readSessionHeader(filePath);
          if (header && header.id) {
            const stat = statSync(filePath);
            rawSessions.push({
              path: filePath,
              id: header.id,
              cwd: header.cwd || "",
              name: header.name || header.title,
              created: header.timestamp ? new Date(header.timestamp).toISOString() : stat.birthtime.toISOString(),
              modified: stat.mtime.toISOString(),
              firstMessage: header.title || "(session)",
              parentSessionPath: header.parentSession,
            });
            knownPaths.add(sessionPathKey(filePath));
          }
        }
      }
    } catch {
      // ignore error
    }
  }
  const pathToId = new Map<string, string>();
  for (const s of rawSessions) pathToId.set(sessionPathKey(s.path), s.id);
  // Resolve each unique cwd to its project root (main repo shared by all
  // worktrees). resolveProject caches per-cwd, so this is cheap after warmup.
  const uniqueCwds = [...new Set(rawSessions.map((s) => s.cwd).filter(Boolean))];
  const projectByCwd = new Map<string, ProjectInfo>();
  await Promise.all(uniqueCwds.map(async (cwd) => {
    projectByCwd.set(cwd, await resolveProject(cwd));
  }));

  return rawSessions.map((s) => {
    cacheSessionPath(s.id, s.path);
    const project = s.cwd ? projectByCwd.get(s.cwd) : undefined;
    return {
      path: s.path,
      id: s.id,
      cwd: s.cwd,
      name: s.name,
      created: s.created,
      modified: s.modified,
      messageCount: 1,
      firstMessage: s.firstMessage || "(no messages)",
      parentSessionId: s.parentSessionPath ? pathToId.get(sessionPathKey(s.parentSessionPath)) : undefined,
      projectRoot: project?.projectRoot ?? s.cwd,
      ...(project?.isWorktree && project.branch ? { worktreeBranch: project.branch } : {}),
    };
  });
}

export async function listAllSessions(): Promise<SessionInfo[]> {
  const generation = globalThis.__piSessionListGeneration ?? 0;

  // Return cached result if still fresh (avoids re-scanning session files
  // and re-spawning git processes on every page load).
  if (globalThis.__piSessionListCache && Date.now() - globalThis.__piSessionListCache.ts < SESSION_LIST_CACHE_TTL_MS) {
    return globalThis.__piSessionListCache.data;
  }

  // Coalescing dedup: concurrent callers share the same in-flight promise
  // only while it belongs to the current cache generation.
  if (globalThis.__piSessionListPromise && globalThis.__piSessionListPromiseGeneration === generation) {
    return globalThis.__piSessionListPromise;
  }

  const loadPromise = loadAllSessions().then((data) => {
    // An invalidation may happen while the scan is in flight. Do not let that
    // older result repopulate the cache after a session mutation.
    if ((globalThis.__piSessionListGeneration ?? 0) === generation) {
      globalThis.__piSessionListCache = { data, ts: Date.now() };
    }
    return data;
  });
  const trackedPromise = loadPromise.finally(() => {
    if (globalThis.__piSessionListPromise === trackedPromise) {
      globalThis.__piSessionListPromise = undefined;
      globalThis.__piSessionListPromiseGeneration = undefined;
    }
  });

  globalThis.__piSessionListPromise = trackedPromise;
  globalThis.__piSessionListPromiseGeneration = generation;
  return trackedPromise;
}

// ============================================================================
// Session path caches, stored in globalThis for hot-reload safety.
// ============================================================================
declare global {
  var __piSessionPathCache: Map<string, string> | undefined;
  var __piPathToSessionIdCache: Map<string, string> | undefined;
  var __piSessionListPromise: Promise<SessionInfo[]> | undefined;
  var __piSessionListPromiseGeneration: number | undefined;
  var __piSessionListGeneration: number | undefined;
  var __piSessionListCache: { data: SessionInfo[]; ts: number } | undefined;
}

const SESSION_LIST_CACHE_TTL_MS = 30_000;

export function invalidateSessionListCache(): void {
  globalThis.__piSessionListGeneration = (globalThis.__piSessionListGeneration ?? 0) + 1;
  globalThis.__piSessionListCache = undefined;
}

function getPathCache(): Map<string, string> {
  if (!globalThis.__piSessionPathCache) globalThis.__piSessionPathCache = new Map();
  return globalThis.__piSessionPathCache;
}

function getPathToIdCache(): Map<string, string> {
  if (!globalThis.__piPathToSessionIdCache) globalThis.__piPathToSessionIdCache = new Map();
  return globalThis.__piPathToSessionIdCache;
}

export async function resolveSessionPath(sessionId: string): Promise<string | null> {
  const cached = getPathCache().get(sessionId);
  if (cached) return cached;

  // Cache miss: scan all sessions to populate cache, then retry
  await listAllSessions();
  return getPathCache().get(sessionId) ?? null;
}

export async function resolveSessionIdByPath(filePath: string): Promise<string | undefined> {
  const pathKey = sessionPathKey(filePath);
  const cached = getPathToIdCache().get(pathKey);
  if (cached) return cached;

  await listAllSessions();
  return getPathToIdCache().get(pathKey);
}

export function cacheSessionPath(sessionId: string, filePath: string): void {
  const normalizedPath = normalizePath(filePath);
  const pathKey = sessionPathKey(normalizedPath);
  const pathCache = getPathCache();
  const reverseCache = getPathToIdCache();
  const previousPath = pathCache.get(sessionId);
  const previousPathKey = previousPath ? sessionPathKey(previousPath) : undefined;
  const previousSessionId = reverseCache.get(pathKey);
  const previousOwnerPath = previousSessionId ? pathCache.get(previousSessionId) : undefined;
  if (previousPathKey && previousPathKey !== pathKey && reverseCache.get(previousPathKey) === sessionId) {
    reverseCache.delete(previousPathKey);
  }
  if (
    previousSessionId &&
    previousSessionId !== sessionId &&
    previousOwnerPath &&
    sessionPathKey(previousOwnerPath) === pathKey
  ) {
    pathCache.delete(previousSessionId);
  }
  pathCache.set(sessionId, normalizedPath);
  reverseCache.set(pathKey, sessionId);
}

export function invalidateSessionPathCache(sessionId: string): void {
  const pathCache = getPathCache();
  const reverseCache = getPathToIdCache();
  const filePath = pathCache.get(sessionId);
  pathCache.delete(sessionId);
  const pathKey = filePath ? sessionPathKey(filePath) : undefined;
  if (pathKey && reverseCache.get(pathKey) === sessionId) {
    reverseCache.delete(pathKey);
  }
}

export function readSessionHeader(filePath: string): (SessionHeader & { name?: string; title?: string }) | null {
  let fd: number;
  try {
    fd = openSync(filePath, "r");
  } catch {
    return null;
  }
  try {
    const buffer = Buffer.allocUnsafe(64 * 1024);
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    if (bytesRead === 0) return null;
    const text = buffer.subarray(0, bytesRead).toString("utf8");
    const lines = text.split("\n");
    let sessionHeader: (SessionHeader & { name?: string; title?: string }) | null = null;
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line.trim()) as Record<string, unknown>;
        if (entry && entry.type === "session" && !sessionHeader) {
          sessionHeader = entry as unknown as SessionHeader;
        } else if (entry && entry.type === "session_info" && typeof entry.name === "string" && entry.name.trim()) {
          if (sessionHeader) {
            sessionHeader.name = entry.name.trim();
            sessionHeader.title = entry.name.trim();
          }
        }
      } catch {
        // continue scanning
      }
    }
    return sessionHeader;
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

function hasSessionType(entry: unknown): boolean {
  return Boolean(entry && typeof entry === "object" && (entry as { type?: unknown }).type === "session");
}

export function loadOmpSessionEntries(filePath: string): SessionEntry[] {
  if (!existsSync(filePath)) return [];
  try {
    const content = readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    const entries: SessionEntry[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line.trim()) as SessionEntry);
      } catch {
        // ignore invalid lines
      }
    }
    const sessionIdx = entries.findIndex((e) => hasSessionType(e));
    if (sessionIdx > 0) {
      const [sessionHeader] = entries.splice(sessionIdx, 1);
      entries.unshift(sessionHeader);
      try {
        const fixedContent = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
        writeFileSync(filePath, fixedContent, "utf8");
      } catch {
        // ignore write error
      }
    }
    return entries;
  } catch {
    return [];
  }
}

export function getSessionEntries(filePath: string): SessionEntry[] {
  return loadOmpSessionEntries(filePath);
}