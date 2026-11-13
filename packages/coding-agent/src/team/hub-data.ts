/**
 * Team Hub data projection: reads the global Team database and exposes exactly
 * the rows the Hub draws. No caching, no watchers — the Hub reloads on open,
 * `r`, and after a post. Room posts go through the same `postRoomEvent` service
 * the CLI uses, so they are database events only and never session transcripts.
 */

import type {
	TeamHubEngineer,
	TeamHubEvent,
	TeamHubMember,
	TeamHubPm,
	TeamHubRoom,
	TeamHubRoomKind,
	TeamHubRoomView,
	TeamHubSnapshot,
	TeamHubWorktree,
} from "@linxiraos/pi-tui/overlays/team-hub";
import { addRoomMember, createRoom, postRoomEvent, removeRoomMember, setRoomKind } from "./rooms";
import { resolveTeamDbPath, TeamDb, type RoomSummaryRecord, type TaskRecord } from "./db";
import { cancelTask, claimTask, completeTask, releaseTask, renewTaskLease, rejectTask, submitTask } from "./tasks";

/** Events loaded per selected room. */
export const TEAM_HUB_EVENT_LIMIT = 200;

export interface TeamHubDataSourceOptions {
	teamRoot: string;
	teamId: string;
	/** Marker display name; the DB row (when present) remains authoritative. */
	teamName?: string;
	dbPath?: string;
}

/** The host-side source the overlay calls; tests use it without any terminal. */
export interface TeamHubSource {
	load(options?: { room?: string; preferPmId?: string }): Promise<TeamHubSnapshot>;
	post(input: { room: string; body: string; sender?: string }): Promise<{ seq: number }>;
	createRoom?(input: {
		name: string;
		kind?: "pm" | "coordination" | "room";
		pm?: string;
		shared?: boolean;
		members?: string[];
	}): Promise<{ message: string }>;
	addRoomMember?(input: { room: string; member: string }): Promise<{ message: string }>;
	removeRoomMember?(input: { room: string; member: string }): Promise<{ message: string }>;
	setRoomKind?(input: {
		room: string;
		kind: "pm" | "coordination" | "room";
		pm?: string;
	}): Promise<{ message: string }>;
	taskAction?(input: {
		task: string;
		action: "claim" | "renew" | "release" | "submit" | "complete" | "reject" | "cancel";
		agent?: string;
		pm?: string;
		body?: string;
	}): Promise<{ message: string }>;
}

const ROOM_KIND_RANK: Record<TeamHubRoomKind, number> = { coordination: 0, pm: 1, room: 2 };

/** Shared first, then PM rooms, then arbitrary rooms; name order inside each kind. */
function compareTeamHubRooms(left: TeamHubRoom, right: TeamHubRoom): number {
	const byKind = ROOM_KIND_RANK[left.kind] - ROOM_KIND_RANK[right.kind];
	return byKind !== 0 ? byKind : left.name.localeCompare(right.name);
}

function toRoom(summary: RoomSummaryRecord): TeamHubRoom {
	return {
		id: summary.id,
		name: summary.name,
		kind: summary.kind as TeamHubRoomKind,
		pmId: summary.pmId,
		pmName: null,
		memberCount: summary.memberCount,
		lastSeq: summary.lastSeq,
		lastSentAt: summary.lastSentAt,
	};
}

/** Label an agent id with real roster names; unknown ids stay as their id. */
function agentLabel(
	agentId: string,
	pms: ReadonlyMap<string, string>,
	engineers: ReadonlyMap<string, { name: string; pmName: string }>,
): string {
	const pm = pms.get(agentId);
	if (pm) return pm;
	const engineer = engineers.get(agentId);
	if (engineer) return `${engineer.pmName}/${engineer.name}`;
	return agentId;
}

/**
 * Build a Hub snapshot from the real database. A team marker without a database
 * row still opens the Hub, with an honest warning and empty lists rather than
 * fabricated rooms.
 */
export function createTeamHubDataSource(options: TeamHubDataSourceOptions): TeamHubSource {
	const dbPath = options.dbPath ?? resolveTeamDbPath();

	return {
		async load(loadOptions = {}) {
			const db = new TeamDb(dbPath);
			try {
				const team = db.getTeam(options.teamId);
				const pms = team ? db.listPms(options.teamId) : [];
				const engineers = team ? db.listEngineers(options.teamId) : [];
				const worktrees = team ? db.listWorktrees(options.teamId) : [];
				const pmById = new Map(pms.map(pm => [pm.id, pm.name]));
				const engineerById = new Map(
					engineers.map(engineer => [
						engineer.id,
						{ name: engineer.name, pmName: pmById.get(engineer.pmId) ?? engineer.pmId },
					]),
				);

				const rooms: TeamHubRoom[] = team
					? db
							.listRoomSummaries(options.teamId)
							.map(summary => {
								const room = toRoom(summary);
								return { ...room, pmName: room.pmId ? (pmById.get(room.pmId) ?? room.pmId) : null };
							})
							.sort(compareTeamHubRooms)
					: [];

				let selectedRoom: TeamHubRoomView | null = null;
				let warning: string | undefined = team
					? undefined
					: `Team "${options.teamId}" has a marker but no row in the global team database. Run \`zetacode team doctor\`; nothing is fabricated here.`;

				const roomNameFromRequest = loadOptions.room;
				const preferredRoom = roomNameFromRequest
					? rooms.find(room => room.name === roomNameFromRequest)
					: loadOptions.preferPmId
						? (rooms
								.filter(room => room.pmId === loadOptions.preferPmId)
								.sort((left, right) => left.name.localeCompare(right.name))[0] ??
							rooms.find(room => room.kind === "coordination") ??
							rooms[0])
						: (rooms.find(room => room.kind === "coordination") ?? rooms[0]);
				if (team && roomNameFromRequest && !preferredRoom) {
					warning = `Room "${roomNameFromRequest}" no longer exists; showing another room.`;
				} else if (
					team &&
					!roomNameFromRequest &&
					loadOptions.preferPmId &&
					!rooms.some(room => room.pmId === loadOptions.preferPmId)
				) {
					warning = `PM "${loadOptions.preferPmId}" owns no room in this team; showing ${preferredRoom ? `#${preferredRoom.name}` : "no room"}.`;
				}
				if (preferredRoom) {
					const members: TeamHubMember[] = db.listRoomMembers(preferredRoom.id).map(member => ({
						agentId: member.agentId,
						role: member.role,
						label: agentLabel(member.agentId, pmById, engineerById),
					}));
					const events: TeamHubEvent[] = db.listRoomEvents(preferredRoom.id, TEAM_HUB_EVENT_LIMIT).map(event => ({
						seq: event.seq,
						sentAt: event.sentAt,
						senderAgentId: event.senderAgentId,
						senderLabel: agentLabel(event.senderAgentId, pmById, engineerById),
						kind: event.kind,
						body: event.body,
						replyTo: event.replyTo,
					}));
					selectedRoom = { room: preferredRoom, members, events };
				}

				const tasksView = (team ? db.listTasks(options.teamId) : []).map(task => ({
					id: task.id,
					taskKey: task.taskKey,
					title: task.title,
					status: task.status,
					assignedPmId: task.assignedPmId,
					assigneeAgentId: task.assigneeAgentId,
					ownerAgentId: task.ownerAgentId,
					leaseExpiresAt: task.leaseExpiresAt,
					reqIds: task.reqIds,
				}));
				const pmsView: TeamHubPm[] = pms.map(pm => ({
					id: pm.id,
					name: pm.name,
					engineerCount: engineers.filter(engineer => engineer.pmId === pm.id).length,
				}));
				const engineersView: TeamHubEngineer[] = engineers.map(engineer => {
					const pmName = pmById.get(engineer.pmId) ?? engineer.pmId;
					const rows: TeamHubWorktree[] = worktrees
						.filter(worktree => worktree.engineerId === engineer.id)
						.sort((left, right) => left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name))
						.map(worktree => ({
							id: worktree.id,
							kind: worktree.kind,
							name: worktree.name,
							branch: worktree.branch,
							path: worktree.path,
						}));
					return {
						id: engineer.id,
						name: engineer.name,
						pmId: engineer.pmId,
						pmName,
						execution: engineer.execution,
						worktrees: rows,
					};
				});

				return {
					teamId: options.teamId,
					teamName: team?.name ?? options.teamName ?? options.teamId,
					dbAvailable: team !== null,
					warning,
					pms: pmsView,
					engineers: engineersView,
					rooms,
					tasks: tasksView,
					selectedRoom,
				} satisfies TeamHubSnapshot;
			} finally {
				db.close();
			}
		},

		async post(input) {
			const result = await postRoomEvent({
				teamRoot: options.teamRoot,
				dbPath,
				room: input.room,
				body: input.body,
				sender: input.sender,
			});
			return { seq: result.event.seq };
		},

		async createRoom(input) {
			const result = await createRoom({
				teamRoot: options.teamRoot,
				dbPath,
				name: input.name,
				kind: input.kind,
				pm: input.pm,
				shared: input.shared,
				members: input.members,
			});
			return { message: `Created room "${result.room.name}" (${result.room.kind})` };
		},

		async addRoomMember(input) {
			const member = await addRoomMember({
				teamRoot: options.teamRoot,
				dbPath,
				room: input.room,
				member: input.member,
			});
			return { message: `Added ${member.agentId} to ${input.room} (${member.role})` };
		},

		async removeRoomMember(input) {
			await removeRoomMember({ teamRoot: options.teamRoot, dbPath, room: input.room, member: input.member });
			return { message: `Removed ${input.member} from ${input.room}` };
		},

		async setRoomKind(input) {
			const room = await setRoomKind({
				teamRoot: options.teamRoot,
				dbPath,
				room: input.room,
				kind: input.kind,
				pm: input.pm,
			});
			return { message: `Room "${room.name}" is now ${room.kind}` };
		},

		async taskAction(input) {
			const db = new TeamDb(dbPath);
			let task: TaskRecord | null;
			try {
				const team = db.getTeam(options.teamId);
				task = team ? db.getTask(team.id, input.task) : null;
			} finally {
				db.close();
			}
			if (!task) throw new Error(`Unknown task "${input.task}"`);
			const actor =
				input.agent ??
				task.assigneeAgentId ??
				(() => {
					const connection = new TeamDb(dbPath);
					try {
						return connection.listEngineers(task.teamId).find(engineer => engineer.pmId === task.assignedPmId)
							?.id;
					} finally {
						connection.close();
					}
				})();
			const pm = input.pm ?? task.assignedPmId;
			const base = { teamRoot: options.teamRoot, dbPath, task: task.taskKey };
			switch (input.action) {
				case "claim":
					if (!actor) throw new Error("No engineer is available to claim this task");
					return {
						message: `Claimed ${task.taskKey} as ${(await claimTask({ ...base, agent: actor })).task.ownerAgentId}`,
					};
				case "renew":
					if (!actor) throw new Error("No engineer owns this task");
					await renewTaskLease({ ...base, agent: actor });
					return { message: `Renewed ${task.taskKey}` };
				case "release":
					if (!actor) throw new Error("No engineer owns this task");
					await releaseTask({ ...base, agent: actor });
					return { message: `Released ${task.taskKey}` };
				case "submit":
					if (!actor) throw new Error("No engineer owns this task");
					await submitTask({ ...base, agent: actor, body: input.body });
					return { message: `Submitted ${task.taskKey} for review` };
				case "complete":
					await completeTask({ ...base, pm, body: input.body });
					return { message: `Completed ${task.taskKey}` };
				case "reject":
					await rejectTask({ ...base, pm, body: input.body ?? "rejected from Team Hub" });
					return { message: `Rejected ${task.taskKey} back to pending` };
				case "cancel":
					await cancelTask({ ...base, pm, body: input.body });
					return { message: `Cancelled ${task.taskKey}` };
			}
		},
	};
}
