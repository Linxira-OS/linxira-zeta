/**
 * Sidebar grouping & sorting — pure functions (P2 interaction port).
 *
 * Sort contract: archived sinks to the bottom, pinned floats to the top,
 * then the active sort key, then updatedAt desc, then a stable id tiebreak.
 * Zone splitting and time-bucket grouping were removed with the D6 rework —
 * the sidebar renders project groups directly from component state.
 */
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

const DAY_MS = 86_400_000;

/**
 * D5 empty-session policy: 0 messages, not running, not pinned, and untouched
 * for >24h → pulled out of the regular list into the group-tail fold. Fresh /
 * running / pinned empty sessions stay visible.
 */
export function isFoldableEmptySession(
	session: { messageCount: number; modified: string },
	opts: { now: number; isRunning: boolean; isPinned: boolean },
): boolean {
	if (session.messageCount !== 0) return false;
	if (opts.isRunning || opts.isPinned) return false;
	const modified = Date.parse(session.modified);
	if (!Number.isFinite(modified)) return true;
	return opts.now - modified > DAY_MS;
}
