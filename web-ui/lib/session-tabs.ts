/**
 * Session tabs — the pure state model behind the multi-tab chat shell.
 *
 * A tab is a *view*: either a saved session (`kind: "session"`) or a
 * not-yet-created draft bound to a workspace (`kind: "draft"`). Tabs never own
 * sessions: closing one only drops the view (the gateway has no "end session"
 * capability), and the same session can always be re-opened from the sidebar.
 *
 * Everything here is a pure function over immutable state so the ordering,
 * activation, eviction, and stream-budget rules can be unit tested without a
 * DOM. The React binding lives in `hooks/useSessionTabs.ts`; the runtime-only
 * per-tab metadata (which must NOT be persisted) lives in `TabRuntimeMeta`.
 */
import type { SessionStatsInfo } from "./pi-types";
import type { SessionTreeNode } from "./types";

export type SessionTabKind = "session" | "draft";

export interface SessionTab {
	/** `t:<uuid>` — stable for the tab's whole life (reorder/remount never change it). */
	id: string;
	kind: SessionTabKind;
	/** Required for `kind: "session"`. */
	sessionId: string | null;
	/** Workspace of a draft tab; null = degraded draft (no workspace resolved yet). */
	draftCwd: string | null;
	/** `session.projectRoot ?? session.cwd`; `draftCwd` for drafts. */
	projectRoot: string | null;
	/**
	 * Last known display title (D4 rule: session name > first user message >
	 * "New session · HH:mm"). The tab bar prefers a live resolver when the host
	 * has the `SessionInfo` at hand, so this snapshot is the fallback for tabs
	 * restored without their session object.
	 */
	title: string;
	openedAt: number;
	/** LRU key: drives eviction and the background stream budget. */
	lastActiveAt: number;
	/**
	 * Draft tabs: true when the user asked for a new session (`+`, Ctrl+N,
	 * palette). The boot-time default draft is false so it keeps attaching to
	 * the serve process's shared coordinator session like the single-chat shell.
	 * Always false for session tabs.
	 */
	explicitNew: boolean;
}

export interface SessionTabsState {
	tabs: SessionTab[];
	activeTabId: string | null;
}

/** Soft cap: the 13th tab evicts the least-recently-used evictable one. */
export const MAX_TABS = 12;
/** Background tabs that may keep their session SSE (the active tab is extra). */
export const MAX_BACKGROUND_STREAMS = 2;

export type ContextUsageInfo = {
	percent: number | null;
	contextWindow: number;
	tokens: number | null;
};

/**
 * Runtime-only per-tab metadata written by the tab's own `ChatWindow` and read
 * by the shell chrome (`Map<tabId, TabRuntimeMeta>` in AppShell). Never
 * persisted: nothing here survives a reload, and the top bar / dock panels only
 * ever read the *active* tab's entry so a background tab cannot leak its stats
 * into the chrome.
 */
export interface TabRuntimeMeta {
	/** Lazily mounted: false until the tab has been activated once. */
	mounted: boolean;
	/** Bumped to force a fresh `ChatWindow` mount for this tab only. */
	remountNonce: number;
	/** Live run state (SSE) for the active tab; the shared poll covers the rest. */
	running: boolean;
	/** Cold tab: running with its stream over budget — content needs a refetch. */
	stale: boolean;
	sessionStats: SessionStatsInfo | null;
	contextUsage: ContextUsageInfo | null;
	model: { provider: string; modelId: string } | null;
	thinkingLevel: string;
	branchTree: SessionTreeNode[];
	branchActiveLeafId: string | null;
	systemPrompt: string | null;
	plan: { enabled: boolean; planFilePath: string | null };
}

export const EMPTY_TAB_META: TabRuntimeMeta = {
	mounted: false,
	remountNonce: 0,
	running: false,
	stale: false,
	sessionStats: null,
	contextUsage: null,
	model: null,
	thinkingLevel: "",
	branchTree: [],
	branchActiveLeafId: null,
	systemPrompt: null,
	plan: { enabled: false, planFilePath: null },
};

export const EMPTY_TABS_STATE: SessionTabsState = { tabs: [], activeTabId: null };

/** New stable tab id. `crypto.randomUUID` exists in browsers and node >= 19. */
export function createTabId(): string {
	const uuid = globalThis.crypto?.randomUUID?.();
	if (uuid) return `t:${uuid}`;
	return `t:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Identity subset of `SessionInfo` a tab needs (also satisfied by list rows). */
export interface TabSessionIdentity {
	id: string;
	cwd: string;
	projectRoot?: string;
}

export function tabProjectRoot(session: TabSessionIdentity): string {
	return session.projectRoot ?? session.cwd ?? "";
}

export function sessionTab(
	session: TabSessionIdentity,
	options: { title: string; now?: number; id?: string },
): SessionTab {
	const now = options.now ?? Date.now();
	return {
		id: options.id ?? createTabId(),
		kind: "session",
		sessionId: session.id,
		draftCwd: null,
		projectRoot: tabProjectRoot(session),
		title: options.title,
		openedAt: now,
		lastActiveAt: now,
		explicitNew: false,
	};
}

export function draftTab(
	cwd: string | null,
	options: { title: string; explicitNew: boolean; now?: number; id?: string },
): SessionTab {
	const now = options.now ?? Date.now();
	return {
		id: options.id ?? createTabId(),
		kind: "draft",
		sessionId: null,
		draftCwd: cwd,
		projectRoot: cwd,
		title: options.title,
		openedAt: now,
		lastActiveAt: now,
		explicitNew: options.explicitNew,
	};
}

/**
 * Draft key (`lib/draft-store`) for a tab — the F5 fix.
 *
 * Saved sessions keep the pre-tab key (`session.id`) so a session's unsent text
 * follows it. Drafts key on the *tab id*, so two "new session" tabs in the same
 * cwd no longer share one draft buffer (the old `new:<cwd>` key did).
 */
export function draftKeyForTab(tab: Pick<SessionTab, "id" | "kind" | "sessionId">): string {
	return tab.kind === "session" && tab.sessionId ? tab.sessionId : `draft:${tab.id}`;
}

export function findTabBySessionId(tabs: readonly SessionTab[], sessionId: string): SessionTab | null {
	return tabs.find(tab => tab.sessionId === sessionId) ?? null;
}

/** Insert a tab at `index` (default: append) and optionally activate it. */
export function insertTab(
	state: SessionTabsState,
	tab: SessionTab,
	options: { index?: number; activate?: boolean; now?: number } = {},
): SessionTabsState {
	const tabs = [...state.tabs];
	const index = options.index ?? tabs.length;
	tabs.splice(Math.max(0, Math.min(index, tabs.length)), 0, tab);
	const activate = options.activate !== false;
	const now = options.now ?? Date.now();
	return {
		tabs: activate ? tabs.map(t => (t.id === tab.id ? { ...t, lastActiveAt: now } : t)) : tabs,
		activeTabId: activate ? tab.id : state.activeTabId,
	};
}

/** Activate an existing tab (refresh its LRU stamp). Unknown id = no-op. */
export function activateTab(state: SessionTabsState, tabId: string, now = Date.now()): SessionTabsState {
	if (!state.tabs.some(tab => tab.id === tabId)) return state;
	return {
		tabs: state.tabs.map(tab => (tab.id === tabId ? { ...tab, lastActiveAt: now } : tab)),
		activeTabId: tabId,
	};
}

export function closeTabs(state: SessionTabsState, tabIds: readonly string[]): SessionTabsState {
	const closing = new Set(tabIds);
	if (closing.size === 0) return state;
	let nextActive = state.activeTabId;
	if (nextActive !== null && closing.has(nextActive)) {
		// Close-successor rule: the next still-open tab to the right, else to the
		// left, else the empty state. Walks the *pre-close* order so closing a
		// block of tabs still lands on the nearest surviving neighbour.
		const index = state.tabs.findIndex(tab => tab.id === nextActive);
		nextActive = null;
		for (let i = index + 1; i < state.tabs.length && nextActive === null; i += 1) {
			if (!closing.has(state.tabs[i].id)) nextActive = state.tabs[i].id;
		}
		for (let i = index - 1; i >= 0 && nextActive === null; i -= 1) {
			if (!closing.has(state.tabs[i].id)) nextActive = state.tabs[i].id;
		}
	}
	return { tabs: state.tabs.filter(tab => !closing.has(tab.id)), activeTabId: nextActive };
}

export function closeTab(state: SessionTabsState, tabId: string): SessionTabsState {
	return closeTabs(state, [tabId]);
}

/** "Close other tabs": drop every tab but `tabId`, which stays active. */
export function closeOtherTabs(state: SessionTabsState, tabId: string): SessionTabsState {
	if (!state.tabs.some(tab => tab.id === tabId)) return state;
	const closing = state.tabs.filter(tab => tab.id !== tabId).map(tab => tab.id);
	return activateTab(closeTabs(state, closing), tabId);
}

/** "Close tabs to the right": drop the tabs after `tabId` in strip order. */
export function closeTabsToRight(state: SessionTabsState, tabId: string): SessionTabsState {
	const index = state.tabs.findIndex(tab => tab.id === tabId);
	if (index < 0) return state;
	const closing = state.tabs.slice(index + 1).map(tab => tab.id);
	return closing.length > 0 ? closeTabs(state, closing) : state;
}

export function updateTab(
	state: SessionTabsState,
	tabId: string,
	patch: Partial<Omit<SessionTab, "id">>,
): SessionTabsState {
	if (!state.tabs.some(tab => tab.id === tabId)) return state;
	return { tabs: state.tabs.map(tab => (tab.id === tabId ? { ...tab, ...patch } : tab)), activeTabId: state.activeTabId };
}

/** Move a tab to `toIndex` (the DnD / keyboard reorder primitive; PR C wires it). */
export function reorderTabs(state: SessionTabsState, fromIndex: number, toIndex: number): SessionTabsState {
	const tabs = [...state.tabs];
	if (fromIndex < 0 || fromIndex >= tabs.length) return state;
	const target = Math.max(0, Math.min(toIndex, tabs.length - 1));
	if (fromIndex === target) return state;
	const [moved] = tabs.splice(fromIndex, 1);
	tabs.splice(target, 0, moved);
	return { tabs, activeTabId: state.activeTabId };
}

/**
 * Eviction candidate for the soft cap: the least-recently-active tab the host
 * says is safe to drop. `canEvict` is supplied by the shell (not running, no
 * unsent draft, no pending approval); when nothing qualifies the cap is
 * exceeded on purpose rather than killing a run.
 */
export function evictionCandidate(
	tabs: readonly SessionTab[],
	canEvict: (tab: SessionTab) => boolean,
): SessionTab | null {
	let candidate: SessionTab | null = null;
	for (const tab of tabs) {
		if (!canEvict(tab)) continue;
		if (!candidate || tab.lastActiveAt < candidate.lastActiveAt) candidate = tab;
	}
	return candidate;
}

/** Identity of the currently *active* tab's draft/session key (host convenience). */
export function activeTab(state: SessionTabsState): SessionTab | null {
	if (!state.activeTabId) return null;
	return state.tabs.find(tab => tab.id === state.activeTabId) ?? null;
}

export interface StreamBudgetInput {
	tabs: readonly SessionTab[];
	activeTabId: string | null;
	/** Sessions the shared running poll reports as running. */
	runningSessionIds: ReadonlySet<string>;
	/** Tabs whose own `ChatWindow` reports a live run (SSE), keyed by tab id. */
	runningTabIds?: ReadonlySet<string>;
	maxBackgroundStreams?: number;
}

export function isTabRunning(tab: SessionTab, input: Omit<StreamBudgetInput, "tabs" | "activeTabId" | "maxBackgroundStreams">): boolean {
	if (input.runningTabIds?.has(tab.id)) return true;
	return Boolean(tab.sessionId && input.runningSessionIds.has(tab.sessionId));
}

/**
 * Tabs that should show the running badge.
 *
 * Two already-consumed signals only: the tabs whose own `ChatWindow` reports a
 * live run (SSE), plus the shared running poll, which names sessions — that is
 * what covers a restored/cold tab, whose ChatWindow was never mounted and which
 * therefore never reported a run. No extra request is made for the badge.
 */
export function selectRunningTabIds(input: {
	tabs: readonly SessionTab[];
	runningSessionIds: ReadonlySet<string>;
	runningTabIds?: ReadonlySet<string>;
}): Set<string> {
	const ids = new Set<string>(input.runningTabIds ?? []);
	for (const tab of input.tabs) {
		if (tab.sessionId && input.runningSessionIds.has(tab.sessionId)) ids.add(tab.id);
	}
	return ids;
}

/**
 * Which tabs may hold a session SSE. Browsers cap same-origin connections at 6
 * under HTTP/1.1, so the budget is the active tab plus the N most recently used
 * background tabs that are still running (the user's decision: 2). Everything
 * else is a "cold" tab: no stream, content refreshed when it is activated
 * again. An idle background tab never streams at all.
 */
export function selectStreamingTabIds(input: StreamBudgetInput): Set<string> {
	const maxBackground = input.maxBackgroundStreams ?? MAX_BACKGROUND_STREAMS;
	const streaming = new Set<string>();
	if (input.activeTabId) streaming.add(input.activeTabId);

	const backgroundRunning = input.tabs
		.filter(tab => tab.id !== input.activeTabId && isTabRunning(tab, input))
		.sort((a, b) => b.lastActiveAt - a.lastActiveAt);

	for (const tab of backgroundRunning.slice(0, Math.max(0, maxBackground))) streaming.add(tab.id);
	return streaming;
}
