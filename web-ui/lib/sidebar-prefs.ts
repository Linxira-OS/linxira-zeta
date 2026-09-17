/**
 * Unified sidebar preference schema (P2 interaction port).
 *
 * One localStorage key holds every sidebar preference: per-session meta
 * (pin/archive/order/manual-title/read-at), per-project meta (alias, pin,
 * archive, collapse, manual order) and the two sort modes. Migrated once from
 * the scattered P1 keys, which are removed after a successful migration.
 *
 * Pure module: no React. Storage access is guarded so it can run under SSR
 * and in node:test (memory fallback).
 */
"use client";
import { isRecord } from "./type-guards";

export type SessionSort = "recent" | "created" | "oldest" | "name";
export type ProjectSort = "recent" | "created" | "oldest" | "name" | "manual";

export interface SessionMeta {
	pinned?: boolean;
	/** Manual rename flag: an automatic title must never replace a manual one. */
	manualTitle?: boolean;
	/** Manual sort position (project sort = manual). */
	order?: number;
	/** Timestamp of the last open; unread outcome badges compare against it. */
	readAt?: number;
}

export interface ProjectMeta {
	/** UI-only display alias; the project path stays authoritative. */
	name?: string;
	pinned?: boolean;
	collapsed?: boolean;
	/** Manual sort position (project sort = manual). */
	order?: number;
}

export interface ZetaSidebarPrefs {
	sessionMeta: Record<string, SessionMeta>;
	projectMeta: Record<string, ProjectMeta>;
	projectSort: ProjectSort;
	sessionView: { sort: SessionSort };
}

export const SIDEBAR_PREFS_KEY = "zeta-web:sidebar-preferences-v2";

// Legacy P1 keys — read once by the migration, then deleted.
const LEGACY_KEYS = {
	pinnedSessions: "zeta-web:sidebar-pinned",
	aliases: "zeta-web:sidebar-project-aliases",
	pinnedProjects: "zeta-web:sidebar-pinned-projects",
	collapsedProjects: "zeta-web:sidebar-collapsed-projects",
	display: "zeta-web:sidebar-display",
} as const;

export const DEFAULT_PREFS: ZetaSidebarPrefs = {
	sessionMeta: {},
	projectMeta: {},
	projectSort: "recent",
	sessionView: { sort: "recent" },
};

interface StorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

let memory: Map<string, string> | null = null;

function storage(): StorageLike {
	if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
	memory ??= new Map<string, string>();
	return {
		getItem: (k) => memory?.get(k) ?? null,
		setItem: (k, v) => void memory?.set(k, v),
		removeItem: (k) => void memory?.delete(k),
	};
}

function bool(v: unknown): boolean | undefined {
	return typeof v === "boolean" ? v : undefined;
}

function num(v: unknown): number | undefined {
	return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function str(v: unknown): string | undefined {
	return typeof v === "string" && v.length > 0 ? v : undefined;
}

function cleanSessionMeta(v: unknown): SessionMeta {
	if (!isRecord(v)) return {};
	const out: SessionMeta = {};
	const pinned = bool(v.pinned);
	if (pinned !== undefined) out.pinned = pinned;
	const manualTitle = bool(v.manualTitle);
	if (manualTitle !== undefined) out.manualTitle = manualTitle;
	const order = num(v.order);
	if (order !== undefined) out.order = order;
	const readAt = num(v.readAt);
	if (readAt !== undefined) out.readAt = readAt;
	return out;
}

function cleanProjectMeta(v: unknown): ProjectMeta {
	if (!isRecord(v)) return {};
	const out: ProjectMeta = {};
	const name = str(v.name);
	if (name !== undefined) out.name = name.slice(0, 80);
	const pinned = bool(v.pinned);
	if (pinned !== undefined) out.pinned = pinned;
	const collapsed = bool(v.collapsed);
	if (collapsed !== undefined) out.collapsed = collapsed;
	const order = num(v.order);
	if (order !== undefined) out.order = order;
	return out;
}

const SESSION_SORTS: readonly SessionSort[] = ["recent", "created", "oldest", "name"];
const PROJECT_SORTS: readonly ProjectSort[] = ["recent", "created", "oldest", "name", "manual"];

function sessionSort(v: unknown): SessionSort {
	return SESSION_SORTS.includes(v as SessionSort) ? (v as SessionSort) : "recent";
}

function projectSort(v: unknown): ProjectSort {
	return PROJECT_SORTS.includes(v as ProjectSort) ? (v as ProjectSort) : "recent";
}

function cleanPrefs(v: unknown): ZetaSidebarPrefs {
	if (!isRecord(v)) return { ...DEFAULT_PREFS };
	const sm: Record<string, SessionMeta> = {};
	if (isRecord(v.sessionMeta)) {
		for (const [k, m] of Object.entries(v.sessionMeta)) sm[k] = cleanSessionMeta(m);
	}
	const pm: Record<string, ProjectMeta> = {};
	if (isRecord(v.projectMeta)) {
		for (const [k, m] of Object.entries(v.projectMeta)) pm[k] = cleanProjectMeta(m);
	}
	const view = isRecord(v.sessionView) ? v.sessionView : {};
	return {
		sessionMeta: sm,
		projectMeta: pm,
		projectSort: projectSort(v.projectSort),
		sessionView: { sort: sessionSort(view.sort) },
	};
}

/** Legacy display.projectSort values → unified ProjectSort. */
function migrateLegacyProjectSort(v: unknown): ProjectSort {
	if (v === "a-z" || v === "z-a") return "name";
	if (v === "date-added") return "created";
	return projectSort(v);
}

/** One-time migration from the P1 scattered keys. Idempotent; best-effort. */
export function migrateLegacyKeys(s: StorageLike): void {
	const raw = s.getItem(SIDEBAR_PREFS_KEY);
	const prefs = cleanPrefs(raw ? JSON.parse(raw) : undefined);

	const legacyPins = raw0(s, LEGACY_KEYS.pinnedSessions);
	if (legacyPins) {
		legacyPins.forEach((id, i) => {
			prefs.sessionMeta[id] = { ...prefs.sessionMeta[id], pinned: true, order: i };
		});
		s.removeItem(LEGACY_KEYS.pinnedSessions);
	}
	const aliases = rawObj(s, LEGACY_KEYS.aliases);
	if (aliases) {
		for (const [path, name] of Object.entries(aliases)) {
			prefs.projectMeta[path] = { ...prefs.projectMeta[path], name };
		}
		s.removeItem(LEGACY_KEYS.aliases);
	}
	const legacyProjectPins = raw0(s, LEGACY_KEYS.pinnedProjects);
	if (legacyProjectPins) {
		legacyProjectPins.forEach((path, i) => {
			prefs.projectMeta[path] = { ...prefs.projectMeta[path], pinned: true, order: i };
		});
		s.removeItem(LEGACY_KEYS.pinnedProjects);
	}
	const collapsed = raw0(s, LEGACY_KEYS.collapsedProjects);
	if (collapsed) {
		for (const path of collapsed) {
			prefs.projectMeta[path] = { ...prefs.projectMeta[path], collapsed: true };
		}
		s.removeItem(LEGACY_KEYS.collapsedProjects);
	}
	const display = rawObj(s, LEGACY_KEYS.display);
	if (display) {
		if ("projectSort" in display) prefs.projectSort = migrateLegacyProjectSort(display.projectSort);
		s.removeItem(LEGACY_KEYS.display);
	}

	s.setItem(SIDEBAR_PREFS_KEY, JSON.stringify(prefs));
}

function raw0(s: StorageLike, key: string): string[] | null {
	try {
		const raw = s.getItem(key);
		if (!raw) return null;
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : null;
	} catch {
		return null;
	}
}

function rawObj(s: StorageLike, key: string): Record<string, string> | null {
	try {
		const raw = s.getItem(key);
		if (!raw) return null;
		const parsed: unknown = JSON.parse(raw);
		if (!isRecord(parsed)) return null;
		const out: Record<string, string> = {};
		for (const [k, v] of Object.entries(parsed)) {
			if (typeof v === "string") out[k] = v;
		}
		return out;
	} catch {
		return null;
	}
}

let cached: ZetaSidebarPrefs | null = null;

export function loadSidebarPrefs(): ZetaSidebarPrefs {
	if (cached) return cached;
	try {
		migrateLegacyKeys(storage());
		cached = cleanPrefs(JSON.parse(storage().getItem(SIDEBAR_PREFS_KEY) ?? ""));
	} catch {
		cached = { ...DEFAULT_PREFS };
	}
	return cached;
}

export function saveSidebarPrefs(prefs: ZetaSidebarPrefs): void {
	cached = prefs;
	try {
		storage().setItem(SIDEBAR_PREFS_KEY, JSON.stringify(prefs));
	} catch {
		// quota/private-mode failures are non-fatal; state stays in memory
	}
}

export function updatePrefs(mutate: (p: ZetaSidebarPrefs) => void): ZetaSidebarPrefs {
	const prefs = loadSidebarPrefs();
	const next: ZetaSidebarPrefs = {
		sessionMeta: { ...prefs.sessionMeta },
		projectMeta: { ...prefs.projectMeta },
		projectSort: prefs.projectSort,
		sessionView: { ...prefs.sessionView },
	};
	mutate(next);
	saveSidebarPrefs(next);
	return next;
}

// ---- Session meta helpers -------------------------------------------------

export function sessionIsPinned(id: string, p: ZetaSidebarPrefs): boolean {
	return p.sessionMeta[id]?.pinned === true;
}

export function pinSession(id: string, pinned: boolean): ZetaSidebarPrefs {
	return updatePrefs((p) => {
		p.sessionMeta[id] = { ...p.sessionMeta[id], pinned };
	});
}

export function markSessionRenamed(id: string): ZetaSidebarPrefs {
	return updatePrefs((p) => {
		p.sessionMeta[id] = { ...p.sessionMeta[id], manualTitle: true };
	});
}

export function markSessionRead(id: string, at: number): ZetaSidebarPrefs {
	return updatePrefs((p) => {
		p.sessionMeta[id] = { ...p.sessionMeta[id], readAt: at };
	});
}

// ---- Project meta helpers -------------------------------------------------

export function projectIsPinned(path: string, p: ZetaSidebarPrefs): boolean {
	return p.projectMeta[path]?.pinned === true;
}

export function projectIsCollapsed(path: string, p: ZetaSidebarPrefs): boolean {
	return p.projectMeta[path]?.collapsed === true;
}

export function projectAlias(path: string, p: ZetaSidebarPrefs): string | undefined {
	return p.projectMeta[path]?.name;
}

export function setProjectAlias(path: string, name: string | null): ZetaSidebarPrefs {
	return updatePrefs((p) => {
		const meta = { ...p.projectMeta[path] };
		if (name) meta.name = name.slice(0, 80);
		else delete meta.name;
		p.projectMeta[path] = meta;
	});
}

export function pinProject(path: string, pinned: boolean): ZetaSidebarPrefs {
	return updatePrefs((p) => {
		p.projectMeta[path] = { ...p.projectMeta[path], pinned };
	});
}

export function collapseProject(path: string, collapsed: boolean): ZetaSidebarPrefs {
	return updatePrefs((p) => {
		p.projectMeta[path] = { ...p.projectMeta[path], collapsed };
	});
}

export function reorderProjects(orderedPaths: readonly string[]): ZetaSidebarPrefs {
	return updatePrefs((p) => {
		orderedPaths.forEach((path, i) => {
			p.projectMeta[path] = { ...p.projectMeta[path], order: i };
		});
		p.projectSort = "manual";
	});
}

/** Test seam: reset the in-memory cache (node:test isolation). */
export function resetPrefsCacheForTest(): void {
	cached = null;
}
