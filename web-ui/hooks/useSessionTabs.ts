"use client";

/**
 * Session tabs — React binding for the pure model in `lib/session-tabs.ts`.
 *
 * The shell owns a single instance whose state is the sole source of truth for
 * "which sessions are open, in what order, and which one is active". Persistence
 * lives outside this hook: `lib/session-tabs-persist` decodes the stored view
 * list, the caller passes it as `initialState`, and a save effect writes the
 * state back. Restored tabs are ordinary cold tabs — no session is contacted
 * until the tab is activated.
 */
import { useCallback, useState } from "react";

import {
	activateTab,
	closeOtherTabs,
	closeTab,
	closeTabs,
	closeTabsToRight,
	draftTab,
	evictionCandidate,
	insertTab,
	MAX_TABS,
	reorderTabs,
	sessionTab,
	updateTab,
	type SessionTab,
	type SessionTabsState,
	type TabSessionIdentity,
} from "@/lib/session-tabs";

export interface OpenTabOptions {
	/** Activate the new tab (default true; the "open in background" case opts out). */
	activate?: boolean;
	/**
	 * Soft-cap eviction gate. Tabs for which this returns false are never
	 * evicted (running, holding an unsent draft, waiting for approval), so the
	 * cap may be exceeded instead of killing work.
	 */
	canEvict?: (tab: SessionTab) => boolean;
	/** Tabs dropped by the cap, for the shell's one-line hint (PR B surfaces it). */
	onEvicted?: (evicted: readonly SessionTab[]) => void;
}

export interface UseSessionTabsResult {
	tabs: readonly SessionTab[];
	activeTabId: string | null;
	activeTab: SessionTab | null;
	/** Ensure the session has a tab (focusing it, not duplicating), then activate it. */
	openSessionTab(session: TabSessionIdentity, title: string, options?: OpenTabOptions): string;
	/** Open a new draft tab; `explicitNew` decides shared-coordinator vs fresh session. */
	openDraftTab(cwd: string | null, title: string, explicitNew: boolean, options?: OpenTabOptions): string;
	activate(tabId: string): void;
	close(tabId: string): void;
	closeMany(tabIds: readonly string[]): void;
	/** Right-click menu: drop every other tab, keeping this one active. */
	closeOthers(tabId: string): void;
	/** Right-click menu: drop the tabs after this one in strip order. */
	closeRight(tabId: string): void;
	closeSessionTabs(sessionId: string): void;
	update(tabId: string, patch: Partial<Omit<SessionTab, "id">>): void;
	/** Reorder primitive (HTML5 DnD / keyboard in PR C). */
	reorder(fromIndex: number, toIndex: number): void;
}

export interface UseSessionTabsOptions {
	/** Restored state (PR B). Defaults to the empty state. */
	initialState?: SessionTabsState;
}

export function useSessionTabs(options: UseSessionTabsOptions = {}): UseSessionTabsResult {
	const [state, setState] = useState<SessionTabsState>(() => options.initialState ?? { tabs: [], activeTabId: null });

	const insert = useCallback((tab: SessionTab, openOptions?: OpenTabOptions): string => {
		setState(prev => {
			let next = prev;
			if (next.tabs.length >= MAX_TABS && openOptions?.canEvict) {
				const victim = evictionCandidate(next.tabs, openOptions.canEvict);
				if (victim) {
					next = closeTab(next, victim.id);
					openOptions.onEvicted?.([victim]);
				}
			}
			return insertTab(next, tab, { activate: openOptions?.activate });
		});
		return tab.id;
	}, []);

	const openSessionTab = useCallback(
		(session: TabSessionIdentity, title: string, openOptions?: OpenTabOptions): string => {
			const existing = state.tabs.find(tab => tab.sessionId === session.id);
			if (!existing) return insert(sessionTab(session, { title }), openOptions);
			setState(prev => {
				// Refresh identity-derived fields: renames, and worktrees whose
				// projectRoot only lands with the hydrated session info.
				const refreshed = updateTab(prev, existing.id, {
					title,
					projectRoot: session.projectRoot ?? session.cwd,
				});
				return openOptions?.activate === false ? refreshed : activateTab(refreshed, existing.id);
			});
			return existing.id;
		},
		[insert, state.tabs],
	);

	const openDraftTab = useCallback(
		(cwd: string | null, title: string, explicitNew: boolean, openOptions?: OpenTabOptions): string =>
			insert(draftTab(cwd, { title, explicitNew }), openOptions),
		[insert],
	);

	const activate = useCallback((tabId: string) => setState(prev => activateTab(prev, tabId)), []);
	const close = useCallback((tabId: string) => setState(prev => closeTab(prev, tabId)), []);
	const closeMany = useCallback((tabIds: readonly string[]) => setState(prev => closeTabs(prev, tabIds)), []);
	const closeOthers = useCallback((tabId: string) => setState(prev => closeOtherTabs(prev, tabId)), []);
	const closeRight = useCallback((tabId: string) => setState(prev => closeTabsToRight(prev, tabId)), []);
	const closeSessionTabs = useCallback(
		(sessionId: string) =>
			setState(prev => closeTabs(prev, prev.tabs.filter(tab => tab.sessionId === sessionId).map(tab => tab.id))),
		[],
	);
	const update = useCallback(
		(tabId: string, patch: Partial<Omit<SessionTab, "id">>) => setState(prev => updateTab(prev, tabId, patch)),
		[],
	);
	const reorder = useCallback((fromIndex: number, toIndex: number) => setState(prev => reorderTabs(prev, fromIndex, toIndex)), []);

	return {
		tabs: state.tabs,
		activeTabId: state.activeTabId,
		activeTab: state.tabs.find(tab => tab.id === state.activeTabId) ?? null,
		openSessionTab,
		openDraftTab,
		activate,
		close,
		closeMany,
		closeOthers,
		closeRight,
		closeSessionTabs,
		update,
		reorder,
	};
}
