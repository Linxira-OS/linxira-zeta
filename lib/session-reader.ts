import {
  SessionManager,
  buildContextEntries as piBuildContextEntries,
  buildSessionContext as piBuildSessionContext,
} from "@earendil-works/pi-coding-agent";
import { readFileSync } from "fs";
import { dirname } from "path";
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync, writeFileSync } from "fs";
import { join, normalize as normalizePath } from "path";
import type { AgentMessage, SessionEntry, SessionHeader, SessionInfo, SessionContext } from "./types";
import type { SessionEntry as PiSessionEntry, SessionInfo as PiSessionInfo } from "@earendil-works/pi-coding-agent";
import { normalizeToolCalls } from "./normalize";
import { sessionPathKey } from "./session-path";
import { resolveProject, type ProjectInfo } from "./worktree";

import { getOmpAgentDir } from "./file-paths";
export { getOmpAgentDir as getAgentDir };

async function loadAllSessions(): Promise<SessionInfo[]> {
  let piSessions: PiSessionInfo[] = [];
  try {
    piSessions = await SessionManager.listAll();
  } catch {
    // ignore
  }

  // Always scan getOmpAgentDir()/sessions for session files that SessionManager missed
  // (e.g. files where title entry or thinking_level_change is at line 1)
  const knownPaths = new Set(piSessions.map((s) => sessionPathKey(s.path)));
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
            piSessions.push({
              path: filePath,
              id: header.id,
              cwd: header.cwd || "",
              name: (header as unknown as Record<string, unknown>).name as string || (header as unknown as Record<string, unknown>).title as string,
              created: header.timestamp ? new Date(header.timestamp) : stat.birthtime,
              modified: stat.mtime,
              messageCount: 1,
              firstMessage: (header as unknown as Record<string, unknown>).title as string || "(session)",
              parentSessionPath: header.parentSession,
            } as unknown as PiSessionInfo);
            knownPaths.add(sessionPathKey(filePath));
          }
        }
      }
    } catch {
      // ignore error
    }
  }
  const pathToId = new Map<string, string>();
  for (const s of piSessions) pathToId.set(sessionPathKey(s.path), s.id);
  // Resolve each unique cwd to its project root (main repo shared by all
  // worktrees). resolveProject caches per-cwd, so this is cheap after warmup.
  const uniqueCwds = [...new Set(piSessions.map((s) => s.cwd).filter(Boolean))];
  const projectByCwd = new Map<string, ProjectInfo>();
  await Promise.all(uniqueCwds.map(async (cwd) => {
    projectByCwd.set(cwd, await resolveProject(cwd));
  }));

  return piSessions.map((s) => {
    cacheSessionPath(s.id, s.path);
    const project = s.cwd ? projectByCwd.get(s.cwd) : undefined;
    return {
      path: s.path,
      id: s.id,
      cwd: s.cwd,
      name: s.name,
      created: s.created instanceof Date ? s.created.toISOString() : String(s.created),
      modified: s.modified instanceof Date ? s.modified.toISOString() : String(s.modified),
      messageCount: s.messageCount,
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

export function readSessionHeader(filePath: string): SessionHeader | null {
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

type SessionManagerConstructor = new (
  cwd: string,
  dir: string,
  sessionFile: string,
  watch: boolean,
  options: unknown,
  fileEntries: unknown[]
) => SessionManager;

export function openSessionManager(filePath: string, sessionDir?: string, cwdOverride?: string): SessionManager {
  const entries = loadOmpSessionEntries(filePath);
  const header = entries.find((e) => hasSessionType(e)) as (SessionEntry & { cwd?: string }) | undefined;
  const cwd = cwdOverride ?? header?.cwd ?? process.cwd();
  const dir = sessionDir ? normalizePath(sessionDir) : dirname(filePath);
  const Ctor = SessionManager as unknown as SessionManagerConstructor;
  return new Ctor(cwd, dir, filePath, true, undefined, entries);
}
export function getSessionEntries(filePath: string): SessionEntry[] {
  const sm = openSessionManager(filePath);
  return sm.getEntries() as unknown as SessionEntry[];
}

export function buildSessionContext(
  entries: SessionEntry[],
  leafId?: string | null,
  options: { deferThinking?: boolean; deferToolResultImages?: boolean } = {},
): SessionContext {
  const byId = new Map<string, SessionEntry>();
  for (const e of entries) byId.set(e.id, e);

  const piEntries = entries as unknown as PiSessionEntry[];
  const piCtx = piBuildSessionContext(piEntries, leafId, byId as unknown as Map<string, PiSessionEntry>);

  const contextEntries = piBuildContextEntries(
    piEntries,
    leafId,
    byId as unknown as Map<string, PiSessionEntry>,
  );

  // Convert the SDK-selected context entries and their IDs together. This keeps
  // fork/navigation targets aligned while preserving pi's compaction ordering.
  const messages: AgentMessage[] = [];
  const entryIds: string[] = [];
  for (const entry of contextEntries) {
    const localEntry = entry as unknown as SessionEntry;
    const m = entryToUiMessage(localEntry, options);
    if (m) {
      messages.push(m);
      entryIds.push(localEntry.id);
    }
  }

  return {
    messages,
    entryIds,
    thinkingLevel: piCtx.thinkingLevel,
    model: piCtx.model,
  };
}

function parseEntryTimestamp(timestamp: string): number | undefined {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function base64ImageInfo(block: unknown): { bytes: number; mime?: string } | null {
  if (!isRecord(block) || block.type !== "image") return null;

  let data: string | undefined;
  let mime: string | undefined;
  if (typeof block.data === "string") {
    data = block.data;
    mime = typeof block.mimeType === "string" ? block.mimeType : undefined;
  } else if (isRecord(block.source) && block.source.type === "base64" && typeof block.source.data === "string") {
    data = block.source.data;
    mime = typeof block.source.media_type === "string" ? block.source.media_type : undefined;
  }
  if (!data) return null;

  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return { bytes: Math.max(0, Math.floor(data.length * 3 / 4) - padding), mime };
}

function omitToolResultBase64Images(message: AgentMessage): AgentMessage {
  if (message.role !== "toolResult") return message;

  let omitted = 0;
  let bytes = 0;
  const mimes = new Set<string>();
  const content = message.content.filter((block) => {
    const image = base64ImageInfo(block);
    if (!image) return true;
    omitted += 1;
    bytes += image.bytes;
    if (image.mime) mimes.add(image.mime);
    return false;
  });
  if (omitted === 0) return message;

  const mimeText = mimes.size > 0 ? `: ${[...mimes].join(", ")}` : "";
  content.push({
    type: "text",
    text: `[${omitted} tool result image${omitted === 1 ? "" : "s"} omitted from initial history payload${mimeText}, ~${bytes} bytes]`,
  });
  return { ...message, content };
}

// Convert a session entry on the active branch into a UI message.
// Returns null for entries that do not map to chat history (metadata, non-message types).
function entryToUiMessage(
  entry: SessionEntry,
  options: { deferThinking?: boolean; deferToolResultImages?: boolean },
): AgentMessage | null {
  // Supported message roles: user, assistant, toolResult, bashExecution.
  // bashExecution messages enter the case "message" branch (entry.type === "message").
  // The early return at line below ("!options.deferThinking || message.role !== "assistant"")
  // passes non-assistant messages — including bashExecution — through unchanged.
  // normalizeToolCalls is a secondary guard (returns non-assistant messages as-is).
  switch (entry.type) {
    case "message": {
      const message = options.deferToolResultImages
        ? omitToolResultBase64Images(normalizeToolCalls(entry.message))
        : normalizeToolCalls(entry.message);
      if (!options.deferThinking || message.role !== "assistant") return message;
      return {
        ...message,
        content: message.content.map((block) => (
          block.type === "thinking" && block.thinking.trim() !== ""
            ? { ...block, thinking: "", deferred: true }
            : block
        )),
      };
    }
    case "compaction":
      return {
        role: "custom",
        customType: "compaction",
        content: entry.summary,
        display: true,
        details: {
          tokensBefore: entry.tokensBefore,
          firstKeptEntryId: entry.firstKeptEntryId,
        },
        timestamp: parseEntryTimestamp(entry.timestamp),
      };
    case "branch_summary":
      if (!entry.summary) return null;
      return {
        role: "user",
        content: `*The conversation briefly explored another branch and returned with this summary:*\n\n${entry.summary}`,
        timestamp: parseEntryTimestamp(entry.timestamp),
      };
    case "custom_message":
      return {
        role: "custom",
        customType: entry.customType,
        content: entry.content,
        display: entry.display,
        details: entry.details,
        timestamp: parseEntryTimestamp(entry.timestamp),
      };
    default:
      return null;
  }
}
