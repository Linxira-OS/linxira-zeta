/**
 * Team DB facts for the Studio graph.
 *
 * The single global Team database (`~/.zeta/data/zeta.db`) is the authority for
 * teams, PM workspaces, base repos, bindings, engineers, linked worktrees,
 * rooms and PM-owned persistent agents. This module reads one consistent
 * snapshot for the pure projection in `team-projection.ts`.
 *
 * A missing database is an empty team inventory, not an error: hosts without a
 * Team still show their live agents. Opening `TeamDb` would create the file, so
 * the path is checked first.
 */
import * as fs from "node:fs";
import {
	resolveTeamDbPath,
	TeamDb,
	type AgentRecord,
	type BindingRecord,
	type EngineerRecord,
	type PmRecord,
	type RepoRecord,
	type RoomMemberRecord,
	type RoomRecord,
	type TeamRecord,
	type WorktreeRecord,
} from "../../../team/db.js";

/** One read-model snapshot of every structural Team fact. */
export interface TeamDbFacts {
	readonly teams: readonly TeamRecord[];
	readonly pms: readonly PmRecord[];
	readonly repos: readonly RepoRecord[];
	readonly bindings: readonly BindingRecord[];
	readonly engineers: readonly EngineerRecord[];
	readonly worktrees: readonly WorktreeRecord[];
	readonly rooms: readonly RoomRecord[];
	readonly roomMembers: readonly RoomMemberRecord[];
	readonly agents: readonly AgentRecord[];
}

const EMPTY_TEAM_DB_FACTS: TeamDbFacts = {
	teams: [],
	pms: [],
	repos: [],
	bindings: [],
	engineers: [],
	worktrees: [],
	rooms: [],
	roomMembers: [],
	agents: [],
};

/** Empty inventory, shared because it is immutable. */
export function emptyTeamDbFacts(): TeamDbFacts {
	return EMPTY_TEAM_DB_FACTS;
}

/** Read every Team row, or the empty inventory when the database is absent. */
export function readTeamDbFacts(dbPath: string = resolveTeamDbPath()): TeamDbFacts {
	if (!fs.existsSync(dbPath)) return EMPTY_TEAM_DB_FACTS;
	const db = new TeamDb(dbPath);
	try {
		const teams = db.listTeams();
		const pms: PmRecord[] = [];
		const repos: RepoRecord[] = [];
		const bindings: BindingRecord[] = [];
		const engineers: EngineerRecord[] = [];
		const worktrees: WorktreeRecord[] = [];
		const rooms: RoomRecord[] = [];
		const roomMembers: RoomMemberRecord[] = [];
		const agents: AgentRecord[] = [];
		for (const team of teams) {
			pms.push(...db.listPms(team.id));
			repos.push(...db.listRepos(team.id));
			bindings.push(...db.listBindings(team.id));
			engineers.push(...db.listEngineers(team.id));
			worktrees.push(...db.listWorktrees(team.id));
			const teamRooms = db.listRooms(team.id);
			rooms.push(...teamRooms);
			for (const room of teamRooms) roomMembers.push(...db.listRoomMembers(room.id));
			agents.push(...db.listAgents(team.id));
		}
		return { teams, pms, repos, bindings, engineers, worktrees, rooms, roomMembers, agents };
	} finally {
		db.close();
	}
}
