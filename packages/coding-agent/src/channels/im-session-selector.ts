/**
 * Short `!session` selectors for one IM entry.
 *
 * A selector is `NN-00001`: a stable workspace base plus a stable per-workspace
 * session number. Numbers are assigned in creation order and never reused or
 * renumbered when the 3-day display window changes. The Team IM page and
 * `!session list` consume this same candidate read model; neither duplicates
 * the algorithm.
 */

import { readSessionInfo, type SessionInfo } from "../session/session-listing";
import type { SessionTaskSummary } from "../session/session-task-summary";
import type { BotSessionEntry, WebConfig } from "../config/web-config";
import type { SessionRouter } from "./session-router";

export interface ImSessionCandidate {
	/** `NN-00001`: stable workspace base + stable per-workspace sequence. */
	selector: string;
	/** Canonical registry/session id; never a selector. */
	canonicalSessionId: string;
	bindingId?: string;
	workspaceAlias: string;
	/** Alias of the canonical workspace id; display label, not an id. */
	workspaceId: string;
	/** Human label (never a raw session id). */
	label: string;
	/** Completed task result only; absent when there is none. */
	latestTaskSummary?: string;
	status: "completed" | "incomplete" | "unknown";
	/** Full provenance projection; never inferred from the display label. */
	taskSummary?: SessionTaskSummary;
	/** ISO timestamp of the last activity used for display sorting. */
	lastActiveAt: string;
	isPm: boolean;
	tag: BotSessionEntry["tag"];
}

export interface ImSessionListSnapshot {
	generatedAt: number;
	candidates: ImSessionCandidate[];
	bySelector: ReadonlyMap<string, ImSessionCandidate>;
}

/** In-memory stable numbering state owned by one SessionRouter. */
export interface ImSessionSelectorState {
	workspaceBase: Map<string, number>;
	sessionNumber: Map<string, number>;
	nextSessionNumber: Map<string, number>;
	nextWorkspaceBase: number;
}

export function createImSessionSelectorState(): ImSessionSelectorState {
	return {
		workspaceBase: new Map(),
		sessionNumber: new Map(),
		nextSessionNumber: new Map(),
		nextWorkspaceBase: 1,
	};
}

export interface BuildSessionListOptions {
	now?: number;
	/** PM candidates are hidden from ordinary chat lists unless explicitly asked. */
	includePm?: boolean;
	/** Default 3 days; older conversations stay in Studio/history. */
	maxAgeMs?: number;
}

function isPmEntry(entry: BotSessionEntry, webConfig: WebConfig): boolean {
	if (entry.target?.kind === "team-pm") return true;
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

function workspaceBase(state: ImSessionSelectorState, alias: string): number {
	const existing = state.workspaceBase.get(alias);
	if (existing !== undefined) return existing;
	const next = state.nextWorkspaceBase++;
	state.workspaceBase.set(alias, next);
	return next;
}

function candidateLabel(entry: BotSessionEntry, info: SessionInfo | undefined, alias: string): string {
	const title = info?.title?.replace(/\s+/g, " ").trim();
	if (title && title !== entry.id && title !== info?.id) return title;
	const name = entry.name?.replace(/\s+/g, " ").trim();
	if (name && name !== entry.id && name !== info?.id) return name;
	const platform = entry.platform ?? "im";
	const display = { wechat: "WeChat", feishu: "Feishu", telegram: "Telegram", discord: "Discord", qq: "QQ", im: "IM" }[platform] ?? "IM";
	return `${alias} · ${display} 会话`;
}

/** Build one immutable list snapshot for the current entry. */
export async function buildImSessionList(
	router: SessionRouter,
	webConfig: WebConfig,
	state: ImSessionSelectorState,
	options: BuildSessionListOptions = {},
): Promise<ImSessionListSnapshot> {
	const now = options.now ?? Date.now();
	const maxAge = options.maxAgeMs ?? 3 * 24 * 60 * 60_000;
	const includePm = options.includePm === true;
	const rows: Array<{ entry: BotSessionEntry; info?: SessionInfo; workspaceAlias: string; modifiedAt: number; isPm: boolean }> = [];
	for (const entry of router.listBotSessions()) {
		const isPm = isPmEntry(entry, webConfig);
		const info = await readSessionInfo(entry.sessionFile).catch(() => undefined);
		rows.push({
			entry,
			...(info === undefined ? {} : { info }),
			workspaceAlias: entry.workspaceAlias ?? "main",
			modifiedAt: entryTime(entry, info),
			isPm,
		});
	}
	// Workspace bases follow the canonical registry order (main first), never
	// activity. The router state keeps them stable if a workspace disappears.
	workspaceBase(state, "main");
	for (const workspace of webConfig.getWorkspaces()) workspaceBase(state, workspace.alias);
	for (const row of rows) workspaceBase(state, row.workspaceAlias);

	// Assign stable session numbers in creation order, before the display
	// window is applied. A session that slides out keeps its number; a new one
	// takes the next number.
	rows.sort((a, b) => {
		const byWorkspace = (state.workspaceBase.get(a.workspaceAlias) ?? 0) - (state.workspaceBase.get(b.workspaceAlias) ?? 0);
		if (byWorkspace !== 0) return byWorkspace;
		const byCreated = Date.parse(a.entry.createdAt) - Date.parse(b.entry.createdAt);
		return byCreated !== 0 ? byCreated : a.entry.id.localeCompare(b.entry.id);
	});
	for (const row of rows) {
		if (state.sessionNumber.has(row.entry.id)) continue;
		const next = (state.nextSessionNumber.get(row.workspaceAlias) ?? 0) + 1;
		state.nextSessionNumber.set(row.workspaceAlias, next);
		state.sessionNumber.set(row.entry.id, next);
	}

	const candidates: ImSessionCandidate[] = rows
		.filter(row => (!row.isPm || includePm) && row.modifiedAt > 0 && now - row.modifiedAt <= maxAge)
		.sort((a, b) => b.modifiedAt - a.modifiedAt || a.entry.id.localeCompare(b.entry.id))
		.map(row => {
			const taskSummary = row.info?.taskSummary;
			const summary = taskSummary?.status === "completed" ? taskSummary.result?.trim() : undefined;
			const base = state.workspaceBase.get(row.workspaceAlias) ?? 1;
			const sequence = state.sessionNumber.get(row.entry.id) ?? 1;
			const selector = `${String(base).padStart(2, "0")}-${String(sequence).padStart(5, "0")}`;
			const label = candidateLabel(row.entry, row.info, row.workspaceAlias);
			return {
				selector,
				canonicalSessionId: row.entry.id,
				...(row.entry.bindingId ? { bindingId: row.entry.bindingId } : {}),
				workspaceAlias: row.workspaceAlias,
				workspaceId: row.workspaceAlias,
				label,
				...(summary ? { latestTaskSummary: summary } : {}),
				status: taskSummary?.status ?? "unknown",
				...(taskSummary ? { taskSummary } : {}),
				lastActiveAt: new Date(row.modifiedAt).toISOString(),
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
