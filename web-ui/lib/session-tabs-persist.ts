/**
 * Session tabs — localStorage codec for the tab strip (PR B).
 *
 * What is stored is the *view list* only: tab order, the active tab id and the
 * cold metadata a tab needs to be listed (`SessionTab`). Nothing about a
 * session's content is stored, so restoring a tab creates no request: a
 * restored tab has no runtime metadata, which means its `ChatWindow` is not
 * mounted until the tab is activated (that is the "cold tab" state the shell
 * already implements).
 *
 * The payload is boundary data — a user, an older build or a broken write can
 * put anything in the key — so decoding validates every field and drops what
 * it cannot prove. An unknown schema version is *not* guessed at: the whole
 * payload is ignored (the shell starts empty and the next save rewrites it).
 *
 * Cap: a payload with more than `MAX_TABS` tabs is trimmed least-recently-active
 * first, keeping the active tab. Eviction here only drops Views, never work:
 * closing a tab has no gateway command behind it (see `session-tabs.ts`), so a
 * turn that is still running keeps running and its session stays reachable from
 * the sidebar. The live eviction gate (running / unsent draft) lives in
 * `hooks/useSessionTabs.ts` and is unaffected by this module.
 */
import { MAX_TABS, type SessionTab, type SessionTabsState } from "./session-tabs";
import { isRecord } from "./type-guards";

/** The persisted key. Also names the schema generation, hence the constant name. */
export const SESSION_TABS_STORAGE_KEY = "zeta-web:session-tabs-v1";
export const SESSION_TABS_SCHEMA_VERSION = 1;

/** A sane ceiling: 12 tabs of metadata is ~4 KB; anything huge is not ours. */
const MAX_PAYLOAD_CHARS = 64 * 1024;
const MAX_ID_CHARS = 128;
const MAX_TITLE_CHARS = 500;
const MAX_PATH_CHARS = 4096;

/** The tiny slice of `Storage` the codec needs (fakes in tests satisfy it). */
export interface TabsStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

interface PersistedTab {
	id: string;
	kind: "session" | "draft";
	sessionId: string | null;
	draftCwd: string | null;
	projectRoot: string | null;
	title: string;
	openedAt: number;
	lastActiveAt: number;
	explicitNew: boolean;
}

/** The read-only shape both the codec and the shell state satisfy. */
export interface SessionTabsView {
	tabs: readonly SessionTab[];
	activeTabId: string | null;
}

interface PersistedPayload {
	version: number;
	tabs: PersistedTab[];
	activeTabId: string | null;
}

function boundedString(value: unknown, limit: number): string | null {
	if (typeof value !== "string" || value.length === 0 || value.length > limit) return null;
	return value;
}

function nullablePath(value: unknown): string | null {
	if (value === undefined || value === null) return null;
	if (typeof value !== "string" || value.length === 0 || value.length > MAX_PATH_CHARS) return null;
	return value;
}

function timestamp(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
	return value;
}

/**
 * Validate one stored tab. Returns null for anything the model cannot hold
 * safely (missing id, a session tab without a session, a non-finite LRU stamp),
 * so a single bad row never costs the rest of the strip.
 */
function decodeTab(value: unknown): SessionTab | null {
	if (!isRecord(value)) return null;
	const id = boundedString(value.id, MAX_ID_CHARS);
	if (!id) return null;
	const kind = value.kind;
	if (kind !== "session" && kind !== "draft") return null;

	const rawSessionId = value.sessionId;
	let sessionId: string | null = null;
	if (kind === "session") {
		sessionId = boundedString(rawSessionId, MAX_ID_CHARS);
		if (!sessionId) return null;
	} else if (rawSessionId !== undefined && rawSessionId !== null) {
		// A draft must not claim a session; a mismatched row is noise, not data.
		return null;
	}

	const openedAt = timestamp(value.openedAt);
	const lastActiveAt = timestamp(value.lastActiveAt);
	if (openedAt === null || lastActiveAt === null) return null;

	const title = typeof value.title === "string" ? value.title.slice(0, MAX_TITLE_CHARS) : "";
	const projectRoot = nullablePath(value.projectRoot);
	const draftCwd = kind === "draft" ? nullablePath(value.draftCwd) : null;

	return {
		id,
		kind,
		sessionId,
		draftCwd,
		projectRoot,
		title,
		openedAt,
		lastActiveAt,
		// Only drafts carry the flag; session tabs are always false by contract.
		explicitNew: kind === "draft" && value.explicitNew === true,
	};
}

/**
 * Trim to the tab cap, least-recently-active first. The active tab is never
 * trimmed (the shell would otherwise restore to a different view), so a
 * pathological payload can keep one extra tab until the next interaction.
 */
function trimToCap(tabs: SessionTab[], activeTabId: string | null): SessionTab[] {
	if (tabs.length <= MAX_TABS) return tabs;
	const drop = new Set<string>();
	for (const tab of [...tabs].sort((a, b) => a.lastActiveAt - b.lastActiveAt)) {
		if (tabs.length - drop.size <= MAX_TABS) break;
		if (tab.id === activeTabId) continue;
		drop.add(tab.id);
	}
	return tabs.filter(tab => !drop.has(tab.id));
}

/**
 * Decode a stored payload. Returns null when the payload is absent, corrupt,
 * from an unknown schema version, or structurally wrong — the caller then keeps
 * its current (empty) state. A *valid* payload with no tabs yields the empty
 * state, which is how the shell persists "no tabs open".
 */
export function decodeSessionTabs(raw: string | null | undefined): SessionTabsState | null {
	if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_PAYLOAD_CHARS) return null;

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}

	if (!isRecord(parsed)) return null;
	if (parsed.version !== SESSION_TABS_SCHEMA_VERSION) return null;
	if (!Array.isArray(parsed.tabs)) return null;

	const tabs: SessionTab[] = [];
	const seenIds = new Set<string>();
	const seenSessions = new Set<string>();
	for (const entry of parsed.tabs) {
		const tab = decodeTab(entry);
		if (!tab) continue;
		if (seenIds.has(tab.id)) continue;
		if (tab.sessionId) {
			// One view per session: the model guarantees it, and a duplicate would
			// render two ChatWindows for the same session.
			if (seenSessions.has(tab.sessionId)) continue;
			seenSessions.add(tab.sessionId);
		}
		seenIds.add(tab.id);
		tabs.push(tab);
	}

	const requestedActive =
		typeof parsed.activeTabId === "string" && seenIds.has(parsed.activeTabId) ? parsed.activeTabId : null;
	const trimmed = trimToCap(tabs, requestedActive);
	const keptIds = new Set(trimmed.map(tab => tab.id));
	// The requested tab may have been trimmed; fall back to the most recent one
	// so a restore always lands on something real.
	const activeTabId =
		requestedActive && keptIds.has(requestedActive)
			? requestedActive
			: [...trimmed].sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0]?.id ?? null;

	return { tabs: trimmed, activeTabId };
}

/** Serialize the view list (order + active id + tab metadata only). */
export function encodeSessionTabs(state: SessionTabsView): string {
	const payload: PersistedPayload = {
		version: SESSION_TABS_SCHEMA_VERSION,
		activeTabId: state.activeTabId,
		tabs: state.tabs.map(tab => ({
			id: tab.id,
			kind: tab.kind,
			sessionId: tab.sessionId,
			draftCwd: tab.draftCwd,
			projectRoot: tab.projectRoot,
			title: tab.title,
			openedAt: tab.openedAt,
			lastActiveAt: tab.lastActiveAt,
			explicitNew: tab.explicitNew,
		})),
	};
	return JSON.stringify(payload);
}

function resolveStorage(storage?: TabsStorage): TabsStorage | null {
	if (storage) return storage;
	try {
		if (typeof window === "undefined") return null;
		return window.localStorage;
	} catch {
		// Storage disabled (private mode, blocked cookies) — tabs just don't persist.
		return null;
	}
}

/** Read and decode the stored tabs; null when absent/unreadable. */
export function readPersistedSessionTabs(storage?: TabsStorage): SessionTabsState | null {
	const store = resolveStorage(storage);
	if (!store) return null;
	try {
		return decodeSessionTabs(store.getItem(SESSION_TABS_STORAGE_KEY));
	} catch {
		return null;
	}
}

/** Write the current view list; storage failures are non-fatal. */
export function writePersistedSessionTabs(state: SessionTabsView, storage?: TabsStorage): void {
	const store = resolveStorage(storage);
	if (!store) return;
	try {
		store.setItem(SESSION_TABS_STORAGE_KEY, encodeSessionTabs(state));
	} catch {
		// Quota / disabled storage: the session keeps working without persistence.
	}
}
