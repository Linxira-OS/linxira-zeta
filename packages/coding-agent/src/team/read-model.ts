/**
 * Read-only Team projection for the Team Hub and Studio host.
 *
 * It returns real database rows only (team, PMs, engineers, worktrees, rooms,
 * tasks, bounded task events, bootstrap runs). The caller supplies the team
 * root so the read model never guesses which team a global DB row belongs to.
 */

import type {
	BootstrapRunRecord,
	EngineerRecord,
	PmRecord,
	RoomRecord,
	RoomSummaryRecord,
	TaskEventRecord,
	TaskRecord,
	TeamRecord,
	WorktreeRecord,
} from "./db";
import { resolveTeamDbPath, TeamDb } from "./db";
import { canonicalPath } from "./paths";
import { loadContext, type TeamContextOptions } from "./service";

export interface TeamReadModel {
	team: TeamRecord;
	pms: PmRecord[];
	engineers: EngineerRecord[];
	worktrees: WorktreeRecord[];
	rooms: RoomSummaryRecord[];
	tasks: TaskRecord[];
	taskEvents: Record<string, TaskEventRecord[]>;
	bootstrapRuns: BootstrapRunRecord[];
	/** Display-only room rows for surfaces that do not need summary counts. */
	roomRows: RoomRecord[];
	warnings: string[];
}

export interface TeamReadModelOptions extends TeamContextOptions {
	taskEventLimit?: number;
}

export async function readTeamReadModel(options: TeamReadModelOptions): Promise<TeamReadModel> {
	const dbPath = options.dbPath ?? resolveTeamDbPath();
	const ctx = await loadContext({ ...options, dbPath });
	try {
		const warnings: string[] = [];
		const tasks = ctx.db.listTasks(ctx.team.id);
		const limit = options.taskEventLimit ?? 50;
		const taskEvents: Record<string, TaskEventRecord[]> = {};
		for (const task of tasks) {
			const events = ctx.db.listTaskEvents(task.id);
			taskEvents[task.id] = events.slice(-limit);
		}
		return {
			team: ctx.team,
			pms: ctx.db.listPms(ctx.team.id),
			engineers: ctx.db.listEngineers(ctx.team.id),
			worktrees: ctx.db.listWorktrees(ctx.team.id),
			rooms: ctx.db.listRoomSummaries(ctx.team.id),
			tasks,
			taskEvents,
			bootstrapRuns: ctx.db.listBootstrapRuns(ctx.teamRoot),
			roomRows: ctx.db.listRooms(ctx.team.id),
			warnings,
		};
	} finally {
		ctx.db.close();
	}
}

/** Task rows for a Hub pane; same database, no room/roster projection. */
export function listTeamTasks(teamRoot: string, options: TeamContextOptions = {}): TaskRecord[] {
	const db = new TeamDb(options.dbPath ?? resolveTeamDbPath());
	try {
		const team = db.getTeamByRoot(canonicalPath(teamRoot));
		return team ? db.listTasks(team.id) : [];
	} finally {
		db.close();
	}
}
