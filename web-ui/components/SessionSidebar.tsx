"use client";

// `node:`-prefixed specifiers are not resolvable in the client bundle — the
// project's own helper covers POSIX and Windows paths without a Node import.
import { getFileName } from "@/lib/file-paths";

import {
  useEffect,
  useLayoutEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { SessionInfo } from "@/lib/types";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { DirectoryPicker } from "./DirectoryPicker";
import { FileExplorer, type FileExplorerHandle } from "./FileExplorer";
import { StarfieldEmblem } from "./StarfieldEmblem";
import { FolderPickerModal } from "./FolderPickerModal";
import { useTheme } from "@/hooks/useTheme";
import { useI18n } from "@/hooks/useI18n";
import "@/lib/pi-desktop";

interface Props {
  selectedSessionId: string | null;
  onSelectSession: (session: SessionInfo, isRestore?: boolean) => void;
  onNewSession?: (sessionId: string, cwd: string) => void;
  initialSessionId?: string | null;
  skipInitialProjectSelection?: boolean;
  onInitialRestoreDone?: () => void;
  refreshKey?: number;
  onSessionDeleted?: (sessionId: string) => void;
  selectedCwd?: string | null;
  onCwdChange?: (cwd: string | null, projectRoot?: string | null) => void;
  onOpenFile?: (filePath: string, fileName: string) => void;
  explorerRefreshKey?: number;
  onExplorerRefresh?: () => void;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  onAtMentions?: (relativePaths: string[]) => void;
}

interface WorktreeEntry {
  path: string;
  branch: string | null;
  isMain: boolean;
}

interface WorktreeState {
  /** The cwd this data was fetched for — guards against stale responses */
  forCwd: string;
  projectRoot: string;
  isGit: boolean;
  /** False when forCwd is a repo subdirectory — the switcher is hidden there
   *  because subdir sessions keep their own project identity */
  isTopLevel: boolean;
  worktrees: WorktreeEntry[];
}

const UNREAD_SESSIONS_STORAGE_KEY = "zeta-web:unread-session-ids";
const SIDEBAR_COLLAPSED_PROJECTS_KEY = "zeta-web:sidebar-collapsed-projects";
const SIDEBAR_DISPLAY_KEY = "zeta-web:sidebar-display";

type ProjectSort = "manual" | "a-z" | "z-a" | "date-added" | "recent";
interface SidebarDisplaySettings {
  projectSort: ProjectSort;
  sessionGrouping: "by-worktree" | "flat";
  showRecent: boolean;
}

const DEFAULT_DISPLAY: SidebarDisplaySettings = {
  projectSort: "manual",
  sessionGrouping: "by-worktree",
  showRecent: true,
};

function loadCollapsedProjects(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(SIDEBAR_COLLAPSED_PROJECTS_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function loadDisplaySettings(): SidebarDisplaySettings {
  if (typeof window === "undefined") return DEFAULT_DISPLAY;
  try {
    const raw = window.localStorage.getItem(SIDEBAR_DISPLAY_KEY);
    if (!raw) return DEFAULT_DISPLAY;
    const parsed = JSON.parse(raw) as Partial<SidebarDisplaySettings>;
    const validSorts: ProjectSort[] = ["manual", "a-z", "z-a", "date-added", "recent"];
    return {
      projectSort: validSorts.includes(parsed.projectSort as ProjectSort)
        ? (parsed.projectSort as ProjectSort)
        : DEFAULT_DISPLAY.projectSort,
      sessionGrouping:
        parsed.sessionGrouping === "flat" ? "flat" : DEFAULT_DISPLAY.sessionGrouping,
      showRecent: parsed.showRecent ?? DEFAULT_DISPLAY.showRecent,
    };
  } catch {
    return DEFAULT_DISPLAY;
 }
}

function loadUnreadSessionIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(UNREAD_SESSIONS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed))
      return new Set(
        parsed.filter((id): id is string => typeof id === "string"),
      );
    return new Set();
  } catch {
    return new Set();
  }
}

function saveUnreadSessionIds(ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    if (ids.size === 0)
      window.localStorage.removeItem(UNREAD_SESSIONS_STORAGE_KEY);
    else
      window.localStorage.setItem(
        UNREAD_SESSIONS_STORAGE_KEY,
        JSON.stringify([...ids]),
      );
  } catch {
    // ignore storage quota / privacy-mode errors
  }
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

/**
 * Return all projects (deduped by projectRoot so worktrees collapse into their
 * main repo) sorted by most recent session activity.
 */
function getRecentProjects(sessions: SessionInfo[]): string[] {
  const latestByRoot = new Map<string, string>(); // projectRoot -> most recent modified
  for (const s of sessions) {
    const root = s.projectRoot ?? s.cwd;
    if (!root) continue;
    const prev = latestByRoot.get(root);
    if (!prev || s.modified > prev) {
      latestByRoot.set(root, s.modified);
    }
  }
  return [...latestByRoot.entries()]
    .sort((a, b) => b[1].localeCompare(a[1]))
    .map(([root]) => root);
}

/** Substitute the home dir prefix with ~ (no path truncation — see PathLabel) */
function displayCwd(cwd: string, homeDir?: string): string {
  return homeDir && cwd.startsWith(homeDir)
    ? "~" + cwd.slice(homeDir.length)
    : cwd;
}

/**
 * Path label that ellipsizes on the LEFT, keeping the (most relevant) trailing
 * segments visible: "…orkspace/pi-web". Shows as much of the path as fits
 * instead of a fixed number of segments. The rtl container moves the ellipsis
 * to the left edge; the inner plaintext bidi isolation keeps the path itself
 * rendered strictly left-to-right (no punctuation reordering).
 */
function PathLabel({ text, style }: { text: string; style?: CSSProperties }) {
  return (
    <span
      style={{
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        display: "block",
        minWidth: 0,
        lineHeight: 1.35,
        direction: "rtl",
        textAlign: "left",
        ...style,
      }}
    >
      <span style={{ unicodeBidi: "plaintext" }}>{text}</span>
    </span>
  );
}

const DROPDOWN_ANIMATION_MS = 140;

function AnimatedDropdown({
  open,
  children,
  style,
}: {
  open: boolean;
  children: ReactNode;
  style: CSSProperties;
}) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(open);

  useEffect(() => {
    let frame: number | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    if (open) {
      setMounted(true);
      setVisible(false);
      frame = window.requestAnimationFrame(() => {
        frame = window.requestAnimationFrame(() => setVisible(true));
      });
    } else {
      setVisible(false);
      timeout = setTimeout(() => setMounted(false), DROPDOWN_ANIMATION_MS);
    }

    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      if (timeout) clearTimeout(timeout);
    };
  }, [open]);

  if (!mounted) return null;

  return (
    <div
      style={{
        ...style,
        opacity: visible ? 1 : 0,
        transform: visible
          ? "translateY(0) scale(1)"
          : "translateY(-8px) scale(0.96)",
        transformOrigin: "top center",
        transition: `opacity ${DROPDOWN_ANIMATION_MS}ms ease, transform ${DROPDOWN_ANIMATION_MS}ms ease`,
        pointerEvents: open ? "auto" : "none",
      }}
    >
      {children}
    </div>
  );
}

interface SessionTreeNode {
  session: SessionInfo;
  children: SessionTreeNode[];
}

function buildSessionTree(sessions: SessionInfo[]): SessionTreeNode[] {
  const byId = new Map<string, SessionTreeNode>();
  for (const s of sessions) {
    byId.set(s.id, { session: s, children: [] });
  }

  // Build a map of parentSessionId chains so we can resolve missing ancestors
  const parentOf = new Map<string, string>();
  for (const s of sessions) {
    if (s.parentSessionId) parentOf.set(s.id, s.parentSessionId);
  }

  // Walk up the parentSessionId chain to find the nearest ancestor that exists in byId
  function resolveAncestor(id: string): string | null {
    let cur = parentOf.get(id);
    const visited = new Set<string>();
    while (cur) {
      if (visited.has(cur)) return null; // cycle guard
      visited.add(cur);
      if (byId.has(cur)) return cur;
      cur = parentOf.get(cur);
    }
    return null;
  }

  const roots: SessionTreeNode[] = [];
  for (const node of byId.values()) {
    const ancestor = resolveAncestor(node.session.id);
    if (ancestor) {
      byId.get(ancestor)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Sort each level by modified desc
  const sort = (nodes: SessionTreeNode[]) => {
    nodes.sort((a, b) => b.session.modified.localeCompare(a.session.modified));
    nodes.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

const SCRAMBLE_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";

function useScramble(target: string, running: boolean): string {
  const [display, setDisplay] = useState(target);
  const frameRef = useRef<number | null>(null);
  const iterRef = useRef(0);

  useEffect(() => {
    if (!running) {
      setDisplay(target);
      return;
    }
    iterRef.current = 0;
    const totalFrames = target.length * 4;

    const step = () => {
      iterRef.current += 1;
      const progress = iterRef.current / totalFrames;
      const resolved = Math.floor(progress * target.length);

      setDisplay(
        target
          .split("")
          .map((char, i) => {
            if (char === " ") return " ";
            if (i < resolved) return char;
            return SCRAMBLE_CHARS[
              Math.floor(Math.random() * SCRAMBLE_CHARS.length)
            ];
          })
          .join(""),
      );

      if (iterRef.current < totalFrames) {
        frameRef.current = requestAnimationFrame(step);
      } else {
        setDisplay(target);
      }
    };

    frameRef.current = requestAnimationFrame(step);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [target, running]);

  return display;
}

function ZetaWebTitle() {
  const [showVersion, setShowVersion] = useState(false);
  const [scrambling, setScrambling] = useState(false);
  const revertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const target = showVersion
    ? `v${process.env.NEXT_PUBLIC_APP_VERSION ?? process.env.NEXT_PUBLIC_OMP_VERSION ?? process.env.NEXT_PUBLIC_PI_VERSION ?? "0.0.0"}`
    : "Zeta Web";
  const display = useScramble(target, scrambling);

  const triggerScramble = useCallback((toVersion: boolean) => {
    setShowVersion(toVersion);
    setScrambling(true);
    setTimeout(
      () => setScrambling(false),
      (toVersion ? 6 : 8) * 4 * (1000 / 60) + 100,
    );
  }, []);

  const handleClick = useCallback(() => {
    if (revertTimerRef.current) clearTimeout(revertTimerRef.current);

    const next = !showVersion;
    triggerScramble(next);

    if (next) {
      revertTimerRef.current = setTimeout(() => triggerScramble(false), 3000);
    }
  }, [showVersion, triggerScramble]);

  useEffect(
    () => () => {
      if (revertTimerRef.current) clearTimeout(revertTimerRef.current);
    },
    [],
  );

  const { isStarfield } = useTheme();

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
      {isStarfield && <StarfieldEmblem size={20} />}
      <button
        onClick={handleClick}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          cursor: "default",
          fontWeight: 800,
          fontSize: isStarfield ? 14 : 15,
          letterSpacing: isStarfield ? "0.12em" : "-0.01em",
          color: showVersion ? "var(--accent)" : "var(--text)",
          fontFamily: isStarfield
            ? "var(--font-display, 'Orbitron', sans-serif)"
            : "var(--font-mono)",
          minWidth: "6ch",
          textTransform: isStarfield ? "uppercase" : "none",
        }}
      >
        {display}
      </button>
    </div>
  );
}

export function SessionSidebar({
  selectedSessionId,
  onSelectSession,
  onNewSession,
  initialSessionId,
  skipInitialProjectSelection,
  onInitialRestoreDone,
  refreshKey,
  onSessionDeleted,
  selectedCwd: selectedCwdProp,
  onCwdChange,
  onOpenFile,
  explorerRefreshKey,
  onExplorerRefresh,
  onAtMention,
  onAtMentions,
}: Props) {
  const { t } = useI18n();
  const [allSessions, setAllSessions] = useState<SessionInfo[]>([]);
  const [showBotSessions, setShowBotSessions] = useState(false);
  const [sessionSearch, setSessionSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(
    () => loadCollapsedProjects(),
  );
  const [display, setDisplay] = useState<SidebarDisplaySettings>(
    () => loadDisplaySettings(),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCwd, setSelectedCwd] = useState<string | null>(null);
  const [homeDir, setHomeDir] = useState<string>("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [projectFilter, setProjectFilter] = useState("");
  const [folderPickerModalOpen, setFolderPickerModalOpen] = useState(false);
  const [customPathOpen, setCustomPathOpen] = useState(false);
  const [customPathValue, setCustomPathValue] = useState("");
  const [customPathError, setCustomPathError] = useState<string | null>(null);
  const [customPathValidating, setCustomPathValidating] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  // Worktree switcher state
  const [worktreeState, setWorktreeState] = useState<WorktreeState | null>(
    null,
  );
  const [wtDropdownOpen, setWtDropdownOpen] = useState(false);
  const [wtNewOpen, setWtNewOpen] = useState(false);
  const [wtNewBranch, setWtNewBranch] = useState("");
  const [wtError, setWtError] = useState<string | null>(null);
  const [wtBusy, setWtBusy] = useState(false);
  const [wtConfirmRemove, setWtConfirmRemove] = useState<string | null>(null);
  const [worktreeLoadingCwd, setWorktreeLoadingCwd] = useState<string | null>(
    null,
  );
  const wtDropdownRef = useRef<HTMLDivElement>(null);
  const wtNewInputRef = useRef<HTMLInputElement>(null);
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [explorerKey, setExplorerKey] = useState(0);
  const [explorerUploadBusy, setExplorerUploadBusy] = useState(false);
  const [explorerRefreshDone, setExplorerRefreshDone] = useState(false);
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [unreadSessionIds, setUnreadSessionIds] = useState<Set<string>>(() =>
    loadUnreadSessionIds(),
  );
  const previousRunningSessionIdsRef = useRef<Set<string>>(new Set());
  // Once the SSE stream has delivered a frame it is the source of truth for
  // running state; late /api/sessions responses must not overwrite it.
  const sseAuthoritativeRef = useRef(false);
  const explorerRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const fileExplorerRef = useRef<FileExplorerHandle>(null);

  const loadSessions = useCallback(async (showLoading = false) => {
    try {
      if (showLoading) setLoading(true);
      const res = await fetch("/api/sessions");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        sessions: SessionInfo[];
        runningSessionIds?: string[];
      };
      setAllSessions(data.sessions);
      // Treat the fetched running set as an initial fallback only. Once SSE is
      // live it owns this state, so a slow fetch can't revive a stale snapshot.
      if (!sseAuthoritativeRef.current) {
        setRunningSessionIds(new Set(data.runningSessionIds ?? []));
      }
      // Drop unread markers for sessions that no longer exist (e.g. deleted).
      const existingIds = new Set(data.sessions.map((s) => s.id));
      setUnreadSessionIds((prev) => {
        if (prev.size === 0) return prev;
        const next = new Set([...prev].filter((id) => existingIds.has(id)));
        return next.size === prev.size ? prev : next;
      });
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  const initialLoadDone = useRef(false);
  useEffect(() => {
    const isFirst = !initialLoadDone.current;
    initialLoadDone.current = true;
    loadSessions(isFirst);
    // Whether the sidebar shows relay/bot default-space sessions (web.yml
    // `remote.showBotSessions`; default false = hidden).
    fetch("/api/web-config")
      .then((res) => (res.ok ? res.json() : null))
      .then((config) => {
        if (config?.remote?.showBotSessions === true) setShowBotSessions(true);
      })
      .catch(() => {});
  }, [loadSessions, refreshKey]);

  // Persist unread markers so they survive a browser refresh before the user
  // has actually opened the completed session.
  useEffect(() => {
    saveUnreadSessionIds(unreadSessionIds);
  }, [unreadSessionIds]);

  useEffect(() => {
    // Live running status via SSE — no polling. The server pushes the current
    // set of running session ids whenever any session starts/stops working.
    const source = new EventSource("/api/agent/running/events");

    source.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as {
          type?: string;
          runningSessionIds?: string[];
        };
        if (data.type === "running") {
          sseAuthoritativeRef.current = true;
          setRunningSessionIds(new Set(data.runningSessionIds ?? []));
        }
      } catch {
        // ignore malformed frames
      }
    };

    // On error EventSource auto-reconnects; keep the last known state meanwhile.
    return () => source.close();
  }, []);

  useEffect(() => {
    const previous = previousRunningSessionIdsRef.current;
    const completedInBackground = [...previous].filter(
      (id) => !runningSessionIds.has(id) && id !== selectedSessionId,
    );
    const newlyRunning = [...runningSessionIds];

    if (completedInBackground.length > 0 || newlyRunning.length > 0) {
      setUnreadSessionIds((prev) => {
        const next = new Set(prev);
        newlyRunning.forEach((id) => next.delete(id));
        completedInBackground.forEach((id) => next.add(id));
        return next;
      });
    }
    // Refresh the session list whenever the running set changes: new sessions
    // become visible without a manual refresh, including the just-selected one
    // (previously excluded here, which left brand-new sessions invisible).
    if (completedInBackground.length > 0 || newlyRunning.length > 0) {
      loadSessions(false);
    }

    previousRunningSessionIdsRef.current = runningSessionIds;
  }, [runningSessionIds, selectedSessionId, loadSessions]);

  useEffect(() => {
    if (!selectedSessionId) return;
    setUnreadSessionIds((prev) => {
      if (!prev.has(selectedSessionId)) return prev;
      const next = new Set(prev);
      next.delete(selectedSessionId);
      return next;
    });
  }, [selectedSessionId]);

  useEffect(() => {
    if (explorerRefreshKey !== undefined) setExplorerKey((k) => k + 1);
  }, [explorerRefreshKey]);

  useEffect(() => {
    fetch("/api/home")
      .then((r) => r.json())
      .then((d: { home?: string }) => {
        if (d.home) setHomeDir(d.home);
      })
      .catch(() => {});
  }, []);

  const restoredRef = useRef(false);

  /** Resolve the project root for a cwd from the freshest data available */
  const projectRootFor = useCallback(
    (cwd: string | null): string | null => {
      if (!cwd) return null;
      if (worktreeState && worktreeState.forCwd === cwd)
        return worktreeState.projectRoot;
      // Any path in the loaded worktree list belongs to that project — covers
      // worktrees without sessions, so switching to them keeps the row mounted.
      if (worktreeState?.worktrees.some((w) => w.path === cwd))
        return worktreeState.projectRoot;
      const match = allSessions.find((s) => s.cwd === cwd);
      return match?.projectRoot ?? cwd;
    },
    [worktreeState, allSessions],
  );

  // Notify parent only when the effective cwd actually changes (not when
  // projectRootFor identity changes due to session/worktree refreshes).
  const lastNotifiedCwdRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastNotifiedCwdRef.current === selectedCwd) return;
    lastNotifiedCwdRef.current = selectedCwd;
    onCwdChange?.(selectedCwd, projectRootFor(selectedCwd));
  }, [selectedCwd, onCwdChange, projectRootFor]);

  // Sync the worktree switcher to the selected session's cwd. Sessions of all
  // worktrees in a project share one list, so clicking a session from another
  // worktree should move the effective cwd there. Only fires when the prop
  // value changes, so a manual switcher change is not snapped back.
  const lastSyncedCwdPropRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectedCwdProp && selectedCwdProp !== lastSyncedCwdPropRef.current) {
      lastSyncedCwdPropRef.current = selectedCwdProp;
      setSelectedCwd(selectedCwdProp);
    }
  }, [selectedCwdProp]);

  // Load worktrees for the current effective cwd
  const [wtRefreshKey, setWtRefreshKey] = useState(0);
  useLayoutEffect(() => {
    if (!selectedCwd) {
      setWorktreeState(null);
      setWorktreeLoadingCwd(null);
      return;
    }
    let cancelled = false;
    setWorktreeLoadingCwd(selectedCwd);
    fetch(`/api/worktrees?cwd=${encodeURIComponent(selectedCwd)}`)
      .then((r) => r.json())
      .then(
        (d: {
          projectRoot?: string;
          isGit?: boolean;
          isTopLevel?: boolean;
          worktrees?: WorktreeEntry[];
          error?: string;
        }) => {
          if (cancelled) return;
          setWorktreeLoadingCwd(null);
          if (d.error || !d.projectRoot) {
            setWorktreeState(null);
            return;
          }
          setWorktreeState({
            forCwd: selectedCwd,
            projectRoot: d.projectRoot,
            isGit: d.isGit ?? false,
            isTopLevel: d.isTopLevel ?? false,
            worktrees: d.worktrees ?? [],
          });
        },
      )
      .catch(() => {
        if (!cancelled) {
          setWorktreeLoadingCwd(null);
          setWorktreeState(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedCwd, wtRefreshKey, refreshKey]);

  // Auto-select cwd and restore session from URL on first load
  useEffect(() => {
    if (allSessions.length === 0 || skipInitialProjectSelection) return;

    if (selectedCwd === null) {
      // If restoring a session, set cwd to match that session
      if (initialSessionId && !restoredRef.current) {
        restoredRef.current = true;
        const target = allSessions.find((s) => s.id === initialSessionId);
        if (target) {
          setSelectedCwd(target.cwd);
          onSelectSession(target, true);
          return;
        }
        // Session not found — notify parent so it can show the placeholder
        onInitialRestoreDone?.();
      }
      const projects = getRecentProjects(allSessions);
      if (projects.length > 0) setSelectedCwd(projects[0]);
    }
  }, [
    allSessions,
    selectedCwd,
    initialSessionId,
    skipInitialProjectSelection,
    onSelectSession,
    onInitialRestoreDone,
  ]);

  const commitCustomPath = useCallback(
    async (candidate?: string) => {
      const path = (candidate ?? customPathValue).trim();
      if (!path || customPathValidating) return;

      setCustomPathValidating(true);
      setCustomPathError(null);
      try {
        const res = await fetch("/api/cwd/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd: path }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          cwd?: string;
          error?: string;
        };
        if (!res.ok || data.error) {
          setCustomPathError(data.error ?? `HTTP ${res.status}`);
          return;
        }
        setSelectedCwd(data.cwd ?? path);
        setCustomPathOpen(false);
        setCustomPathValue("");
        setDropdownOpen(false);
      } catch (e) {
        setCustomPathError(e instanceof Error ? e.message : String(e));
      } finally {
        setCustomPathValidating(false);
      }
    },
    [customPathValue, customPathValidating],
  );

  const handleCustomPathClick = useCallback(() => {
    setCustomPathOpen(true);
    setCustomPathError(null);
    setDropdownOpen(false);
  }, []);
  const handleDefaultCwd = useCallback(async () => {
    try {
      const res = await fetch("/api/default-cwd", { method: "POST" });
      const data = (await res.json()) as { cwd?: string; error?: string };
      if (data.cwd) {
        setSelectedCwd(data.cwd);
        setCustomPathOpen(false);
        setCustomPathValue("");
        setCustomPathError(null);
        setDropdownOpen(false);
      }
    } catch {
      // ignore
    }
  }, []);

  const handleCreateWorktree = useCallback(async () => {
    const branch = wtNewBranch.trim();
    if (!branch || wtBusy || !worktreeState) return;
    setWtBusy(true);
    setWtError(null);
    try {
      const res = await fetch("/api/worktrees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: worktreeState.projectRoot, branch }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        path?: string;
        error?: string;
      };
      if (!res.ok || data.error || !data.path) {
        setWtError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setWtNewOpen(false);
      setWtNewBranch("");
      setWtDropdownOpen(false);
      // Optimistically register the new worktree so projectRootFor() resolves
      // it to the main repo before the refetch lands (keeps AppShell from
      // treating the new cwd as a different project).
      setWorktreeState((prev) =>
        prev
          ? {
              ...prev,
              forCwd: data.path!,
              worktrees: [
                ...prev.worktrees,
                { path: data.path!, branch, isMain: false },
              ],
            }
          : prev,
      );
      setSelectedCwd(data.path);
      setWtRefreshKey((k) => k + 1);
    } catch (e) {
      setWtError(e instanceof Error ? e.message : String(e));
    } finally {
      setWtBusy(false);
    }
  }, [wtNewBranch, wtBusy, worktreeState]);

  const handleRemoveWorktree = useCallback(
    async (path: string, force: boolean) => {
      if (!worktreeState || wtBusy) return;
      setWtBusy(true);
      setWtError(null);
      try {
        const res = await fetch("/api/worktrees", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd: worktreeState.projectRoot, path, force }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          dirty?: boolean;
        };
        if (!res.ok) {
          if (data.dirty && !force) {
            // Dirty worktree — ask the user to confirm a force removal
            setWtConfirmRemove(path);
            return;
          }
          setWtError(data.error ?? `HTTP ${res.status}`);
          return;
        }
        setWtConfirmRemove(null);
        if (selectedCwd === path) setSelectedCwd(worktreeState.projectRoot);
        setWtRefreshKey((k) => k + 1);
      } catch (e) {
        setWtError(e instanceof Error ? e.message : String(e));
      } finally {
        setWtBusy(false);
      }
    },
    [worktreeState, wtBusy, selectedCwd],
  );

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
        setProjectFilter("");
      }
      if (
        wtDropdownRef.current &&
        !wtDropdownRef.current.contains(e.target as Node)
      ) {
        setWtDropdownOpen(false);
        setWtNewOpen(false);
        setWtNewBranch("");
        setWtError(null);
        setWtConfirmRemove(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Clicking a session moves the effective cwd to that session's worktree.
  // Done on the click path (not via the selectedCwd prop sync) so it also
  // works when the prop value won't change — e.g. re-clicking the already
  // open session after manually switching worktrees.
  const handleSelectSessionFromList = useCallback(
    (s: SessionInfo) => {
      if (s.cwd) setSelectedCwd(s.cwd);
      onSelectSession(s);
    },
    [onSelectSession],
  );

  const handleNewSession = useCallback(() => {
    if (!selectedCwd) return;
    // Generate a temporary UUID client-side — no backend call needed.
    // Pi will be spawned lazily when the user sends the first message.
    const tempId =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    onNewSession?.(tempId, selectedCwd);
  }, [selectedCwd, onNewSession]);

  const toggleProjectCollapsed = useCallback((project: string) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(project)) {
        next.delete(project);
      } else {
        next.add(project);
      }
      try {
        window.localStorage.setItem(
          SIDEBAR_COLLAPSED_PROJECTS_KEY,
          JSON.stringify([...next]),
        );
      } catch {
        // storage unavailable — collapse stays session-only
      }
      return next;
    });
  }, []);

  const updateDisplay = useCallback((patch: Partial<SidebarDisplaySettings>) => {
    setDisplay((prev) => {
      const next = { ...prev, ...patch };
      try {
        window.localStorage.setItem(SIDEBAR_DISPLAY_KEY, JSON.stringify(next));
      } catch {
        // storage unavailable — display prefs stay session-only
      }
      return next;
    });
  }, []);

  const recentProjects = getRecentProjects(allSessions);
  const showProjectFilter = recentProjects.length > 8;
  const visibleProjects = projectFilter.trim()
    ? recentProjects.filter((p) =>
        p.toLowerCase().includes(projectFilter.trim().toLowerCase()),
      )
    : recentProjects;

  // Sessions of every worktree in the selected project are shown together
  const selectedProject = projectRootFor(selectedCwd);
  const visibleSessions = showBotSessions
    ? allSessions
    : allSessions.filter((s) => s.tag !== "relay" && s.tag !== "bot");
  const filteredSessions = selectedProject
    ? visibleSessions.filter((s) => (s.projectRoot ?? s.cwd) === selectedProject)
    : visibleSessions;
  const showWorktreeSwitcher = Boolean(
    worktreeState?.isGit &&
    worktreeState.isTopLevel &&
    selectedCwd &&
    selectedProject === worktreeState.projectRoot,
  );
  const worktreeGuide =
    selectedCwd &&
    worktreeState &&
    selectedProject === worktreeState.projectRoot &&
    !showWorktreeSwitcher
      ? worktreeState.isGit
        ? {
            label: "Open repo root",
            title: "Open the repository root to manage worktrees.",
          }
        : {
            label: "Git repo root only",
            title: "Worktrees are available in Git repository roots.",
          }
      : null;
  const worktreeLoading = Boolean(
    selectedCwd && worktreeLoadingCwd === selectedCwd,
  );
  const inactiveWorktreeSelector =
    worktreeGuide ??

    (worktreeLoading && !showWorktreeSwitcher
      ? {
          label: "Worktrees...",
          title: "Checking worktrees for this directory.",
        }
      : null);
  // All known workspaces, current first — the sidebar lists every workspace
  // with its own session group (reference-project layout).
  const workspaceGroups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const project of recentProjects) {
      counts.set(
        project,
        visibleSessions.filter((s) => (s.projectRoot ?? s.cwd) === project).length,
      );
    }
    let ordered: string[];
    switch (display.projectSort) {
      case "a-z":
        ordered = [...recentProjects].sort((a, b) => a.localeCompare(b));
        break;
      case "z-a":
        ordered = [...recentProjects].sort((a, b) => b.localeCompare(a));
        break;
      case "date-added": {
        // First session appearance order (stable per id order in allSessions).
        const firstSeen = new Map<string, number>();
        allSessions.forEach((s, idx) => {
          const root = s.projectRoot ?? s.cwd;
          if (root && !firstSeen.has(root)) firstSeen.set(root, idx);
        });
        ordered = [...recentProjects].sort(
          (a, b) => (firstSeen.get(a) ?? 1e9) - (firstSeen.get(b) ?? 1e9),
        );
        break;
      }
      case "recent": {
        // Most recently modified session first.
        const latest = new Map<string, number>();
        for (const s of allSessions) {
          const root = s.projectRoot ?? s.cwd;
          if (!root) continue;
          const t = new Date(s.modified).getTime();
          if (!latest.has(root) || t > (latest.get(root) ?? 0)) latest.set(root, t);
        }
        ordered = [...recentProjects].sort(
          (a, b) => (latest.get(b) ?? 0) - (latest.get(a) ?? 0),
        );
        break;
      }
      default:
        // "manual": current project first, then recency order from recentProjects.
        ordered = [...recentProjects].sort((a, b) =>
          a === selectedProject ? -1 : b === selectedProject ? 1 : 0,
        );
    }
    return ordered.map((project) => ({
      project,
      count: counts.get(project) ?? 0,
    }));
  }, [recentProjects, selectedProject, visibleSessions, display.projectSort, allSessions]);

  // Local session search (data is fully in memory — no backend round trip).
  const searchQuery = sessionSearch.trim().toLowerCase();
  const searchedSessions = useMemo(() => {
    if (!searchQuery) return filteredSessions;
    return filteredSessions.filter((s) => {
      const title = (s.name || s.firstMessage || s.id).toLowerCase();
      const cwd = (s.cwd ?? "").toLowerCase();
      return title.includes(searchQuery) || cwd.includes(searchQuery);
    });
  }, [filteredSessions, searchQuery]);
  const searchTree = buildSessionTree(searchedSessions);
  const searching = searchQuery.length > 0;

  // Time-group headings (Today / Yesterday / Earlier) around the tree — only
  // when not searching, so the search result stays a flat list.
  type TimeBucket = "today" | "yesterday" | "earlier";
  const bucketOf = (dateStr: string): TimeBucket => {
    const d = new Date(dateStr);
    const now = new Date();
    const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const dayMs = 86_400_000;
    const diff = startOfDay(now) - startOfDay(d);
    if (diff < 0) return "today";
    if (diff < dayMs) return "today";
    if (diff < 2 * dayMs) return "yesterday";
    return "earlier";
  };
  const BUCKET_LABELS: Record<TimeBucket, string> = {
    today: t("sidebar.bucket.today"),
    yesterday: t("sidebar.bucket.yesterday"),
    earlier: t("sidebar.bucket.earlier"),
  };
  const bucketOrder: TimeBucket[] = ["today", "yesterday", "earlier"];
  const groupedTree = useMemo(() => {
    if (searching) return null;
    const byBucket: Record<TimeBucket, SessionTreeNode[]> = { today: [], yesterday: [], earlier: [] };
    const tree = buildSessionTree(filteredSessions);
    for (const node of tree) {
      byBucket[bucketOf(node.session.modified)].push(node);
    }
    return bucketOrder.map((b) => ({ bucket: b, nodes: byBucket[b] })).filter((g) => g.nodes.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bucketOf/bucketOrder are stable per-locale constants
  }, [filteredSessions, searching]);


  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {customPathOpen && (
        <DirectoryPicker
          busy={customPathValidating}
          error={customPathError}
          onCancel={() => {
            setCustomPathOpen(false);
            setCustomPathError(null);
          }}
          onSelect={(path) => void commitCustomPath(path)}
        />
      )}
      {/* Header */}
      <div
        style={{
          padding: "12px 10px 10px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 10,
          }}
        >
          <ZetaWebTitle />
          <div style={{ display: "flex", gap: 6 }}>
            {/* Folder picker — opens the directory dialog (IDE-style browser) */}
            <button
              onClick={() => setFolderPickerModalOpen(true)}
              title={t("browse-folder-ide-style")}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "var(--bg-hover)",
                border: "1px solid var(--border)",
                color: "var(--text-muted)",
                cursor: "pointer",
                width: 32,
                height: 32,
                borderRadius: 7,
                padding: 0,
                flexShrink: 0,
                transition: "background 0.12s, color 0.12s, border-color 0.12s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--bg-selected)";
                e.currentTarget.style.color = "var(--accent)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = "var(--text-muted)";
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
            </button>

            {/* Display settings dropdown — sort/group/recent controls (openchamber SidebarHeader) */}
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  title={t("sidebar.display.title")}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "var(--bg-hover)",
                    border: "1px solid var(--border)",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    width: 32,
                    height: 32,
                    borderRadius: 7,
                    padding: 0,
                    flexShrink: 0,
                    transition: "background 0.12s, color 0.12s, border-color 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--bg-selected)";
                    e.currentTarget.style.color = "var(--accent)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "var(--bg-hover)";
                    e.currentTarget.style.color = "var(--text-muted)";
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <line x1="4" y1="6" x2="20" y2="6" />
                    <line x1="4" y1="12" x2="16" y2="12" />
                    <line x1="4" y1="18" x2="12" y2="18" />
                  </svg>
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  sideOffset={4}
                  style={{
                    minWidth: 200,
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    boxShadow: "0 6px 20px rgba(0,0,0,0.14)",
                    padding: 4,
                    zIndex: 200,
                  }}
                >
                  <DropdownMenu.Label style={{ padding: "6px 8px 2px", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-dim)" }}>
                    {t("sidebar.display.projectSort")}
                  </DropdownMenu.Label>
                  {([
                    ["manual", "sidebar.display.sort.manual"],
                    ["a-z", "sidebar.display.sort.a-z"],
                    ["z-a", "sidebar.display.sort.z-a"],
                    ["date-added", "sidebar.display.sort.date-added"],
                    ["recent", "sidebar.display.sort.recent"],
                  ] as const).map(([value, key]) => (
                    <DropdownMenu.Item
                      key={value}
                      onSelect={() => updateDisplay({ projectSort: value })}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "6px 8px",
                        fontSize: 12,
                        color: display.projectSort === value ? "var(--accent)" : "var(--text)",
                        borderRadius: 5,
                        cursor: "pointer",
                        outline: "none",
                      }}
                    >
                      <span style={{ width: 12 }}>{display.projectSort === value ? "✓" : ""}</span>
                      {t(key)}
                    </DropdownMenu.Item>
                  ))}
                  <DropdownMenu.Separator style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
                  <DropdownMenu.Label style={{ padding: "6px 8px 2px", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-dim)" }}>
                    {t("sidebar.display.sessionGrouping")}
                  </DropdownMenu.Label>
                  {([
                    ["by-worktree", "sidebar.display.grouping.by-worktree"],
                    ["flat", "sidebar.display.grouping.flat"],
                  ] as const).map(([value, key]) => (
                    <DropdownMenu.Item
                      key={value}
                      onSelect={() => updateDisplay({ sessionGrouping: value })}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "6px 8px",
                        fontSize: 12,
                        color: display.sessionGrouping === value ? "var(--accent)" : "var(--text)",
                        borderRadius: 5,
                        cursor: "pointer",
                        outline: "none",
                      }}
                    >
                      <span style={{ width: 12 }}>{display.sessionGrouping === value ? "✓" : ""}</span>
                      {t(key)}
                    </DropdownMenu.Item>
                  ))}
                  <DropdownMenu.Separator style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
                  <DropdownMenu.Item
                    onSelect={() => updateDisplay({ showRecent: !display.showRecent })}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "6px 8px",
                      fontSize: 12,
                      color: "var(--text)",
                      borderRadius: 5,
                      cursor: "pointer",
                      outline: "none",
                    }}
                  >
                    {t("sidebar.display.showRecent")}
                    <span style={{ fontSize: 11, color: display.showRecent ? "var(--accent)" : "var(--text-dim)" }}>
                      {display.showRecent ? "ON" : "OFF"}
                    </span>
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>

            {/* Search toggle — expands the inline search row below */}
            <button
              onClick={() => {
                setSearchOpen((v) => {
                  if (v) setSessionSearch("");
                  return !v;
                });
                setTimeout(() => searchInputRef.current?.focus(), 0);
              }}
              title={t("sidebar.display.search")}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: searchOpen ? "var(--bg-selected)" : "var(--bg-hover)",
                border: `1px solid ${searchOpen ? "rgba(37,99,235,0.35)" : "var(--border)"}`,
                color: searchOpen ? "var(--accent)" : "var(--text-muted)",
                cursor: "pointer",
                width: 32,
                height: 32,
                borderRadius: 7,
                padding: 0,
                flexShrink: 0,
                transition: "background 0.12s, color 0.12s, border-color 0.12s",
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </button>
          </div>
        </div>

        {/* CWD picker */}
        <div ref={dropdownRef} style={{ position: "relative" }}>
          <button
            onClick={() => setDropdownOpen((v) => !v)}
            title={selectedProject ?? selectedCwd ?? ""}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              padding: "6px 10px",
              background: selectedCwd
                ? "var(--bg-hover)"
                : "rgba(37,99,235,0.06)",
              border: selectedCwd
                ? "1px solid var(--border)"
                : "1px solid rgba(37,99,235,0.4)",
              borderRadius: 7,
              cursor: "pointer",
              fontSize: 12,
              color: "var(--text)",
              textAlign: "left",
              transition: "border-color 0.15s, background 0.15s",
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            {selectedCwd ? (
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--text)",
                  }}
                >
                  {getFileName(selectedProject ?? selectedCwd)}
                </span>
                <PathLabel
                  text={displayCwd(selectedProject ?? selectedCwd, homeDir)}
                  style={{ fontSize: 10, color: "var(--text-muted)" }}
                />
              </span>
            ) : (
              <span
                style={{
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontSize: 11,
                  color: "var(--text-dim)",
                }}
              >
                {initialSessionId && !restoredRef.current
                  ? ""
                  : t("select-project")}
              </span>
            )}
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: "var(--text-muted)" }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          <AnimatedDropdown
            open={dropdownOpen}
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              left: 0,
              right: 0,
              zIndex: 100,
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              boxShadow: "0 6px 20px rgba(0,0,0,0.10)",
              overflow: "hidden",
            }}
          >
            {showProjectFilter && (
              <div
                style={{
                  padding: "6px 8px",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <input
                  value={projectFilter}
                  onChange={(e) => setProjectFilter(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setProjectFilter("");
                      setDropdownOpen(false);
                    }
                  }}
                  placeholder={t("filter-projects")}
                  autoFocus
                  style={{
                    width: "100%",
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                    padding: "5px 8px",
                    border: "1px solid var(--border)",
                    borderRadius: 5,
                    outline: "none",
                    background: "var(--bg)",
                    color: "var(--text)",
                    boxSizing: "border-box",
                  }}
                />
            </div>
            )}
            {/* Default workspace — always the first entry */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                void handleDefaultCwd();
                setDropdownOpen(false);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                width: "100%",
                padding: "7px 10px",
                background: "var(--bg)",
                border: "none",
                borderBottom: "1px solid var(--border)",
                color: "var(--text)",
                cursor: "pointer",
                textAlign: "left",
              }}
              title={t("sidebar.default-workspace")}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M3 9.5L12 3l9 6.5V21H3z" />
              </svg>
              <span style={{ fontSize: 11.5, fontWeight: 600 }}>{t("sidebar.default-workspace")}</span>
            </button>
            <div style={{ maxHeight: "min(50vh, 380px)", overflowY: "auto" }}>
              {visibleProjects.map((project) => {
                const active = project === selectedProject;
                return (
                  <button
                    key={project}
                    onClick={() => {
                      setSelectedCwd(project);
                      setProjectFilter("");
                      setCustomPathOpen(false);
                      setCustomPathValue("");
                      setCustomPathError(null);
                      setDropdownOpen(false);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 7,
                      width: "100%",
                      padding: "7px 10px",
                      background: active ? "var(--bg-selected)" : "var(--bg)",
                      border: "none",
                      borderBottom: "1px solid var(--border)",
                      color: active ? "var(--text)" : "var(--text-muted)",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                    title={project}
                  >
                    <span style={{ width: 10, flexShrink: 0, display: "flex" }}>
                      {active && (
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="1.5 5 4 7.5 8.5 2.5" />
                        </svg>
                      )}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                      <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {getFileName(project)}
                      </span>
                      <PathLabel
                        text={displayCwd(project, homeDir)}
                        style={{ fontSize: 10, color: "var(--text-muted)" }}
                      />
                    </span>
                  </button>
                );
              })}
              {visibleProjects.length === 0 && projectFilter.trim() && (
                <div
                  style={{
                    padding: "8px 10px",
                    fontSize: 11,
                    color: "var(--text-dim)",
                  }}
                >
                  {t("no-matching-projects")}
                </div>
              )}
            </div>

            {/* Workspace source actions — compact single row */}
            <div
              style={{
                display: "flex",
                borderTop: "1px solid var(--border)",
                background: "var(--bg)",
              }}
            >
              {[
                {
                  key: "default",
                  label: t("use-default-directory"),
                  visible: !customPathOpen,
                  color: "var(--text-muted)" as string,
                  icon: (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                      <path d="M1 3A1 1 0 0 1 2 2H4L5 3.5H8.5a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-.5.5h-7A.5.5 0 0 1 1 8V3Z" />
                    </svg>
                  ),
                  onClick: (e: React.MouseEvent) => {
                    e.stopPropagation();
                    void handleDefaultCwd();
                  },
                },
                {
                  key: "browse",
                  label: t("browse-folder-ide-style"),
                  visible: !customPathOpen,
                  color: "var(--accent)" as string,
                  icon: (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                  ),
                  onClick: (e: React.MouseEvent) => {
                    e.stopPropagation();
                    setDropdownOpen(false);
                    setFolderPickerModalOpen(true);
                  },
                },
                {
                  key: "custom",
                  label: t("custom-path"),
                  visible: true,
                  color: "var(--text-muted)" as string,
                  icon: (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" style={{ flexShrink: 0 }}>
                      <line x1="5" y1="1" x2="5" y2="9" /><line x1="1" y1="5" x2="9" y2="5" />
                    </svg>
                  ),
                  onClick: (e: React.MouseEvent) => {
                    e.stopPropagation();
                    handleCustomPathClick();
                  },
                },
              ]
                .filter((action) => action.visible)
                .map((action) => (
                  <button
                    key={action.key}
                    onClick={action.onClick}
                    title={action.label}
                    style={{
                      flex: 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 5,
                      padding: "7px 4px",
                      background: "none",
                      border: "none",
                      color: action.color,
                      cursor: "pointer",
                      fontSize: 10.5,
                      minWidth: 0,
                    }}
                  >
                    {action.icon}
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{action.label}</span>
                  </button>
                ))}
            </div>
          </AnimatedDropdown>
        </div>

        {/* Worktree switcher — shown only for git projects at a checkout top
            level (repo subdirs keep their own project identity, so switching
            from them would jump projects). Rendered whenever the selected cwd
            belongs to the loaded project (not just when forCwd matches), so
            switching between worktrees of one project keeps the row mounted
            instead of flickering while data refetches: all worktrees of a
            project share the same list anyway. */}
        {showWorktreeSwitcher &&
          (() => {
            if (!worktreeState) return null;
            const currentWt =
              worktreeState.worktrees.find((w) => w.path === selectedCwd) ??
              worktreeState.worktrees.find((w) => w.isMain);
            return (
              <div
                ref={wtDropdownRef}
                style={{ position: "relative", marginTop: 6 }}
              >
                <button
                  onClick={() => setWtDropdownOpen((v) => !v)}
                  title={
                    currentWt
                      ? `Switch worktree: ${currentWt.path}`
                      : "Switch worktree"
                  }
                  style={{
                    width: "100%",
                    height: 29,
                    boxSizing: "border-box",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "0 10px",
                    background: "var(--bg-hover)",
                    border: "1px solid var(--border)",
                    borderRadius: 7,
                    cursor: "pointer",
                    fontSize: 11,
                    lineHeight: 1.35,
                    color: "var(--text-muted)",
                    textAlign: "left",
                  }}
                >
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{
                      flexShrink: 0,
                      color:
                        currentWt && !currentWt.isMain
                          ? "var(--accent)"
                          : "var(--text-dim)",
                    }}
                  >
                    <line x1="6" y1="3" x2="6" y2="15" />
                    <circle cx="18" cy="6" r="3" />
                    <circle cx="6" cy="18" r="3" />
                    <path d="M18 9a9 9 0 0 1-9 9" />
                  </svg>
                  <PathLabel
                    text={
                      currentWt
                        ? (currentWt.branch ??
                          displayCwd(currentWt.path, homeDir))
                        : "…"
                    }
                    style={{
                      flex: 1,
                      fontFamily: "var(--font-mono)",
                      color: "var(--text)",
                    }}
                  />
                  {currentWt?.isMain && (
                    <span
                      style={{
                        flexShrink: 0,
                        color: "var(--text-dim)",
                        fontSize: 10,
                      }}
                    >
                      main
                    </span>
                  )}
                  {worktreeState.worktrees.length > 1 && (
                    <span
                      style={{
                        flexShrink: 0,
                        color: "var(--text-dim)",
                        fontSize: 10,
                      }}
                    >
                      {worktreeState.worktrees.length}
                    </span>
                  )}
                  <svg
                    width="9"
                    height="9"
                    viewBox="0 0 10 10"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ flexShrink: 0 }}
                  >
                    <polyline points="2 3.5 5 6.5 8 3.5" />
                  </svg>
                </button>

                <AnimatedDropdown
                  open={wtDropdownOpen}
                  style={{
                    position: "absolute",
                    top: "calc(100% + 4px)",
                    left: 0,
                    right: 0,
                    zIndex: 100,
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    boxShadow: "0 6px 20px rgba(0,0,0,0.10)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{ maxHeight: "min(40vh, 300px)", overflowY: "auto" }}
                  >
                    {worktreeState.worktrees.map((wt) => {
                      const isCurrent =
                        wt.path === selectedCwd ||
                        (wt.isMain &&
                          !worktreeState.worktrees.some(
                            (w) => w.path === selectedCwd,
                          ));
                      if (wtConfirmRemove === wt.path) {
                        return (
                          <div
                            key={wt.path}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                              padding: "7px 10px",
                              borderBottom: "1px solid var(--border)",
                              background: "rgba(239,68,68,0.06)",
                            }}
                          >
                            <span
                              style={{
                                flex: 1,
                                fontSize: 11,
                                color: "var(--text)",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              Uncommitted changes. Force remove checkout?
                            </span>
                            <button
                              onClick={() =>
                                void handleRemoveWorktree(wt.path, true)
                              }
                              disabled={wtBusy}
                              style={{
                                padding: "3px 9px",
                                background: "#ef4444",
                                border: "none",
                                borderRadius: 5,
                                color: "#fff",
                                fontSize: 11,
                                fontWeight: 600,
                                cursor: "pointer",
                                flexShrink: 0,
                              }}
                            >
                              Force
                            </button>
                            <button
                              onClick={() => setWtConfirmRemove(null)}
                              style={{
                                padding: "3px 9px",
                                background: "var(--bg-hover)",
                                border: "1px solid var(--border)",
                                borderRadius: 5,
                                color: "var(--text-muted)",
                                fontSize: 11,
                                cursor: "pointer",
                                flexShrink: 0,
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        );
                      }
                      return (
                        <div
                          key={wt.path}
                          className="wt-row"
                          style={{
                            display: "flex",
                            alignItems: "center",
                            borderBottom: "1px solid var(--border)",
                          }}
                        >
                          <button
                            onClick={() => {
                              setSelectedCwd(wt.path);
                              setWtDropdownOpen(false);
                              setWtError(null);
                            }}
                            title={wt.path}
                            style={{
                              flex: 1,
                              minWidth: 0,
                              display: "flex",
                              alignItems: "center",
                              gap: 7,
                              padding: "8px 10px",
                              background: "var(--bg)",
                              border: "none",
                              color: isCurrent
                                ? "var(--text)"
                                : "var(--text-muted)",
                              cursor: "pointer",
                              textAlign: "left",
                              fontSize: 11,
                              fontFamily: "var(--font-mono)",
                            }}
                          >
                            {isCurrent ? (
                              <svg
                                width="10"
                                height="10"
                                viewBox="0 0 10 10"
                                fill="none"
                                stroke="var(--accent)"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                style={{ flexShrink: 0 }}
                              >
                                <polyline points="1.5 5 4 7.5 8.5 2.5" />
                              </svg>
                            ) : (
                              <span style={{ width: 10, flexShrink: 0 }} />
                            )}
                            <PathLabel
                              text={wt.branch ?? displayCwd(wt.path, homeDir)}
                              style={{ flex: 1 }}
                            />
                            {wt.isMain && (
                              <span
                                style={{
                                  flexShrink: 0,
                                  color: "var(--text-dim)",
                                  fontSize: 10,
                                }}
                              >
                                main
                              </span>
                            )}
                          </button>
                          {!wt.isMain && (
                            <button
                              onClick={() =>
                                void handleRemoveWorktree(wt.path, false)
                              }
                              disabled={wtBusy}
                              title={`Remove worktree checkout ${wt.path}; the branch is kept`}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                width: 34,
                                height: 28,
                                padding: 0,
                                marginRight: 4,
                                background: "none",
                                border: "none",
                                color: "var(--text-dim)",
                                cursor: "pointer",
                                borderRadius: 5,
                                flexShrink: 0,
                                transition: "color 0.12s, background 0.12s",
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.color = "#ef4444";
                                e.currentTarget.style.background =
                                  "rgba(239,68,68,0.08)";
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.color = "var(--text-dim)";
                                e.currentTarget.style.background = "none";
                              }}
                            >
                              <svg
                                width="12"
                                height="12"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                <path d="M10 11v6M14 11v6" />
                                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                              </svg>
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {!wtNewOpen ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setWtNewOpen(true);
                        setWtError(null);
                        setTimeout(() => wtNewInputRef.current?.focus(), 0);
                      }}
                      title="Create a worktree checkout for a branch"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 7,
                        width: "100%",
                        padding: "8px 10px",
                        background: "none",
                        border: "none",
                        color: "var(--text-muted)",
                        cursor: "pointer",
                        textAlign: "left",
                        fontSize: 11,
                      }}
                    >
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 10 10"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.1"
                        strokeLinecap="round"
                        style={{ flexShrink: 0 }}
                      >
                        <line x1="5" y1="1" x2="5" y2="9" />
                        <line x1="1" y1="5" x2="9" y2="5" />
                      </svg>
                      <span>New worktree…</span>
                    </button>
                  ) : (
                    <div style={{ padding: "6px 8px" }}>
                      <input
                        ref={wtNewInputRef}
                        value={wtNewBranch}
                        onChange={(e) => {
                          setWtNewBranch(e.target.value);
                          setWtError(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void handleCreateWorktree();
                          }
                          if (e.key === "Escape") {
                            setWtNewOpen(false);
                            setWtNewBranch("");
                            setWtError(null);
                          }
                        }}
                        placeholder="branch name"
                        style={{
                          width: "100%",
                          fontSize: 11,
                          fontFamily: "var(--font-mono)",
                          padding: "5px 8px",
                          border: "1px solid var(--accent)",
                          borderRadius: 5,
                          outline: "none",
                          background: "var(--bg)",
                          color: "var(--text)",
                          boxSizing: "border-box",
                        }}
                      />
                      <div style={{ display: "flex", gap: 5, marginTop: 5 }}>
                        <button
                          onClick={() => void handleCreateWorktree()}
                          disabled={wtBusy || !wtNewBranch.trim()}
                          style={{
                            flex: 1,
                            padding: "4px 0",
                            background: "var(--accent)",
                            border: "none",
                            borderRadius: 5,
                            color: "#fff",
                            fontSize: 11,
                            fontWeight: 600,
                            cursor:
                              wtBusy || !wtNewBranch.trim()
                                ? "not-allowed"
                                : "pointer",
                            opacity: wtBusy || !wtNewBranch.trim() ? 0.65 : 1,
                          }}
                        >
                          {wtBusy ? "Creating…" : "Create"}
                        </button>
                        <button
                          onClick={() => {
                            setWtNewOpen(false);
                            setWtNewBranch("");
                            setWtError(null);
                          }}
                          style={{
                            flex: 1,
                            padding: "4px 0",
                            background: "var(--bg-hover)",
                            border: "1px solid var(--border)",
                            borderRadius: 5,
                            color: "var(--text-muted)",
                            fontSize: 11,
                            cursor: "pointer",
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                  {wtError && (
                    <div
                      style={{
                        padding: "5px 10px 8px",
                        color: "#dc2626",
                        fontSize: 11,
                        lineHeight: 1.35,
                        overflowWrap: "anywhere",
                      }}
                    >
                      {wtError}
                    </div>
                  )}
                </AnimatedDropdown>
              </div>
            );
          })()}
        {inactiveWorktreeSelector && (
          <button
            type="button"
            aria-disabled="true"
            tabIndex={-1}
            title={inactiveWorktreeSelector.title}
            style={{
              width: "100%",
              height: 29,
              boxSizing: "border-box",
              marginTop: 6,
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "0 10px",
              border: "1px solid var(--border)",
              borderRadius: 7,
              background: "var(--bg-hover)",
              color: "var(--text-dim)",
              fontSize: 11,
              lineHeight: 1.35,
              whiteSpace: "nowrap",
              textAlign: "left",
              cursor: "default",
              opacity: 0.82,
            }}
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ flexShrink: 0 }}
            >
              <line x1="6" y1="3" x2="6" y2="15" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
              {inactiveWorktreeSelector.label}
            </span>
          </button>
        )}
        {/* New session — the only creation entry (openchamber SidebarNav) */}
        <button
          onClick={handleNewSession}
          disabled={!selectedCwd}
          style={{
            margin: "8px 10px 4px",
            width: "calc(100% - 20px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            height: 34,
            background: "var(--bg-hover)",
            border: "1px solid var(--border)",
            color: selectedCwd ? "var(--text)" : "var(--text-dim)",
            cursor: selectedCwd ? "pointer" : "not-allowed",
            borderRadius: 7,
            fontSize: 12.5,
            fontWeight: 600,
            letterSpacing: "-0.01em",
            flexShrink: 0,
            transition: "background 0.12s, color 0.12s, border-color 0.12s",
          }}
          onMouseEnter={(e) => {
            if (!selectedCwd) return;
            e.currentTarget.style.background = "var(--bg-selected)";
            e.currentTarget.style.color = "var(--accent)";
            e.currentTarget.style.borderColor = "rgba(37,99,235,0.35)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "var(--bg-hover)";
            e.currentTarget.style.color = selectedCwd ? "var(--text)" : "var(--text-dim)";
            e.currentTarget.style.borderColor = "var(--border)";
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <line x1="6" y1="1" x2="6" y2="11" />
            <line x1="1" y1="6" x2="11" y2="6" />
          </svg>
          {t("sidebar.actions.newSession")}
        </button>

        {/* Search row — toggled from the tools row, Esc clears/closes */}
        {searchOpen && !loading && !error && (
          <div style={{ padding: "4px 10px 6px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                height: 28,
                padding: "0 8px",
                background: "var(--bg-panel)",
                border: "1px solid var(--border)",
                borderRadius: 6,
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                ref={searchInputRef}
                value={sessionSearch}
                onChange={(e) => setSessionSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    if (sessionSearch) setSessionSearch("");
                    else setSearchOpen(false);
                  }
                }}
                placeholder={t("sidebar.display.searchPlaceholder")}
                aria-label={t("sidebar.display.searchPlaceholder")}
                style={{
                  flex: 1,
                  minWidth: 0,
                  border: "none",
                  outline: "none",
                  background: "transparent",
                  color: "var(--text)",
                  fontSize: 12,
                }}
              />
              {searching && (
                <button
                  onClick={() => setSessionSearch("")}
                  aria-label={t("sidebar.display.searchClear")}
                  title={t("sidebar.display.searchClear")}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: 16, height: 16, padding: 0, flexShrink: 0,
                    background: "none", border: "none",
                    color: "var(--text-dim)", cursor: "pointer",
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
              {searching && (
                <span style={{ fontSize: 10, color: "var(--text-dim)", flexShrink: 0 }}>
                  {searchTree.length}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Session list */}
      <div
        style={{
          flex:
            explorerOpen && (selectedCwdProp || selectedCwd)
              ? "1 1 0"
              : "1 1 auto",
          overflowY: "auto",
          padding: "0",
          minHeight: 80,
        }}
      >
        {loading && (
          <div
            style={{
              padding: "16px 14px",
              color: "var(--text-muted)",
              fontSize: 12,
            }}
          >
            Loading...
          </div>
        )}
        {error && (
          <div style={{ padding: "12px 14px", color: "var(--status-error-foreground)", fontSize: 12 }}>
            {error}
          </div>
        )}

        {!loading && !error && filteredSessions.length === 0 && (
          <div
            style={{
              padding: "16px 14px",
              color: "var(--text-muted)",
              fontSize: 12,
            }}
          >
            No sessions found
          </div>
        )}
        {!loading && !error && filteredSessions.length > 0 && searching && searchTree.length === 0 && (
          <div
            style={{
              padding: "16px 14px",
              color: "var(--text-muted)",
              fontSize: 12,
            }}
          >
            No sessions match &ldquo;{sessionSearch.trim()}&rdquo;
          </div>
        )}
        {!loading && !error && groupedTree !== null
          ? workspaceGroups.map((pg) => {
              const isCurrent = pg.project === selectedProject;
              return (
                <div key={pg.project}>
                  {/* Workspace group header — chevron toggles collapse; name switches workspace */}
                  <button
                    onClick={() => {
                      if (!isCurrent) {
                        setSelectedCwd(pg.project);
                        setDropdownOpen(false);
                      } else {
                        toggleProjectCollapsed(pg.project);
                      }
                    }}
                    title={pg.project}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      width: "100%",
                      padding: "9px 14px 5px",
                      background: "none",
                      border: "none",
                      cursor: isCurrent ? "default" : "pointer",
                      textAlign: "left",
                    }}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={isCurrent ? "var(--accent)" : "var(--text-dim)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: 700, color: isCurrent ? "var(--text)" : "var(--text-muted)" }}>
                      {getFileName(pg.project)}
                    </span>
                    <span style={{ fontSize: 10, color: "var(--text-dim)", flexShrink: 0 }}>
                      {pg.count > 0 ? pg.count : ""}
                    </span>
                    <svg
                      width="9"
                      height="9"
                      viewBox="0 0 10 10"
                      fill="none"
                      stroke="var(--text-dim)"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{
                        flexShrink: 0,
                        transform: collapsedProjects.has(pg.project) ? "rotate(-90deg)" : "rotate(0deg)",
                        transition: "transform 0.12s",
                      }}
                    >
                      <polyline points="2 3.5 5 6.5 8 3.5" />
                    </svg>
                  </button>
                  {isCurrent && pg.count === 0 && !collapsedProjects.has(pg.project) && (
                    <div style={{ padding: "2px 14px 8px", fontSize: 11, color: "var(--text-dim)" }}>
                      {t("sidebar.no-sessions-in-workspace")}
                    </div>
                  )}
                  {isCurrent &&
                    !collapsedProjects.has(pg.project) &&
                    groupedTree.map((group) => (
                      <div key={group.bucket}>
                        <div
                          style={{
                            padding: "10px 14px 4px",
                            color: "var(--text-dim)",
                            fontSize: 10,
                            fontWeight: 600,
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                          }}
                        >
                          {BUCKET_LABELS[group.bucket]}
                        </div>
                        {group.nodes.map((node) => (
                          <SessionTreeItem
                            key={node.session.id}
                            node={node}
                            selectedSessionId={selectedSessionId}
                            runningSessionIds={runningSessionIds}
                            unreadSessionIds={unreadSessionIds}
                            onSelectSession={handleSelectSessionFromList}
                            onRenamed={loadSessions}
                            onSessionDeleted={(id) => {
                              onSessionDeleted?.(id);
                              loadSessions();
                            }}
                            depth={0}
                          />
                        ))}
                      </div>
                    ))}
                </div>
              );
            })
          : !loading &&
            !error &&
            searchTree.map((node) => (
              <SessionTreeItem
                key={node.session.id}
                node={node}
                selectedSessionId={selectedSessionId}
                runningSessionIds={runningSessionIds}
                unreadSessionIds={unreadSessionIds}
                onSelectSession={handleSelectSessionFromList}
                onRenamed={loadSessions}
                onSessionDeleted={(id) => {
                  onSessionDeleted?.(id);
                  loadSessions();
                }}
                depth={0}
              />
            ))}
      </div>

      {/* File Explorer section */}
      {(selectedCwdProp || selectedCwd) && (
        <div
          style={{
            borderTop: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            flex: explorerOpen ? "1 1 0" : "0 0 auto",
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
            <button
              onClick={() => setExplorerOpen((v) => !v)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                flex: 1,
                padding: "6px 10px",
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                textAlign: "left",
              }}
            >
              <svg
                width="9"
                height="9"
                viewBox="0 0 10 10"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  transform: explorerOpen ? "rotate(90deg)" : "none",
                  transition: "transform 0.15s",
                  flexShrink: 0,
                }}
              >
                <polyline points="3 2 7 5 3 8" />
              </svg>
              Explorer
            </button>
            {explorerOpen && (
              <button
                onClick={() => fileExplorerRef.current?.openUploadPicker()}
                disabled={explorerUploadBusy}
                title="Upload files to project root"
                aria-label="Upload files"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 26,
                  height: 26,
                  padding: 0,
                  background: "none",
                  border: "none",
                  color: "var(--text-dim)",
                  cursor: explorerUploadBusy ? "default" : "pointer",
                  borderRadius: 5,
                  flexShrink: 0,
                  opacity: explorerUploadBusy ? 0.6 : 1,
                  transition: "color 0.3s, background 0.3s",
                }}
                onMouseEnter={(e) => {
                  if (explorerUploadBusy) return;
                  e.currentTarget.style.color = "var(--text-muted)";
                  e.currentTarget.style.background = "var(--bg-hover)";
                }}
                onMouseLeave={(e) => {
                  if (explorerUploadBusy) return;
                  e.currentTarget.style.color = "var(--text-dim)";
                  e.currentTarget.style.background = "none";
                }}
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <path d="m17 8-5-5-5 5" />
                  <path d="M12 3v12" />
                </svg>
              </button>
            )}
            <button
              onClick={() => {
                if (onExplorerRefresh) onExplorerRefresh();
                else setExplorerKey((k) => k + 1);
                setExplorerRefreshDone(true);
                if (explorerRefreshTimerRef.current)
                  clearTimeout(explorerRefreshTimerRef.current);
                explorerRefreshTimerRef.current = setTimeout(
                  () => setExplorerRefreshDone(false),
                  2000,
                );
              }}
              title="Refresh explorer"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 26,
                height: 26,
                padding: 0,
                marginRight: 6,
                background: explorerRefreshDone
                  ? "rgba(74,222,128,0.18)"
                  : "none",
                border: "none",
                color: explorerRefreshDone ? "#4ade80" : "var(--text-dim)",
                cursor: "pointer",
                borderRadius: 5,
                flexShrink: 0,
                transition: "color 0.3s, background 0.3s",
              }}
              onMouseEnter={(e) => {
                if (explorerRefreshDone) return;
                e.currentTarget.style.color = "var(--text-muted)";
                e.currentTarget.style.background = "var(--bg-hover)";
              }}
              onMouseLeave={(e) => {
                if (explorerRefreshDone) return;
                e.currentTarget.style.color = "var(--text-dim)";
                e.currentTarget.style.background = "none";
              }}
            >
              {explorerRefreshDone ? (
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#4ade80"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                </svg>
              )}
            </button>
          </div>
          {explorerOpen && (
            <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
              <FileExplorer
                ref={fileExplorerRef}
                cwd={selectedCwd ?? selectedCwdProp!}
                onOpenFile={onOpenFile ?? (() => {})}
                refreshKey={explorerKey}
                onAtMention={onAtMention}
                onAtMentions={onAtMentions}
                onUploadBusyChange={setExplorerUploadBusy}
              />
            </div>
          )}
        </div>
      )}
      <FolderPickerModal
        open={folderPickerModalOpen}
        initialPath={selectedCwd}
        onSelect={(path) => {
          setFolderPickerModalOpen(false);
          void commitCustomPath(path);
        }}
        onClose={() => setFolderPickerModalOpen(false)}
      />
    </div>
  );
}

function SessionTreeItem({
  node,
  selectedSessionId,
  runningSessionIds,
  unreadSessionIds,
  onSelectSession,
  onRenamed,
  onSessionDeleted,
  depth,
}: {
  node: SessionTreeNode;
  selectedSessionId: string | null;
  runningSessionIds: Set<string>;
  unreadSessionIds: Set<string>;
  onSelectSession: (s: SessionInfo) => void;
  onRenamed?: () => void;
  onSessionDeleted?: (id: string) => void;
  depth: number;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div style={{ position: "relative" }}>
        {/* Indent line for child sessions */}
        {depth > 0 && (
          <div
            style={{
              position: "absolute",
              left: depth * 12 + 6,
              top: 0,
              bottom: 0,
              width: 1,
              background: "var(--border)",
              pointerEvents: "none",
            }}
          />
        )}
        <SessionItem
          session={node.session}
          isSelected={node.session.id === selectedSessionId}
          isRunning={runningSessionIds.has(node.session.id)}
          isUnread={unreadSessionIds.has(node.session.id)}
          onClick={() => onSelectSession(node.session)}
          onRenamed={onRenamed}
          onDeleted={(id) => onSessionDeleted?.(id)}
          depth={depth}
          hasChildren={hasChildren}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((v) => !v)}
        />
      </div>
      {hasChildren && !collapsed && (
        <div>
          {node.children.map((child) => (
            <SessionTreeItem
              key={child.session.id}
              node={child}
              selectedSessionId={selectedSessionId}
              runningSessionIds={runningSessionIds}
              unreadSessionIds={unreadSessionIds}
              onSelectSession={onSelectSession}
              onRenamed={onRenamed}
              onSessionDeleted={onSessionDeleted}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RunningSessionIndicator() {
  return (
    <span
      title="Agent running…"
      aria-label="Agent running"
      style={{
        width: 14,
        height: 14,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: "var(--accent)",
      }}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        style={{ display: "block" }}
      >
        <g>
          <path
            d="M21 12a9 9 0 1 1-3.8-7.4"
            stroke="currentColor"
            strokeWidth="2.8"
            strokeLinecap="round"
          />
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0 12 12"
            to="360 12 12"
            dur="0.9s"
            repeatCount="indefinite"
          />
        </g>
      </svg>
    </span>
  );
}

function UnreadSessionIndicator() {
  return (
    <span
      title="New activity"
      aria-label="New session activity"
      style={{
        width: 14,
        height: 14,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: "#0891b2",
      }}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        aria-hidden="true"
        style={{ display: "block" }}
      >
        <circle cx="7" cy="7" r="2.5" fill="currentColor" />
        <circle
          cx="7"
          cy="7"
          r="3"
          stroke="currentColor"
          strokeWidth="1.4"
          opacity="0.32"
        >
          <animate
            attributeName="r"
            values="3;6;3"
            dur="1.6s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="opacity"
            values="0.32;0;0.32"
            dur="1.6s"
            repeatCount="indefinite"
          />
        </circle>
      </svg>
    </span>
  );
}

function SessionItem({
  session,
  isSelected,
  isRunning,
  isUnread,
  onClick,
  onRenamed,
  onDeleted,
  depth = 0,
  hasChildren = false,
  collapsed = false,
  onToggleCollapse,
}: {
  session: SessionInfo;
  isSelected: boolean;
  isRunning?: boolean;
  isUnread?: boolean;
  onClick: () => void;
  onRenamed?: () => void;
  onDeleted?: (id: string) => void;
  depth?: number;
  hasChildren?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const title =
    session.name ||
    session.firstMessage.slice(0, 50) ||
    session.id.slice(0, 12);

  const startRename = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setRenameValue(session.name ?? "");
      setRenaming(true);
      setTimeout(() => inputRef.current?.select(), 0);
    },
    [session.name],
  );

  const commitRename = useCallback(async () => {
    const name = renameValue.trim();
    setRenaming(false);
    if (name === (session.name ?? "")) return;
    try {
      await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      onRenamed?.();
    } catch {
      // ignore
    }
  }, [renameValue, session.id, session.name, onRenamed]);

  const handleDeleteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(true);
  }, []);

  const handleDeleteConfirm = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      setConfirmDelete(false);
      setDeleting(true);
      try {
        await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
          method: "DELETE",
        });
        onDeleted?.(session.id);
      } catch {
        setDeleting(false);
      }
    },
    [session.id, onDeleted],
  );

  const handleDeleteCancel = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(false);
  }, []);

  // Fixed-height outer wrapper — content swaps in place so the list never reflows
  const ITEM_HEIGHT = 54;

  return (
    <div
      onClick={confirmDelete || renaming ? undefined : onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
      }}
      style={{
        height: ITEM_HEIGHT,
        display: "flex",
        alignItems: "center",
        paddingLeft: depth > 0 ? depth * 12 + 14 : 14,
        paddingRight: 8,
        cursor: confirmDelete || renaming ? "default" : "pointer",
        background: confirmDelete
          ? "rgba(239,68,68,0.06)"
          : isSelected
            ? "var(--bg-selected)"
            : hovered
              ? "var(--bg-hover)"
              : "transparent",
        borderLeft: confirmDelete
          ? "2px solid #ef4444"
          : isSelected
            ? "2px solid var(--accent)"
            : "2px solid transparent",
        transition: "background 0.1s",
        opacity: deleting ? 0.5 : 1,
        gap: 6,
        overflow: "hidden",
      }}
    >
      {confirmDelete ? (
        /* ── Delete confirmation: same height, two flat buttons ── */
        <>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 12,
              color: "var(--text)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            Delete{" "}
            <span style={{ fontWeight: 600 }}>
              &ldquo;{title.slice(0, 22)}
              {title.length > 22 ? "…" : ""}&rdquo;
            </span>
            ?
          </div>
          <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
            <button
              onClick={handleDeleteConfirm}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
                height: 30,
                padding: "0 11px",
                background: "#ef4444",
                border: "none",
                borderRadius: 6,
                color: "#fff",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
              Delete
            </button>
            <button
              onClick={handleDeleteCancel}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: 30,
                padding: "0 11px",
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 500,
                whiteSpace: "nowrap",
              }}
            >
              Cancel
            </button>
          </div>
        </>
      ) : renaming ? (
        /* ── Rename: input fills the same row ── */
        <input
          ref={inputRef}
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") setRenaming(false);
          }}
          autoFocus
          style={{
            flex: 1,
            fontSize: 12,
            padding: "5px 8px",
            border: "1px solid var(--accent)",
            borderRadius: 5,
            outline: "none",
            background: "var(--bg)",
            color: "var(--text)",
            height: 30,
          }}
        />
      ) : (
        /* ── Normal view ── */
        <>
          {/* Fork indicator for child sessions */}
          {depth > 0 && (
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--text-dim)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ flexShrink: 0 }}
            >
              <line x1="6" y1="3" x2="6" y2="15" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                minWidth: 0,
                fontSize: 12,
                fontWeight: isSelected ? 500 : 400,
                lineHeight: 1.4,
                color: "var(--text)",
              }}
              title={title}
            >
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  minWidth: 0,
                }}
              >
                {title}
              </span>
              {session.tag && (
                <span
                  style={{
                    flexShrink: 0,
                    fontSize: 9,
                    lineHeight: 1,
                    padding: "2px 5px",
                    borderRadius: 8,
                    border: "1px solid var(--accent-dim, rgba(99,102,241,0.4))",
                    color: "var(--accent, #6366f1)",
                    textTransform: "uppercase",
                    letterSpacing: 0.4,
                  }}
                >
                  {session.tag}
                </span>
              )}
            </div>
            <div
              style={{
                marginTop: 2,
                display: "flex",
                alignItems: "center",
                gap: 8,
                color: "var(--text-dim)",
                fontSize: 11,
                minWidth: 0,
              }}
            >
              {session.cwd && (
                <span
                  title={session.cwd}
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: "45%",
                    color: "var(--text-dim)",
                  }}
                >
                  {session.cwd.split(/[\\/]/).filter(Boolean).pop() ||
                    session.cwd}
                </span>
              )}
              {isRunning ? (
                <RunningSessionIndicator />
              ) : isUnread ? (
                <UnreadSessionIndicator />
              ) : (
                <span title={session.modified}>
                  {formatRelativeTime(session.modified)}
                </span>
              )}
              <span>{session.messageCount} msgs</span>
              {session.worktreeBranch && (
                <span
                  title={`Worktree: ${session.cwd}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 3,
                    color: "var(--accent)",
                    minWidth: 0,
                    overflow: "hidden",
                  }}
                >
                  <svg
                    width="9"
                    height="9"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ flexShrink: 0 }}
                  >
                    <line x1="6" y1="3" x2="6" y2="15" />
                    <circle cx="18" cy="6" r="3" />
                    <circle cx="6" cy="18" r="3" />
                    <path d="M18 9a9 9 0 0 1-9 9" />
                  </svg>
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {session.worktreeBranch}
                  </span>
                </span>
              )}
            </div>
          </div>

          {/* Collapse toggle — always visible when has children */}
          {hasChildren && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleCollapse?.();
              }}
              title={collapsed ? "Expand forks" : "Collapse forks"}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 20,
                height: 20,
                padding: 0,
                flexShrink: 0,
                background: "none",
                border: "none",
                color: "var(--text-dim)",
                cursor: "pointer",
                transform: collapsed ? "rotate(-90deg)" : "none",
                transition: "transform 0.15s",
              }}
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="2 3.5 5 6.5 8 3.5" />
              </svg>
            </button>
          )}

          {/* Action buttons — reserved width (2×32px + 4px gap) so the row
              never reflows on hover; opacity fades in instead. */}
          <div
            style={{
              display: "flex",
              gap: 4,
              flexShrink: 0,
              width: 68,
              justifyContent: "flex-end",
              opacity: hovered ? 1 : 0,
              transition: "opacity 0.12s",
              pointerEvents: hovered ? "auto" : "none",
            }}
          >
            <button
              onClick={startRename}
              title="Rename"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 32,
                height: 32,
                padding: 0,
                background: "var(--bg-hover)",
                border: "1px solid var(--border)",
                borderRadius: 7,
                color: "var(--text-muted)",
                cursor: "pointer",
                flexShrink: 0,
                transition: "background 0.12s, color 0.12s, border-color 0.12s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--bg-selected)";
                e.currentTarget.style.color = "var(--accent)";
                e.currentTarget.style.borderColor = "rgba(37,99,235,0.35)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = "var(--text-muted)";
                e.currentTarget.style.borderColor = "var(--border)";
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
              </svg>
            </button>
            <button
              onClick={handleDeleteClick}
              title="Delete"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 32,
                height: 32,
                padding: 0,
                background: "var(--bg-hover)",
                border: "1px solid var(--border)",
                borderRadius: 7,
                color: "var(--text-muted)",
                cursor: "pointer",
                flexShrink: 0,
                transition: "background 0.12s, color 0.12s, border-color 0.12s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(239,68,68,0.08)";
                e.currentTarget.style.color = "#ef4444";
                e.currentTarget.style.borderColor = "rgba(239,68,68,0.35)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = "var(--text-muted)";
                e.currentTarget.style.borderColor = "var(--border)";
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
