/**
 * Team session grouping: Team → PM → engineer → repo → conversation.
 *
 * This is the data contract the resume picker's Team scope and, later, the
 * Team Hub's Sessions panel share. It is pure: callers pass the Team-origin
 * rows from a picker listing (`includeTeam: true`), and this module only
 * orders and labels them. A row with an incomplete stamp still appears, under
 * an explicit "Unassigned" bucket, rather than disappearing.
 *
 * Labels come from the deterministic Team row ids (`<team>:<pm>:<engineer>`),
 * never from a filesystem path: a Team row must not leak the host layout.
 */

import type { SessionInfo } from "../session/session-listing";
import { isTeamSession } from "../session/session-origin";

export interface TeamSessionRepoGroup {
	/** Deterministic repo row id, or null when the stamp did not resolve one. */
	repoId: string | null;
	/** Display name derived from the row id. */
	label: string;
	/** Newest first. */
	conversations: SessionInfo[];
}

export interface TeamSessionEngineerGroup {
	engineerId: string | null;
	label: string;
	repos: TeamSessionRepoGroup[];
}

export interface TeamSessionPmGroup {
	pmId: string | null;
	label: string;
	engineers: TeamSessionEngineerGroup[];
}

export interface TeamSessionTeamGroup {
	teamId: string;
	label: string;
	pms: TeamSessionPmGroup[];
}

interface MutableRepo {
	label: string;
	conversations: SessionInfo[];
}

interface MutableEngineer {
	label: string;
	repos: Map<string | null, MutableRepo>;
}

interface MutablePm {
	label: string;
	engineers: Map<string | null, MutableEngineer>;
}

interface MutableTeam {
	label: string;
	pms: Map<string | null, MutablePm>;
}

/** Name part of a deterministic Team row id (`<team>:<name>`). */
function idLabel(id: string | null, fallback: string): string {
	if (id === null) return fallback;
	const separator = id.lastIndexOf(":");
	const label = separator < 0 ? id : id.slice(separator + 1);
	return label.length > 0 ? label : fallback;
}

function newestFirst(a: SessionInfo, b: SessionInfo): number {
	const modified = b.modified.getTime() - a.modified.getTime();
	if (modified !== 0) return modified;
	const created = b.created.getTime() - a.created.getTime();
	if (created !== 0) return created;
	return a.id.localeCompare(b.id);
}

function sortByLabel<T extends { label: string }>(groups: T[]): T[] {
	return groups.sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Group Team-origin rows only. IM and personal rows are ignored here; a
 * caller that wants every origin asks the listing for them separately.
 */
export function groupTeamSessions(sessions: readonly SessionInfo[]): TeamSessionTeamGroup[] {
	const teams = new Map<string, MutableTeam>();

	for (const session of sessions) {
		const origin = session.origin;
		if (!isTeamSession(origin)) continue;
		let team = teams.get(origin.teamId);
		if (!team) {
			team = { label: origin.teamId, pms: new Map() };
			teams.set(origin.teamId, team);
		}
		const pmId = origin.pmId ?? null;
		let pm = team.pms.get(pmId);
		if (!pm) {
			pm = { label: idLabel(pmId, "Unassigned PM"), engineers: new Map() };
			team.pms.set(pmId, pm);
		}
		const engineerId = origin.engineerId ?? null;
		let engineer = pm.engineers.get(engineerId);
		if (!engineer) {
			engineer = { label: idLabel(engineerId, "Unassigned engineer"), repos: new Map() };
			pm.engineers.set(engineerId, engineer);
		}
		const repoId = origin.repoId ?? null;
		let repo = engineer.repos.get(repoId);
		if (!repo) {
			repo = { label: idLabel(repoId, "Unassigned repo"), conversations: [] };
			engineer.repos.set(repoId, repo);
		}
		repo.conversations.push(session);
	}

	return [...teams.entries()]
		.map(([teamId, team]): TeamSessionTeamGroup => ({
			teamId,
			label: team.label,
			pms: sortByLabel(
				[...team.pms.entries()].map(([pmId, pm]): TeamSessionPmGroup => ({
					pmId,
					label: pm.label,
					engineers: sortByLabel(
						[...pm.engineers.entries()].map(([engineerId, engineer]): TeamSessionEngineerGroup => ({
							engineerId,
							label: engineer.label,
							repos: sortByLabel(
								[...engineer.repos.entries()].map(([repoId, repo]): TeamSessionRepoGroup => ({
									repoId,
									label: repo.label,
									conversations: repo.conversations.sort(newestFirst),
								})),
							),
						})),
					),
				})),
			),
		}))
		.sort((a, b) => a.label.localeCompare(b.label) || a.teamId.localeCompare(b.teamId));
}
