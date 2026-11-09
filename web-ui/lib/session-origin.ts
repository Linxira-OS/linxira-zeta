import type { SessionInfo } from "./types";

/** Minimal structural subset of a session row the origin helpers need. */
type SessionOriginRow = Pick<SessionInfo, "origin" | "tag">;

/** Translate function shape used across the web UI (avoids an import cycle). */
type Translate = (key: string, vars?: Record<string, string | number>) => string;

/**
 * True when a session is an IM/bot/relay conversation. The header origin is
 * authoritative; the older web.yml `tag` keeps a pre-origin transcript
 * recognized, so an upgrade never reclassifies an existing bot chat as personal.
 */
export function isImSession(row: SessionOriginRow): boolean {
	return row.origin?.kind === "im" || Boolean(row.tag);
}

/**
 * Safe location label for an IM row: its workspace alias, else
 * `IM · <channel>`, else the default-workspace label. `null` for a personal
 * session, whose callers keep showing their own project/workspace path.
 */
export function sessionLocationLabel(row: SessionOriginRow, t: Translate): string | null {
	if (!isImSession(row)) return null;
	const alias = row.origin?.workspaceAlias?.trim();
	if (alias) return alias;
	const channel = row.origin?.channel?.trim();
	if (channel) return t("studio.session.imChannel", { channel });
	return t("studio.session.imDefaultWorkspace");
}
