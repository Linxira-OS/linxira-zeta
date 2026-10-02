/**
 * Shared types + persistence helpers for the sidebar split. Pure state — no
 * rendering — so both SessionSidebar and the split components can import
 * without cycles.
 */
"use client";

import type { TranslationParams } from "@/lib/i18n/types";

export type ProjectSort = "manual" | "a-z" | "z-a" | "date-added" | "recent";

/**
 * D4 session title resolution: explicit title (name, incl. user renames) >
 * sanitized first user message (max 60 chars) > "New session · HH:mm".
 * The gateway's `"(no messages)"` placeholder and raw uuids are never shown.
 */
const NO_MESSAGES_PLACEHOLDER = "(no messages)";
const MAX_FIRST_MESSAGE_TITLE = 60;

type TranslateFn = (key: string, params?: TranslationParams) => string;

export function sessionDisplayTitle(
	session: Pick<SessionInfoLite, "name" | "firstMessage" | "created">,
	t: TranslateFn,
): string {
	const name = session.name?.trim();
	if (name && name !== NO_MESSAGES_PLACEHOLDER) return name;
	const first = session.firstMessage?.trim();
	if (first && first !== NO_MESSAGES_PLACEHOLDER) {
		return first.length > MAX_FIRST_MESSAGE_TITLE ? `${first.slice(0, MAX_FIRST_MESSAGE_TITLE)}…` : first;
	}
	const created = new Date(session.created);
	const time = Number.isFinite(created.getTime())
		? `${String(created.getHours()).padStart(2, "0")}:${String(created.getMinutes()).padStart(2, "0")}`
		: "--:--";
	return t("sidebar.newSessionFallback", { time });
}

/** Minimal structural subset of SessionInfo the helpers need (avoids a cycle). */
export interface SessionInfoLite {
	name?: string | null;
	firstMessage: string;
	created: string;
}


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

export const SIDEBAR_PROJECT_ALIASES_KEY = "zeta-web:sidebar-project-aliases";
export const SIDEBAR_PINNED_PROJECTS_KEY = "zeta-web:sidebar-pinned-projects";

/** cwd → display alias. UI-only overlay; never renames anything on disk. */
export function loadProjectAliases(): Record<string, string> {
	try {
		const raw = window.localStorage.getItem(SIDEBAR_PROJECT_ALIASES_KEY);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			const out: Record<string, string> = {};
			for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
				if (typeof v === "string" && v.trim()) out[k] = v.trim();
			}
			return out;
		}
	} catch {
		// storage unavailable — aliases stay session-only
	}
	return {};
}

export function saveProjectAliases(aliases: Record<string, string>): void {
	try {
		window.localStorage.setItem(SIDEBAR_PROJECT_ALIASES_KEY, JSON.stringify(aliases));
	} catch {
		// ignore
	}
}

/** Pinned project roots (cwd-keyed), order-preserving. */
export function loadPinnedProjects(): string[] {
	try {
		const raw = window.localStorage.getItem(SIDEBAR_PINNED_PROJECTS_KEY);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === "string");
	} catch {
		// ignore
	}
	return [];
}

export function savePinnedProjects(projects: string[]): void {
	try {
		window.localStorage.setItem(SIDEBAR_PINNED_PROJECTS_KEY, JSON.stringify(projects));
	} catch {
		// ignore
	}
}

export function saveCollapsedProjects(projects: readonly string[]): void {
	try {
		window.localStorage.setItem(SIDEBAR_COLLAPSED_PROJECTS_KEY, JSON.stringify(projects));
	} catch {
		// storage unavailable — collapse state stays session-only
	}
}
