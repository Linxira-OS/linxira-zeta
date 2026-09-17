/**
 * Sidebar grouping & sorting — pure functions (P2 interaction port).
 *
 * Zones: globally pinned sessions float out as their own zone; temp sessions
 * (cwd inside the OS temp dir, flagged by the gateway) form the TEMP zone;
 * everything else groups by project. Within a project group, sessions are
 * sub-grouped by recency (today needs no header — recent is the top).
 *
 * Sort contract: archived sinks to the bottom, pinned floats to the top,
 * then the active sort key, then updatedAt desc, then a stable id tiebreak.
 */
import { isRecord } from "./type-guards";

export type SessionSort = "recent" | "created" | "oldest" | "name";
export type ProjectSort = "recent" | "created" | "oldest" | "name" | "manual";

export interface SortableSession {
	id: string;
	title?: string;
	updatedAt?: number;
	createdAt?: number;
	pinned?: boolean;
	archived?: boolean;
	order?: number;
	/** Project root or cwd the session belongs to (already resolved upstream). */
	projectKey: string;
	temp?: boolean;
}

export interface SortableProject {
	path: string;
	name?: string;
	branch?: string | null;
	pinned?: boolean;
	archived?: boolean;
	order?: number;
	openedAt?: number;
	updatedAt?: number;
	createdAt?: number;
}

export interface SessionMetaLite {
	pinned?: boolean;
	archived?: boolean;
	order?: number;
}

export interface ProjectMetaLite {
	name?: string;
	pinned?: boolean;
	archived?: boolean;
	collapsed?: boolean;
	order?: number;
}

/** Groups older than today, in label order. `today` renders without a header. */
export type TimeGroupKey = "today" | "yesterday" | "thisWeek" | "older";
export const TIME_GROUP_KEYS: readonly TimeGroupKey[] = ["today", "yesterday", "thisWeek", "older"];

const DAY = 86_400_000;

function startOfDay(now: number): number {
	const d = new Date(now);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

export function timeGroupOf(updatedAt: number | undefined, now: number): TimeGroupKey {
	const t = typeof updatedAt === "number" && Number.isFinite(updatedAt) ? updatedAt : 0;
	if (t >= startOfDay(now)) return "today";
	if (t >= startOfDay(now) - DAY) return "yesterday";
	if (t >= startOfDay(now) - 6 * DAY) return "thisWeek";
	return "older";
}

/**
 * Sub-group sessions by recency. `today` is first and carries a null label
 * (renderers skip the header); empty groups are omitted entirely.
 */
export function timeGroups<T extends SortableSession>(
	rows: readonly T[],
	now: number,
): Array<{ key: TimeGroupKey; label: TimeGroupKey | null; items: T[] }> {
	const buckets = new Map<TimeGroupKey, T[]>(TIME_GROUP_KEYS.map((k) => [k, []]));
	for (const row of rows) buckets.get(timeGroupOf(row.updatedAt, now))?.push(row);
	return TIME_GROUP_KEYS.map((key) => ({
		key,
		label: key === "today" ? null : key,
		items: buckets.get(key) as T[],
	})).filter((g) => g.items.length > 0);
}

function ts(v: number | undefined): number {
	return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function compareTs(a: number | undefined, b: number | undefined, desc: boolean): number {
	const ta = ts(a);
	const tb = ts(b);
	if (ta === tb) return 0;
	const missing = ts(a) === 0 ? -1 : ts(b) === 0 ? 1 : 0;
	if (missing) return missing;
	return desc ? tb - ta : ta - tb;
}

function orderOf(meta: SessionMetaLite | ProjectMetaLite | undefined): number {
	return typeof meta?.order === "number" ? meta.order : Number.MAX_SAFE_INTEGER;
}

export interface SortInput {
	metaFor: (id: string) => SessionMetaLite | undefined;
	sort: SessionSort;
}


/** Unified comparator chain: archived → pinned → sort key → updated → id. */
export function sortSessions<T extends SortableSession>(
	rows: readonly T[],
	sort: SessionSort,
	metaFor: (id: string) => SessionMetaLite | undefined,
): T[] {
	return [...rows].sort((a, b) => {
		const ma = metaFor(a.id);
		const mb = metaFor(b.id);
		const arch = Number(ma?.archived === true) - Number(mb?.archived === true);
		if (arch) return arch;
		const pin = Number(mb?.pinned === true) - Number(ma?.pinned === true);
		if (pin) return pin;
		if (sort === "name") {
			const byName = String(a.title ?? "").localeCompare(String(b.title ?? ""), undefined, {
				sensitivity: "base",
			});
			if (byName) return byName;
		} else if (sort === "created") {
			const byCreated = compareTs(a.createdAt, b.createdAt, true);
			if (byCreated) return byCreated;
		} else if (sort === "oldest") {
			const byCreated = compareTs(a.createdAt, b.createdAt, false);
			if (byCreated) return byCreated;
		}
		const byUpdated = compareTs(a.updatedAt, b.updatedAt, true);
		if (byUpdated) return byUpdated;
		return a.id.localeCompare(b.id);
	});
}

/** Project comparator: pinned → sort key → path tiebreak. */
export function sortProjects<T extends SortableProject>(
	projects: readonly T[],
	sort: ProjectSort,
): T[] {
	return [...projects].sort((a, b) => {
		const pin = Number(b.pinned === true) - Number(a.pinned === true);
		if (pin) return pin;
		if (sort === "name") {
			const byName = String(a.name ?? a.path).localeCompare(String(b.name ?? b.path), undefined, {
				sensitivity: "base",
			});
			if (byName) return byName;
		} else if (sort === "created") {
			const byCreated = compareTs(a.createdAt, b.createdAt, true);
			if (byCreated) return byCreated;
		} else if (sort === "oldest") {
			const byCreated = compareTs(a.createdAt, b.createdAt, false);
			if (byCreated) return byCreated;
		} else if (sort === "manual") {
			const byOrder = orderOf(a) - orderOf(b);
			if (byOrder) return byOrder;
		}
		const byOpened = compareTs(a.openedAt ?? a.updatedAt, b.openedAt ?? b.updatedAt, true);
		if (byOpened) return byOpened;
		return a.path.localeCompare(b.path, undefined, { sensitivity: "base" });
	});
}

/** Max sessions rendered per project group before the Load-more fold. */
export const MAX_VISIBLE_SESSIONS = 10;

export function foldVisible<T>(items: readonly T[], expanded: boolean): { visible: T[]; hidden: number } {
	if (expanded || items.length <= MAX_VISIBLE_SESSIONS) return { visible: [...items], hidden: 0 };
	return { visible: items.slice(0, MAX_VISIBLE_SESSIONS), hidden: items.length - MAX_VISIBLE_SESSIONS };
}

export interface SidebarZones<T extends SortableSession> {
	pinned: T[];
	temp: T[];
	projectRows: Array<{ project: string; sessions: T[] }>;
}

/**
 * Split sessions into the three floating zones. Pinned sessions leave their
 * project group (project retention never limits pin discovery). Temp
 * sessions never enter project groups.
 */
export function splitZones<T extends SortableSession>(
	sessions: readonly T[],
	sort: SessionSort,
	metaFor: (id: string) => SessionMetaLite | undefined,
): SidebarZones<T> {
	const pinned: T[] = [];
	const temp: T[] = [];
	const byProject = new Map<string, T[]>();
	for (const s of sessions) {
		if (metaFor(s.id)?.pinned === true) {
			pinned.push(s);
			continue;
		}
		if (s.temp) {
			temp.push(s);
			continue;
		}
		const list = byProject.get(s.projectKey) ?? [];
		list.push(s);
		byProject.set(s.projectKey, list);
	}
	const sortedPins = sortSessions(pinned, "recent", metaFor);
	const sortedTemp = sortSessions(temp, sort, metaFor);
	// Group order: most recently active project first (consumers re-sort via
	// sortProjects when the project sort mode is not "recent").
	const projectRows = [...byProject.entries()]
		.map(([project, rows]) => ({
			project,
			sessions: sortSessions(rows, sort, metaFor),
		}))
		.sort(
			(a, b) =>
				ts(b.sessions[0]?.updatedAt) - ts(a.sessions[0]?.updatedAt) || a.project.localeCompare(b.project),
		);
	return { pinned: sortedPins, temp: sortedTemp, projectRows };
}

/** Parse helper for consumers reading prefs-backed meta maps. */
export function metaEntry(v: unknown): SessionMetaLite | undefined {
	if (!isRecord(v)) return undefined;
	return {
		pinned: typeof v.pinned === "boolean" ? v.pinned : undefined,
		archived: typeof v.archived === "boolean" ? v.archived : undefined,
		order: typeof v.order === "number" ? v.order : undefined,
	};
}
