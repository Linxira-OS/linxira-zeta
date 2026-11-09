"use client";

/**
 * StudioShell — the product surface.
 *
 * This is the single shell for both distributions: the browser-only
 * `@linxiraos/zeta-web` server and the `zetawork` desktop bundle mount the same
 * component against the same gateway. It owns navigation, the project sidebar,
 * the session tab strip, the conversation column and the docked workbench.
 *
 * Division of responsibility (migration plan §2):
 * - **Shell** = this file: chrome, IA, route state, project registry reads.
 * - **Data** = the existing Zeta plumbing (`useSessionTabs`,
 *   `useRunningSessionIds`, `session-api`, `projects-api`). No second
 *   client, no second transport: every mutation is a gateway call.
 * - **Conversation** = `ChatWindow`, mounted once per tab and kept mounted so
 *   transcript scroll and composer drafts survive tab switches.
 * - **Presentation** = Studio's vocabulary under `.studio-root`
 *   (`web-ui/styles/studio/**`).
 *
 * Product vocabulary: a *project* is a registered directory, a *workspace* is
 * a checkout (main clone or worktree) under it, a *session* is one agent
 * conversation. There is no initial pseudo-project: with nothing registered the
 * shell opens the folder picker.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatWindow } from "@/components/ChatWindow";
import type { ChatInputHandle } from "@/components/ChatInput";
import { FolderPickerModal } from "@/components/FolderPickerModal";
import { SessionTabBar } from "@/components/shell/SessionTabBar";
import { EMPTY_TAB_META, draftKeyForTab, type TabRuntimeMeta } from "@/lib/session-tabs";
import { readPersistedSessionTabs, writePersistedSessionTabs } from "@/lib/session-tabs-persist";
import { useSessionTabs } from "@/hooks/useSessionTabs";
import { I18nProvider, useI18n } from "@/hooks/useI18n";
import { RunningSessionsProvider, useRunningSessionIds } from "@/hooks/useRunningSessionIds";
import { useIsMobile } from "@/hooks/useIsMobile";
import { fetchSessions } from "@/lib/session-api";
import { fetchProjects, projectForPath, putProject, unregisterProject } from "@/lib/projects-api";
import { sessionDisplayTitle } from "@/components/sidebar/sidebar-shared";
import { isImSession, sessionLocationLabel } from "@/lib/session-origin";
import type { SessionInfo } from "@/lib/types";
import type {
	StudioMode,
	StudioProjectSummary,
	StudioRoute,
	StudioSessionSummary,
	StudioWorkspaceSummary,
} from "../adapters/types";
import { StudioSidebar } from "./StudioSidebar";
import { StudioPageHost } from "./StudioPageHost";
import { StudioStatusBar } from "./StudioStatusBar";
import {
	StudioCommandPalette,
	StudioTitleMenus,
	StudioTitlebar,
	TitleMenuScope,
	type StudioPaletteActions,
} from "../chrome";
import { platformCapabilities } from "@/lib/pi-desktop";

/** Session row shape this shell renders (gateway `SessionInfo` → view model). */
function toSessionSummary(
	info: SessionInfo,
	projects: readonly StudioProjectSummary[],
	running: ReadonlySet<string>,
	t: (key: string, vars?: Record<string, string | number>) => string,
): StudioSessionSummary {
	const project = projectForPath(projects, info.cwd ?? null);
	const workspace = project?.workspaces.find(
		entry => entry.path.replace(/\\/g, "/").toLowerCase() === (info.cwd ?? "").replace(/\\/g, "/").toLowerCase(),
	);
	return {
		id: info.id,
		path: info.path,
		title: sessionDisplayTitle(info, t),
		cwd: info.cwd ?? "",
		created: info.created,
		modified: info.modified,
		messageCount: info.messageCount,
		running: running.has(info.id),
		projectKey: project?.key ?? null,
		workspaceKey: workspace?.key ?? null,
		im: isImSession(info),
		location: sessionLocationLabel(info, t),
	};
}

export function StudioShell({ mode = "app" }: { mode?: StudioMode }) {
	return (
		<I18nProvider>
			<RunningSessionsProvider>
				<StudioShellContent mode={mode} />
			</RunningSessionsProvider>
		</I18nProvider>
	);
}

function StudioShellContent({ mode }: { mode: StudioMode }) {
	const { t } = useI18n();
	const isMobile = useIsMobile();
	const { runningSessionIds } = useRunningSessionIds();

	const [route, setRoute] = useState<StudioRoute>("workbench");
	const [projects, setProjects] = useState<StudioProjectSummary[]>([]);
	const [projectsLoaded, setProjectsLoaded] = useState(false);
	const [projectsError, setProjectsError] = useState<string | null>(null);
	const [sessions, setSessions] = useState<SessionInfo[]>([]);
	const [sessionsError, setSessionsError] = useState<string | null>(null);
	const [refreshKey, setRefreshKey] = useState(0);
	const [picker, setPicker] = useState<{ open: boolean; initial: string | null }>({ open: false, initial: null });
	const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
	const [paletteOpen, setPaletteOpen] = useState(false);
	const [selectedProjectKey, setSelectedProjectKey] = useState<string | null>(null);
	const [selectedWorkspacePath, setSelectedWorkspacePath] = useState<string | null>(null);
	const [tabMeta, setTabMeta] = useState<Record<string, TabRuntimeMeta>>({});
	const [sessionCache, setSessionCache] = useState<Record<string, SessionInfo>>({});
	/**
	 * IM/bot/relay conversations are personal-agent surfaces too, but they are
	 * not coding sessions: every normal list leaves them out until the operator
	 * asks for the "IM / Bot" group.
	 */
	const [includeIm, setIncludeIm] = useState(false);

	const [restoredTabs] = useState(() => (mode === "panel" ? null : readPersistedSessionTabs()));
	const sessionTabs = useSessionTabs({ initialState: restoredTabs ?? undefined });
	const { tabs, activeTabId, activeTab } = sessionTabs;

	const runningSet = useMemo(() => new Set(runningSessionIds), [runningSessionIds]);

	// --- registry + session list -------------------------------------------
	const loadProjects = useCallback(async () => {
		try {
			const response = await fetchProjects();
			setProjects(response.projects);
			setProjectsError(null);
			return response.projects;
		} catch (error) {
			setProjectsError(error instanceof Error ? error.message : String(error));
			return [] as StudioProjectSummary[];
		} finally {
			setProjectsLoaded(true);
		}
	}, []);

	const loadSessions = useCallback(async () => {
		try {
			const { sessions: rows } = await fetchSessions();
			setSessions(rows);
			setSessionsError(null);
		} catch (error) {
			setSessionsError(error instanceof Error ? error.message : String(error));
		}
	}, []);

	useEffect(() => {
		void loadProjects();
	}, [loadProjects]);

	useEffect(() => {
		void loadSessions();
	}, [loadSessions, refreshKey]);

	// First run: nothing registered → the folder picker, never an empty chat.
	useEffect(() => {
		if (projectsLoaded && projects.length === 0 && !picker.open) {
			setPicker({ open: true, initial: null });
		}
	}, [projectsLoaded, projects.length, picker.open]);

	// Keep the selection on a real project after every refresh.
	useEffect(() => {
		if (projects.length === 0) {
			setSelectedProjectKey(null);
			setSelectedWorkspacePath(null);
			return;
		}
		const current = selectedProjectKey ? projects.find(project => project.key === selectedProjectKey) : undefined;
		const next = current ?? projects.find(project => project.pinned) ?? projects[0];
		if (next && next.key !== selectedProjectKey) setSelectedProjectKey(next.key);
	}, [projects, selectedProjectKey]);

	const selectedProject = useMemo(
		() => projects.find(project => project.key === selectedProjectKey) ?? null,
		[projects, selectedProjectKey],
	);

	const selectedWorkspace: StudioWorkspaceSummary | null = useMemo(() => {
		if (!selectedProject) return null;
		if (selectedWorkspacePath) {
			const match = selectedProject.workspaces.find(workspace => workspace.path === selectedWorkspacePath);
			if (match) return match;
		}
		return selectedProject.workspaces[0] ?? null;
	}, [selectedProject, selectedWorkspacePath]);

	/** Working directory a new session in the current selection starts in. */
	const activeCwd = selectedWorkspace?.path ?? selectedProject?.path ?? null;

	const sessionSummaries = useMemo(
		() => sessions.map(info => toSessionSummary(info, projects, runningSet, t)),
		[sessions, projects, runningSet, t],
	);
	/** Personal sessions: project/workspace groups and the palette's recents. */
	const personalSummaries = useMemo(() => sessionSummaries.filter(session => !session.im), [sessionSummaries]);
	/** IM/bot/relay conversations, shown only in their own group. */
	const imSummaries = useMemo(() => sessionSummaries.filter(session => session.im), [sessionSummaries]);

	// --- persistence --------------------------------------------------------
	useEffect(() => {
		if (mode === "panel") return;
		writePersistedSessionTabs({ tabs, activeTabId });
	}, [mode, tabs, activeTabId]);

	// --- tab wiring ---------------------------------------------------------
	const bindingsRef = useRef(new Map<string, {
		inputRef: React.RefObject<ChatInputHandle | null>;
		onTabMeta: (patch: Partial<TabRuntimeMeta>) => void;
		onSessionCreated: (session: SessionInfo) => void;
		onSessionForked: (sessionId: string) => void;
		onAgentEnd: () => void;
		onNewSessionCwdChange: (cwd: string) => void;
	}>());

	const patchTabMeta = useCallback((tabId: string, patch: Partial<TabRuntimeMeta>) => {
		setTabMeta(previous => ({ ...previous, [tabId]: { ...EMPTY_TAB_META, ...previous[tabId], ...patch } }));
	}, []);

	const cacheSession = useCallback((session: SessionInfo) => {
		setSessionCache(previous => ({ ...previous, [session.id]: session }));
	}, []);

	const bindingsFor = useCallback(
		(tabId: string) => {
			const existing = bindingsRef.current.get(tabId);
			if (existing) return existing;
			const bindings = {
				inputRef: { current: null } as React.RefObject<ChatInputHandle | null>,
				onTabMeta: (patch: Partial<TabRuntimeMeta>) => patchTabMeta(tabId, patch),
				onSessionCreated: (session: SessionInfo) => {
					cacheSession(session);
					setRefreshKey(key => key + 1);
				},
				onSessionForked: (sessionId: string) => void sessionId,
				onAgentEnd: () => setRefreshKey(key => key + 1),
				onNewSessionCwdChange: (cwd: string) => {
					sessionTabs.update(tabId, { draftCwd: cwd });
				},
			};
			bindingsRef.current.set(tabId, bindings);
			return bindings;
		},
		[cacheSession, patchTabMeta, sessionTabs],
	);

	// Mount a tab on first activation and drop metadata for closed tabs.
	useEffect(() => {
		const live = new Set(tabs.map(tab => tab.id));
		for (const id of [...bindingsRef.current.keys()]) if (!live.has(id)) bindingsRef.current.delete(id);
		setTabMeta(previous => {
			const pruned = Object.fromEntries(Object.entries(previous).filter(([id]) => live.has(id)));
			if (!activeTabId || pruned[activeTabId]?.mounted) return pruned;
			return { ...pruned, [activeTabId]: { ...EMPTY_TAB_META, ...pruned[activeTabId], mounted: true } };
		});
	}, [tabs, activeTabId]);

	const sessionForTab = useCallback(
		(tab: { sessionId: string | null; projectRoot: string | null; title: string; openedAt: number }) => {
			if (!tab.sessionId) return null;
			return (
				sessionCache[tab.sessionId] ??
				sessions.find(entry => entry.id === tab.sessionId) ?? {
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
		},
		[sessionCache, sessions],
	);

	const titleForTab = useCallback(
		(tab: Parameters<typeof sessionForTab>[0]) => {
			const session = sessionForTab(tab);
			return session ? sessionDisplayTitle(session, t) : tab.title;
		},
		[sessionForTab, t],
	);

	// --- actions ------------------------------------------------------------
	const openProject = useCallback(
		async (path: string) => {
			try {
				const response = await putProject({ path });
				setProjects(response.projects);
				const match = response.projects.find(project => project.path === path || project.alias === path);
				if (match) setSelectedProjectKey(match.key);
				setProjectsError(null);
			} catch (error) {
				setProjectsError(error instanceof Error ? error.message : String(error));
			}
		},
		[],
	);

	/**
	 * Create a branch/worktree under a project. `POST /api/worktrees` runs the
	 * native worktree add and returns the new checkout path; the registry then
	 * needs a reload because the new workspace is derived from the session scan.
	 */
	const createWorkspace = useCallback(async (projectPath: string, branch: string) => {
		try {
			const res = await fetch("/api/worktrees", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ cwd: projectPath, branch }),
			});
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as { error?: string };
				throw new Error(body.error ?? `worktree add: HTTP ${res.status}`);
			}
			const created = (await res.json()) as { path?: string };
			await loadProjects();
			if (created.path) setSelectedWorkspacePath(created.path);
			setProjectsError(null);
			return true;
		} catch (error) {
			setProjectsError(error instanceof Error ? error.message : String(error));
			return false;
		}
	}, [loadProjects]);

	const removeProject = useCallback(async (path: string) => {
		try {
			const response = await unregisterProject(path);
			setProjects(response.projects);
			setProjectsError(null);
		} catch (error) {
			setProjectsError(error instanceof Error ? error.message : String(error));
		}
	}, []);

	const openSession = useCallback(
		(session: StudioSessionSummary) => {
			const info = sessions.find(entry => entry.id === session.id) ?? sessionCache[session.id];
			if (!info) return;
			cacheSession(info);
			sessionTabs.openSessionTab(info, sessionDisplayTitle(info, t));
			setRoute("workbench");
		},
		[cacheSession, sessionCache, sessions, sessionTabs, t],
	);

	const startSession = useCallback(
		(cwd: string | null) => {
			const title = sessionDisplayTitle(
				{ name: null, firstMessage: "", created: new Date().toISOString() },
				t,
			);
			sessionTabs.openDraftTab(cwd, title, true);
			setRoute("workbench");
		},
		[sessionTabs, t],
	);

	const capabilities = useMemo(() => platformCapabilities(), []);

	const paletteActions = useMemo<StudioPaletteActions>(
		() => ({
			go: setRoute,
			openSession: id => {
				const summary = sessionSummaries.find(entry => entry.id === id);
				if (summary) openSession(summary);
			},
			newSession: () => startSession(activeCwd),
			toggleSidebar: () => setSidebarCollapsed(value => !value),
			refresh: () => setRefreshKey(key => key + 1),
			openPalette: () => setPaletteOpen(true),
		}),
		[activeCwd, openSession, sessionSummaries, startSession],
	);

	// Studio's bindings: ⌘/Ctrl+K opens the palette, ⌘/Ctrl+N starts a session.
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
			const key = event.key.toLowerCase();
			if (key === "k") {
				event.preventDefault();
				setPaletteOpen(true);
			} else if (key === "n" && !event.shiftKey) {
				event.preventDefault();
				startSession(activeCwd);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [activeCwd, startSession]);

	// --- render -------------------------------------------------------------
	const showWorkbench = route === "workbench";

	return (
		<div className="studio-root" data-studio-mode={mode} data-studio-route={route}>
			<div className="app" id="studioAppRoot">
				<StudioTitlebar
					capabilities={capabilities}
					route={route}
					onRoute={setRoute}
					onToggleSidebar={() => setSidebarCollapsed(value => !value)}
					sidebarCollapsed={sidebarCollapsed}
					menus={
						<TitleMenuScope>
							<StudioTitleMenus actions={paletteActions} />
						</TitleMenuScope>
					}
				>
					<button
						type="button"
						className="btn btn-ghost btn-xs"
						onClick={() => setRefreshKey(key => key + 1)}
						title={t("studio.action.refresh")}
					>
						{t("studio.action.refresh")}
					</button>
				</StudioTitlebar>

				<div className="shell-body">
					{!sidebarCollapsed || isMobile ? (
						<StudioSidebar
							projects={projects}
							projectsLoaded={projectsLoaded}
							error={projectsError ?? sessionsError}
							selectedProjectKey={selectedProjectKey}
							selectedWorkspacePath={selectedWorkspace?.path ?? null}
							sessions={personalSummaries}
							imSessions={imSummaries}
							includeIm={includeIm}
							onToggleIm={() => setIncludeIm(value => !value)}
							activeSessionId={activeTab?.sessionId ?? null}
							onSelectProject={key => {
								setSelectedProjectKey(key);
								setSelectedWorkspacePath(null);
							}}
							onSelectWorkspace={path => setSelectedWorkspacePath(path)}
							onSelectSession={openSession}
							onRegisterProject={() => setPicker({ open: true, initial: activeCwd })}
							onCreateWorkspace={createWorkspace}
							onRemoveProject={path => void removeProject(path)}
							onNewSession={() => startSession(activeCwd)}
							onRefresh={() => setRefreshKey(key => key + 1)}
						/>
					) : null}

					<main className="center" id="convoScroll">
						{showWorkbench ? (
							<>
								{tabs.length > 0 ? (
									<div className="tabs-slot">
										<SessionTabBar
										tabs={tabs}
										activeTabId={activeTabId}
										runningTabIds={runningSet}
										streamingTabIds={runningSet}
										titleFor={titleForTab}
										onActivateTab={tabId => sessionTabs.activate(tabId)}
										onCloseTab={tabId => sessionTabs.close(tabId)}
										onCloseOthers={tabId => sessionTabs.closeOthers(tabId)}
										onCloseRight={tabId => sessionTabs.closeRight(tabId)}
										onNewTab={() => startSession(activeCwd)}
										isMobile={isMobile}
										/>
									</div>
								) : null}
								<div className="center-body">
									{tabs.length === 0 ? (
										<div className="convo-empty">
											<h2>{t(projects.length === 0 ? "studio.empty.noProject" : "studio.empty.noSession")}</h2>
											<p className="muted">{t("studio.empty.hint")}</p>
											<button type="button" className="btn btn-primary" onClick={() => startSession(activeCwd)}>
												{t("studio.action.newSession")}
											</button>
										</div>
									) : (
										tabs.map(tab => {
											const meta = tabMeta[tab.id] ?? EMPTY_TAB_META;
											if (!meta.mounted) return null;
											const bindings = bindingsFor(tab.id);
											const tabSession = sessionForTab(tab);
											const active = tab.id === activeTabId;
											return (
												<div key={tab.id} className="tab-pane" hidden={!active} aria-hidden={!active}>
													<ChatWindow
														tabId={tab.id}
														active={active}
														streamActive={runningSet.has(tab.id)}
														draftKey={draftKeyForTab(tab)}
														session={tabSession}
														newSessionCwd={tab.kind === "draft" ? tab.draftCwd : null}
														explicitNew={tab.explicitNew}
														onNewSessionCwdChange={bindings.onNewSessionCwdChange}
														onTabMeta={bindings.onTabMeta}
														onAgentEnd={bindings.onAgentEnd}
														onSessionCreated={bindings.onSessionCreated}
														onSessionForked={bindings.onSessionForked}
														chatInputRef={bindings.inputRef}
													/>
												</div>
											);
										})
									)}
								</div>
							</>
						) : (
							<StudioPageHost
								route={route}
								cwd={activeCwd}
								sessionId={activeTab?.sessionId ?? null}
								projects={projects}
								onRegisterProject={path => void openProject(path)}
								onNavigate={setRoute}
							/>
						)}
					</main>
				</div>

				<StudioStatusBar
					project={selectedProject}
					workspace={selectedWorkspace}
					sessions={personalSummaries.length}
					running={runningSet.size}
					error={projectsError ?? sessionsError}
					route={route}
				/>
			</div>

			<StudioCommandPalette
				open={paletteOpen}
				onOpenChange={setPaletteOpen}
				sessions={includeIm ? sessionSummaries : personalSummaries}
				actions={paletteActions}
			/>

			<FolderPickerModal
				open={picker.open}
				initialPath={picker.initial}
				onSelect={path => {
					setPicker({ open: false, initial: null });
					void openProject(path);
				}}
				onClose={() => setPicker({ open: false, initial: null })}
			/>
		</div>
	);
}
