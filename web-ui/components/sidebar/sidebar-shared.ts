/**
 * Shared helpers for the sidebar split. Pure state — no rendering — so both
 * SessionSidebar and the split components can import without cycles.
 *
 * Batch 5 (D6): all project presentation prefs (collapse / alias / project
 * pin / display settings) now live in P2 `lib/sidebar-prefs.ts`
 * (`zeta-web:sidebar-preferences-v2`); the P1 scattered keys survive only as
 * a read-once migration source. What remains here is the pinned-session list
 * (still P1-persisted by design) and the D4 display-title helper.
 */
"use client";

import type { TranslationParams } from "@/lib/i18n/types";

export const SIDEBAR_PINNED_KEY = "zeta-web:sidebar-pinned";

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
		window.localStorage.setItem(SIDEBAR_PINNED_KEY, JSON.stringify([...ids]));
	} catch {
		// storage unavailable — pins stay session-only
	}
}

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
