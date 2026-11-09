/**
 * Resolve the Team provenance of a new session from its working directory.
 *
 * Session creation is synchronous (`SessionManager.create` writes the header
 * before returning), so this uses {@link resolveTeamLocationSync}. Markers are
 * the discovery input; the global Team DB, when it exists, refines the ids and
 * display labels and matches external (linked) worktrees whose path is not
 * below the team root. Nothing here can fail session creation: a malformed
 * marker or an unreadable DB leaves the session unstamped, which keeps it in
 * the personal lists rather than hiding it.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { TeamSessionOrigin } from "../session/session-origin";
import { TeamDb, engineerRowId, pmRowId, repoRowId, resolveTeamDbPath, type WorktreeRecord } from "./db";
import { canonicalPath, pathWithin, resolveTeamLocationSync, type TeamLocation } from "./paths";

export interface ResolveTeamSessionOriginOptions {
	/** Team database override; defaults to `ZETA_TEAM_DB` or the global zeta.db. */
	dbPath?: string;
}

/** Name part of a deterministic Team row id (`<team>:<name>`). */
function idName(id: string | undefined): string | undefined {
	if (id === undefined) return undefined;
	const separator = id.lastIndexOf(":");
	return separator < 0 ? id : id.slice(separator + 1);
}

function displayLabel(parts: readonly (string | undefined)[]): string | undefined {
	const kept = parts.filter((part): part is string => part !== undefined && part.length > 0);
	return kept.length > 0 ? kept.join(" / ") : undefined;
}

interface DerivedOrigin {
	pmId?: string;
	engineerId?: string;
	repoId?: string;
	workspaceAlias?: string;
}

/** Ids and a name-only label implied by the cwd's position inside the team root. */
function deriveFromLayout(location: TeamLocation, cwd: string): DerivedOrigin {
	const teamId = location.teamId;
	const rel = path.relative(canonicalPath(location.teamRoot), canonicalPath(cwd)).split(path.sep).filter(Boolean);
	const [section, ...parts] = rel;

	if (section === "worktrees" && parts.length >= 3) {
		const [repoName, pmName, engineerName, entryName] = parts;
		return {
			pmId: pmRowId(teamId, pmName),
			engineerId: engineerRowId(teamId, pmName, engineerName),
			repoId: repoRowId(teamId, repoName),
			// `home` is the engineer's main worktree; any other entry is a task name.
			workspaceAlias: displayLabel([
				pmName,
				engineerName,
				repoName,
				entryName === undefined || entryName === "home" ? undefined : entryName,
			]),
		};
	}
	if (section === "pms" && parts[0]) {
		return { pmId: pmRowId(teamId, parts[0]), workspaceAlias: parts[0] };
	}
	if (section === "repos" && parts[0]) {
		return { repoId: repoRowId(teamId, parts[0]), workspaceAlias: parts[0] };
	}
	if (location.pmId) {
		return { pmId: pmRowId(teamId, location.pmId), workspaceAlias: location.pmId };
	}
	return {};
}

/** Deepest DB worktree whose path contains `cwd` (a worktree root or a folder inside it). */
function findWorktree(db: TeamDb, teamId: string, cwd: string): WorktreeRecord | undefined {
	let best: WorktreeRecord | undefined;
	for (const worktree of db.listWorktrees(teamId)) {
		if (!pathWithin(worktree.path, cwd)) continue;
		if (best === undefined || canonicalPath(worktree.path).length > canonicalPath(best.path).length) best = worktree;
	}
	return best;
}

/** Refine marker-derived ids with the authoritative DB rows, when it is available. */
function enrichFromDb(origin: TeamSessionOrigin, cwd: string, dbPath: string): TeamSessionOrigin {
	if (!fs.existsSync(dbPath)) return origin;
	let db: TeamDb;
	try {
		db = new TeamDb(dbPath);
	} catch {
		return origin;
	}
	try {
		let { pmId, engineerId, repoId, workspaceAlias } = {
			pmId: origin.pmId,
			engineerId: origin.engineerId,
			repoId: origin.repoId,
			workspaceAlias: origin.workspaceAlias,
		};

		const worktree = findWorktree(db, origin.teamId, cwd);
		if (worktree) {
			pmId = worktree.pmId;
			engineerId = worktree.engineerId;
			repoId = worktree.repoId;
			const pmName = db.getPmById(worktree.pmId)?.name ?? idName(worktree.pmId);
			const repoName = db.getRepoById(worktree.repoId)?.name ?? idName(worktree.repoId);
			const engineerName = db.getEngineerById(worktree.engineerId)?.name ?? idName(worktree.engineerId);
			workspaceAlias = displayLabel([
				pmName,
				engineerName,
				repoName,
				worktree.kind === "task" ? worktree.name : undefined,
			]);
		} else {
			const pm = db.listPms(origin.teamId).find(record => pathWithin(record.workspacePath, cwd));
			if (pm) {
				pmId = pm.id;
				workspaceAlias = pm.name;
			}
			const repo = db.listRepos(origin.teamId).find(record => pathWithin(record.basePath, cwd));
			if (repo) {
				repoId = repo.id;
				workspaceAlias = repo.name;
			}
		}

		return {
			kind: "team",
			teamId: origin.teamId,
			...(pmId === undefined ? {} : { pmId }),
			...(engineerId === undefined ? {} : { engineerId }),
			...(repoId === undefined ? {} : { repoId }),
			...(origin.roomId === undefined ? {} : { roomId: origin.roomId }),
			...(workspaceAlias === undefined ? {} : { workspaceAlias }),
		};
	} catch {
		return origin;
	} finally {
		db.close();
	}
}

/**
 * `undefined` outside a Team location (a personal session, or a malformed
 * marker). The returned stamp carries deterministic Team row ids and a
 * display-only alias built from names — never an absolute path.
 */
export function resolveTeamSessionOrigin(
	cwd: string,
	options: ResolveTeamSessionOriginOptions = {},
): TeamSessionOrigin | undefined {
	let location: TeamLocation | null;
	try {
		location = resolveTeamLocationSync(cwd);
	} catch {
		return undefined;
	}
	if (location === null) return undefined;
	const derived = deriveFromLayout(location, cwd);
	const origin: TeamSessionOrigin = {
		kind: "team",
		teamId: location.teamId,
		...(derived.pmId === undefined ? {} : { pmId: derived.pmId }),
		...(derived.engineerId === undefined ? {} : { engineerId: derived.engineerId }),
		...(derived.repoId === undefined ? {} : { repoId: derived.repoId }),
		...(derived.workspaceAlias === undefined ? {} : { workspaceAlias: derived.workspaceAlias }),
	};
	return enrichFromDb(origin, cwd, options.dbPath ?? resolveTeamDbPath());
}
