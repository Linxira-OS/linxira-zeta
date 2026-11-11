/**
 * Short `!session` selectors for one IM entry.
 *
 * A list snapshot assigns `NN-00001` (workspace base + per-workspace sequence).
 * `!session use` must resolve against the snapshot the user actually saw, not
 * a freshly renumbered list. Canonical session ids stay in the registry; the
 * selector is only a short-lived display handle.
 */

import { readSessionInfo, type SessionInfo } from "../session/session-listing";
import type { BotSessionEntry, WebConfig } from "../config/web-config";
import type { SessionRouter } from "./session-router";

export interface ImSessionCandidate {
	/** `NN-00001`: workspace base + per-workspace sequence. */
	selector: string;
	/** Registry id; never renumbered. */
	canonicalId: string;
	name: string;
	/** Latest completed-task summary from the provenance projection, when present. */
	summary?: string;
	workspaceAlias: string;
	modifiedAt: number;
	isPm: boolean;
	tag: BotSessionEntry["tag"];
}

export interface ImSessionListSnapshot {
	generatedAt: number;
	candidates: ImSessionCandidate[];
	bySelector: ReadonlyMap<string, ImSessionCandidate>;
}

export interface BuildSessionListOptions {
	now?: number;
	/** PM candidates are hidden from ordinary chat lists unless explicitly asked. */
	includePm?: boolean;
	/** Default 3 days; older conversations stay in Studio/history. */
	maxAgeMs?: number;
}

function isPmEntry(entry: BotSessionEntry, webConfig: WebConfig): boolean {
	if (!entry.agentProfileId) return false;
	const profile = webConfig.getImAgent(entry.agentProfileId);
	return profile?.location.kind === "team-pm" || profile?.tools.preset === "team-pm";
}

function entryTime(entry: BotSessionEntry, info: SessionInfo | undefined): number {
	const modified = info?.modified?.getTime();
	if (typeof modified === "number" && Number.isFinite(modified)) return modified;
	const created = Date.parse(entry.createdAt);
	return Number.isFinite(created) ? created : 0;
}

/** Build one immutable list snapshot for the current entry. */
export async function buildImSessionList(
	router: SessionRouter,
	webConfig: WebConfig,
	options: BuildSessionListOptions = {},
): Promise<ImSessionListSnapshot> {
	const now = options.now ?? Date.now();
	const maxAge = options.maxAgeMs ?? 3 * 24 * 60 * 60_000;
	const includePm = options.includePm === true;
	const rows: Array<{ entry: BotSessionEntry; info?: SessionInfo; workspaceAlias: string; modifiedAt: number; isPm: boolean }> = [];
	for (const entry of router.listBotSessions()) {
		const isPm = isPmEntry(entry, webConfig);
		if (isPm && !includePm) continue;
		const info = await readSessionInfo(entry.sessionFile).catch(() => undefined);
		const modifiedAt = entryTime(entry, info);
		if (modifiedAt > 0 && now - modifiedAt > maxAge) continue;
		rows.push({
			entry,
			...(info === undefined ? {} : { info }),
			workspaceAlias: entry.workspaceAlias ?? "main",
			modifiedAt,
			isPm,
		});
	}
	const aliases = [...new Set(rows.map(row => row.workspaceAlias))].sort((a, b) => {
		if (a === "main") return -1;
		if (b === "main") return 1;
		return a.localeCompare(b);
	});
	const base = new Map(aliases.map((alias, index) => [alias, index + 1]));
	rows.sort(
		(a, b) =>
			(base.get(a.workspaceAlias) ?? 0) - (base.get(b.workspaceAlias) ?? 0) ||
			b.modifiedAt - a.modifiedAt ||
			a.entry.id.localeCompare(b.entry.id),
	);
	const sequence = new Map<string, number>();
	const candidates: ImSessionCandidate[] = rows.map(row => {
		const next = (sequence.get(row.workspaceAlias) ?? 0) + 1;
		sequence.set(row.workspaceAlias, next);
		const selector = `${String(base.get(row.workspaceAlias) ?? 1).padStart(2, "0")}-${String(next).padStart(5, "0")}`;
		return {
			selector,
			canonicalId: row.entry.id,
			name: row.entry.name,
			workspaceAlias: row.workspaceAlias,
			modifiedAt: row.modifiedAt,
			isPm: row.isPm,
			tag: row.entry.tag,
		};
	});
	return {
		generatedAt: now,
		candidates,
		bySelector: new Map(candidates.map(candidate => [candidate.selector, candidate])),
	};
}
