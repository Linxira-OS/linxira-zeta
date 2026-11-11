/**
 * Studio Team workspace operations: onboarding, PM/repo/engineer setup, rooms,
 * tasks, and doctor. The family itself is declared in `team.ts`; this module
 * only owns handlers and the real-service translation.
 *
 * Every operation names a registered `teamId`; the Host resolves `rootPath`
 * from that row, so routine reads and mutations never accept a filesystem path.
 * The bootstrap plan/apply input is the one explicit root a new Team needs.
 * There are no accounts, passwords, tokens or credentials in this surface.
 */
import * as path from "node:path";
import type {
	TeamBootstrapApplyCommand,
	TeamBootstrapInput,
	TeamBootstrapPlanResult,
	TeamBootstrapRollbackView,
	TeamBootstrapRunSummary,
	TeamBootstrapRunsResult,
	TeamBootstrapStepSummary,
	TeamDoctorSummary,
	TeamListResult,
	TeamRoomEvent,
	TeamRoomKind,
	TeamRoomMember,
	TeamRoomSubscription,
	TeamRoomView,
	TeamTaskEvent,
	TeamTaskView,
	TeamWorkspaceReadModel,
	TeamWorkspaceTask,
} from "../contract/index.js";
import { invalid } from "../gateway.js";
import { diagnoseTeam } from "../../../team/doctor.js";
import {
	TeamDb,
	type BootstrapRunRecord,
	type BootstrapStepRecord,
	type EngineerRecord,
	type PmRecord,
	type RepoRecord,
	type RoomEventRecord,
	type RoomMemberRecord,
	type RoomSubscriptionRecord,
	type RoomSummaryRecord,
	type TaskEventRecord,
	type TaskRecord,
	type TeamRecord,
	type WorktreeRecord,
} from "../../../team/db.js";
import {
	applyTeamBootstrap,
	listBootstrapRuns,
	planTeamBootstrap,
	resumeTeamBootstrap,
	rollbackBootstrapRun,
} from "../../../team/bootstrap.js";
import { readTeamReadModel } from "../../../team/read-model.js";
import { addEngineer, addPm, bindRepo } from "../../../team/service.js";
import {
	addRoomMember,
	createRoom,
	postRoomEvent,
	readRoomEvents,
	removeRoomMember,
	setRoomKind,
} from "../../../team/rooms.js";
import { ackRoom, subscribeRoom } from "../../../team/room-delivery.js";
import {
	assignTask,
	cancelTask,
	claimTask,
	commentTask,
	completeTask,
	createTask,
	rejectTask,
	releaseTask,
	renewTaskLease,
	showTask,
	submitTask,
} from "../../../team/tasks.js";

function text(value: unknown, field: string): string {
	if (typeof value !== "string" || value.trim() === "") throw invalid(`${field} must be a non-empty string`);
	return value.trim();
}

function optionalText(value: unknown, field: string): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string") throw invalid(`${field} must be a string`);
	const trimmed = value.trim();
	return trimmed === "" ? undefined : trimmed;
}

function optionalInteger(value: unknown, field: string): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
		throw invalid(`${field} must be a non-negative integer`);
	}
	return value;
}

function object(input: unknown): Record<string, unknown> {
	if (typeof input !== "object" || input === null || Array.isArray(input)) throw invalid("input must be an object");
	return input as Record<string, unknown>;
}

/** Resolve the authoritative Team row; no path ever crosses this boundary. */
function teamRow(teamId: string): TeamRecord {
	const db = new TeamDb();
	try {
		const team = db.getTeam(teamId);
		if (!team) throw invalid(`Unknown Team "${teamId}"`);
		return team;
	} finally {
		db.close();
	}
}

function teamRoot(teamId: string): string {
	return teamRow(teamId).rootPath;
}

function mapRoom(room: RoomSummaryRecord): TeamRoomView["room"] {
	return {
		id: room.id,
		name: room.name,
		kind: room.kind,
		pmId: room.pmId,
		memberCount: room.memberCount,
		lastSeq: room.lastSeq,
		lastSentAt: room.lastSentAt,
	};
}

function mapEvent(event: RoomEventRecord): TeamRoomEvent {
	return {
		seq: event.seq,
		sentAt: event.sentAt,
		senderAgentId: event.senderAgentId,
		kind: event.kind,
		body: event.body,
		replyTo: event.replyTo,
		mentions: event.mentions,
	};
}

function mapSubscription(record: RoomSubscriptionRecord): TeamRoomSubscription {
	return {
		roomId: record.roomId,
		agentId: record.agentId,
		acceptedThrough: record.acceptedThrough,
		readThrough: record.readThrough,
		subscribedAt: record.subscribedAt,
		updatedAt: record.updatedAt,
	};
}

function mapTaskEvent(event: TaskEventRecord): TeamTaskEvent {
	return {
		seq: event.seq,
		at: event.at,
		actorAgentId: event.actorAgentId,
		kind: event.kind,
		body: event.body,
		fromStatus: event.fromStatus,
		toStatus: event.toStatus,
		reqIds: event.reqIds,
		leaseExpiresAt: event.leaseExpiresAt,
	};
}

function mapTask(task: TaskRecord): TeamWorkspaceTask {
	return {
		id: task.id,
		taskKey: task.taskKey,
		title: task.title,
		body: task.body,
		status: task.status,
		assignedPmId: task.assignedPmId,
		assigneeAgentId: task.assigneeAgentId,
		ownerAgentId: task.ownerAgentId,
		ownerRole: task.ownerRole,
		leaseExpiresAt: task.leaseExpiresAt,
		reqIds: task.reqIds,
		revision: task.revision,
		createdAt: task.createdAt,
		updatedAt: task.updatedAt,
	};
}

function taskView(task: TaskRecord, events: readonly TaskEventRecord[]): TeamTaskView {
	return { task: mapTask(task), events: events.map(mapTaskEvent) };
}

function mapRun(run: BootstrapRunRecord, steps: readonly BootstrapStepRecord[]): TeamBootstrapRunSummary {
	return {
		runId: run.runId,
		teamId: run.teamId,
		mode: run.mode,
		status: run.status,
		createdAt: run.createdAt,
		updatedAt: run.updatedAt,
		error: run.error,
		steps: steps.map(mapStep),
	};
}

function mapStep(step: BootstrapStepRecord): TeamBootstrapStepSummary {
	return {
		stepId: step.stepId,
		seq: step.seq,
		kind: step.kind,
		description: step.kind,
		createdByRun: true,
		status: step.status,
		...(step.error ? { error: step.error } : {}),
	};
}

function labelMap(db: TeamDb, teamId: string): (agentId: string) => string {
	const pms = db.listPms(teamId);
	const engineers = db.listEngineers(teamId);
	const agents = db.listAgents(teamId);
	const byId = new Map<string, string>();
	for (const pm of pms) byId.set(pm.id, pm.name);
	for (const engineer of engineers) byId.set(engineer.id, `${engineer.name}`);
	for (const agent of agents) byId.set(agent.id, agent.role);
	return agentId => byId.get(agentId) ?? agentId;
}

function mapMember(member: RoomMemberRecord, label: (id: string) => string): TeamRoomMember {
	return { agentId: member.agentId, role: member.role, label: label(member.agentId) };
}

/** One consistent Team snapshot for the workspace pane. */
async function readTeam(teamId: string): Promise<TeamWorkspaceReadModel> {
	const team = teamRow(teamId);
	const model = await readTeamReadModel({ teamRoot: team.rootPath });
	const db = new TeamDb();
	try {
		const label = labelMap(db, teamId);
		const roomMembers: Record<string, TeamRoomMember[]> = {};
		for (const room of model.rooms) {
			roomMembers[room.id] = db.listRoomMembers(room.id).map(member => mapMember(member, label));
		}
		const repos: RepoRecord[] = db.listRepos(teamId);
		const bindings = db.listBindings(teamId);
		const worktrees: WorktreeRecord[] = db.listWorktrees(teamId);
		return {
			team: { id: team.id, name: team.name, createdAt: team.createdAt },
			pms: model.pms.map((pm: PmRecord) => ({ id: pm.id, name: pm.name })),
			engineers: model.engineers.map((engineer: EngineerRecord) => ({
				id: engineer.id,
				name: engineer.name,
				pmId: engineer.pmId,
				execution: engineer.execution,
			})),
			repos: repos.map(repo => ({
				id: repo.id,
				name: repo.name,
				defaultBranch: repo.defaultBranch,
				...(repo.remoteUrl ? { remoteUrl: repo.remoteUrl } : {}),
			})),
			bindings: bindings.map(binding => ({ repoId: binding.repoId, pmId: binding.pmId })),
			worktrees: worktrees.map(worktree => ({
				id: worktree.id,
				repoId: worktree.repoId,
				pmId: worktree.pmId,
				engineerId: worktree.engineerId,
				kind: worktree.kind,
				name: worktree.name,
				branch: worktree.branch,
				baseBranch: worktree.baseBranch,
			})),
			rooms: model.rooms.map(mapRoom),
			roomMembers,
			tasks: model.tasks.map(task => taskView(task, model.taskEvents[task.id] ?? [])),
			bootstrapRuns: model.bootstrapRuns.map(run => mapRun(run, db.listBootstrapSteps(run.runId))),
			warnings: model.warnings,
		};
	} finally {
		db.close();
	}
}

function planStep(step: {
	stepId: string;
	seq: number;
	kind: string;
	description: string;
	createdByRun: boolean;
}): TeamBootstrapStepSummary {
	return {
		stepId: step.stepId,
		seq: step.seq,
		kind: step.kind,
		description: step.description,
		createdByRun: step.createdByRun,
		status: "planned",
	};
}

function bootstrapInput(input: TeamBootstrapInput): TeamBootstrapInput {
	const root = text(input.root, "root");
	if (!path.isAbsolute(root)) throw invalid("root must be an absolute path");
	return {
		name: text(input.name, "name"),
		root: path.resolve(root),
		...(input.displayName ? { displayName: input.displayName } : {}),
		pms: [...(input.pms ?? [])],
		repos: [...(input.repos ?? [])],
		engineers: [...(input.engineers ?? [])],
		rooms: [...(input.rooms ?? [])],
		...(input.engineerOnly ? { engineerOnly: true } : {}),
	};
}

async function plan(input: TeamBootstrapInput): Promise<TeamBootstrapPlanResult> {
	const plan = await planTeamBootstrap(bootstrapInput(input));
	return {
		plan: {
			version: plan.version,
			mode: plan.mode,
			teamId: plan.teamId,
			displayName: plan.displayName,
			steps: plan.steps.map(planStep),
			preflight: plan.preflight,
		},
		preflight: plan.preflight,
	};
}

async function doctor(teamId: string): Promise<TeamDoctorSummary> {
	const root = teamRoot(teamId);
	const report = await diagnoseTeam({ teamRoot: root });
	return {
		teamId,
		ok: report.ok,
		checks: report.checks.map(check => ({
			id: check.id,
			level: check.level,
			ok: check.ok,
			detail: check.detail,
		})),
	};
}

async function taskAfter(teamId: string, task: string): Promise<TeamTaskView> {
	const root = teamRoot(teamId);
	const view = await showTask({ teamRoot: root, task });
	return taskView(view.task, view.events);
}

async function teamList(): Promise<TeamListResult> {
	const db = new TeamDb();
	try {
		return {
			teams: db.listTeams().map(team => ({ id: team.id, name: team.name, createdAt: team.createdAt })),
		};
	} finally {
		db.close();
	}
}

async function teamRead(input: unknown): Promise<TeamWorkspaceReadModel> {
	const record = object(input);
	return readTeam(text(record.teamId, "teamId"));
}

async function teamDoctor(input: unknown): Promise<TeamDoctorSummary> {
	const record = object(input);
	return doctor(text(record.teamId, "teamId"));
}

async function roomEvents(input: unknown): Promise<TeamRoomView> {
	const record = object(input);
	const teamId = text(record.teamId, "teamId");
	const roomName = text(record.room, "room");
	const root = teamRoot(teamId);
	const db = new TeamDb();
	let summary: RoomSummaryRecord | undefined;
	let members: TeamRoomMember[] = [];
	let subscription: TeamRoomSubscription | undefined;
	try {
		summary = db.listRoomSummaries(teamId).find(room => room.name === roomName);
		if (!summary) throw invalid(`Unknown room "${roomName}" in team "${teamId}"`);
		const label = labelMap(db, teamId);
		members = db.listRoomMembers(summary.id).map(member => mapMember(member, label));
		const agent = optionalText(record.agent, "agent");
		if (agent) {
			const current = db.getRoomSubscription(summary.id, agent);
			if (current) subscription = mapSubscription(current);
		}
	} finally {
		db.close();
	}
	const afterSeq = optionalInteger(record.afterSeq, "afterSeq");
	const limit = optionalInteger(record.limit, "limit");
	if (!summary) throw invalid(`Unknown room "${roomName}" in team "${teamId}"`);
	const events = await readRoomEvents({
		teamRoot: root,
		room: roomName,
		...(afterSeq !== undefined ? { afterSeq } : {}),
		...(limit !== undefined ? { limit } : {}),
	});
	return {
		room: mapRoom(summary),
		members,
		events: events.map(mapEvent),
		...(subscription ? { subscription } : {}),
	};
}

async function taskShow(input: unknown): Promise<TeamTaskView> {
	const record = object(input);
	return taskAfter(text(record.teamId, "teamId"), text(record.task, "task"));
}

async function bootstrapRuns(input: unknown): Promise<TeamBootstrapRunsResult> {
	const record = object(input);
	const teamId = text(record.teamId, "teamId");
	const runs = listBootstrapRuns(teamRoot(teamId));
	const db = new TeamDb();
	try {
		return { runs: runs.map(run => mapRun(run, db.listBootstrapSteps(run.runId))) };
	} finally {
		db.close();
	}
}

async function pmAdd(input: unknown): Promise<TeamWorkspaceReadModel> {
	const record = object(input);
	const teamId = text(record.teamId, "teamId");
	await addPm({
		teamRoot: teamRoot(teamId),
		pm: text(record.pm, "pm"),
		...(optionalText(record.displayName, "displayName")
			? { displayName: optionalText(record.displayName, "displayName") }
			: {}),
	});
	return readTeam(teamId);
}

async function repoBind(input: unknown): Promise<TeamWorkspaceReadModel> {
	const record = object(input);
	const teamId = text(record.teamId, "teamId");
	await bindRepo({ teamRoot: teamRoot(teamId), repo: text(record.repo, "repo"), pm: text(record.pm, "pm") });
	return readTeam(teamId);
}

async function engineerAdd(input: unknown): Promise<TeamWorkspaceReadModel> {
	const record = object(input);
	const teamId = text(record.teamId, "teamId");
	const execution = optionalText(record.execution, "execution");
	if (execution !== undefined && execution !== "normal" && execution !== "vibe") {
		throw invalid('execution must be "normal" or "vibe"');
	}
	await addEngineer({
		teamRoot: teamRoot(teamId),
		name: text(record.engineer, "engineer"),
		pm: text(record.pm, "pm"),
		repo: text(record.repo, "repo"),
		...(execution ? { execution } : {}),
	});
	return readTeam(teamId);
}

async function roomCreate(input: unknown): Promise<TeamWorkspaceReadModel> {
	const record = object(input);
	const teamId = text(record.teamId, "teamId");
	const kind = optionalText(record.kind, "kind");
	if (kind !== undefined && kind !== "pm" && kind !== "coordination" && kind !== "room") {
		throw invalid('kind must be "pm", "coordination", or "room"');
	}
	const members = Array.isArray(record.members)
		? record.members.filter((member): member is string => typeof member === "string" && member.trim() !== "")
		: undefined;
	await createRoom({
		teamRoot: teamRoot(teamId),
		name: text(record.room, "room"),
		...(kind ? { kind } : {}),
		...(optionalText(record.pm, "pm") ? { pm: optionalText(record.pm, "pm") } : {}),
		...(record.shared === true ? { shared: true } : {}),
		...(members && members.length > 0 ? { members } : {}),
	});
	return readTeam(teamId);
}

async function roomPost(input: unknown): Promise<TeamRoomEvent> {
	const record = object(input);
	const teamId = text(record.teamId, "teamId");
	const replyTo = optionalInteger(record.replyTo, "replyTo");
	const result = await postRoomEvent({
		teamRoot: teamRoot(teamId),
		room: text(record.room, "room"),
		body: text(record.body, "body"),
		...(optionalText(record.sender, "sender") ? { sender: optionalText(record.sender, "sender") } : {}),
		...(replyTo !== undefined ? { replyTo } : {}),
	});
	return mapEvent(result.event);
}

async function roomSubscribe(input: unknown): Promise<TeamRoomSubscription> {
	const record = object(input);
	const teamId = text(record.teamId, "teamId");
	const fromSeq = optionalInteger(record.fromSeq, "fromSeq");
	const result = await subscribeRoom({
		teamRoot: teamRoot(teamId),
		room: text(record.room, "room"),
		agent: text(record.agent, "agent"),
		...(fromSeq !== undefined ? { fromSeq } : {}),
	});
	return mapSubscription(result);
}

async function roomAck(input: unknown): Promise<TeamRoomSubscription> {
	const record = object(input);
	const teamId = text(record.teamId, "teamId");
	const throughSeq = optionalInteger(record.throughSeq, "throughSeq");
	if (throughSeq === undefined) throw invalid("throughSeq must be a non-negative integer");
	const result = await ackRoom({
		teamRoot: teamRoot(teamId),
		room: text(record.room, "room"),
		agent: text(record.agent, "agent"),
		throughSeq,
	});
	return mapSubscription(result);
}

async function roomMemberAdd(input: unknown): Promise<TeamWorkspaceReadModel> {
	const record = object(input);
	const teamId = text(record.teamId, "teamId");
	await addRoomMember({
		teamRoot: teamRoot(teamId),
		room: text(record.room, "room"),
		member: text(record.member, "member"),
		...(optionalText(record.role, "role") ? { role: optionalText(record.role, "role") } : {}),
	});
	return readTeam(teamId);
}

async function roomMemberRemove(input: unknown): Promise<TeamWorkspaceReadModel> {
	const record = object(input);
	const teamId = text(record.teamId, "teamId");
	await removeRoomMember({
		teamRoot: teamRoot(teamId),
		room: text(record.room, "room"),
		member: text(record.member, "member"),
	});
	return readTeam(teamId);
}

async function roomKindSet(input: unknown): Promise<TeamWorkspaceReadModel> {
	const record = object(input);
	const teamId = text(record.teamId, "teamId");
	const kind = text(record.kind, "kind");
	if (kind !== "pm" && kind !== "coordination" && kind !== "room") {
		throw invalid('kind must be "pm", "coordination", or "room"');
	}
	await setRoomKind({
		teamRoot: teamRoot(teamId),
		room: text(record.room, "room"),
		kind: kind as TeamRoomKind,
		...(optionalText(record.pm, "pm") ? { pm: optionalText(record.pm, "pm") } : {}),
	});
	return readTeam(teamId);
}

async function taskCreate(input: unknown): Promise<TeamTaskView> {
	const record = object(input);
	const teamId = text(record.teamId, "teamId");
	const result = await createTask({
		teamRoot: teamRoot(teamId),
		taskKey: text(record.taskKey, "taskKey"),
		title: text(record.title, "title"),
		...(optionalText(record.body, "body") ? { body: optionalText(record.body, "body") } : {}),
		pm: text(record.pm, "pm"),
		...(optionalText(record.assignee, "assignee") ? { assignee: optionalText(record.assignee, "assignee") } : {}),
		...(Array.isArray(record.reqIds)
			? { reqIds: record.reqIds.filter((id): id is string => typeof id === "string") }
			: {}),
	});
	return taskAfter(teamId, result.task.taskKey);
}

async function taskAssign(input: unknown): Promise<TeamTaskView> {
	const record = object(input);
	const teamId = text(record.teamId, "teamId");
	const result = await assignTask({
		teamRoot: teamRoot(teamId),
		task: text(record.task, "task"),
		pm: text(record.pm, "pm"),
		assignee: text(record.assignee, "assignee"),
		...(optionalText(record.body, "body") ? { body: optionalText(record.body, "body") } : {}),
	});
	return taskAfter(teamId, result.task.taskKey);
}

async function taskClaim(input: unknown): Promise<TeamTaskView> {
	const record = object(input);
	const teamId = text(record.teamId, "teamId");
	const leaseSeconds = optionalInteger(record.leaseSeconds, "leaseSeconds");
	const result = await claimTask({
		teamRoot: teamRoot(teamId),
		task: text(record.task, "task"),
		agent: text(record.agent, "agent"),
		...(leaseSeconds !== undefined ? { leaseSeconds } : {}),
		...(optionalText(record.body, "body") ? { body: optionalText(record.body, "body") } : {}),
	});
	return taskAfter(teamId, result.task.taskKey);
}

async function taskRenew(input: unknown): Promise<TeamTaskView> {
	const record = object(input);
	const teamId = text(record.teamId, "teamId");
	const leaseSeconds = optionalInteger(record.leaseSeconds, "leaseSeconds");
	const result = await renewTaskLease({
		teamRoot: teamRoot(teamId),
		task: text(record.task, "task"),
		agent: text(record.agent, "agent"),
		...(leaseSeconds !== undefined ? { leaseSeconds } : {}),
		...(optionalText(record.body, "body") ? { body: optionalText(record.body, "body") } : {}),
	});
	return taskAfter(teamId, result.task.taskKey);
}

async function taskRelease(input: unknown): Promise<TeamTaskView> {
	const record = object(input);
	const teamId = text(record.teamId, "teamId");
	const result = await releaseTask({
		teamRoot: teamRoot(teamId),
		task: text(record.task, "task"),
		agent: text(record.agent, "agent"),
		...(optionalText(record.body, "body") ? { body: optionalText(record.body, "body") } : {}),
	});
	return taskAfter(teamId, result.task.taskKey);
}

async function taskSubmit(input: unknown): Promise<TeamTaskView> {
	const record = object(input);
	const teamId = text(record.teamId, "teamId");
	const result = await submitTask({
		teamRoot: teamRoot(teamId),
		task: text(record.task, "task"),
		agent: text(record.agent, "agent"),
		...(optionalText(record.body, "body") ? { body: optionalText(record.body, "body") } : {}),
		...(Array.isArray(record.reqIds)
			? { reqIds: record.reqIds.filter((id): id is string => typeof id === "string") }
			: {}),
	});
	return taskAfter(teamId, result.task.taskKey);
}

async function taskComplete(input: unknown): Promise<TeamTaskView> {
	const record = object(input);
	const teamId = text(record.teamId, "teamId");
	const result = await completeTask({
		teamRoot: teamRoot(teamId),
		task: text(record.task, "task"),
		pm: text(record.pm, "pm"),
		...(optionalText(record.body, "body") ? { body: optionalText(record.body, "body") } : {}),
		...(Array.isArray(record.reqIds)
			? { reqIds: record.reqIds.filter((id): id is string => typeof id === "string") }
			: {}),
	});
	return taskAfter(teamId, result.task.taskKey);
}

async function taskReject(input: unknown): Promise<TeamTaskView> {
	const record = object(input);
	const teamId = text(record.teamId, "teamId");
	const result = await rejectTask({
		teamRoot: teamRoot(teamId),
		task: text(record.task, "task"),
		pm: text(record.pm, "pm"),
		body: text(record.body, "body"),
	});
	return taskAfter(teamId, result.task.taskKey);
}

async function taskCancel(input: unknown): Promise<TeamTaskView> {
	const record = object(input);
	const teamId = text(record.teamId, "teamId");
	const result = await cancelTask({
		teamRoot: teamRoot(teamId),
		task: text(record.task, "task"),
		pm: text(record.pm, "pm"),
		...(optionalText(record.body, "body") ? { body: optionalText(record.body, "body") } : {}),
	});
	return taskAfter(teamId, result.task.taskKey);
}

async function taskComment(input: unknown): Promise<TeamTaskView> {
	const record = object(input);
	const teamId = text(record.teamId, "teamId");
	const result = await commentTask({
		teamRoot: teamRoot(teamId),
		task: text(record.task, "task"),
		agent: text(record.agent, "agent"),
		body: text(record.body, "body"),
	});
	return taskAfter(teamId, result.task.taskKey);
}

async function bootstrapPlan(input: unknown): Promise<TeamBootstrapPlanResult> {
	return plan(object(input) as unknown as TeamBootstrapInput);
}

async function bootstrapApply(input: unknown): Promise<{
	run: TeamBootstrapRunSummary;
	doctor: TeamDoctorSummary;
}> {
	const typed = object(input) as unknown as TeamBootstrapApplyCommand;
	const planResult = await planTeamBootstrap(bootstrapInput(typed));
	const result = await applyTeamBootstrap(planResult, {
		rollbackOnFailure: typed.rollbackOnFailure !== false,
	});
	const doctorSummary: TeamDoctorSummary =
		result.run.status === "done" && result.run.teamId
			? await doctor(result.run.teamId)
			: { teamId: planResult.teamId, ok: false, checks: [] };
	const db = new TeamDb();
	let steps: BootstrapStepRecord[];
	try {
		steps = db.listBootstrapSteps(result.run.runId);
	} finally {
		db.close();
	}
	return { run: mapRun(result.run, steps), doctor: doctorSummary };
}

async function bootstrapResume(input: unknown): Promise<{
	run: TeamBootstrapRunSummary;
	doctor: TeamDoctorSummary;
}> {
	const record = object(input);
	const result = await resumeTeamBootstrap(text(record.runId, "runId"), {
		rollbackOnFailure: record.rollbackOnFailure !== false,
	});
	if (!result.run.teamId) throw invalid(`Bootstrap run "${result.run.runId}" has no Team id`);
	const doctorSummary: TeamDoctorSummary =
		result.run.status === "done"
			? await doctor(result.run.teamId)
			: { teamId: result.run.teamId, ok: false, checks: [] };
	const db = new TeamDb();
	let steps: BootstrapStepRecord[];
	try {
		steps = db.listBootstrapSteps(result.run.runId);
	} finally {
		db.close();
	}
	return { run: mapRun(result.run, steps), doctor: doctorSummary };
}

async function bootstrapRollback(input: unknown): Promise<TeamBootstrapRollbackView> {
	const record = object(input);
	const result = await rollbackBootstrapRun(text(record.runId, "runId"));
	const db = new TeamDb();
	let steps: BootstrapStepRecord[];
	try {
		steps = db.listBootstrapSteps(result.run.runId);
	} finally {
		db.close();
	}
	return { run: mapRun(result.run, steps), errors: result.errors };
}

export const teamWorkspaceQueries = {
	"team.list": teamList,
	"team.read": teamRead,
	"team.doctor": teamDoctor,
	"team.room.events": roomEvents,
	"team.task.show": taskShow,
	"team.bootstrap.plan": bootstrapPlan,
	"team.bootstrap.runs": bootstrapRuns,
} as const;

export const teamWorkspaceCommands = {
	"team.pm.add": pmAdd,
	"team.repo.bind": repoBind,
	"team.engineer.add": engineerAdd,
	"team.room.create": roomCreate,
	"team.room.post": roomPost,
	"team.room.subscribe": roomSubscribe,
	"team.room.ack": roomAck,
	"team.room.member.add": roomMemberAdd,
	"team.room.member.remove": roomMemberRemove,
	"team.room.kind.set": roomKindSet,
	"team.task.create": taskCreate,
	"team.task.assign": taskAssign,
	"team.task.claim": taskClaim,
	"team.task.renew": taskRenew,
	"team.task.release": taskRelease,
	"team.task.submit": taskSubmit,
	"team.task.complete": taskComplete,
	"team.task.reject": taskReject,
	"team.task.cancel": taskCancel,
	"team.task.comment": taskComment,
	"team.bootstrap.apply": bootstrapApply,
	"team.bootstrap.resume": bootstrapResume,
	"team.bootstrap.rollback": bootstrapRollback,
} as const;
