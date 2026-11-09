/**
 * Lead (PM) mode workspace resolution.
 *
 * Lead mode is the PM main agent's workspace mode. It is valid only when the
 * session cwd resolves to a PM workspace (`pms/<pm>/` with `.zeta/pm.json`)
 * that the team database also registers. A worktree, a base repository, or the
 * ownerless team root is not a PM workspace even though the resolver can name
 * the team (and sometimes the PM) for them.
 */

import { TeamError } from "./errors";
import { pathWithin, resolveTeamLocation, samePath } from "./paths";
import { resolveTeamDbPath, TeamDb } from "./db";

/** Session-level Lead mode state, mirroring the Vibe mode state shape. */
export interface LeadModeState {
	enabled: boolean;
	teamId: string;
	teamName: string;
	pmId: string;
	pmName: string;
}

export interface LeadWorkspace {
	teamRoot: string;
	teamId: string;
	teamName: string;
	pmRoot: string;
	pmId: string;
	pmName: string;
}

/**
 * Resolve the PM workspace for `cwd`, or throw a clear `TeamError` explaining
 * why Lead mode cannot open here. The PM marker and the database row must
 * agree; a marker alone is only a discovery hint.
 */
export async function resolveLeadWorkspace(cwd: string): Promise<LeadWorkspace> {
	const location = await resolveTeamLocation(cwd).catch(error => {
		throw new TeamError(
			`Lead mode requires a PM workspace, but the Team markers from this directory are unreadable: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	});
	if (!location) {
		throw new TeamError(
			"Lead mode requires a PM workspace (pms/<pm>/ containing .zeta/pm.json) inside a Team root. Open the PM folder and retry.",
		);
	}
	const pmRoot = location.pmRoot;
	if (!location.pmId || !pmRoot || !pathWithin(pmRoot, cwd)) {
		throw new TeamError(
			`Lead mode requires a PM workspace (pms/<pm>/ containing .zeta/pm.json); ${location.teamRoot} resolves to team "${location.teamId}" but not to a PM workspace.`,
		);
	}

	const db = new TeamDb(resolveTeamDbPath());
	try {
		const team = db.getTeam(location.teamId);
		if (!team) {
			throw new TeamError(
				`PM workspace ${pmRoot} names team "${location.teamId}", but the global team database has no such team.`,
			);
		}
		const pm = db.listPms(location.teamId).find(record => samePath(record.workspacePath, pmRoot));
		if (!pm) {
			throw new TeamError(
				`PM workspace ${pmRoot} names PM "${location.pmId}", but the global team database has no such PM workspace in team "${location.teamId}".`,
			);
		}
		return {
			teamRoot: location.teamRoot,
			teamId: location.teamId,
			teamName: location.teamName,
			pmRoot,
			pmId: pm.id,
			pmName: pm.name,
		};
	} finally {
		db.close();
	}
}
