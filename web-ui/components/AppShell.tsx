"use client";

import { useState, useCallback, useRef, useEffect, useMemo, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useGlobalKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { installRemoteTokenFetch } from "@/lib/remote-token";
import { SessionSidebar } from "./SessionSidebar";
import { ChatWindow, planTitleFromPath } from "./ChatWindow";
import { TerminalView, type TerminalFileRequest } from "./TerminalView";
import {
	loadTerminalSlots,
	saveTerminalSlots,
	slotsFor,
	terminalWorkspaceKey,
	withActiveInstance,
	withNewInstance,
	withSessionId,
	withoutSessionId,
	type TerminalSlotsState,
} from "@/lib/terminal-workspaces";
import { FloatingMenu, type FloatingMenuItem } from "./sidebar/FloatingMenu";
import { PluginsManager } from "./PluginsManager";
import { FileViewer } from "./FileViewer";
import { TabBar, type Tab } from "./TabBar";
import { ModelsConfig } from "./ModelsConfig";
import { GitBranchesPanel } from "./git-branches/GitBranchesPanel";
import { openStandaloneStats } from "@/lib/standalone-stats";
import { FullHistoryPanel } from "./FullHistoryPanel";
import { ContextRingPanel } from "./context-ring/ContextRingPanel";
import { SkillsConfig } from "./SkillsConfig";
import { PluginsConfig } from "./PluginsConfig";
import { SettingsWindow } from "./settings/SettingsWindow";
import { BranchNavigator } from "./BranchNavigator";
import { useViewportHeight } from "@/hooks/useViewportHeight";
import { ShellLayout, ShellSlot } from "./shell/ShellLayout";
import { DockRail } from "./shell/DockRail";
import { TopPanelChips } from "./shell/TopPanelChips";
import { ShellBootGate } from "./shell/BootGate";
import { ThemePicker } from "./ThemePicker";
import { LanguagePicker } from "./LanguagePicker";
import { useTheme } from "@/hooks/useTheme";
import { useI18n, I18nProvider } from "@/hooks/useI18n";
import { StarfieldEmblem } from "./StarfieldEmblem";
import { TrackingPanel } from "./TrackingPanel";
import { useIsMobile } from "@/hooks/useIsMobile";
import { copyText } from "@/lib/clipboard";
import { fetchSessions } from "@/lib/session-api";
import { getFileName } from "@/lib/file-paths";
import { buildAtMentionText, buildFileAtMentionsText, buildFileLineMentionText } from "@/lib/file-fuzzy";
import { getInitialNavigation } from "@/lib/initial-navigation";
import {
	resolveShellMode,
	SHELL_MODE_PARAM,
	type ShellMode,
} from "@/lib/shell-mode";
import { SidePanel } from "./SidePanel";
import { CommandPalette, type CommandPaletteAction } from "./command-palette";
import { useSidebar } from "@/hooks/useSidebar";
import {
	fetchDesktopInfo,
	hasDesktopToolLauncher,
	hasDesktopWindowControls,
	isWindowMaximized,
	subscribeWindowState,
	minimizeWindow,
	maximizeWindow,
	closeWindow,
	spawnDesktopTool,
	type DesktopToolId,
} from "@/lib/pi-desktop";
import {
	SIDEBAR_COLLAPSED_WIDTH,
	readSidebarCollapsedPref,
	writeSidebarCollapsedPref,
} from "@/lib/panel-layout";
import type { SessionInfo, SessionTreeNode } from "@/lib/types";
import { ChatInput, type ChatInputHandle } from "./ChatInput";
import { WorkspacePickerPanel, type PickerAnchor } from "./DraftContextBar";
import { OpenSplitButton } from "./OpenSplitButton";
import { SessionTabBar } from "./shell/SessionTabBar";
import { useSessionTabs } from "@/hooks/useSessionTabs";
import { RunningSessionsProvider, useRunningSessionIds } from "@/hooks/useRunningSessionIds";
import { sessionDisplayTitle } from "./sidebar/sidebar-shared";
import { getDraft } from "@/lib/draft-store";
import {
	draftKeyForTab,
	EMPTY_TAB_META,
	findTabBySessionId,
	isTabRunning,
	selectStreamingTabIds,
	type SessionTab,
	type TabRuntimeMeta,
} from "@/lib/session-tabs";

type SessionCopyField = "file" | "id";

const SIDEBAR_OPEN_STORAGE_KEY = "zeta-sidebar-open";

/** Read the persisted sidebar-open preference; closed unless explicitly opened. */
function readSidebarOpenPref(): boolean {
	if (typeof window === "undefined") return false;
	try {
		return window.localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY) === "1";
	} catch {
		return false;
	}
}

/** Persist the sidebar-open preference; storage failures are non-fatal. */
function writeSidebarOpenPref(open: boolean): void {
	try {
		window.localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, open ? "1" : "0");
	} catch {
		// Private mode / storage disabled: preference just won't survive reloads.
	}
}

/**
 * Session row behind a tab: the cached `/api/sessions` row when the tab was
 * opened from the sidebar (the normal path), else a minimal identity stub so a
 * tab restored without its row (PR B) still renders its chat. `path`/`modified`
 * are only used by sidebar rows, which always come from the real list.
 */
function sessionForTab(tab: SessionTab, cache: Record<string, SessionInfo>): SessionInfo | null {
	if (tab.kind !== "session" || !tab.sessionId) return null;
	return (
		cache[tab.sessionId] ?? {
			path: "",
			id: tab.sessionId,
			cwd: tab.projectRoot ?? "",
			name: tab.title,
			created: new Date(tab.openedAt).toISOString(),
			modified: "",
			messageCount: 0,
			firstMessage: "",
		}
	);
}

/**
 * Workspace context of a tab. A session tab keeps the session's own cwd — a
 * linked worktree is a different directory from its project root, and the
 * terminal/dock panels must open there — while a draft tab owns its cwd.
 */
function tabContextCwd(tab: SessionTab, session: SessionInfo | null): string | null {
	if (tab.kind === "draft") return tab.draftCwd;
	return session?.cwd ?? tab.projectRoot;
}

/** Metadata of one tab, or the neutral entry when it has not reported yet. */
function tabMetaFor(meta: Record<string, TabRuntimeMeta>, tabId: string | null): TabRuntimeMeta {
	return (tabId && meta[tabId]) || EMPTY_TAB_META;
}

/** Tabs whose own ChatWindow reports a live run (exact, SSE-driven). */
function runningTabIdsFrom(meta: Record<string, TabRuntimeMeta>): Set<string> {
	const ids = new Set<string>();
	for (const [tabId, entry] of Object.entries(meta)) {
		if (entry.running) ids.add(tabId);
	}
	return ids;
}

/** Is the tab running? Live tab state first, then the shared running poll. */
function isTabRunningNow(
	tab: SessionTab,
	meta: Record<string, TabRuntimeMeta>,
	runningSessionIds: ReadonlySet<string>,
): boolean {
	return isTabRunning(tab, { runningSessionIds, runningTabIds: runningTabIdsFrom(meta) });
}

/** Unsent composer text or images — tabs holding either are never evicted. */
function hasUnsavedDraft(tab: SessionTab): boolean {
	return getDraft(draftKeyForTab(tab)) !== null;
}

/**
 * Per-tab ChatWindow callbacks, cached by tab id. `inputRef` is the tab's own
 * composer handle (Ctrl+I / Ctrl+Enter and the file-mention inserters act on
 * the active tab only).
 */
interface TabBindings {
	inputRef: React.RefObject<ChatInputHandle | null>;
	onTabMeta: (patch: Partial<TabRuntimeMeta>) => void;
	onSessionCreated: (session: SessionInfo) => void;
	onSessionForked: (newSessionId: string) => void;
	onAgentEnd: () => void;
	onNewSessionCwdChange: (cwd: string) => void;
	onBranchDataChange: (
		tree: SessionTreeNode[],
		activeLeafId: string | null,
		onLeafChange: (leafId: string | null) => void,
	) => void;
}

/**
 * `mode` is normally read from the URL (`?mode=panel`); the `/panel` route
 * passes it explicitly so the host URL needs no query parameter. Either way the
 * shell itself is the only component that knows about it — see
 * `components/shell/ShellLayout.tsx`.
 */
export function AppShell({ mode }: { mode?: ShellMode } = {}) {
	return (
		<I18nProvider>
			<RunningSessionsProvider>
				<AppShellContent shellMode={mode} />
			</RunningSessionsProvider>
		</I18nProvider>
	);
}

function AppShellContent({ shellMode: pinnedMode }: { shellMode?: ShellMode }) {
	const router = useRouter();
	const searchParams = useSearchParams();
	const shellMode = pinnedMode ?? resolveShellMode(searchParams.get(SHELL_MODE_PARAM));
	const panel = shellMode === "panel";
	const [bootFailures, setBootFailures] = useState<string[]>([]);
	const recordBootFailure = useCallback((step: string, error: unknown) => {
		const detail = error instanceof Error ? error.message : String(error);
		setBootFailures(prev => [...prev, `${step}: ${detail}`]);
	}, []);
	useEffect(() => {
		try {
			installRemoteTokenFetch();
		} catch (error) {
			recordBootFailure("remote-token", error);
		}
	}, [recordBootFailure]);
	const [initialNavigation] = useState(() => getInitialNavigation(searchParams));
	const { isStarfield, cycleTheme } = useTheme();
	const { locale, t } = useI18n();
	useViewportHeight();
	const isMobile = useIsMobile();

	// --- Session tabs ------------------------------------------------------
	// The tab list is the single source of truth for "which chat is open";
	// `selectedSession` / `newSessionCwd` / `activeCwd` below are *derived* from
	// the active tab so every existing consumer (dock panels, sidebar highlight,
	// top bar) keeps reading one value.
	const sessionTabs = useSessionTabs();
	const { tabs, activeTabId, activeTab } = sessionTabs;
	const { runningSessionIds } = useRunningSessionIds();
	// Runtime-only per-tab metadata (stats, context, branch tree, plan, run
	// state). Written by each tab's ChatWindow through `onTabMeta`; the shell
	// chrome only ever reads the active tab's entry.
	const [tabMeta, setTabMeta] = useState<Record<string, TabRuntimeMeta>>({});
	// Sessions opened through the sidebar arrive with their full row; cache them
	// so a tab can render its ChatWindow without a second `/api/sessions/{id}`.
	const [sessionCache, setSessionCache] = useState<Record<string, SessionInfo>>({});
	// The workspace the sidebar currently points at. Only used while no tab
	// exists (open-workspace placeholder): once a tab is active, the tab owns
	// its workspace, so moving around the sidebar never retargets an open draft.
	const [sidebarCwd, setSidebarCwd] = useState<string | null>(null);

	// --- Derived active-tab state -------------------------------------------
	// One expression per value: the active tab is the session the sidebar
	// highlights, the dock panels describe, and the top bar reports.
	const selectedSession = activeTab ? sessionForTab(activeTab, sessionCache) : null;
	const newSessionCwd = activeTab?.kind === "draft" ? activeTab.draftCwd : null;
	const activeCwd = activeTab ? tabContextCwd(activeTab, selectedSession) : sidebarCwd;
	const [initialCwdStatus, setInitialCwdStatus] = useState<"idle" | "validating" | "ready" | "error">(() =>
		initialNavigation.requestedCwd ? "validating" : "idle",
	);
	const [initialCwdError, setInitialCwdError] = useState<string | null>(null);
	const [refreshKey, setRefreshKey] = useState(0);
	const [explorerRefreshKey, setExplorerRefreshKey] = useState(0);
	const [modelsConfigOpen, setModelsConfigOpen] = useState(false);
	const [modelsRefreshKey, setModelsRefreshKey] = useState(0);
	const [updating, setUpdating] = useState(false);
	const [checkingUpdate, setCheckingUpdate] = useState(false);
	// One transient notice serves the whole shell chrome (update checks, stats
	// dashboard failures): a short-lived line near the top-right, never a modal.
	const [shellNotice, setShellNotice] = useState<string | null>(null);
	const shellNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const [updateInfo, setUpdateInfo] = useState<{
		current: string;
		latest: string;
		available: boolean;
	} | null>(null);
	const [skillsConfigOpen, setSkillsConfigOpen] = useState(false);
	const [pluginsConfigOpen, setPluginsConfigOpen] = useState(false);
	// Tray/desktop deep links (`/?panel=settings`) open the settings modal on load.
	const [settingsConfigOpen, setSettingsConfigOpen] = useState(initialNavigation.requestedPanel === "settings");
	// Self-drawn titlebar. Only rendered inside the frameless desktop shell, and
	// only detected after mount so SSR and the browser build paint identically.
	const [desktopChrome, setDesktopChrome] = useState(false);
	const [windowMaximized, setWindowMaximized] = useState(false);
	const [canLaunchTools, setCanLaunchTools] = useState(false);
	useEffect(() => {
		setCanLaunchTools(hasDesktopToolLauncher());
		if (!hasDesktopWindowControls()) return;
		setDesktopChrome(true);
		void isWindowMaximized().then(setWindowMaximized);
		return subscribeWindowState(state => setWindowMaximized(state.maximized));
	}, []);
	const launchTool = useCallback(
		(tool: DesktopToolId) => {
			const cwd = selectedSession?.cwd ?? activeCwd ?? newSessionCwd ?? undefined;
			void spawnDesktopTool(tool, cwd).catch((err: unknown) => {
				console.error(`Failed to launch ${tool}:`, err);
			});
		},
		[activeCwd, newSessionCwd, selectedSession],
	);
	// Sidebar visibility. Desktop never fully hides the sidebar: the collapsed
	// state is the 56px icon rail, and the persisted `collapsed` preference
	// decides between full and rail. Mobile keeps a persisted drawer pref.
	const [sidebarOpen, setSidebarOpen] = useState(false);
	const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
	useEffect(() => {
		setSidebarOpen(isMobile ? readSidebarOpenPref() : true);
	}, [isMobile]);
	useEffect(() => {
		setSidebarCollapsed(readSidebarCollapsedPref());
	}, []);
	// Command palette (Ctrl+K) visibility.
	const [paletteOpen, setPaletteOpen] = useState(false);
	// Sidebar Plan card state: read from the active tab's metadata (the tab's
	// own ChatWindow writes it) so a background plan cannot drive the sidebar.
	const sidebarPlan = tabMetaFor(tabMeta, activeTabId).plan;
	// tracking.enabled gates the dock tracking entry (conditional entry, §1.3).
	const [trackingEnabled, setTrackingEnabled] = useState(false);
	useEffect(() => {
		let cancelled = false;
		fetch("/api/settings")
			.then(r => r.json())
			.then((data: { settings?: Array<{ path?: string; value?: unknown }> }) => {
				if (cancelled) return;
				const entry = Array.isArray(data.settings) ? data.settings.find(s => s.path === "tracking.enabled") : null;
				setTrackingEnabled(entry?.value === true);
			})
			.catch(() => {
				// Settings fetch failed — the tracking entry stays hidden (safe default).
			});
		return () => {
			cancelled = true;
		};
	}, []);
	const expandSidebar = useCallback(() => {
		setSidebarCollapsed(false);
		writeSidebarCollapsedPref(false);
	}, []);
	const collapseSidebar = useCallback(() => {
		setSidebarCollapsed(true);
		writeSidebarCollapsedPref(true);
	}, []);
	// The collapsed rail is a desktop affordance; mobile keeps the drawer.
	const sidebarRailActive = sidebarCollapsed && !isMobile;
	type DockTool = "session" | "files" | "tracking" | "plugins" | "terminal" | "git" | "history" | "context";
	const [mobileSidebarReady, setMobileSidebarReady] = useState(false);
	const [dockTool, setDockTool] = useState<DockTool | null>(null);
	// Embedded terminal (spec §15, P1): the pane is a view of a per-workspace
	// slot keyed by `(cwd, instanceId)`; the gateway reattaches by that key, so
	// closing the dock never kills a shell and reopening resumes it. Slot state
	// (which slots exist, which one is active, the last session per slot) is
	// persisted so a reload still recognises "the gateway lost that session".
	const [terminalSlots, setTerminalSlots] = useState<TerminalSlotsState>({});
	const [terminalFileRequest, setTerminalFileRequest] = useState<TerminalFileRequest | null>(null);
	useEffect(() => {
		setTerminalSlots(loadTerminalSlots());
	}, []);
	const updateTerminalSlots = useCallback((update: (state: TerminalSlotsState) => TerminalSlotsState) => {
		setTerminalSlots(previous => {
			const next = update(previous);
			saveTerminalSlots(next);
			return next;
		});
	}, []);
	const [fileChipMenu, setFileChipMenu] = useState<{ filePath: string; point: { x: number; y: number } } | null>(null);
	// On mobile the sidebar is an overlay drawer; hide it by default so the chat
	// is visible on load. Runs once the breakpoint resolves after hydration.
	useEffect(() => {
		if (isMobile) setSidebarOpen(false);
	}, [isMobile]);
	useEffect(() => {
		setMobileSidebarReady(true);
	}, []);
	const topBarRef = useRef<HTMLDivElement>(null);

	// --- Per-tab metadata plumbing ------------------------------------------
	// Every ChatWindow stays mounted while its tab is open, so the hoisted
	// session values (stats, context, branch tree, prompt, plan, run state) are
	// per-tab maps. The chrome below reads only the active tab's entry.
	const activeMeta = tabMetaFor(tabMeta, activeTabId);
	const sessionStats = activeMeta.sessionStats;
	const contextUsage = activeMeta.contextUsage;
	const modelInfo = { model: activeMeta.model, thinkingLevel: activeMeta.thinkingLevel };
	const branchTree = activeMeta.branchTree;
	const branchActiveLeafId = activeMeta.branchActiveLeafId;
	const systemPrompt = activeMeta.systemPrompt;

	const patchTabMeta = useCallback((tabId: string, patch: Partial<TabRuntimeMeta>) => {
		setTabMeta(prev => ({ ...prev, [tabId]: { ...EMPTY_TAB_META, ...prev[tabId], ...patch } }));
	}, []);

	// Keep a ref to the live tab list so the per-tab callbacks (created once per
	// tab and cached) never read a stale render's state.
	const tabsRef = useRef({ tabs, activeTabId, sessionCache });
	tabsRef.current = { tabs, activeTabId, sessionCache };
	const tabMetaRef = useRef(tabMeta);
	tabMetaRef.current = tabMeta;
	const runningSessionIdsRef = useRef(runningSessionIds);
	runningSessionIdsRef.current = runningSessionIds;
	const branchLeafChangeFnsRef = useRef(new Map<string, (leafId: string | null) => void>());
	const tabBindingsRef = useRef(new Map<string, TabBindings>());

	// The top bar's branch navigator acts on the active tab's leaf callback.
	const handleBranchLeafChange = useCallback((leafId: string | null) => {
		const tabId = tabsRef.current.activeTabId;
		if (tabId) branchLeafChangeFnsRef.current.get(tabId)?.(leafId);
	}, []);

	// Cache the session row so the tab's ChatWindow renders from real data (and
	// the sidebar's rename / projectRoot land without another fetch).
	const cacheSession = useCallback((session: SessionInfo) => {
		setSessionCache(prev => ({ ...prev, [session.id]: session }));
	}, []);

	const bumpTabRemount = useCallback((tabId: string) => {
		setTabMeta(prev => ({
			...prev,
			[tabId]: { ...EMPTY_TAB_META, ...prev[tabId], remountNonce: (prev[tabId]?.remountNonce ?? 0) + 1 },
		}));
	}, []);

	/**
	 * Welcome-card workspace pick: rebind the draft tab to another workspace and
	 * re-create its chat, because the cwd is where the pending session will be
	 * created (the pre-tab shell remounted for the same reason).
	 */
	const setTabDraftCwd = useCallback(
		(tabId: string, cwd: string) => {
			const tab = tabsRef.current.tabs.find(candidate => candidate.id === tabId);
			if (!tab || tab.kind !== "draft" || tab.draftCwd === cwd) return;
			sessionTabs.update(tabId, { draftCwd: cwd, projectRoot: cwd });
			bumpTabRemount(tabId);
		},
		[bumpTabRemount, sessionTabs],
	);

	/**
	 * Per-tab ChatWindow bindings, created once per tab id and cached: the
	 * hoist effects inside ChatWindow key on callback identity, so a fresh
	 * closure per render would re-fire them forever. Everything they touch goes
	 * through refs that are refreshed on each render.
	 */
	const tabHandlersRef = useRef<{
		tabMeta: (tabId: string, patch: Partial<TabRuntimeMeta>) => void;
		sessionCreated: (tabId: string, session: SessionInfo) => void;
		sessionForked: (tabId: string, newSessionId: string) => void;
		agentEnd: (tabId: string) => void;
		draftCwdChange: (tabId: string, cwd: string) => void;
		branchData: (
			tabId: string,
			tree: SessionTreeNode[],
			activeLeafId: string | null,
			onLeafChange: (leafId: string | null) => void,
		) => void;
	}>({
		tabMeta: () => {},
		sessionCreated: () => {},
		sessionForked: () => {},
		agentEnd: () => {},
		draftCwdChange: () => {},
		branchData: () => {},
	});

	const bindingsFor = useCallback((tabId: string): TabBindings => {
		const cached = tabBindingsRef.current.get(tabId);
		if (cached) return cached;
		const bindings: TabBindings = {
			inputRef: { current: null },
			onTabMeta: patch => tabHandlersRef.current.tabMeta(tabId, patch),
			onSessionCreated: session => tabHandlersRef.current.sessionCreated(tabId, session),
			onSessionForked: newSessionId => tabHandlersRef.current.sessionForked(tabId, newSessionId),
			onAgentEnd: () => tabHandlersRef.current.agentEnd(tabId),
			onNewSessionCwdChange: cwd => tabHandlersRef.current.draftCwdChange(tabId, cwd),
			onBranchDataChange: (tree, activeLeafId, onLeafChange) =>
				tabHandlersRef.current.branchData(tabId, tree, activeLeafId, onLeafChange),
		};
		tabBindingsRef.current.set(tabId, bindings);
		return bindings;
	}, []);

	/** Composer handle of the active tab: Ctrl+I / Ctrl+Enter and file mentions. */
	const activeInputRef = useCallback((): React.RefObject<ChatInputHandle | null> => {
		const tabId = tabsRef.current.activeTabId;
		return tabId ? bindingsFor(tabId).inputRef : { current: null };
	}, [bindingsFor]);

	/**
	 * Mark the active tab mounted (its ChatWindow is created on first
	 * activation) and drop metadata for tabs that no longer exist.
	 */
	useEffect(() => {
		const live = new Set(tabs.map(tab => tab.id));
		for (const id of [...tabBindingsRef.current.keys()]) {
			if (!live.has(id)) tabBindingsRef.current.delete(id);
		}
		for (const id of [...branchLeafChangeFnsRef.current.keys()]) {
			if (!live.has(id)) branchLeafChangeFnsRef.current.delete(id);
		}
		setTabMeta(prev => {
			const pruned = Object.fromEntries(Object.entries(prev).filter(([id]) => live.has(id)));
			if (!activeTabId || pruned[activeTabId]?.mounted) return pruned;
			return { ...pruned, [activeTabId]: { ...EMPTY_TAB_META, ...pruned[activeTabId], mounted: true } };
		});
	}, [tabs, activeTabId]);

	// --- Tab lifecycle helpers ----------------------------------------------
	// A tab that is running, holds unsent text, or (PR B) waits for approval is
	// never evicted by the soft cap: the cap is a memory guard, not a way to
	// kill work.
	const canEvictTab = useCallback(
		(tab: SessionTab) =>
			!isTabRunningNow(tab, tabMetaRef.current, runningSessionIdsRef.current) && !hasUnsavedDraft(tab),
		[],
	);

	const openSessionTab = useCallback(
		(session: SessionInfo) => {
			cacheSession(session);
			sessionTabs.openSessionTab(session, sessionDisplayTitle(session, t), { canEvict: canEvictTab });
		},
		[cacheSession, canEvictTab, sessionTabs, t],
	);

	const openDraftTab = useCallback(
		(cwd: string | null, explicitNew: boolean) => {
			// Draft tabs use the same D4 title rule a brand-new session row shows
			// (name > first message > "New session · HH:mm"), so the strip reads
			// the same before and after the session exists.
			const title = sessionDisplayTitle({ name: null, firstMessage: "", created: new Date().toISOString() }, t);
			sessionTabs.openDraftTab(cwd, title, explicitNew, { canEvict: canEvictTab });
		},
		[canEvictTab, sessionTabs, t],
	);

	// "Update" button: check → confirm → download → install → prompt restart.
	const handleCheckUpdate = useCallback(async () => {
		setCheckingUpdate(true);
		try {
			const response = await fetch("/api/update/check");
			if (!response.ok) return;
			setUpdateInfo(
				(await response.json()) as {
					current: string;
					latest: string;
					available: boolean;
				},
			);
		} catch {
			// Gateway unavailable; leave the button silent.
		} finally {
			setCheckingUpdate(false);
		}
	}, []);

	/**
	 * Show the shell's transient notice. `ttlMs` defaults to the update-check
	 * flash; longer copy (e.g. "start the stats service") asks for more.
	 */
	const showShellNotice = useCallback((message: string, ttlMs = 2_000) => {
		setShellNotice(message);
		clearTimeout(shellNoticeTimerRef.current);
		shellNoticeTimerRef.current = setTimeout(() => setShellNotice(null), ttlMs);
	}, []);

	const handleRunUpdate = useCallback(async () => {
		if (!updateInfo) return;
		setUpdating(true);
		try {
			const download = await fetch("/api/update/download", { method: "POST" });
			if (!download.ok) {
				window.alert(t("topbar.downloadFailedFmt", { detail: await download.text() }));
				return;
			}
			const install = await fetch("/api/update/install", { method: "POST" });
			if (!install.ok) {
				window.alert(t("topbar.installFailedFmt", { detail: await install.text() }));
				return;
			}
			window.alert(t("topbar.updatedFmt", { version: updateInfo.latest }));
			setUpdateInfo(null);
		} finally {
			setUpdating(false);
		}
	}, [updateInfo, t]);
	const [copiedSessionField, setCopiedSessionField] = useState<SessionCopyField | null>(null);
	const sessionCopyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const handleCopySessionField = useCallback((field: SessionCopyField, value: string) => {
		void copyText(value).then(() => {
			if (sessionCopyTimerRef.current) clearTimeout(sessionCopyTimerRef.current);
			setCopiedSessionField(field);
			sessionCopyTimerRef.current = setTimeout(() => setCopiedSessionField(null), 1400);
		});
	}, []);

	useEffect(() => {
		return () => {
			if (sessionCopyTimerRef.current) clearTimeout(sessionCopyTimerRef.current);
		};
	}, []);

	// One-shot /api/desktop/info probe: warms the shared cached promise so
	// desktop-specific surfaces resolve instantly instead of re-fetching.
	useEffect(() => {
		fetchDesktopInfo().catch(error => recordBootFailure("desktop-info", error));
	}, [recordBootFailure]);

	const { visible: sessionPanelVisible } = useSidebar();
	// The dock auto-hides below 1024px regardless of the stored preference.
	const [sidePanelNarrow, setSidePanelNarrow] = useState(false);
	useEffect(() => {
		if (typeof window === "undefined" || !window.matchMedia) return;
		const mql = window.matchMedia("(max-width: 1023px)");
		const onChange = () => setSidePanelNarrow(mql.matches);
		onChange();
		mql.addEventListener("change", onChange);
		return () => mql.removeEventListener("change", onChange);
	}, []);

	// Bridge the shared "session panel" visibility flag (sidebar toggle,
	// storage-persisted) into the dock's window selection. Edge-triggered so a
	// mount with a stale persisted `true` does not force-open the dock.
	const prevSessionPanelVisible = useRef(sessionPanelVisible);
	useEffect(() => {
		const was = prevSessionPanelVisible.current;
		prevSessionPanelVisible.current = sessionPanelVisible;
		if (sessionPanelVisible && !was) setDockTool("session");
		else if (!sessionPanelVisible && was) setDockTool(cur => (cur === "session" ? null : cur));
	}, [sessionPanelVisible]);
	// Single active panel — only one dropdown open at a time
	const [activeTopPanel, setActiveTopPanel] = useState<"branches" | "system" | "session" | null>(null);
	const [topPanelPos, setTopPanelPos] = useState<{
		top: number;
		left: number;
		width: number;
	} | null>(null);

	const toggleTopPanel = useCallback(
		(panel: "branches" | "system" | "session") => {
			if (isMobile) setSidebarOpen(false);
			setActiveTopPanel(cur => (cur === panel ? null : panel));
		},
		[isMobile],
	);

	const openSessionStatsPanel = useCallback(() => {
		if (isMobile) setSidebarOpen(false);
		setActiveTopPanel("session");
	}, [isMobile]);

	/**
	 * Open the standalone stats dashboard. It is not a dock panel: its data is
	 * cross-session (costs, providers, tools, traces) while the dock's context
	 * ring reports one live session, so the shell keeps the capability as an
	 * action entry and opens the dashboard in its own tab. When nothing answers,
	 * say so — with the address and the command — instead of a dead tab.
	 */
	const handleOpenStatsDashboard = useCallback(async () => {
		const { ok, url } = await openStandaloneStats();
		if (ok) return;
		showShellNotice(url === null ? t("stats.urlUnresolved") : t("stats.notRunning", { url }), 6_000);
	}, [showShellNotice, t]);

	/**
	 * A checkout rewrites the working tree, so every surface that read the old
	 * branch is stale: the file explorer's git status/diff, the open file tabs,
	 * and the sidebar's per-project worktree/branch badges.
	 */
	const handleBranchSwitched = useCallback(() => {
		setExplorerRefreshKey(k => k + 1);
		setRefreshKey(k => k + 1);
	}, []);

	// One semantic for both surfaces (plan §3 P0): on desktop the toggle swaps
	// between the full sidebar and the 56px rail (never fully hides); on mobile
	// it opens/closes the drawer.
	const handleSidebarToggle = useCallback(() => {
		if (isMobile) {
			setActiveTopPanel(null);
			setSidebarOpen(open => {
				writeSidebarOpenPref(!open);
				return !open;
			});
			return;
		}
		setSidebarCollapsed(collapsed => {
			writeSidebarCollapsedPref(!collapsed);
			return !collapsed;
		});
	}, [isMobile]);

	useEffect(() => {
		if (!activeTopPanel || !topBarRef.current) return;
		const update = () => {
			const rect = topBarRef.current!.getBoundingClientRect();
			setTopPanelPos({ top: rect.bottom, left: rect.left, width: rect.width });
		};
		update();
		const ro = new ResizeObserver(update);
		ro.observe(topBarRef.current);
		return () => ro.disconnect();
	}, [activeTopPanel, isMobile]);

	// Right panel — file tabs or tracking panel
	const [fileTabs, setFileTabs] = useState<Tab[]>([]);
	const [activeFileTabId, setActiveFileTabId] = useState<string | null>(null);

	// Same @mention format as the chat input's @ autocomplete, so the agent's
	// read tool resolves it the same way (it strips the @ prefix). Inserts land
	// in the active tab's composer.
	const handleAtMention = useCallback(
		(relativePath: string, isDir: boolean) => {
			activeInputRef().current?.insertText(buildAtMentionText(relativePath, isDir));
		},
		[activeInputRef],
	);

	const handleAtMentions = useCallback(
		(relativePaths: string[]) => {
			const mentions = buildFileAtMentionsText(relativePaths);
			if (mentions) activeInputRef().current?.insertText(mentions);
		},
		[activeInputRef],
	);

	const handleFileLineMention = useCallback(
		(relativePath: string, startLine: number, endLine: number) => {
			activeInputRef().current?.insertText(buildFileLineMentionText(relativePath, startLine, endLine));
		},
		[activeInputRef],
	);

	const initialSessionId = initialNavigation.sessionId;
	// True once the initial ?session= URL param has been resolved (or confirmed absent)
	const [initialSessionRestored, setInitialSessionRestored] = useState<boolean>(() => !initialSessionId);
	useEffect(() => {
		const requestedCwd = initialNavigation.requestedCwd;
		if (!requestedCwd) return;

		const controller = new AbortController();
		setInitialCwdStatus("validating");
		setInitialCwdError(null);

		void fetch("/api/cwd/validate", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ cwd: requestedCwd }),
			signal: controller.signal,
		})
			.then(async response => {
				const data = (await response.json().catch(() => ({}))) as {
					cwd?: string;
					error?: string;
				};
				if (!response.ok || !data.cwd) {
					throw new Error(data.error ?? `HTTP ${response.status}`);
				}

				// `?cwd=` deep link: open the requested workspace as the initial
				// draft tab. Not "explicit" — it keeps attaching to the serve
				// process's shared coordinator session until the user sends.
				openDraftTab(data.cwd, false);
				setInitialCwdStatus("ready");
			})
			.catch((error: unknown) => {
				if (controller.signal.aborted) return;
				setInitialCwdError(error instanceof Error ? error.message : String(error));
				setInitialCwdStatus("error");
			});

		return () => controller.abort();
	}, [initialNavigation, openDraftTab]);

	const handleCwdChange = useCallback(
		(cwd: string | null) => {
			// The sidebar points at a workspace. It only decides the context while
			// nothing is open: with tabs, the active tab owns its workspace (plan
			// §2.3), so an open chat is never retargeted behind the user's back.
			setSidebarCwd(cwd);
			if (!cwd) return;
			if (tabsRef.current.tabs.length > 0) return;
			// Boot: the sidebar resolved the initial project and no tab exists yet,
			// so open the default draft there (shared-coordinator semantics).
			openDraftTab(cwd, false);
		},
		[openDraftTab],
	);

	const handleSelectSession = useCallback(
		(session: SessionInfo, isRestore = false) => {
			// Clicking a session focuses its tab, or appends a new one; it never
			// replaces whatever the current tab is showing.
			openSessionTab(session);
			setInitialSessionRestored(true);
			// On mobile, collapse the overlay drawer so the chat is revealed after pick.
			if (isMobile && !isRestore) setSidebarOpen(false);
		},
		[isMobile, openSessionTab],
	);

	const handleNewSession = useCallback(
		// cwd === null: neither a project nor the default workspace resolved —
		// the tab renders the degraded workspace trigger (batch 3).
		(cwd: string | null) => {
			openDraftTab(cwd, true);
			if (isMobile) setSidebarOpen(false);
		},
		[isMobile, openDraftTab],
	);

	// Global keyboard shortcuts (handles Esc, Ctrl+N/Ctrl+Alt+N, Ctrl+I,
	// Ctrl+Enter, Ctrl+K, Ctrl+/ etc.). Ctrl+I/Ctrl+Enter act on the active
	// tab's composer; Esc aborts the active tab's run.
	useGlobalKeyboardShortcuts({
		onNewSession: (cwd: string) => handleNewSession(cwd),
		activeCwd,
		activeTabId,
		onFocusInput: () => activeInputRef().current?.focus(),
		onSubmitInput: () => activeInputRef().current?.submit(),
		onTogglePalette: () => setPaletteOpen(open => !open),
		onCycleTheme: () => cycleTheme(),
	});

	// Command palette entries (Ctrl+K): shell actions; sessions are fetched by
	// the palette itself.
	const paletteActions: CommandPaletteAction[] = [
		{
			id: "new-session",
			label: t("palette.new-session"),
			keywords: "new create session",
			run: () => handleNewSession(activeCwd ?? ""),
		},
		{
			id: "open-settings",
			label: t("palette.open-settings"),
			keywords: "settings preferences",
			run: () => setSettingsConfigOpen(true),
		},
		{
			id: "open-models",
			label: t("palette.open-models"),
			keywords: "models provider",
			run: () => setModelsConfigOpen(true),
		},
		{
			id: "open-skills",
			label: t("palette.open-skills"),
			keywords: "skills",
			run: () => setSkillsConfigOpen(true),
		},
		{
			id: "open-plugins",
			label: t("palette.open-plugins"),
			keywords: "plugins extensions",
			run: () => setDockTool("plugins"),
		},
		{
			id: "open-stats",
			label: t("palette.open-stats"),
			keywords: "stats dashboard usage cost",
			run: () => void handleOpenStatsDashboard(),
		},
		...(isMobile
			? []
			: [
					{
						id: "toggle-sidebar-rail",
						label: sidebarRailActive ? t("layout.expandRail") : t("layout.collapseToRail"),
						keywords: "sidebar collapse rail expand",
						run: () => (sidebarRailActive ? expandSidebar() : collapseSidebar()),
					} satisfies CommandPaletteAction,
				]),
	];

	const handlePaletteSelectSession = useCallback(
		(sessionId: string) => {
			fetchSessions()
				.then(list => {
					const session = (Array.isArray(list) ? list : []).find(s => s.id === sessionId);
					if (session) handleSelectSession(session);
				})
				.catch(() => {
					// Session list fetch failed — nothing sensible to select.
				});
		},
		[handleSelectSession],
	);

	// Client-built transient SessionInfo (new session / fork) lacks the
	// server-computed projectRoot. Hydrate it from the session list so the tab's
	// identity (and the sidebar's project grouping) matches the server row.
	const hydrateSession = useCallback(
		(sessionId: string) => {
			void fetch("/api/sessions")
				.then(r => (r.ok ? (r.json() as Promise<{ sessions: SessionInfo[] }>) : null))
				.then(d => {
					const full = d?.sessions.find(s => s.id === sessionId);
					if (!full) return;
					cacheSession(full);
					const tab = findTabBySessionId(tabsRef.current.tabs, sessionId);
					if (tab) {
						sessionTabs.update(tab.id, {
							projectRoot: full.projectRoot ?? full.cwd,
							title: sessionDisplayTitle(full, t),
						});
					}
				})
				.catch(() => {});
		},
		[cacheSession, sessionTabs, t],
	);

	// Called by the tab's ChatWindow when a draft gets its real session id.
	const handleSessionCreated = useCallback(
		(tabId: string, session: SessionInfo) => {
			cacheSession(session);
			// The tab keeps its id and its mounted ChatWindow: the draft simply
			// becomes the session view (no remount, no lost scroll position).
			sessionTabs.update(tabId, {
				kind: "session",
				sessionId: session.id,
				draftCwd: null,
				projectRoot: session.projectRoot ?? session.cwd,
				title: sessionDisplayTitle(session, t),
				explicitNew: false,
			});
			setRefreshKey(k => k + 1);
			hydrateSession(session.id);
		},
		[cacheSession, hydrateSession, sessionTabs, t],
	);

	const handleAgentEnd = useCallback(() => {
		setRefreshKey(k => k + 1);
		setExplorerRefreshKey(k => k + 1);
	}, []);

	const handleExplorerRefresh = useCallback(() => {
		setExplorerRefreshKey(k => k + 1);
	}, []);

	// A fork opens its own tab; the parent tab keeps its transcript untouched.
	const handleSessionForked = useCallback(
		(tabId: string, newSessionId: string) => {
			const parent = tabsRef.current.tabs.find(tab => tab.id === tabId);
			const cwd = parent?.projectRoot ?? tabsRef.current.sessionCache[parent?.sessionId ?? ""]?.cwd ?? "";
			const session: SessionInfo = {
				path: "",
				id: newSessionId,
				cwd,
				created: new Date().toISOString(),
				modified: new Date().toISOString(),
				messageCount: 0,
				firstMessage: "",
			};
			setRefreshKey(k => k + 1);
			openSessionTab(session);
			hydrateSession(newSessionId);
		},
		[hydrateSession, openSessionTab],
	);

	const handleInitialRestoreDone = useCallback(() => {
		setInitialSessionRestored(true);
	}, []);

	const handleSessionDeleted = useCallback(
		(sessionId: string) => {
			setRefreshKey(k => k + 1);
			// Deleting a session closes its tab view (activation falls to the
			// right neighbour, else the left, else the empty state). The session
			// file is gone, so nothing is left to re-open.
			sessionTabs.closeSessionTabs(sessionId);
		},
		[sessionTabs],
	);

	const handleOpenFile = useCallback(
		(filePath: string, fileName: string, options?: { sourceSessionId?: string | null; modeHint?: "diff" }) => {
			const sourceSessionId = options?.sourceSessionId;
			const modeHint = options?.modeHint;
			const tabId = `file:${filePath}`;
			setFileTabs(prev => {
				const existing = prev.find(t => t.id === tabId);
				if (!existing) {
					return [
						...prev,
						{
							id: tabId,
							label: fileName,
							filePath,
							sourceSessionId,
							initialDisplayMode: modeHint,
						},
					];
				}
				const sourceUnchanged = !sourceSessionId || existing.sourceSessionId === sourceSessionId;
				const modeUnchanged = !modeHint || existing.initialDisplayMode === modeHint;
				if (sourceUnchanged && modeUnchanged) return prev;
				return prev.map(t => {
					if (t.id !== tabId) return t;
					const next: Tab = { ...t };
					if (sourceSessionId) next.sourceSessionId = sourceSessionId;
					if (modeHint) next.initialDisplayMode = modeHint;
					return next;
				});
			});
			setActiveFileTabId(tabId);
			setDockTool("files");
			// On mobile the file panel is full-screen; close the drawer so it shows.
			if (isMobile) setSidebarOpen(false);
		},
		[isMobile],
	);

	const handleOpenLinkedFile = useCallback(
		(filePath: string) => {
			handleOpenFile(filePath, getFileName(filePath), {
				sourceSessionId: selectedSession?.id ?? null,
			});
		},
		[handleOpenFile, selectedSession?.id],
	);

	// 「在终端打开」 (spec U9): pop the terminal pane with a session that runs
	// `zeta-ide <file>`; the gateway falls back to a plain shell when the
	// zeta-ide binary is not on PATH.
	const handleOpenFileInTerminal = useCallback((filePath: string) => {
		setDockTool("terminal");
		setTerminalFileRequest({ file: filePath, nonce: Date.now() });
	}, []);

	const handleFileChipContextMenu = useCallback((filePath: string, point: { x: number; y: number }) => {
		setFileChipMenu({ filePath, point });
	}, []);

	const fileChipMenuItems = useMemo<Array<FloatingMenuItem>>(() => {
		const chip = fileChipMenu;
		if (!chip) return [];
		return [
			{
				key: "open-file",
				label: t("markdown.openFile"),
				onSelect: () => handleOpenLinkedFile(chip.filePath),
			},
			{
				key: "open-in-terminal",
				label: t("markdown.openInTerminal"),
				onSelect: () => handleOpenFileInTerminal(chip.filePath),
			},
		];
	}, [fileChipMenu, handleOpenFileInTerminal, handleOpenLinkedFile, t]);

	const handleCloseFileTab = useCallback(
		(tabId: string) => {
			setFileTabs(prev => {
				const next = prev.filter(t => t.id !== tabId);
				if (next.length === 0) setDockTool(cur => (cur === "files" ? null : cur));
				return next;
			});
			setActiveFileTabId(cur => {
				if (cur !== tabId) return cur;
				const remaining = fileTabs.filter(t => t.id !== tabId);
				return remaining.length > 0 ? remaining[remaining.length - 1].id : null;
			});
		},
		[fileTabs],
	);

	// Live tab title: the cached session row keeps renames and first messages
	// current; a draft falls back to its snapshot title.
	const tabTitle = useCallback(
		(tab: SessionTab) => {
			const session = sessionForTab(tab, tabsRef.current.sessionCache);
			return session ? sessionDisplayTitle(session, t) : tab.title;
		},
		[t],
	);

	// --- Tab strip plumbing -------------------------------------------------
	// Sessions whose stream may stay open: the active tab, plus the two most
	// recently used *running* background tabs (browser connection budget).
	const runningTabIds = useMemo(() => runningTabIdsFrom(tabMeta), [tabMeta]);
	const streamingTabIds = useMemo(
		() => selectStreamingTabIds({ tabs, activeTabId, runningSessionIds, runningTabIds }),
		[tabs, activeTabId, runningSessionIds, runningTabIds],
	);

	const handleActivateTab = useCallback((tabId: string) => sessionTabs.activate(tabId), [sessionTabs]);
	const handleCloseTab = useCallback((tabId: string) => sessionTabs.close(tabId), [sessionTabs]);

	// The URL always names the active tab's session (`?session=`), or is bare for
	// a draft — the same contract as the pre-tab shell, and the deep link the
	// desktop tray and the browser back/forward rely on. Skipped when the param
	// already matches: replacing it with the same value makes Next.js remount
	// the route in production. An explicit `?mode=` is carried along, otherwise
	// the first session switch inside a panel would drop it and the host would
	// suddenly get the full chrome (`/panel` needs no help: its mode is pinned by
	// the route, not the query).
	useEffect(() => {
		const current = searchParams.get("session");
		const modeParam = searchParams.get(SHELL_MODE_PARAM);
		const withMode = (params: URLSearchParams): string => {
			if (modeParam) params.set(SHELL_MODE_PARAM, modeParam);
			const query = params.toString();
			return query ? `?${query}` : "/";
		};
		if (!activeTab) return;
		if (activeTab.kind === "session" && activeTab.sessionId) {
			if (current === activeTab.sessionId) return;
			router.replace(withMode(new URLSearchParams({ session: activeTab.sessionId })), { scroll: false });
			return;
		}
		if (current === null) return;
		router.replace(withMode(new URLSearchParams()), { scroll: false });
	}, [activeTab, router, searchParams]);

	// Per-tab callbacks are created once per tab (see `bindingsFor`); point them
	// at this render's handlers so they never run a stale closure.
	tabHandlersRef.current = {
		tabMeta: patchTabMeta,
		sessionCreated: handleSessionCreated,
		sessionForked: handleSessionForked,
		agentEnd: handleAgentEnd,
		draftCwdChange: setTabDraftCwd,
		branchData: (tabId, tree, activeLeafId, onLeafChange) => {
			branchLeafChangeFnsRef.current.set(tabId, onLeafChange);
			patchTabMeta(tabId, { branchTree: tree, branchActiveLeafId: activeLeafId });
		},
	};

	// The chat area is driven by the tab list: one entry per open tab, lazily
	// mounted on first activation and kept alive (hidden) afterwards so its
	// transcript, scroll position and composer draft survive tab switches.
	const showChat = tabs.length > 0;
	// While restoring initial session from URL, don't show the placeholder
	const showPlaceholder = initialSessionRestored && !showChat;

	const activeFileTab = fileTabs.find(t => t.id === activeFileTabId) ?? null;
	const activeCwdName = activeCwd ? getFileName(activeCwd) || activeCwd : null;
	const windowTitle = activeCwdName ? `${activeCwdName} - Zeta Web` : "Zeta Web";

	// Terminal slot plumbing (P1). The workspace key is derived from the cwd the
	// pane will use, so switching workspaces switches the slot set — and with
	// it the gateway-side session key, which is why two workspaces can never
	// share a PTY. Instance ids are allocated here (t1, then max + 1).
	const terminalCwd = activeCwd ?? selectedSession?.cwd ?? null;
	const terminalWorkspace = terminalWorkspaceKey(terminalCwd);
	const terminalSlot = slotsFor(terminalSlots, terminalWorkspace);
	const handleTerminalSelectSlot = useCallback(
		(instanceId: string) => updateTerminalSlots(state => withActiveInstance(state, terminalWorkspace, instanceId)),
		[terminalWorkspace, updateTerminalSlots],
	);
	const handleTerminalNewSlot = useCallback(() => {
		updateTerminalSlots(state => {
			const { state: next } = withNewInstance(state, terminalWorkspace);
			return next;
		});
	}, [terminalWorkspace, updateTerminalSlots]);
	const handleTerminalSession = useCallback(
		(sessionId: string) =>
			updateTerminalSlots(state => withSessionId(state, terminalWorkspace, terminalSlot.active, sessionId)),
		[terminalSlot.active, terminalWorkspace, updateTerminalSlots],
	);
	const handleTerminalStopped = useCallback(
		() => updateTerminalSlots(state => withoutSessionId(state, terminalWorkspace, terminalSlot.active)),
		[terminalSlot.active, terminalWorkspace, updateTerminalSlots],
	);

	useEffect(() => {
		const syncWindowTitle = () => {
			if (document.title !== windowTitle) document.title = windowTitle;
		};

		syncWindowTitle();
		const observer = new MutationObserver(syncWindowTitle);
		observer.observe(document.head, {
			childList: true,
			subtree: true,
			characterData: true,
		});
		return () => observer.disconnect();
	}, [windowTitle]);

	// Collapsed rail: 56px icon column replacing the full sidebar body.
	const sidebarCollapsedRail = (
		<div
			style={{
				height: "100%",
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				gap: 4,
				padding: "8px 0",
			}}
		>
			{(
				[
					{
						label: t("new-session"),
						onClick: () => handleNewSession(activeCwd ?? ""),
						icon: (
							<svg
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								<path d="M12 5v14" />
								<path d="M5 12h14" />
							</svg>
						),
					},
					{
						label: t("sidebar.display.search"),
						onClick: expandSidebar,
						icon: (
							<svg
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								<circle cx="11" cy="11" r="7" />
								<line x1="21" y1="21" x2="16.5" y2="16.5" />
							</svg>
						),
					},
					{
						label: t("sidebar.openWorkspace"),
						onClick: expandSidebar,
						icon: (
							<svg
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
							</svg>
						),
					},
					{
						label: t("settings"),
						onClick: () => setSettingsConfigOpen(true),
						icon: (
							<svg
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
								<circle cx="12" cy="12" r="3" />
							</svg>
						),
					},
				] as { label: string; onClick: () => void; icon: ReactNode }[]
			).map(({ label, onClick, icon }) => (
				<button
					key={label}
					onClick={onClick}
					title={label}
					aria-label={label}
					className="sidebar-icon-btn"
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						width: 36,
						height: 36,
						padding: 0,
						background: "none",
						border: "none",
						borderRadius: 9,
						color: "var(--zeta-alias-text-muted)",
						cursor: "pointer",
					}}
				>
					{icon}
				</button>
			))}
			<div style={{ flex: 1 }} />
			<button
				onClick={expandSidebar}
				title={t("layout.expandRail")}
				aria-label={t("layout.expandRail")}
				className="sidebar-icon-btn"
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					width: 36,
					height: 36,
					padding: 0,
					background: "none",
					border: "none",
					borderRadius: 9,
					color: "var(--zeta-alias-text-muted)",
					cursor: "pointer",
				}}
			>
				<svg
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<rect x="3" y="3" width="18" height="18" rx="2" />
					<line x1="9" y1="3" x2="9" y2="21" />
					<polyline points="15 9 17.5 12 15 15" />
				</svg>
			</button>
		</div>
	);

	const sidebarContent = sidebarRailActive ? (
		sidebarCollapsedRail
	) : (
		<>
			<SessionSidebar
				selectedSessionId={selectedSession?.id ?? null}
				onSelectSession={handleSelectSession}
				onNewSession={handleNewSession}
				initialSessionId={initialSessionId}
				skipInitialProjectSelection={initialNavigation.requestedCwd !== null}
				onInitialRestoreDone={handleInitialRestoreDone}
				refreshKey={refreshKey}
				onSessionDeleted={handleSessionDeleted}
				selectedCwd={selectedSession?.cwd ?? newSessionCwd ?? null}
				onCwdChange={handleCwdChange}
				onOpenSkills={() => setSkillsConfigOpen(true)}
				onOpenStats={() => void handleOpenStatsDashboard()}
				onOpenFile={handleOpenFile}
				explorerRefreshKey={explorerRefreshKey}
				onExplorerRefresh={handleExplorerRefresh}
				onAtMention={handleAtMention}
				onAtMentions={handleAtMentions}
				planCard={
					sidebarPlan.enabled && sidebarPlan.planFilePath
						? {
								title: planTitleFromPath(sidebarPlan.planFilePath),
								onOpen: () => setDockTool("session"),
							}
						: null
				}
			/>
			<div
				style={{
					padding: "8px",
					flexShrink: 0,
					display: "flex",
					justifyContent: "space-between",
					gap: 4,
				}}
			>
				{(
					[
						{
							label: t("settings"),
							onClick: () => setSettingsConfigOpen(true),
							disabled: false,
							icon: (
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
									<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
									<circle cx="12" cy="12" r="3" />
								</svg>
							),
						},
					] as {
						label: string;
						onClick: () => void;
						disabled: boolean;
						icon: ReactNode;
					}[]
				).map(({ label, onClick, disabled, icon }) => (
					<button
						key={label}
						onClick={onClick}
						disabled={disabled}
						title={label}
						className="sidebar-icon-btn"
						style={{
							flex: 1,
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							gap: 6,
							height: 32,
							padding: 0,
							background: "none",
							border: "none",
							borderRadius: 9,
							color: "var(--zeta-alias-text-muted)",
							cursor: disabled ? "default" : "pointer",
							fontSize: 12,
							opacity: disabled ? 0.35 : 1,
						}}
					>
						{icon}
						{label}
					</button>
				))}
			</div>
		</>
	);

	return (
		<ShellBootGate failures={bootFailures}>
			<style>{`
      @keyframes session-info-pop {
        0% {
          opacity: 0;
          transform: translateY(-24px);
          filter: blur(6px);
          box-shadow: 0 2px 8px transparent;
        }
        55% {
          opacity: 1;
          transform: translateY(0);
          filter: blur(0);
          background: color-mix(in srgb, var(--zeta-alias-accent) 8%, var(--zeta-alias-bg-panel));
          box-shadow: 0 18px 44px color-mix(in srgb, var(--zeta-alias-accent) 16%, transparent);
        }
        100% {
          opacity: 1;
          transform: translateY(0);
          filter: blur(0);
          background: var(--zeta-alias-bg-panel);
          box-shadow: 0 10px 28px var(--zeta-alias-surface-shadow);
        }
      }
      @keyframes session-info-light-wash {
        0% {
          opacity: 0;
          transform: translateX(-110%) skewX(-16deg);
        }
        24% {
          opacity: 0.42;
        }
        100% {
          opacity: 0;
          transform: translateX(115%) skewX(-16deg);
        }
      }
      .session-info-popover {
        position: relative;
        overflow: hidden;
        transform-origin: top right;
        animation: session-info-pop 360ms ease-out both;
        will-change: transform, opacity, filter, background, box-shadow;
      }
      .session-info-popover::after {
        content: "";
        position: absolute;
        top: 0;
        bottom: 0;
        left: 0;
        width: 44%;
        pointer-events: none;
        background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--zeta-alias-accent) 24%, transparent), transparent);
        animation: session-info-light-wash 620ms ease-out both;
      }
      @media (prefers-reduced-motion: reduce) {
        .session-info-popover,
        .session-info-popover::after {
          animation: none;
        }
      }
      @media (max-width: 640px) {
        .sidebar-overlay-backdrop.sidebar-mobile-pending {
          opacity: 0 !important;
          pointer-events: none !important;
        }
        .sidebar-container.sidebar-mobile-pending.sidebar-open {
          transform: translateX(calc(-100% - env(safe-area-inset-left)));
          box-shadow: none;
        }
      }
      .panel-resize-handle {
        position: relative;
        z-index: 220;
        width: 12px;
        margin: 0 -6px;
        flex: 0 0 12px;
        cursor: col-resize;
        touch-action: none;
        outline: none;
      }
      .panel-resize-handle::after {
        content: "";
        position: absolute;
        top: 0;
        bottom: 0;
        left: 5px;
        width: 2px;
        pointer-events: none;
        background: transparent;
        transition: background 0.12s ease;
      }
      .panel-resize-handle:hover::after,
      .panel-resize-handle:focus-visible::after,
      .panel-resize-handle.is-resizing::after {
        background: color-mix(in srgb, var(--zeta-alias-text-muted) 70%, var(--zeta-alias-border));
      }
      @media (min-width: 641px) {
        .sidebar-overlay-backdrop {
          display: none !important;
        }
        .sidebar-container {
          position: relative;
          overflow: hidden;
          transition: width 0.2s ease, min-width 0.2s ease;
        }
		.sidebar-container.sidebar-open {
          width: var(--sidebar-width, 260px);
          min-width: var(--sidebar-width, 260px);
        }
        .sidebar-container.sidebar-collapsed,
        .sidebar-container.sidebar-collapsed.sidebar-open {
          width: ${SIDEBAR_COLLAPSED_WIDTH}px;
          min-width: ${SIDEBAR_COLLAPSED_WIDTH}px;
        }
        .sidebar-container.sidebar-collapsed > * {
          width: ${SIDEBAR_COLLAPSED_WIDTH}px;
          min-width: ${SIDEBAR_COLLAPSED_WIDTH}px;
        }
        .sidebar-container.sidebar-closed {
          width: 0;
          min-width: 0;
          border-right: none !important;
        }
        .sidebar-container > * {
          width: var(--sidebar-width, 260px);
          min-width: var(--sidebar-width, 260px);
        }
        .sidebar-container.sidebar-resizing,
        .sidebar-container.sidebar-resizing > * {
          transition: none !important;
        }
        .right-panel-container.right-panel-open {
          width: var(--right-panel-width, clamp(360px, 42vw, 640px));
          min-width: 300px;
        }
        .right-panel-container.right-panel-closed {
          width: 0;
          min-width: 0;
          border-left: none !important;
        }
        .right-panel-container > * {
          width: var(--right-panel-width, clamp(360px, 42vw, 640px));
          min-width: 300px;
        }
        .right-panel-container.right-panel-resizing,
        .right-panel-container.right-panel-resizing > * {
          transition: none !important;
        }
      }
      /* Compact desktop file panel: overlay the chat instead of collapsing it. */
      @media (min-width: 641px) and (max-width: 959px) {
        .right-panel-resize-handle {
          display: none;
        }
        .right-panel-container {
          position: fixed;
          top: 0;
          right: env(safe-area-inset-right);
          bottom: 0;
          z-index: 250;
          width: min(560px, calc(100vw - 48px));
          min-width: 300px;
          overflow: hidden;
          box-shadow: -12px 0 32px var(--zeta-alias-surface-shadow);
          transition: transform 0.2s ease;
        }
        .right-panel-container.right-panel-open {
          transform: translateX(0);
        }
        .right-panel-container.right-panel-closed {
          transform: translateX(100%);
          pointer-events: none;
        }
        .right-panel-container > * {
          width: 100%;
          min-width: 0;
        }
      }
    `}</style>
			{/* Self-drawn titlebar — frameless desktop shell only, never inside an
        panel (the host owns the frame). Fixed so the existing three-column row
        only needs a top inset to make room. */}
			{desktopChrome && !panel && (
				<div
					style={
						{
							position: "fixed",
							top: 0,
							left: 0,
							right: 0,
							height: 30,
							zIndex: 400,
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							background: "var(--zeta-alias-bg-panel)",
							borderBottom: "1px solid var(--zeta-alias-border)",
							userSelect: "none",
							WebkitAppRegion: "drag",
						} as React.CSSProperties
					}
				>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: 7,
							paddingLeft: 11,
							fontSize: 11.5,
							fontWeight: 600,
							letterSpacing: "0.04em",
							color: "var(--zeta-alias-text-muted)",
						}}
					>
						Zeta
						{canLaunchTools && (
							<div
								style={
									{
										display: "flex",
										alignItems: "center",
										gap: 4,
										marginLeft: 6,
										WebkitAppRegion: "no-drag",
									} as React.CSSProperties
								}
							>
								{(["zetacode", "zetaide", "zetaeditor", "zetawork"] as const).map(tool => (
									<button
										key={tool}
										type="button"
										onClick={() => launchTool(tool)}
										title={tool}
										aria-label={tool}
										style={
											{
												padding: "2px 8px",
												border: "1px solid var(--zeta-alias-border)",
												borderRadius: 4,
												background: "transparent",
												color: "var(--zeta-alias-text-muted)",
												fontSize: 10.5,
												fontWeight: 500,
												letterSpacing: "0.02em",
												cursor: "pointer",
												WebkitAppRegion: "no-drag",
											} as React.CSSProperties
										}
									>
										{tool}
									</button>
								))}
							</div>
						)}
					</div>
					<div style={{ display: "flex", alignItems: "stretch", height: "100%" }}>
						<TitlebarButton label={t("titlebar.minimize")} onClick={() => void minimizeWindow()}>
							<line x1="5" y1="12" x2="19" y2="12" />
						</TitlebarButton>
						<TitlebarButton
							label={windowMaximized ? t("titlebar.restore") : t("titlebar.maximize")}
							onClick={() => void maximizeWindow()}
						>
							{windowMaximized ? (
								<>
									<rect x="5" y="7" width="10" height="10" rx="1.5" />
									<path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h8A1.5 1.5 0 0 1 20 5.5V13.5A1.5 1.5 0 0 1 18.5 15H17" />
								</>
							) : (
								<rect x="5.5" y="5.5" width="13" height="13" rx="1.5" />
							)}
						</TitlebarButton>
						<TitlebarButton label={t("titlebar.close")} danger onClick={() => void closeWindow()}>
							<line x1="6" y1="6" x2="18" y2="18" />
							<line x1="18" y1="6" x2="6" y2="18" />
						</TitlebarButton>
					</div>
				</div>
			)}
			{/* Mobile overlay backdrop */}
			{!panel && (
				<div
					className={`sidebar-overlay-backdrop${mobileSidebarReady ? "" : " sidebar-mobile-pending"}`}
					onClick={() => setSidebarOpen(false)}
					style={{
						position: "fixed",
						inset: 0,
						zIndex: 199,
						background: "color-mix(in srgb, var(--zeta-alias-bg) 40%, transparent)",
						opacity: sidebarOpen ? 1 : 0,
						pointerEvents: sidebarOpen ? "auto" : "none",
						transition: "opacity 0.25s ease",
					}}
				/>
			)}

			<ShellLayout
				mode={shellMode}
				sidebarOpen={sidebarOpen}
				sidebarCollapsed={sidebarRailActive}
				detailOpen={dockTool !== null}
				isMobile={isMobile}
				desktopChromeInset={desktopChrome && !panel ? 30 : 0}
			>
				<ShellSlot name="sidebar">{sidebarContent}</ShellSlot>

				<ShellSlot name="topbar">
					{/* Top bar with sidebar toggle */}
					<div
						ref={topBarRef}
						style={{
							display: "flex",
							alignItems: "center",
							flexShrink: 0,
							borderBottom: "1px solid var(--zeta-alias-border)",
							height: "calc(36px + env(safe-area-inset-top))",
							paddingTop: "env(safe-area-inset-top)",
							background: "var(--zeta-alias-bg-panel)",
						}}
					>
						<button
							onClick={handleSidebarToggle}
							title={
								isMobile
									? sidebarOpen
										? t("layout.hideSidebar")
										: t("layout.showSidebar")
									: sidebarRailActive
										? t("layout.expandRail")
										: t("layout.collapseToRail")
							}
							aria-label={
								isMobile
									? sidebarOpen
										? t("layout.hideSidebar")
										: t("layout.showSidebar")
									: sidebarRailActive
										? t("layout.expandRail")
										: t("layout.collapseToRail")
							}
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								width: 36,
								height: 36,
								padding: 0,
								background: "none",
								border: "none",
								borderRight: "1px solid var(--zeta-alias-border)",
								color: "var(--zeta-alias-text-muted)",
								cursor: "pointer",
								flexShrink: 0,
								transition: "color 0.12s",
							}}
							onMouseEnter={e => {
								e.currentTarget.style.color = "var(--zeta-alias-text)";
							}}
							onMouseLeave={e => {
								e.currentTarget.style.color = "var(--zeta-alias-text-muted)";
							}}
						>
							{sidebarOpen && !sidebarRailActive ? (
								<svg
									width="16"
									height="16"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
								>
									<rect x="3" y="3" width="18" height="18" rx="2" />
									<line x1="9" y1="3" x2="9" y2="21" />
								</svg>
							) : (
								<svg
									width="18"
									height="18"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
								>
									<line x1="3" y1="6" x2="21" y2="6" />
									<line x1="3" y1="12" x2="21" y2="12" />
									<line x1="3" y1="18" x2="21" y2="18" />
								</svg>
							)}
						</button>
						<ThemePicker />
						<LanguagePicker />
						{showChat && (
							<div
								style={{
									display: "flex",
									alignItems: "stretch",
									height: "100%",
								}}
							>
								<OpenSplitButton
									activeCwd={activeCwd ?? selectedSession?.projectRoot ?? selectedSession?.cwd ?? newSessionCwd}
								/>
								<button
									onClick={() => {
										if (checkingUpdate) return;
										if (updateInfo) {
											if (updateInfo.available && window.confirm(t("topbar.updateConfirmFmt", { version: updateInfo.latest }))) {
												void handleRunUpdate();
											} else {
												showShellNotice(t("you-are-up-to-date"));
												setUpdateInfo(null);
											}
										} else {
											void handleCheckUpdate();
										}
									}}
									disabled={updating || checkingUpdate}
									title={
										checkingUpdate
											? t("checking-for-updates")
											: updateInfo && updateInfo.available
												? t("topbar.updateAvailableFmt", { version: updateInfo.latest })
												: t("topbar.checkForUpdates")
									}
									style={{
										display: "flex",
										alignItems: "center",
										gap: 6,
										height: "100%",
										padding: "0 12px",
										background: "none",
										border: "none",
										borderTop: "2px solid transparent",
										borderRight: "1px solid var(--zeta-alias-border)",
										cursor: updating || checkingUpdate ? "default" : "pointer",
										color: updateInfo?.available ? "var(--zeta-alias-accent)" : "var(--zeta-alias-text-muted)",
										fontSize: 11,
										whiteSpace: "nowrap",
										opacity: updating || checkingUpdate ? 0.5 : 1,
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
										<path d="M21 12a9 9 0 1 1-9-9" />
										<polyline points="21 3 21 9 15 9" />
									</svg>
									{!isMobile && (
										<span>
											{checkingUpdate
												? t("checking-for-updates")
												: updateInfo && updateInfo.available
													? `v${updateInfo.latest}`
													: t("topbar.update")}
										</span>
									)}
								</button>
								{shellNotice && (
									<div
										style={{
											position: "fixed",
											top: 40,
											right: 16,
											zIndex: 400,
											background: "var(--zeta-alias-bg-panel)",
											border: "1px solid var(--zeta-alias-border)",
											borderRadius: 8,
											boxShadow: "0 4px 16px color-mix(in srgb, var(--zeta-alias-bg) 20%, transparent)",
											padding: "8px 12px",
											fontSize: 12,
											color: "var(--zeta-alias-text)",
										}}
									>
										{shellNotice}
									</div>
								)}
								<TopPanelChips
									activeId={activeTopPanel}
									onToggle={id => toggleTopPanel(id as "branches" | "system")}
									isMobile={isMobile}
									stateFor={id => (id === "system" ? { title: t("topbar.systemPrompt") } : {})}
									overrides={{
										branches: (
											<BranchNavigator
												tree={branchTree}
												activeLeafId={branchActiveLeafId}
												onLeafChange={handleBranchLeafChange}
												inline
												compact={isMobile}
												containerRef={topBarRef}
												open={activeTopPanel === "branches"}
												onToggle={() => toggleTopPanel("branches")}
												hasSession
											/>
										),
									}}
								/>
							</div>
						)}
						{/* Session stats — right-aligned in top bar */}
						{showChat &&
							(sessionStats || contextUsage) &&
							(() => {
								const tokenUsage = sessionStats?.tokens;
								const c = sessionStats?.cost ?? 0;
								const fmt = (n: number) =>
									n >= 1_000_000
										? `${(n / 1_000_000).toFixed(1)}M`
										: n >= 1000
											? `${(n / 1000).toFixed(0)}k`
											: String(n);
								const costStr = c > 0 ? (c >= 0.01 ? `$${c.toFixed(2)}` : `<$0.01`) : null;

								let ctxColor = "var(--zeta-alias-text-muted)";
								let ctxStr: string | null = null;
								if (contextUsage?.contextWindow) {
									const pct = contextUsage.percent;
									if (pct !== null && pct > 90) ctxColor = "var(--zeta-alias-status-error-foreground)";
									else if (pct !== null && pct > 70) ctxColor = "var(--zeta-alias-status-warning-foreground)";
									ctxStr =
										pct !== null
											? `${pct.toFixed(0)}% / ${fmt(contextUsage.contextWindow)}`
											: `0% / ${fmt(contextUsage.contextWindow)}`;
								}

								const tooltipParts: string[] = [];
								if (tokenUsage) {
									tooltipParts.push(`in: ${tokenUsage.input.toLocaleString(locale)}`);
									tooltipParts.push(`out: ${tokenUsage.output.toLocaleString(locale)}`);
									tooltipParts.push(`cache read: ${tokenUsage.cacheRead.toLocaleString(locale)}`);
									tooltipParts.push(`cache write: ${tokenUsage.cacheWrite.toLocaleString(locale)}`);
									if (c > 0) tooltipParts.push(`cost: $${c.toFixed(4)}`);
								}
								if (contextUsage?.contextWindow) {
									const pct = contextUsage.percent;
									tooltipParts.push(
										`context: ${pct !== null ? pct.toFixed(1) + "%" : "0.0%"} of ${contextUsage.contextWindow.toLocaleString(locale)} tokens`,
									);
								}
								const tooltip = tooltipParts.join("  |  ");

								return (
									<button
										type="button"
										onClick={() => toggleTopPanel("session")}
										title={tooltip || t("session-info")}
										aria-label={t("session-info")}
										aria-pressed={activeTopPanel === "session"}
										style={{
											marginLeft: "auto",
											display: "flex",
											alignItems: "center",
											gap: 10,
											paddingLeft: 12,
											paddingRight: 12,
											height: "100%",
											background: activeTopPanel === "session" ? "var(--zeta-alias-bg-selected)" : "none",
											border: "none",
											borderTop:
												activeTopPanel === "session" ? "2px solid var(--zeta-alias-accent)" : "2px solid transparent",
											fontSize: 11,
											color: "var(--zeta-alias-text-muted)",
											whiteSpace: "nowrap",
											cursor: "pointer",
											fontVariantNumeric: "tabular-nums",
											transition: "color 0.1s, background 0.1s",
										}}
										onMouseEnter={e => {
											e.currentTarget.style.color = "var(--zeta-alias-text)";
										}}
										onMouseLeave={e => {
											e.currentTarget.style.color =
												activeTopPanel === "session" ? "var(--zeta-alias-text)" : "var(--zeta-alias-text-muted)";
										}}
									>
										{isMobile && (
											<svg
												width="14"
												height="14"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												strokeWidth="2"
												strokeLinecap="round"
												strokeLinejoin="round"
												aria-hidden="true"
											>
												<circle cx="12" cy="12" r="10" />
												<line x1="12" y1="16" x2="12" y2="12" />
												<line x1="12" y1="8" x2="12.01" y2="8" />
											</svg>
										)}
										{!isMobile && tokenUsage && tokenUsage.input > 0 && (
											<span
												style={{
													display: "flex",
													alignItems: "center",
													gap: 4,
												}}
											>
												<svg
													width="12"
													height="12"
													viewBox="0 0 10 10"
													fill="none"
													stroke="currentColor"
													strokeWidth="1.2"
													strokeLinecap="round"
													strokeLinejoin="round"
												>
													<line x1="5" y1="8.5" x2="5" y2="1.5" />
													<polyline points="2 4 5 1.5 8 4" />
												</svg>
												{fmt(tokenUsage.input)}
											</span>
										)}
										{!isMobile && tokenUsage && tokenUsage.output > 0 && (
											<span
												style={{
													display: "flex",
													alignItems: "center",
													gap: 4,
												}}
											>
												<svg
													width="12"
													height="12"
													viewBox="0 0 10 10"
													fill="none"
													stroke="currentColor"
													strokeWidth="1.2"
													strokeLinecap="round"
													strokeLinejoin="round"
												>
													<line x1="5" y1="1.5" x2="5" y2="8.5" />
													<polyline points="2 6 5 8.5 8 6" />
												</svg>
												{fmt(tokenUsage.output)}
											</span>
										)}
										{!isMobile && tokenUsage && tokenUsage.cacheRead > 0 && (
											<span
												style={{
													display: "flex",
													alignItems: "center",
													gap: 4,
												}}
											>
												<svg
													width="12"
													height="12"
													viewBox="0 0 10 10"
													fill="none"
													stroke="currentColor"
													strokeWidth="1.2"
													strokeLinecap="round"
													strokeLinejoin="round"
												>
													<path d="M8.5 5a3.5 3.5 0 1 1-1-2.45" />
													<polyline points="6.5 1.5 8.5 2.5 7.5 4.5" />
												</svg>
												{fmt(tokenUsage.cacheRead)}
											</span>
										)}
										{!isMobile && costStr && (
											<span
												style={{
													display: "flex",
													alignItems: "center",
													color: "var(--zeta-alias-text)",
													fontWeight: 500,
												}}
											>
												{costStr}
											</span>
										)}
										{ctxStr && (
											<span
												style={{
													display: "flex",
													alignItems: "center",
													gap: 4,
													color: ctxColor,
												}}
											>
												<svg
													width="12"
													height="12"
													viewBox="0 0 10 10"
													fill="none"
													stroke="currentColor"
													strokeWidth="1.2"
													strokeLinecap="round"
													strokeLinejoin="round"
												>
													<path d="M1 9 L1 5 Q1 1 5 1 Q9 1 9 5 L9 9" />
													<line x1="1" y1="9" x2="9" y2="9" />
												</svg>
												{ctxStr}
											</span>
										)}
									</button>
								);
							})()}
						{/* Top panel dropdown — shared, only one active at a time */}
						{activeTopPanel && topPanelPos && (
							<div
								style={{
									position: "fixed",
									top: topPanelPos.top,
									left: topPanelPos.left,
									width: topPanelPos.width,
									// Reserve the self-drawn titlebar height so the dropdown never
									// runs past the bottom of the frameless window.
									maxHeight: `calc(100dvh - ${topPanelPos.top + (desktopChrome ? 30 : 0)}px)`,
									overflowY: "auto",
									zIndex: 500,
								}}
							>
								{activeTopPanel === "system" && (
									<div
										style={{
											background: "var(--zeta-alias-bg-panel)",
											borderBottom: "1px solid var(--zeta-alias-border)",
										}}
									>
										{systemPrompt ? (
											<div
												style={{
													maxHeight: "min(600px, 75vh)",
													overflowY: "auto",
													padding: "12px 16px",
													color: "var(--zeta-alias-text-muted)",
													fontSize: 12,
													lineHeight: 1.6,
													whiteSpace: "pre-wrap",
													fontFamily: "var(--font-mono)",
												}}
											>
												{systemPrompt}
											</div>
										) : systemPrompt === "" ? (
											<div
												style={{
													padding: "10px 16px",
													fontSize: 12,
													color: "var(--zeta-alias-text-muted)",
													fontStyle: "italic",
												}}
											>
												{t("system-prompt.empty")}
											</div>
										) : (
											<div
												style={{
													padding: "10px 16px",
													fontSize: 12,
													color: "var(--zeta-alias-text-muted)",
													fontStyle: "italic",
												}}
											>
												{t("system-prompt.load-hint")}
											</div>
										)}
									</div>
								)}
								{activeTopPanel === "session" && (
									<div
										className="session-info-popover"
										style={{
											background: "var(--zeta-alias-bg-panel)",
											borderBottom: "1px solid var(--zeta-alias-border)",
											boxShadow: "0 10px 28px color-mix(in srgb, var(--zeta-alias-bg) 10%, transparent)",
											padding: "12px 16px",
										}}
									>
										{sessionStats ? (
											(() => {
												const sessionRows = [
													...(sessionStats.sessionName
														? [
																{
																	label: t("session-info.name"),
																	value: sessionStats.sessionName,
																	copyField: null,
																},
															]
														: []),
													{
														label: t("session-info.file"),
														value: sessionStats.sessionFile ?? t("session-info.in-memory"),
														copyField: "file" as const,
													},
													{
														label: t("session-info.id"),
														value: sessionStats.sessionId,
														copyField: "id" as const,
													},
												];
												const messageRows = [
													[t("session-info.messages.user"), sessionStats.userMessages.toLocaleString(locale)],
													[t("session-info.messages.assistant"), sessionStats.assistantMessages.toLocaleString(locale)],
													[t("session-info.messages.tool-calls"), sessionStats.toolCalls.toLocaleString(locale)],
													[t("session-info.messages.tool-results"), sessionStats.toolResults.toLocaleString(locale)],
													[t("session-info.messages.total"), sessionStats.totalMessages.toLocaleString(locale)],
												];
												const tokenRows = [
													[t("session-info.tokens.input"), sessionStats.tokens.input.toLocaleString(locale)],
													[t("session-info.tokens.output"), sessionStats.tokens.output.toLocaleString(locale)],
													...(sessionStats.tokens.cacheRead > 0
														? [[t("session-info.tokens.cache-read"), sessionStats.tokens.cacheRead.toLocaleString(locale)]]
														: []),
													...(sessionStats.tokens.cacheWrite > 0
														? [[t("session-info.tokens.cache-write"), sessionStats.tokens.cacheWrite.toLocaleString(locale)]]
														: []),
													[t("session-info.tokens.total"), sessionStats.tokens.total.toLocaleString(locale)],
												];
												const ctx = contextUsage ?? sessionStats.contextUsage;
												const formatCompact = (n: number) =>
													n >= 1_000_000
														? `${(n / 1_000_000).toFixed(1)}M`
														: n >= 1000
															? `${(n / 1000).toFixed(0)}k`
															: String(n);
												const extraTokenRows = [
													...(sessionStats.cost > 0 ? [[t("session-info.cost"), `$${sessionStats.cost.toFixed(4)}`]] : []),
													...(ctx?.contextWindow
														? [
																[
																	t("session-info.context"),
																	`${ctx.percent !== null ? `${ctx.percent.toFixed(1)}%` : "?"} / ${formatCompact(ctx.contextWindow)}`,
																],
															]
														: []),
												];
												const section = (
													title: string,
													sectionRows: string[][],
													valueAlign: "left" | "right" = "left",
													compact = false,
												) => (
													<div style={{ minWidth: 0 }}>
														<div
															style={{
																fontSize: 11,
																fontWeight: 700,
																color: "var(--zeta-alias-text)",
																marginBottom: 6,
															}}
														>
															{title}
														</div>
														<div
															style={{
																display: "grid",
																gridTemplateColumns: compact
																	? "max-content max-content"
																	: "auto minmax(0, 1fr)",
																columnGap: compact ? 14 : 12,
																rowGap: 4,
																justifyContent: compact ? "start" : undefined,
															}}
														>
															{sectionRows.map(([label, value]) => (
																<div key={`${title}:${label}`} style={{ display: "contents" }}>
																	<div
																		style={{
																			color: "var(--zeta-alias-text-dim)",
																			whiteSpace: "nowrap",
																		}}
																	>
																		{label}
																	</div>
																	<div
																		style={{
																			color: "var(--zeta-alias-text-muted)",
																			minWidth: 0,
																			overflowWrap: compact ? "normal" : "anywhere",
																			textAlign: valueAlign,
																			whiteSpace: valueAlign === "right" ? "nowrap" : "normal",
																		}}
																	>
																		{value}
																	</div>
																</div>
															))}
														</div>
													</div>
												);
												const copyButton = (field: SessionCopyField, value: string) => {
													const copied = copiedSessionField === field;
													return (
														<button
															type="button"
															title={
																copied
																	? t("copied")
																	: field === "file"
																		? t("session-info.copy-file")
																		: t("session-info.copy-id")
															}
															onClick={() => handleCopySessionField(field, value)}
															style={{
																alignSelf: "start",
																display: "inline-flex",
																alignItems: "center",
																justifyContent: "center",
																width: 22,
																height: 22,
																marginTop: -2,
																color: copied ? "var(--zeta-alias-accent)" : "var(--zeta-alias-text-dim)",
																background: "transparent",
																border: "1px solid var(--zeta-alias-border)",
																borderRadius: 4,
																cursor: "pointer",
																flex: "0 0 auto",
																transition: "color 0.12s, border-color 0.12s, background 0.12s",
															}}
															onMouseEnter={e => {
																e.currentTarget.style.color = "var(--zeta-alias-accent)";
																e.currentTarget.style.borderColor = "var(--zeta-alias-accent)";
																e.currentTarget.style.background = "var(--zeta-alias-bg-hover)";
															}}
															onMouseLeave={e => {
																e.currentTarget.style.color = copied
																	? "var(--zeta-alias-accent)"
																	: "var(--zeta-alias-text-dim)";
																e.currentTarget.style.borderColor = "var(--zeta-alias-border)";
																e.currentTarget.style.background = "transparent";
															}}
														>
															{copied ? (
																<svg
																	width="12"
																	height="12"
																	viewBox="0 0 24 24"
																	fill="none"
																	stroke="currentColor"
																	strokeWidth="2"
																	strokeLinecap="round"
																	strokeLinejoin="round"
																	aria-hidden="true"
																>
																	<polyline points="20 6 9 17 4 12" />
																</svg>
															) : (
																<svg
																	width="12"
																	height="12"
																	viewBox="0 0 24 24"
																	fill="none"
																	stroke="currentColor"
																	strokeWidth="2"
																	strokeLinecap="round"
																	strokeLinejoin="round"
																	aria-hidden="true"
																>
																	<rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
																	<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
																</svg>
															)}
														</button>
													);
												};
												const sessionInfoSection = (
													<div style={{ minWidth: 0 }}>
														<div
															style={{
																fontSize: 11,
																fontWeight: 700,
																color: "var(--zeta-alias-text)",
																marginBottom: 6,
															}}
														>
															{t("session-info")}
														</div>
														<div
															style={{
																display: "grid",
																gridTemplateColumns: "auto minmax(0, 1fr) auto",
																columnGap: 12,
																rowGap: 8,
																alignItems: "start",
															}}
														>
															{sessionRows.map(row => (
																<div key={`session-info:${row.label}`} style={{ display: "contents" }}>
																	<div
																		style={{
																			color: "var(--zeta-alias-text-dim)",
																			whiteSpace: "nowrap",
																		}}
																	>
																		{row.label}
																	</div>
																	<div
																		style={{
																			color: "var(--zeta-alias-text-muted)",
																			minWidth: 0,
																			overflowWrap: "anywhere",
																			wordBreak: "break-word",
																			whiteSpace: "normal",
																		}}
																	>
																		{row.value}
																	</div>
																	<div>
																		{row.copyField ? copyButton(row.copyField, row.value) : null}
																	</div>
																</div>
															))}
														</div>
													</div>
												);

												return (
													<div
														style={{
															display: "grid",
															gridTemplateColumns: isMobile
																? "1fr"
																: "minmax(360px, 1.7fr) minmax(140px, 0.55fr) minmax(190px, 0.75fr)",
															gap: isMobile ? 16 : 24,
															fontSize: 12,
															lineHeight: 1.5,
															fontFamily: "var(--font-mono)",
														}}
													>
														{sessionInfoSection}
														{section(t("session-info.section-messages"), messageRows)}
														{section(
															t("session-info.section-tokens"),
															[...tokenRows, ...extraTokenRows],
															"right",
															true,
														)}
													</div>
												);
											})()
										) : (
											<div
												style={{
													fontSize: 12,
													color: "var(--zeta-alias-text-muted)",
													fontStyle: "italic",
												}}
											>
												{t("session-info.empty")}
											</div>
										)}
									</div>
								)}
							</div>
						)}
					</div>
				</ShellSlot>

				<ShellSlot name="tabs">
					{/* Session tab strip — one tab per open chat */}
					{tabs.length > 0 && (
						<SessionTabBar
							tabs={tabs}
							activeTabId={activeTabId}
							runningTabIds={runningTabIds}
							streamingTabIds={streamingTabIds}
							titleFor={tabTitle}
							onActivateTab={handleActivateTab}
							onCloseTab={handleCloseTab}
							onNewTab={() => handleNewSession(activeCwd ?? "")}
							isMobile={isMobile}
						/>
					)}
				</ShellSlot>

				<ShellSlot name="center">
					{/* Chat content */}
					<div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
						{showChat ? (
							// One ChatWindow per tab: mounted on first activation, kept
							// mounted (hidden) afterwards so its transcript, scroll
							// position and composer draft survive tab switches. Hidden
							// tabs are inert — see the `active` / `streamActive` props.
							tabs.map(tab => {
								const meta = tabMetaFor(tabMeta, tab.id);
								// A degraded draft (no workspace resolved) renders its
								// picker before anything is mounted; every other tab waits
								// for its first activation.
								const isDegraded = tab.kind === "draft" && tab.draftCwd === null;
								if (!meta.mounted && !isDegraded) return null;
								const tabSession = sessionForTab(tab, sessionCache);
								const bindings = bindingsFor(tab.id);
								return (
									<div
										key={tab.id}
										style={{
											position: "absolute",
											inset: 0,
											display: tab.id === activeTabId ? "block" : "none",
										}}
									>
										{isDegraded ? (
											<DegradedDraftCard onWorkspaceSelect={cwd => setTabDraftCwd(tab.id, cwd)} />
										) : (
											<ChatWindow
												key={`${tab.id}:${meta.remountNonce}`}
												tabId={tab.id}
												active={tab.id === activeTabId}
												streamActive={streamingTabIds.has(tab.id)}
												draftKey={draftKeyForTab(tab)}
												session={tabSession}
												newSessionCwd={tab.kind === "draft" ? tab.draftCwd : null}
												explicitNew={tab.explicitNew}
												onNewSessionCwdChange={bindings.onNewSessionCwdChange}
												onTabMeta={bindings.onTabMeta}
												onAgentEnd={bindings.onAgentEnd}
												onSessionCreated={bindings.onSessionCreated}
												onSessionForked={bindings.onSessionForked}
												modelsRefreshKey={modelsRefreshKey}
												chatInputRef={bindings.inputRef}
												onBranchDataChange={bindings.onBranchDataChange}
												onSessionStatsPanelOpen={openSessionStatsPanel}
												onOpenFile={handleOpenLinkedFile}
												onOpenFileContextMenu={handleFileChipContextMenu}
											/>
										)}
									</div>
								);
							})
						) : initialCwdStatus === "validating" ? (
							<div
								role="status"
								style={{
									height: "100%",
									display: "flex",
									flexDirection: "column",
									alignItems: "center",
									justifyContent: "center",
									gap: 8,
									padding: 24,
									color: "var(--zeta-alias-text-muted)",
									textAlign: "center",
								}}
							>
								<div style={{ fontSize: 14, color: "var(--zeta-alias-text)" }}>Opening workspace...</div>
								<div
									style={{
										maxWidth: "min(720px, 100%)",
										overflowWrap: "anywhere",
										fontFamily: "var(--font-mono)",
										fontSize: 12,
									}}
								>
									{initialNavigation.requestedCwd}
								</div>
							</div>
						) : initialCwdStatus === "error" ? (
							<div
								role="alert"
								style={{
									height: "100%",
									display: "flex",
									flexDirection: "column",
									alignItems: "center",
									justifyContent: "center",
									gap: 8,
									padding: 24,
									color: "var(--zeta-alias-text-muted)",
									textAlign: "center",
								}}
							>
								<div
									style={{
										fontSize: 14,
										color: "var(--zeta-alias-status-error-foreground)",
									}}
								>
									{t("unable-to-open-workspace")}
								</div>
								<div
									style={{
										maxWidth: "min(720px, 100%)",
										overflowWrap: "anywhere",
										fontFamily: "var(--font-mono)",
										fontSize: 12,
									}}
								>
									{initialNavigation.requestedCwd}
								</div>
								<div style={{ maxWidth: 720, fontSize: 12 }}>{initialCwdError}</div>
							</div>
						) : showPlaceholder ? (
							panel ? (
								// A panel has no sidebar, so the "pick a project in the
								// sidebar" placeholders below would be dead instructions.
								// The host normally passes `?session=`/`?cwd=`; when it does
								// not, hand the workspace picker + composer straight to the
								// surface and let the pick create the draft tab.
								<DegradedDraftCard onWorkspaceSelect={cwd => openDraftTab(cwd, true)} />
							) : activeCwd ? (
								<div
									style={{
										height: "100%",
										display: "flex",
										flexDirection: "column",
										alignItems: "center",
										justifyContent: "center",
										gap: 16,
										color: "var(--zeta-alias-text-muted)",
										fontSize: 14,
									}}
								>
									{isStarfield && (
										<div
											style={{
												display: "flex",
												flexDirection: "column",
												alignItems: "center",
												gap: 12,
											}}
										>
											<StarfieldEmblem size={120} />
											<div
												style={{
													fontFamily: "var(--font-display)",
													fontSize: 13,
													letterSpacing: "0.16em",
													color: "var(--zeta-alias-accent)",
													textTransform: "uppercase",
												}}
											>
												{t("constellation-ready")}
											</div>
										</div>
									)}
									<div>{t("select-a-session-from-the-sidebar")}</div>
								</div>
							) : (
								<div
									style={{
										height: "100%",
										display: "flex",
										flexDirection: "column",
										alignItems: "center",
										justifyContent: "center",
										padding: 24,
										userSelect: "none",
									}}
								>
									{isStarfield ? (
										<div
											style={{
												display: "flex",
												flexDirection: "column",
												alignItems: "center",
												gap: 20,
												textAlign: "center",
												maxWidth: 540,
											}}
										>
											<StarfieldEmblem size={160} />
											<div
												style={{
													fontFamily: "var(--font-display)",
													fontSize: 20,
													fontWeight: 900,
													letterSpacing: "0.2em",
													color: "var(--zeta-alias-text)",
													textTransform: "uppercase",
												}}
											>
												STARFIELD // CONSTELLATION FIELD
											</div>
											<div
												style={{
													fontFamily: "var(--font-mono)",
													fontSize: 12,
													color: "var(--zeta-alias-accent)",
													letterSpacing: "0.1em",
												}}
											>
												SYS.LOC // ZETA-WEB-INTERFACE · MISSION AGENT ACTIVE
											</div>
											<div
												style={{
													fontSize: 13,
													color: "var(--zeta-alias-text-muted)",
													lineHeight: 1.8,
													background: "var(--zeta-alias-surface-subtle)",
													border: "1px solid var(--zeta-alias-border)",
													borderLeft: "3px solid var(--zeta-alias-accent)",
													padding: "14px 20px",
													textAlign: "left",
													width: "100%",
												}}
											>
												<span
													style={{
														color: "var(--zeta-alias-status-warning-foreground)",
														fontFamily: "var(--font-mono)",
														fontWeight: 700,
													}}
												>
													01.
												</span>{" "}
												{t("select-a-project-directory-from-the-sidebar")}
												<br />
												<span
													style={{
														color: "var(--zeta-alias-status-warning-foreground)",
														fontFamily: "var(--font-mono)",
														fontWeight: 700,
													}}
												>
													02.
												</span>{" "}
												{t("configure-provider-models-via-the-models-configu")}
											</div>
										</div>
									) : (
										<div
											style={{
												position: "absolute",
												top: 12,
												left: 12,
												display: "flex",
												alignItems: "flex-start",
												gap: 8,
												pointerEvents: "none",
											}}
										>
											<svg
												width="44"
												height="44"
												viewBox="0 0 24 24"
												fill="none"
												stroke="var(--zeta-alias-accent)"
												strokeWidth="1.5"
												strokeLinecap="round"
												strokeLinejoin="round"
												style={{ opacity: 0.7, flexShrink: 0 }}
											>
												<line x1="20" y1="12" x2="4" y2="12" />
												<polyline points="10 6 4 12 10 18" />
											</svg>
											<div>
												<div
													style={{
														fontSize: 18,
														fontWeight: 600,
														color: "var(--zeta-alias-text)",
														marginBottom: 8,
													}}
												>
													{t("get-started")}
												</div>
												<div
													style={{
														fontSize: 12,
														color: "var(--zeta-alias-text-muted)",
														lineHeight: 1.8,
													}}
												>
													<span style={{ color: "var(--zeta-alias-text-dim)", marginRight: 6 }}>1.</span>
													{t("select-a-project-directory-from-the-sidebar")}
													<br />
													<span style={{ color: "var(--zeta-alias-text-dim)", marginRight: 6 }}>2.</span>
													{t("add-models-via-the-models-button-at-the-bottom")}
												</div>
											</div>
										</div>
									)}
								</div>
							)
						) : null}
					</div>
				</ShellSlot>

				<ShellSlot name="rail">
					<DockRail
						activeId={dockTool}
						onToggle={id => setDockTool(cur => (cur === id ? null : id as DockTool))}
						trackingEnabled={trackingEnabled}
						hasSession={selectedSession !== null}
					/>
				</ShellSlot>

				<ShellSlot name="dockWindow">
					{/* Active window */}
					<div
						style={{
							flex: 1,
							minWidth: 0,
							display: "flex",
							flexDirection: "column",
							background: "var(--zeta-alias-bg)",
							overflow: "hidden",
						}}
					>
						{/* Window header */}
						<div
							className="right-panel-tabbar"
							style={{
								display: "flex",
								alignItems: "center",
								flexShrink: 0,
								background: "var(--zeta-alias-bg-panel)",
								borderBottom: "1px solid var(--zeta-alias-border)",
								height: 36,
								paddingLeft: 10,
								gap: 8,
							}}
						>
							<span
								style={{
									fontSize: 11.5,
									fontWeight: 700,
									letterSpacing: 0.3,
									color: "var(--zeta-alias-text)",
								}}
							>
								{dockTool === "git"
									? t("dock.window.branches")
									: dockTool === "session"
										? t("dock.window.session")
										: dockTool === "files"
											? t("dock.window.files")
											: dockTool === "tracking"
												? t("dock.window.tracking")
												: dockTool === "terminal"
													? t("dock.window.terminal")
													: dockTool === "history"
														? t("dock.window.history")
														: dockTool === "context"
															? t("context-ring.title")
															: t("dock.window.plugins")}
							</span>
							<div style={{ flex: 1 }} />
							{dockTool === "files" && fileTabs.length > 0 && (
								<div
									style={{
										flex: 1,
										overflow: "hidden",
										display: "flex",
										alignItems: "center",
										maxWidth: "55%",
									}}
								>
									<TabBar
										tabs={fileTabs}
										activeTabId={activeFileTabId ?? ""}
										onSelectTab={setActiveFileTabId}
										onCloseTab={handleCloseFileTab}
									/>
								</div>
							)}
							<button
								onClick={() => setDockTool(null)}
								title={t("dock.close")}
								aria-label={t("dock.close")}
								style={{
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									width: 26,
									height: 26,
									padding: 0,
									marginRight: 4,
									background: "transparent",
									border: "none",
									borderRadius: 6,
									color: "var(--zeta-alias-text-muted)",
									cursor: "pointer",
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
								>
									<line x1="18" y1="6" x2="6" y2="18" />
									<line x1="6" y1="6" x2="18" y2="18" />
								</svg>
							</button>
						</div>

						{/* Window body */}
						<div
							style={{
								flex: 1,
								overflow: "hidden",
								display: "flex",
								flexDirection: "column",
								minHeight: 0,
							}}
						>
							{dockTool === "git" ? (
								<GitBranchesPanel
									cwd={activeCwd ?? selectedSession?.cwd ?? newSessionCwd ?? null}
									onSwitched={handleBranchSwitched}
								/>
							) : dockTool === "history" ? (
								selectedSession ? (
									<FullHistoryPanel sessionId={selectedSession.id} sessionName={selectedSession.name ?? null} />
								) : (
									<div
										style={{
											flex: 1,
											display: "flex",
											alignItems: "center",
											justifyContent: "center",
											padding: 16,
											textAlign: "center",
											color: "var(--zeta-alias-text-dim)",
											fontSize: 12,
										}}
									>
										{t("full-history-is-available-after-the-session-is-s")}
									</div>
								)
							) : dockTool === "session" ? (
								<SidePanel
									stats={sessionStats}
									contextUsage={contextUsage}
									model={modelInfo.model}
									thinkingLevel={modelInfo.thinkingLevel}
									onClose={() => setDockTool(null)}
								/>
							) : dockTool === "terminal" ? (
								<TerminalView
									cwd={terminalCwd}
									instanceId={terminalSlot.active}
									instances={terminalSlot.instances}
									knownSessionId={terminalSlot.sessionIds[terminalSlot.active] ?? null}
									onSelectInstance={handleTerminalSelectSlot}
									onNewInstance={handleTerminalNewSlot}
									onSessionCreated={handleTerminalSession}
									onSessionStopped={handleTerminalStopped}
									openFileRequest={terminalFileRequest}
								/>
							) : dockTool === "tracking" ? (
								<TrackingPanel cwd={activeCwd} />
							) : dockTool === "context" ? (
								<ContextRingPanel
									sessionId={selectedSession?.id ?? null}
									contextUsage={
										contextUsage
											? {
													tokens: contextUsage.tokens ?? 0,
													contextWindow: contextUsage.contextWindow,
													percent: contextUsage.percent ?? 0,
												}
											: null
									}
								/>
							) : dockTool === "plugins" ? (
								(activeCwd ?? selectedSession?.cwd) ? (
									<PluginsManager
										cwd={(activeCwd ?? selectedSession?.cwd)!}
										sessionId={selectedSession?.id ?? null}
										onReloaded={() => activeTabId && bumpTabRemount(activeTabId)}
										onOpenAdvanced={() => setPluginsConfigOpen(true)}
									/>
								) : (
									<div
										style={{
											flex: 1,
											display: "flex",
											alignItems: "center",
											justifyContent: "center",
											color: "var(--zeta-alias-text-dim)",
											fontSize: 12,
										}}
									>
										{t("dock.plugins-select-project")}
									</div>
								)
							) : activeFileTab?.filePath ? (
								<FileViewer
									filePath={activeFileTab.filePath}
									cwd={activeCwd ?? undefined}
									sourceSessionId={activeFileTab.sourceSessionId}
									gitRefreshKey={explorerRefreshKey}
									initialDisplayMode={activeFileTab.initialDisplayMode}
									onMentionLines={handleFileLineMention}
									onOpenFile={filePath =>
										handleOpenFile(filePath, getFileName(filePath), {
											sourceSessionId: activeFileTab.sourceSessionId,
										})
									}
								/>
							) : (
								<div
									style={{
										height: "100%",
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
										color: "var(--zeta-alias-text-dim)",
										fontSize: 12,
									}}
								>
									{t("dock.no-file")}
								</div>
							)}
						</div>
					</div>
				</ShellSlot>
			</ShellLayout>
			{/* File-chip context menu (U9): 打开文件 / 在终端打开 */}
			<FloatingMenu
				open={fileChipMenu !== null}
				point={fileChipMenu?.point ?? null}
				onClose={() => setFileChipMenu(null)}
				label={t("markdown.openFileMenu")}
				items={fileChipMenuItems}
			/>
			<CommandPalette
				open={paletteOpen}
				onOpenChange={setPaletteOpen}
				onSelectSession={handlePaletteSelectSession}
				actions={paletteActions}
			/>
			{modelsConfigOpen && (
				<ModelsConfig
					onClose={() => {
						setModelsConfigOpen(false);
						setModelsRefreshKey(k => k + 1);
					}}
				/>
			)}
			<SettingsWindow
				open={settingsConfigOpen}
				onClose={() => setSettingsConfigOpen(false)}
				onOpenModelsConfig={() => setModelsConfigOpen(true)}
			/>
			{skillsConfigOpen && (activeCwd ?? selectedSession?.cwd ?? newSessionCwd) && (
				<SkillsConfig
					cwd={(activeCwd ?? selectedSession?.cwd ?? newSessionCwd)!}
					onClose={() => setSkillsConfigOpen(false)}
				/>
			)}
			{pluginsConfigOpen && (activeCwd ?? selectedSession?.cwd ?? newSessionCwd) && (
				<PluginsConfig
					cwd={(activeCwd ?? selectedSession?.cwd ?? newSessionCwd)!}
					sessionId={selectedSession?.id ?? null}
					onClose={() => setPluginsConfigOpen(false)}
					onReloaded={() => activeTabId && bumpTabRemount(activeTabId)}
				/>
			)}
		</ShellBootGate>
	);
}

/**
 * One window-control button in the self-drawn titlebar. `no-drag` keeps the
 * button clickable inside the titlebar's drag region, and the hover colours
 * come from the shared theme tokens so the chrome follows the active theme.
 */
/**
 * Null-cwd degraded draft (spec D11): only reachable when neither the entry
 * cwd nor the default workspace resolved. The whole composer card acts as the
 * workspace-selection trigger — dashed outline (ChatInput `degraded`),
 * readOnly textarea, and an overlay button with aria-haspopup that opens the
 * shared workspace picker upward. Picking a workspace starts a normal draft.
 */
function DegradedDraftCard({ onWorkspaceSelect }: { onWorkspaceSelect: (cwd: string) => void }) {
	const { t } = useI18n();
	const [pickerOpen, setPickerOpen] = useState(false);
	const [anchor, setAnchor] = useState<PickerAnchor | null>(null);
	return (
		<div className="flex h-full flex-col items-center justify-center overflow-y-auto px-4 py-8">
			<div className="w-full max-w-[820px]">
				<div style={{ marginBottom: 12, textAlign: "center", fontSize: 13, color: "var(--zeta-alias-text-muted)" }}>
					{t("draft-context.select-workspace")}
				</div>
				<div style={{ position: "relative" }}>
					<ChatInput variant="hero" degraded onSend={() => {}} onAbort={() => {}} isStreaming={false} />
					<button
						aria-haspopup="dialog"
						aria-expanded={pickerOpen}
						aria-label={t("draft-context.select-workspace")}
						title={t("draft-context.select-workspace")}
						onClick={e => {
							const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
							setAnchor({ top: rect.top, left: rect.left, width: rect.width });
							setPickerOpen(v => !v);
						}}
						style={{
							position: "absolute",
							inset: 0,
							background: "transparent",
							border: "none",
							cursor: "pointer",
							borderRadius: 14,
						}}
					/>
					{pickerOpen && anchor && (
						<WorkspacePickerPanel
							anchor={anchor}
							currentCwd={null}
							onPick={picked => {
								setPickerOpen(false);
								onWorkspaceSelect(picked);
							}}
							onClose={() => setPickerOpen(false)}
						/>
					)}
				</div>
			</div>
		</div>
	);
}

function TitlebarButton({
	label,
	onClick,
	danger,
	children,
}: {
	label: string;
	onClick: () => void;
	danger?: boolean;
	children: ReactNode;
}) {
	const [hovered, setHovered] = useState(false);
	return (
		<button
			type="button"
			onClick={onClick}
			title={label}
			aria-label={label}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			style={
				{
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					width: 44,
					height: "100%",
					padding: 0,
					border: "none",
					cursor: "pointer",
					color: hovered ? (danger ? "var(--zeta-alias-primary-foreground)" : "var(--zeta-alias-text)") : "var(--zeta-alias-text-muted)",
					background: hovered ? (danger ? "var(--zeta-alias-status-error)" : "var(--zeta-alias-bg-hover)") : "transparent",
					transition: "background 0.12s, color 0.12s",
					WebkitAppRegion: "no-drag",
				} as React.CSSProperties
			}
		>
			<svg
				width="12"
				height="12"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.6"
				strokeLinecap="round"
				strokeLinejoin="round"
				aria-hidden="true"
			>
				{children}
			</svg>
		</button>
	);
}
