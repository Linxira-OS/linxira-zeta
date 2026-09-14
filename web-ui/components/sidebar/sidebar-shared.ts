/**
 * Shared types + persistence helpers for the sidebar split. Pure state — no
 * rendering — so both SessionSidebar and the split components can import
 * without cycles.
 */
"use client";

export type ProjectSort = "manual" | "a-z" | "z-a" | "date-added" | "recent";

export interface SidebarDisplaySettings {
	projectSort: ProjectSort;
	sessionGrouping: "by-worktree" | "flat";
	showRecent: boolean;
}

export const SIDEBAR_COLLAPSED_PROJECTS_KEY = "zeta-web:sidebar-collapsed-projects";
export const SIDEBAR_DISPLAY_KEY = "zeta-web:sidebar-display";
export const SIDEBAR_PINNED_KEY = "zeta-web:sidebar-pinned";

export const DEFAULT_DISPLAY: SidebarDisplaySettings = {
	projectSort: "manual",
	sessionGrouping: "by-worktree",
	showRecent: true,
};

export function loadCollapsedProjects(): Set<string> {
	try {
		const raw = window.localStorage.getItem(SIDEBAR_COLLAPSED_PROJECTS_KEY);
		if (!raw) return new Set();
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) ? new Set(parsed.filter((x): x is string => typeof x === "string")) : new Set();
	} catch {
		return new Set();
	}
}

export function loadDisplaySettings(): SidebarDisplaySettings {
	try {
		const raw = window.localStorage.getItem(SIDEBAR_DISPLAY_KEY);
		if (!raw) return DEFAULT_DISPLAY;
		const parsed = JSON.parse(raw) as Partial<SidebarDisplaySettings>;
		return { ...DEFAULT_DISPLAY, ...parsed };
	} catch {
		return DEFAULT_DISPLAY;
	}
}

/** Pinned session ids, persisted and order-preserving; stale ids survive so they gray out. */
export function loadPinnedSessionIds(): string[] {
	try {
		const raw = window.localStorage.getItem(SIDEBAR_PINNED_KEY);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
	} catch {
		return [];
	}
}

export function savePinnedSessionIds(ids: readonly string[]): void {
	try {
		window.localStorage.setItem(SIDEBAR_PINNED_KEY, JSON.stringify(ids));
	} catch {
		// storage unavailable — pins stay session-only
	}
}
