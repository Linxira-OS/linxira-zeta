"use client";

import { useState, useCallback, useRef, useEffect, useMemo, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useGlobalKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { installRemoteTokenFetch } from "@/lib/remote-token";
import { SessionSidebar } from "./SessionSidebar";
import { ChatWindow, planTitleFromPath } from "./ChatWindow";
import { TerminalView, type TerminalFileRequest } from "./TerminalView";
import { FloatingMenu, type FloatingMenuItem } from "./sidebar/FloatingMenu";
import { PluginsManager } from "./PluginsManager";
import { FileViewer } from "./FileViewer";
import { TabBar, type Tab } from "./TabBar";
import { ModelsConfig } from "./ModelsConfig";
import { StatsDashboard } from "./StatsDashboard";
import { FullHistoryPanel } from "./FullHistoryPanel";
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
import type { SessionStatsInfo } from "@/lib/pi-types";

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

export function AppShell() {
	return (
		<I18nProvider>
			<AppShellContent />
		</I18nProvider>
	);
}

function AppShellContent() {
	const router = useRouter();
	const searchParams = useSearchParams();
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
	const [selectedSession, setSelectedSession] = useState<SessionInfo | null>(null);
	const [activeCwd, setActiveCwd] = useState<string | null>(null);
	// When user clicks +, we only store the cwd — no fake session id
	const [newSessionCwd, setNewSessionCwd] = useState<string | null>(null);
	// Null-cwd degraded draft (spec D11): neither a project nor the default
	// workspace resolved — the whole composer card becomes the workspace picker.
	const [degradedDraft, setDegradedDraft] = useState(false);
	/** True once the user explicitly requested a new session (default chat shares the coordinator). */
	const explicitNewRef = useRef(false);
	const [initialCwdStatus, setInitialCwdStatus] = useState<"idle" | "validating" | "ready" | "error">(() =>
		initialNavigation.requestedCwd ? "validating" : "idle",
	);
	const [initialCwdError, setInitialCwdError] = useState<string | null>(null);
	const [refreshKey, setRefreshKey] = useState(0);
	const [sessionKey, setSessionKey] = useState(0);
	const [explorerRefreshKey, setExplorerRefreshKey] = useState(0);
	const [modelsConfigOpen, setModelsConfigOpen] = useState(false);
	const [modelsRefreshKey, setModelsRefreshKey] = useState(0);
	const [updating, setUpdating] = useState(false);
	const [checkingUpdate, setCheckingUpdate] = useState(false);
	const [updateNotice, setUpdateNotice] = useState<string | null>(null);
	const updateNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
	// Sidebar Plan card state (hoisted from ChatWindow).
	const [sidebarPlan, setSidebarPlan] = useState<{ enabled: boolean; planFilePath: string | null }>({
		enabled: false,
		planFilePath: null,
	});
	const handlePlanStateChange = useCallback((plan: { enabled: boolean; planFilePath: string | null }) => {
		setSidebarPlan(plan);
	}, []);
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
	type DockTool = "session" | "files" | "tracking" | "plugins" | "terminal" | "stats" | "history";
	const [mobileSidebarReady, setMobileSidebarReady] = useState(false);
	const [dockTool, setDockTool] = useState<DockTool | null>(null);
	// Embedded terminal (spec §15): live session id survives pane close so the
	// dock reattach; chip flow carries file/line/col for zeta-ide injection.
	const [terminalSessionId, setTerminalSessionId] = useState<string | null>(null);
	const [terminalFileRequest, setTerminalFileRequest] = useState<TerminalFileRequest | null>(null);
	const [fileChipMenu, setFileChipMenu] = useState<{ filePath: string; point: { x: number; y: number } } | null>(null);
	// On mobile the sidebar is an overlay drawer; hide it by default so the chat
	// is visible on load. Runs once the breakpoint resolves after hydration.
	useEffect(() => {
		if (isMobile) setSidebarOpen(false);
	}, [isMobile]);
	useEffect(() => {
		setMobileSidebarReady(true);
	}, []);
	const chatInputRef = useRef<ChatInputHandle | null>(null);
	const topBarRef = useRef<HTMLDivElement>(null);

	// Branch navigator state — populated by ChatWindow via onBranchDataChange
	const [branchTree, setBranchTree] = useState<SessionTreeNode[]>([]);
	const [branchActiveLeafId, setBranchActiveLeafId] = useState<string | null>(null);
	const branchLeafChangeFnRef = useRef<((leafId: string | null) => void) | null>(null);

	const handleBranchDataChange = useCallback(
		(tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void) => {
			setBranchTree(tree);
			setBranchActiveLeafId(activeLeafId);
			branchLeafChangeFnRef.current = onLeafChange;
		},
		[],
	);

	const handleBranchLeafChange = useCallback((leafId: string | null) => {
		branchLeafChangeFnRef.current?.(leafId);
	}, []);

	const [systemPrompt, setSystemPrompt] = useState<string | null>(null);

	const handleSystemPromptChange = useCallback((prompt: string | null) => {
		setSystemPrompt(prompt);
	}, []);

	// Session stats (tokens + cost) — populated by ChatWindow, displayed in top bar
	const [sessionStats, setSessionStats] = useState<SessionStatsInfo | null>(null);
	const handleSessionStatsChange = useCallback((stats: SessionStatsInfo | null) => {
		setSessionStats(stats);
	}, []);

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

	const showUpdateNotice = useCallback((message: string) => {
		setUpdateNotice(message);
		if (updateNoticeTimerRef.current) clearTimeout(updateNoticeTimerRef.current);
		updateNoticeTimerRef.current = setTimeout(() => setUpdateNotice(null), 2000);
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

	// Context usage — populated by ChatWindow, displayed in top bar
	const [contextUsage, setContextUsage] = useState<{
		percent: number | null;
		contextWindow: number;
		tokens: number | null;
	} | null>(null);
	const handleContextUsageChange = useCallback(
		(
			usage: {
				percent: number | null;
				contextWindow: number;
				tokens: number | null;
			} | null,
		) => {
			setContextUsage(usage);
		},
		[],
	);

	// One-shot /api/desktop/info probe: warms the shared cached promise so
	// desktop-specific surfaces resolve instantly instead of re-fetching.
	useEffect(() => {
		fetchDesktopInfo().catch(error => recordBootFailure("desktop-info", error));
	}, [recordBootFailure]);

	// Current model + thinking level — populated by ChatWindow for the SidePanel
	const [modelInfo, setModelInfo] = useState<{
		model: { provider: string; modelId: string } | null;
		thinkingLevel: string;
	}>({ model: null, thinkingLevel: "" });
	const handleModelChange = useCallback(
		(model: { provider: string; modelId: string } | null, thinkingLevel: string) => {
			setModelInfo({ model, thinkingLevel });
		},
		[],
	);
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
	// read tool resolves it the same way (it strips the @ prefix).
	const handleAtMention = useCallback((relativePath: string, isDir: boolean) => {
		chatInputRef.current?.insertText(buildAtMentionText(relativePath, isDir));
	}, []);

	const handleAtMentions = useCallback((relativePaths: string[]) => {
		const mentions = buildFileAtMentionsText(relativePaths);
		if (mentions) chatInputRef.current?.insertText(mentions);
	}, []);

	const handleFileLineMention = useCallback((relativePath: string, startLine: number, endLine: number) => {
		chatInputRef.current?.insertText(buildFileLineMentionText(relativePath, startLine, endLine));
	}, []);

	const initialSessionId = initialNavigation.sessionId;
	const activeProjectRootRef = useRef<string | null>(null);
	// True once the initial ?session= URL param has been resolved (or confirmed absent)
	const [initialSessionRestored, setInitialSessionRestored] = useState<boolean>(() => !initialSessionId);
	// Suppresses sessionKey bump in handleCwdChange during the initial URL restore
	const suppressCwdBumpRef = useRef(false);

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

				// The sidebar will notify us when it adopts this cwd. Avoid remounting
				// the just-created empty chat during that initial synchronization.
				suppressCwdBumpRef.current = true;
				setNewSessionCwd(data.cwd);
				setInitialCwdStatus("ready");
			})
			.catch((error: unknown) => {
				if (controller.signal.aborted) return;
				setInitialCwdError(error instanceof Error ? error.message : String(error));
				setInitialCwdStatus("error");
			});

		return () => controller.abort();
	}, [initialNavigation]);

	const handleCwdChange = useCallback((cwd: string | null, _projectRoot?: string | null) => {
		// Session-centric model: the active session defines the context. The
		// sidebar no longer drives a global cwd switch, so there is nothing to
		// close or remount here — cross-project session activation is handled by
		// handleSelectSession, and concurrent agents keep running per session.
		setActiveCwd(cwd);
	}, []);

	const handleSelectSession = useCallback(
		(session: SessionInfo, isRestore = false) => {
			setNewSessionCwd(null);
			setDegradedDraft(false);
			setSelectedSession(session);
			setSessionKey(k => k + 1);
			setSystemPrompt(null);
			setInitialSessionRestored(true);
			// On mobile, collapse the overlay drawer so the chat is revealed after pick.
			if (isMobile && !isRestore) setSidebarOpen(false);
			if (isRestore) {
				// Suppress the redundant sessionKey bump that would come from the
				// onCwdChange effect firing after setSelectedCwd in the sidebar
				suppressCwdBumpRef.current = true;
			}
			// Skip router.replace when restoring from URL — the param is already correct
			// and calling replace in production Next.js triggers a Suspense remount loop
			if (!isRestore) {
				router.replace(`?session=${encodeURIComponent(session.id)}`, {
					scroll: false,
				});
			}
		},
		[router, isMobile],
	);

	const handleNewSession = useCallback(
		// cwd === null: neither a project nor the default workspace resolved —
		// the empty state renders its degraded workspace trigger (batch 3).
		(_sessionId: string, cwd: string | null) => {
			explicitNewRef.current = true;
			setSelectedSession(null);
			setNewSessionCwd(cwd);
			setDegradedDraft(cwd === null);
			setSessionKey(k => k + 1);
			setBranchTree([]);
			setBranchActiveLeafId(null);
			setSystemPrompt(null);
			setActiveTopPanel(null);
			if (isMobile) setSidebarOpen(false);
			router.replace("/", { scroll: false });
		},
		[router, isMobile],
	);

	// Global keyboard shortcuts (handles Esc, Ctrl+N/Ctrl+Alt+N, Ctrl+I,
	// Ctrl+Enter, Ctrl+K, Ctrl+/ etc.)
	useGlobalKeyboardShortcuts({
		onNewSession: (cwd: string) => handleNewSession(`kb-${Date.now()}`, cwd),
		activeCwd,
		onFocusInput: () => chatInputRef.current?.focus(),
		onSubmitInput: () => chatInputRef.current?.submit(),
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
			run: () => handleNewSession(`palette-${Date.now()}`, activeCwd ?? ""),
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
			keywords: "stats dashboard usage",
			run: () => setDockTool("stats"),
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
	// server-computed projectRoot, which the same-project check in
	// handleCwdChange relies on. Hydrate it from the session list so switching
	// worktrees right after creating a session doesn't close the chat.
	const hydrateSelectedSession = useCallback((sessionId: string) => {
		void fetch("/api/sessions")
			.then(r => (r.ok ? (r.json() as Promise<{ sessions: SessionInfo[] }>) : null))
			.then(d => {
				const full = d?.sessions.find(s => s.id === sessionId);
				if (!full) return;
				setSelectedSession(prev => (prev && prev.id === sessionId && !prev.projectRoot ? full : prev));
			})
			.catch(() => {});
	}, []);

	// Called by ChatWindow when a new session gets its real id from pi
	const handleSessionCreated = useCallback(
		(session: SessionInfo) => {
			setNewSessionCwd(null);
			setDegradedDraft(false);
			setSelectedSession(session);
			setRefreshKey(k => k + 1);
			hydrateSelectedSession(session.id);
			router.replace(`?session=${encodeURIComponent(session.id)}`, {
				scroll: false,
			});
		},
		[router, hydrateSelectedSession],
	);

	const handleAgentEnd = useCallback(() => {
		setRefreshKey(k => k + 1);
		setExplorerRefreshKey(k => k + 1);
	}, []);

	const handleExplorerRefresh = useCallback(() => {
		setExplorerRefreshKey(k => k + 1);
	}, []);

	const handleSessionForked = useCallback(
		(newSessionId: string) => {
			setRefreshKey(k => k + 1);
			setSessionKey(k => k + 1);
			setNewSessionCwd(null);
			setSelectedSession(prev => ({
				...(prev ?? {
					path: "",
					cwd: "",
					created: "",
					modified: "",
					messageCount: 0,
					firstMessage: "",
				}),
				id: newSessionId,
			}));
			hydrateSelectedSession(newSessionId);
			router.replace(`?session=${encodeURIComponent(newSessionId)}`, {
				scroll: false,
			});
		},
		[router, hydrateSelectedSession],
	);

	const handleInitialRestoreDone = useCallback(() => {
		setInitialSessionRestored(true);
	}, []);

	const handleSessionDeleted = useCallback(
		(sessionId: string) => {
			setRefreshKey(k => k + 1);
			if (selectedSession?.id === sessionId) {
				const cwd = selectedSession.cwd;
				setSelectedSession(null);
				setNewSessionCwd(cwd ?? null);
				setSessionKey(k => k + 1);
				setBranchTree([]);
				setBranchActiveLeafId(null);
				setSystemPrompt(null);
				setActiveTopPanel(null);
				router.replace("/", { scroll: false });
			}
		},
		[selectedSession, router],
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

	// Show chat area if a session is selected, a cwd to start a new session in,
	// or the degraded null-cwd draft (whole card = workspace trigger)
	const effectiveNewSessionCwd = newSessionCwd ?? (selectedSession === null && activeCwd ? activeCwd : null);
	const showDegradedDraft = degradedDraft && selectedSession === null && effectiveNewSessionCwd === null;
	const showChat = selectedSession !== null || effectiveNewSessionCwd !== null || showDegradedDraft;
	// While restoring initial session from URL, don't show the placeholder
	const showPlaceholder = initialSessionRestored && !showChat;

	const activeFileTab = fileTabs.find(t => t.id === activeFileTabId) ?? null;
	const activeCwdName = activeCwd ? getFileName(activeCwd) || activeCwd : null;
	const windowTitle = activeCwdName ? `${activeCwdName} - Zeta Web` : "Zeta Web";

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
						onClick: () =>
							handleNewSession(`rail-${Date.now()}`, activeCwd ?? selectedSession?.cwd ?? newSessionCwd ?? ""),
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
						color: "var(--text-muted)",
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
					color: "var(--text-muted)",
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
				onOpenStats={() => setDockTool("stats")}
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
							color: "var(--text-muted)",
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
          background: color-mix(in srgb, var(--accent) 8%, var(--bg-panel));
          box-shadow: 0 18px 44px color-mix(in srgb, var(--accent) 16%, transparent);
        }
        100% {
          opacity: 1;
          transform: translateY(0);
          filter: blur(0);
          background: var(--bg-panel);
          box-shadow: 0 10px 28px var(--surface-shadow);
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
        background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent) 24%, transparent), transparent);
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
        background: color-mix(in srgb, var(--text-muted) 70%, var(--border));
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
          box-shadow: -12px 0 32px var(--surface-shadow);
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
			{/* Self-drawn titlebar — frameless desktop shell only. Fixed so the
        existing three-column row only needs a top inset to make room. */}
			{desktopChrome && (
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
							background: "var(--bg-panel)",
							borderBottom: "1px solid var(--border)",
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
							color: "var(--text-muted)",
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
								{(["zetacode", "zetaide", "zetaeditor"] as const).map(tool => (
									<button
										key={tool}
										type="button"
										onClick={() => launchTool(tool)}
										title={tool}
										aria-label={tool}
										style={
											{
												padding: "2px 8px",
												border: "1px solid var(--border)",
												borderRadius: 4,
												background: "transparent",
												color: "var(--text-muted)",
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
			<div
				className={`sidebar-overlay-backdrop${mobileSidebarReady ? "" : " sidebar-mobile-pending"}`}
				onClick={() => setSidebarOpen(false)}
				style={{
					position: "fixed",
					inset: 0,
					zIndex: 199,
					background: "color-mix(in srgb, var(--bg) 40%, transparent)",
					opacity: sidebarOpen ? 1 : 0,
					pointerEvents: sidebarOpen ? "auto" : "none",
					transition: "opacity 0.25s ease",
				}}
			/>

			<ShellLayout
				sidebarOpen={sidebarOpen}
				sidebarCollapsed={sidebarRailActive}
				detailOpen={dockTool !== null}
				isMobile={isMobile}
				desktopChromeInset={desktopChrome ? 30 : 0}
			>
				<ShellSlot name="sidebar">{sidebarContent}</ShellSlot>

				<ShellSlot name="center">
					{/* Top bar with sidebar toggle */}
					<div
						ref={topBarRef}
						style={{
							display: "flex",
							alignItems: "center",
							flexShrink: 0,
							borderBottom: "1px solid var(--border)",
							height: "calc(36px + env(safe-area-inset-top))",
							paddingTop: "env(safe-area-inset-top)",
							background: "var(--bg-panel)",
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
								borderRight: "1px solid var(--border)",
								color: "var(--text-muted)",
								cursor: "pointer",
								flexShrink: 0,
								transition: "color 0.12s",
							}}
							onMouseEnter={e => {
								e.currentTarget.style.color = "var(--text)";
							}}
							onMouseLeave={e => {
								e.currentTarget.style.color = "var(--text-muted)";
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
												showUpdateNotice(t("you-are-up-to-date"));
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
										borderRight: "1px solid var(--border)",
										cursor: updating || checkingUpdate ? "default" : "pointer",
										color: updateInfo?.available ? "var(--accent)" : "var(--text-muted)",
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
								{updateNotice && (
									<div
										style={{
											position: "fixed",
											top: 40,
											right: 16,
											zIndex: 400,
											background: "var(--bg-panel)",
											border: "1px solid var(--border)",
											borderRadius: 8,
											boxShadow: "0 4px 16px color-mix(in srgb, var(--bg) 20%, transparent)",
											padding: "8px 12px",
											fontSize: 12,
											color: "var(--text)",
										}}
									>
										{updateNotice}
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

								let ctxColor = "var(--text-muted)";
								let ctxStr: string | null = null;
								if (contextUsage?.contextWindow) {
									const pct = contextUsage.percent;
									if (pct !== null && pct > 90) ctxColor = "var(--status-error-foreground)";
									else if (pct !== null && pct > 70) ctxColor = "var(--status-warning-foreground)";
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
											background: activeTopPanel === "session" ? "var(--bg-selected)" : "none",
											border: "none",
											borderTop:
												activeTopPanel === "session" ? "2px solid var(--accent)" : "2px solid transparent",
											fontSize: 11,
											color: "var(--text-muted)",
											whiteSpace: "nowrap",
											cursor: "pointer",
											fontVariantNumeric: "tabular-nums",
											transition: "color 0.1s, background 0.1s",
										}}
										onMouseEnter={e => {
											e.currentTarget.style.color = "var(--text)";
										}}
										onMouseLeave={e => {
											e.currentTarget.style.color =
												activeTopPanel === "session" ? "var(--text)" : "var(--text-muted)";
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
													color: "var(--text)",
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
											background: "var(--bg-panel)",
											borderBottom: "1px solid var(--border)",
										}}
									>
										{systemPrompt ? (
											<div
												style={{
													maxHeight: "min(600px, 75vh)",
													overflowY: "auto",
													padding: "12px 16px",
													color: "var(--text-muted)",
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
													color: "var(--text-muted)",
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
													color: "var(--text-muted)",
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
											background: "var(--bg-panel)",
											borderBottom: "1px solid var(--border)",
											boxShadow: "0 10px 28px color-mix(in srgb, var(--bg) 10%, transparent)",
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
																color: "var(--text)",
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
																			color: "var(--text-dim)",
																			whiteSpace: "nowrap",
																		}}
																	>
																		{label}
																	</div>
																	<div
																		style={{
																			color: "var(--text-muted)",
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
																color: copied ? "var(--accent)" : "var(--text-dim)",
																background: "transparent",
																border: "1px solid var(--border)",
																borderRadius: 4,
																cursor: "pointer",
																flex: "0 0 auto",
																transition: "color 0.12s, border-color 0.12s, background 0.12s",
															}}
															onMouseEnter={e => {
																e.currentTarget.style.color = "var(--accent)";
																e.currentTarget.style.borderColor = "var(--accent)";
																e.currentTarget.style.background = "var(--bg-hover)";
															}}
															onMouseLeave={e => {
																e.currentTarget.style.color = copied
																	? "var(--accent)"
																	: "var(--text-dim)";
																e.currentTarget.style.borderColor = "var(--border)";
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
																color: "var(--text)",
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
																			color: "var(--text-dim)",
																			whiteSpace: "nowrap",
																		}}
																	>
																		{row.label}
																	</div>
																	<div
																		style={{
																			color: "var(--text-muted)",
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
													color: "var(--text-muted)",
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

					{/* Chat content */}
					<div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
						{showDegradedDraft ? (
							<DegradedDraftCard
								onWorkspaceSelect={cwd => {
									setDegradedDraft(false);
									handleNewSession(`draft-${Date.now()}`, cwd);
								}}
							/>
						) : showChat ? (
							<ChatWindow
								key={sessionKey}
								session={selectedSession}
								newSessionCwd={effectiveNewSessionCwd}
								explicitNew={explicitNewRef.current}
								onNewSessionCwdChange={cwd => handleNewSession(`welcome-${Date.now()}`, cwd)}
								onPlanStateChange={handlePlanStateChange}
								onAgentEnd={handleAgentEnd}
								onSessionCreated={handleSessionCreated}
								onSessionForked={handleSessionForked}
								modelsRefreshKey={modelsRefreshKey}
								chatInputRef={chatInputRef}
								onBranchDataChange={handleBranchDataChange}
								onSystemPromptChange={handleSystemPromptChange}
								onSessionStatsChange={handleSessionStatsChange}
								onSessionStatsPanelOpen={openSessionStatsPanel}
								onContextUsageChange={handleContextUsageChange}
								onModelChange={handleModelChange}
								onOpenFile={handleOpenLinkedFile}
								onOpenFileContextMenu={handleFileChipContextMenu}
							/>
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
									color: "var(--text-muted)",
									textAlign: "center",
								}}
							>
								<div style={{ fontSize: 14, color: "var(--text)" }}>Opening workspace...</div>
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
									color: "var(--text-muted)",
									textAlign: "center",
								}}
							>
								<div
									style={{
										fontSize: 14,
										color: "var(--status-error-foreground)",
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
							activeCwd ? (
								<div
									style={{
										height: "100%",
										display: "flex",
										flexDirection: "column",
										alignItems: "center",
										justifyContent: "center",
										gap: 16,
										color: "var(--text-muted)",
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
													color: "var(--accent)",
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
													color: "var(--text)",
													textTransform: "uppercase",
												}}
											>
												STARFIELD // CONSTELLATION FIELD
											</div>
											<div
												style={{
													fontFamily: "var(--font-mono)",
													fontSize: 12,
													color: "var(--accent)",
													letterSpacing: "0.1em",
												}}
											>
												SYS.LOC // ZETA-WEB-INTERFACE · MISSION AGENT ACTIVE
											</div>
											<div
												style={{
													fontSize: 13,
													color: "var(--text-muted)",
													lineHeight: 1.8,
													background: "var(--surface-subtle)",
													border: "1px solid var(--border)",
													borderLeft: "3px solid var(--accent)",
													padding: "14px 20px",
													textAlign: "left",
													width: "100%",
												}}
											>
												<span
													style={{
														color: "var(--status-warning-foreground)",
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
														color: "var(--status-warning-foreground)",
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
												stroke="var(--accent)"
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
														color: "var(--text)",
														marginBottom: 8,
													}}
												>
													{t("get-started")}
												</div>
												<div
													style={{
														fontSize: 12,
														color: "var(--text-muted)",
														lineHeight: 1.8,
													}}
												>
													<span style={{ color: "var(--text-dim)", marginRight: 6 }}>1.</span>
													{t("select-a-project-directory-from-the-sidebar")}
													<br />
													<span style={{ color: "var(--text-dim)", marginRight: 6 }}>2.</span>
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
							background: "var(--bg)",
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
								background: "var(--bg-panel)",
								borderBottom: "1px solid var(--border)",
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
									color: "var(--text)",
								}}
							>
								{dockTool === "stats"
									? t("dock.window.stats")
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
									color: "var(--text-muted)",
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
							{dockTool === "stats" ? (
								<StatsDashboard />
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
											color: "var(--text-dim)",
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
									cwd={activeCwd ?? selectedSession?.cwd ?? null}
									attachSessionId={terminalSessionId}
									onSessionCreated={setTerminalSessionId}
									openFileRequest={terminalFileRequest}
								/>
							) : dockTool === "tracking" ? (
								<TrackingPanel cwd={activeCwd} />
							) : dockTool === "plugins" ? (
								(activeCwd ?? selectedSession?.cwd) ? (
									<PluginsManager
										cwd={(activeCwd ?? selectedSession?.cwd)!}
										sessionId={selectedSession?.id ?? null}
										onReloaded={() => setSessionKey(k => k + 1)}
										onOpenAdvanced={() => setPluginsConfigOpen(true)}
									/>
								) : (
									<div
										style={{
											flex: 1,
											display: "flex",
											alignItems: "center",
											justifyContent: "center",
											color: "var(--text-dim)",
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
										color: "var(--text-dim)",
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
					onReloaded={() => setSessionKey(k => k + 1)}
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
				<div style={{ marginBottom: 12, textAlign: "center", fontSize: 13, color: "var(--text-muted)" }}>
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
					color: hovered ? (danger ? "var(--primary-foreground)" : "var(--text)") : "var(--text-muted)",
					background: hovered ? (danger ? "var(--status-error)" : "var(--bg-hover)") : "transparent",
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
