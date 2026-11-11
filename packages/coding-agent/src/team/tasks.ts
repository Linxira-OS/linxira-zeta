/**
 * Durable Team work queue.
 *
 * A task is a `tasks` row plus an append-only `task_events` log in the global
 * Team database. The queue is pull-based on purpose: a PM assigns a task, an
 * engineer (normal or Vibe) claims it with a lease, submits it for review, and
 * the owning PM completes or rejects it. Claims are compare-and-set writes on
 * `revision`, so two workers cannot own the same task.
 *
 * `REQ-*` identifiers from the repository ledger are extracted from every task
 * body/event and merged into `tasks.req_ids_json`; they are metadata, not a
 * foreign key, so the queue does not depend on the ledger's storage.
 */

import {
	taskRowId,
	TASK_STATUSES,
	type EngineerRecord,
	type TaskEventRecord,
	type TaskRecord,
	type TaskStatus,
} from "./db";
import { TeamError } from "./errors";
import { loadContext, type TeamContext, type TeamContextOptions } from "./service";

export const DEFAULT_TASK_LEASE_SECONDS = 900;
const MAX_TASK_LEASE_SECONDS = 7 * 24 * 60 * 60;

const TASK_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const REQ_ID_RE = /REQ-[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*/g;
const REQ_ID_EXACT_RE = /^REQ-[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/;

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

export function normalizeTaskKey(value: string): string {
	const key = value.trim();
	if (!TASK_KEY_RE.test(key)) {
		throw new TeamError(
			`Invalid task key "${value}". Use letters, digits, ".", "_" or "-", starting with a letter or digit (max 64).`,
		);
	}
	return key;
}

function requireText(value: string | undefined, label: string): string {
	const text = value?.trim() ?? "";
	if (!text) throw new TeamError(`${label} must not be empty`);
	return text;
}

function parseExplicitReqIds(value: string | readonly string[] | undefined): string[] {
	const tokens = typeof value === "string" ? value.split(",") : (value ?? []);
	const result: string[] = [];
	for (const raw of tokens) {
		const token = raw.trim();
		if (!token) continue;
		if (!REQ_ID_EXACT_RE.test(token)) {
			throw new TeamError(`Invalid REQ id "${token}"; expected REQ-<letters-or-digits>`);
		}
		result.push(token);
	}
	return result;
}

/** Extract `REQ-*` ledger ids from free text, preserving first-seen order. */
export function extractReqIds(...texts: readonly (string | undefined)[]): string[] {
	const result: string[] = [];
	for (const text of texts) {
		if (!text) continue;
		for (const match of text.matchAll(REQ_ID_RE)) result.push(match[0]);
	}
	return result;
}

function mergeReqIds(existing: readonly string[], incoming: readonly string[]): string[] {
	const merged = [...existing];
	for (const id of incoming) if (!merged.includes(id)) merged.push(id);
	return merged;
}

function resolvePm(ctx: TeamContext, token: string) {
	const byId = ctx.db.getPmById(token);
	if (byId && byId.teamId === ctx.team.id) return byId;
	const pm = ctx.db.getPm(ctx.team.id, token);
	if (pm) return pm;
	throw new TeamError(`Unknown PM "${token}" in team "${ctx.team.id}"`);
}

/** Claimers are engineer rows; a Vibe worker keeps `execution = "vibe"`. */
function resolveEngineer(ctx: TeamContext, token: string): EngineerRecord {
	const byId = ctx.db.getEngineerById(token);
	if (byId && byId.teamId === ctx.team.id) return byId;
	const engineers = ctx.db.listEngineers(ctx.team.id).filter(engineer => engineer.name === token);
	if (engineers.length === 1) return engineers[0];
	if (engineers.length > 1) {
		throw new TeamError(`Ambiguous engineer "${token}"; use <pm>/<engineer> or the full row id`);
	}
	if (token.includes("/")) {
		const [pmName, engineerName] = token.split("/");
		if (pmName && engineerName) {
			const engineer = ctx.db.getEngineer(ctx.team.id, pmName, engineerName);
			if (engineer) return engineer;
		}
	}
	throw new TeamError(
		`Unknown engineer "${token}". Use an engineer name, <pm>/<engineer>, or a registered engineer row id.`,
	);
}

/** PM, engineer, or PM-owned agent — used for comments and audit events. */
function resolveActor(ctx: TeamContext, token: string): { agentId: string; role: string } {
	const pm = ctx.db.getPmById(token) ?? ctx.db.getPm(ctx.team.id, token);
	if (pm && pm.teamId === ctx.team.id) return { agentId: pm.id, role: "pm" };
	const engineer = ctx.db.getEngineerById(token);
	if (engineer && engineer.teamId === ctx.team.id) return { agentId: engineer.id, role: "engineer" };
	const agent = ctx.db.getAgentById(token);
	if (agent && agent.teamId === ctx.team.id) return { agentId: agent.id, role: agent.role };
	const engineers = ctx.db.listEngineers(ctx.team.id).filter(row => row.name === token);
	if (engineers.length === 1) return { agentId: engineers[0].id, role: "engineer" };
	throw new TeamError(`Unknown team actor "${token}"`);
}

function readTask(ctx: TeamContext, keyOrId: string): TaskRecord {
	const key = keyOrId.trim();
	if (!key) throw new TeamError("Missing task key");
	const task = ctx.db.getTask(ctx.team.id, key) ?? ctx.db.getTaskById(key);
	if (!task || task.teamId !== ctx.team.id) {
		throw new TeamError(`Unknown task "${key}" in team "${ctx.team.id}"`);
	}
	return task;
}

function positiveLease(seconds: number | undefined): number {
	const value = seconds ?? DEFAULT_TASK_LEASE_SECONDS;
	if (!Number.isInteger(value) || value < 1 || value > MAX_TASK_LEASE_SECONDS) {
		throw new TeamError(`Lease must be an integer between 1 and ${MAX_TASK_LEASE_SECONDS} seconds`);
	}
	return value;
}

interface MutationEvent {
	actorAgentId: string;
	kind: string;
	body: string;
	/** Additional REQ ids to merge; body ids are extracted automatically. */
	reqIds?: readonly string[];
}

interface MutationResult {
	task: TaskRecord;
	event: TaskEventRecord;
}

type TaskMutationFields = Parameters<TeamContext["db"]["updateTask"]>[1];

/**
 * Apply one status/owner/lease change and append its event in the same SQLite
 * transaction. The compare-and-set on `revision` is the single ownership gate.
 */
function mutateTask(
	ctx: TeamContext,
	task: TaskRecord,
	fields: TaskMutationFields,
	event: MutationEvent,
): MutationResult {
	const reqIds = mergeReqIds(task.reqIds, [...(event.reqIds ?? []), ...extractReqIds(event.body)]);
	const changed = ctx.db.updateTask(task.id, { ...fields, reqIds }, task.revision);
	if (!changed) {
		throw new TeamError(`Task "${task.taskKey}" changed concurrently; reload and retry`);
	}
	const updated = ctx.db.getTaskById(task.id);
	if (!updated) throw new TeamError(`Task "${task.taskKey}" disappeared during the update`);
	const recorded = ctx.db.insertTaskEvent({
		taskId: updated.id,
		at: nowSeconds(),
		actorAgentId: event.actorAgentId,
		kind: event.kind,
		body: event.body,
		fromStatus: task.status,
		toStatus: updated.status,
		reqIds,
		leaseExpiresAt: updated.leaseExpiresAt,
	});
	return { task: updated, event: recorded };
}

export interface CreateTaskOptions extends TeamContextOptions {
	taskKey: string;
	title: string;
	body?: string;
	/** Owning PM that dispatches and reviews the task. */
	pm: string;
	/** Optional engineer the PM assigns it to; others cannot claim it. */
	assignee?: string;
	reqIds?: string | readonly string[];
}

export async function createTask(options: CreateTaskOptions): Promise<MutationResult> {
	const taskKey = normalizeTaskKey(options.taskKey);
	const title = requireText(options.title, "Task title");
	const body = options.body?.trim() ?? "";
	const ctx = await loadContext(options);
	try {
		return ctx.db.runTransaction(() => {
			const pm = resolvePm(ctx, options.pm);
			const assignee = options.assignee ? resolveEngineer(ctx, options.assignee) : null;
			if (assignee && assignee.pmId !== pm.id) {
				throw new TeamError(`Engineer "${assignee.name}" is not owned by PM "${pm.name}"`);
			}
			if (ctx.db.getTask(ctx.team.id, taskKey)) {
				throw new TeamError(`Task "${taskKey}" already exists in team "${ctx.team.id}"`);
			}
			const reqIds = mergeReqIds(parseExplicitReqIds(options.reqIds), extractReqIds(title, body));
			const now = nowSeconds();
			const task: TaskRecord = {
				id: taskRowId(ctx.team.id, taskKey),
				teamId: ctx.team.id,
				taskKey,
				title,
				body,
				status: "pending",
				assignedPmId: pm.id,
				assigneeAgentId: assignee?.id ?? null,
				ownerAgentId: null,
				ownerRole: null,
				leaseExpiresAt: null,
				reqIds,
				revision: 0,
				createdAt: now,
				updatedAt: now,
			};
			ctx.db.insertTask(task);
			const event = ctx.db.insertTaskEvent({
				taskId: task.id,
				at: now,
				actorAgentId: pm.id,
				kind: "created",
				body: body || title,
				fromStatus: null,
				toStatus: "pending",
				reqIds,
				leaseExpiresAt: null,
			});
			return { task, event };
		});
	} finally {
		ctx.db.close();
	}
}

export interface ListTasksOptions extends TeamContextOptions {
	status?: string;
}

export async function listTasks(options: ListTasksOptions): Promise<TaskRecord[]> {
	let status: TaskStatus | undefined;
	if (options.status !== undefined) {
		if (!TASK_STATUSES.includes(options.status as TaskStatus)) {
			throw new TeamError(`Unknown task status "${options.status}". Expected: ${TASK_STATUSES.join(", ")}`);
		}
		status = options.status as TaskStatus;
	}
	const ctx = await loadContext(options);
	try {
		return ctx.db.listTasks(ctx.team.id, status);
	} finally {
		ctx.db.close();
	}
}

export interface ShowTaskOptions extends TeamContextOptions {
	task: string;
}

export interface TaskView {
	task: TaskRecord;
	events: TaskEventRecord[];
}

export async function showTask(options: ShowTaskOptions): Promise<TaskView> {
	const ctx = await loadContext(options);
	try {
		const task = readTask(ctx, options.task);
		return { task, events: ctx.db.listTaskEvents(task.id) };
	} finally {
		ctx.db.close();
	}
}

export interface AssignTaskOptions extends TeamContextOptions {
	task: string;
	pm: string;
	assignee: string;
	body?: string;
}

/** PM (re)assigns a pending task to one of its engineers. */
export async function assignTask(options: AssignTaskOptions): Promise<MutationResult> {
	const ctx = await loadContext(options);
	try {
		return ctx.db.runTransaction(() => {
			const task = readTask(ctx, options.task);
			const pm = resolvePm(ctx, options.pm);
			if (task.assignedPmId !== pm.id) throw new TeamError(`PM "${pm.name}" does not own task "${task.taskKey}"`);
			if (task.status !== "pending") {
				throw new TeamError(`Task "${task.taskKey}" is ${task.status}; only a pending task can be assigned`);
			}
			const engineer = resolveEngineer(ctx, options.assignee);
			if (engineer.pmId !== pm.id)
				throw new TeamError(`Engineer "${engineer.name}" is not owned by PM "${pm.name}"`);
			return mutateTask(
				ctx,
				task,
				{ assigneeAgentId: engineer.id },
				{
					actorAgentId: pm.id,
					kind: "assigned",
					body: options.body?.trim() || `assigned to ${engineer.name}`,
				},
			);
		});
	} finally {
		ctx.db.close();
	}
}

export interface ClaimTaskOptions extends TeamContextOptions {
	task: string;
	agent: string;
	leaseSeconds?: number;
	body?: string;
}

/** Claim or renew a lease. A live lease owned by another engineer is a conflict. */
export async function claimTask(options: ClaimTaskOptions): Promise<MutationResult> {
	const leaseSeconds = positiveLease(options.leaseSeconds);
	const ctx = await loadContext(options);
	try {
		return ctx.db.runTransaction(() => {
			const task = readTask(ctx, options.task);
			const engineer = resolveEngineer(ctx, options.agent);
			if (task.status === "done" || task.status === "cancelled") {
				throw new TeamError(`Task "${task.taskKey}" is ${task.status} and cannot be claimed`);
			}
			if (task.status === "review") {
				throw new TeamError(`Task "${task.taskKey}" is in review and cannot be claimed`);
			}
			if (engineer.pmId !== task.assignedPmId) {
				throw new TeamError(`Engineer "${engineer.name}" does not belong to the task's PM`);
			}
			if (task.assigneeAgentId && task.assigneeAgentId !== engineer.id) {
				throw new TeamError(`Task "${task.taskKey}" is assigned to another engineer`);
			}
			const now = nowSeconds();
			const liveLease = task.leaseExpiresAt !== null && task.leaseExpiresAt > now;
			if (task.ownerAgentId && task.ownerAgentId !== engineer.id && liveLease) {
				throw new TeamError(`Task "${task.taskKey}" is already claimed by ${task.ownerAgentId}`);
			}
			const note =
				options.body?.trim() ||
				(task.ownerAgentId && task.ownerAgentId !== engineer.id
					? `lease expired; reclaimed by ${engineer.name}`
					: `claimed by ${engineer.name}`);
			return mutateTask(
				ctx,
				task,
				{
					status: "claimed",
					ownerAgentId: engineer.id,
					ownerRole: "engineer",
					leaseExpiresAt: now + leaseSeconds,
				},
				{ actorAgentId: engineer.id, kind: "claimed", body: note },
			);
		});
	} finally {
		ctx.db.close();
	}
}

export interface RenewTaskOptions extends TeamContextOptions {
	task: string;
	agent: string;
	leaseSeconds?: number;
	body?: string;
}

export async function renewTaskLease(options: RenewTaskOptions): Promise<MutationResult> {
	const leaseSeconds = positiveLease(options.leaseSeconds);
	const ctx = await loadContext(options);
	try {
		return ctx.db.runTransaction(() => {
			const task = readTask(ctx, options.task);
			const engineer = resolveEngineer(ctx, options.agent);
			if (task.status !== "claimed" || task.ownerAgentId !== engineer.id) {
				throw new TeamError(`Engineer "${engineer.name}" does not own the live claim on task "${task.taskKey}"`);
			}
			return mutateTask(
				ctx,
				task,
				{ leaseExpiresAt: nowSeconds() + leaseSeconds },
				{ actorAgentId: engineer.id, kind: "renewed", body: options.body?.trim() || "lease renewed" },
			);
		});
	} finally {
		ctx.db.close();
	}
}

export interface ReleaseTaskOptions extends TeamContextOptions {
	task: string;
	agent: string;
	body?: string;
}

export async function releaseTask(options: ReleaseTaskOptions): Promise<MutationResult> {
	const ctx = await loadContext(options);
	try {
		return ctx.db.runTransaction(() => {
			const task = readTask(ctx, options.task);
			const engineer = resolveEngineer(ctx, options.agent);
			if (task.status !== "claimed" || task.ownerAgentId !== engineer.id) {
				throw new TeamError(`Engineer "${engineer.name}" does not own the live claim on task "${task.taskKey}"`);
			}
			return mutateTask(
				ctx,
				task,
				{ status: "pending", ownerAgentId: null, ownerRole: null, leaseExpiresAt: null },
				{ actorAgentId: engineer.id, kind: "released", body: options.body?.trim() || "released" },
			);
		});
	} finally {
		ctx.db.close();
	}
}

export interface SubmitTaskOptions extends TeamContextOptions {
	task: string;
	agent: string;
	body?: string;
	reqIds?: string | readonly string[];
}

/** Worker hand-off: claimed → review; the author stays as owner, lease ends. */
export async function submitTask(options: SubmitTaskOptions): Promise<MutationResult> {
	const ctx = await loadContext(options);
	try {
		return ctx.db.runTransaction(() => {
			const task = readTask(ctx, options.task);
			const engineer = resolveEngineer(ctx, options.agent);
			if (task.status !== "claimed" || task.ownerAgentId !== engineer.id) {
				throw new TeamError(`Engineer "${engineer.name}" does not own the live claim on task "${task.taskKey}"`);
			}
			return mutateTask(
				ctx,
				task,
				{ status: "review", leaseExpiresAt: null },
				{
					actorAgentId: engineer.id,
					kind: "submitted",
					body: options.body?.trim() || `submitted by ${engineer.name}`,
					reqIds: parseExplicitReqIds(options.reqIds),
				},
			);
		});
	} finally {
		ctx.db.close();
	}
}

export interface ReviewTaskOptions extends TeamContextOptions {
	task: string;
	pm: string;
	body?: string;
	reqIds?: string | readonly string[];
}

/** PM approval: review → done. */
export async function completeTask(options: ReviewTaskOptions): Promise<MutationResult> {
	const ctx = await loadContext(options);
	try {
		return ctx.db.runTransaction(() => {
			const task = readTask(ctx, options.task);
			const pm = resolvePm(ctx, options.pm);
			if (task.assignedPmId !== pm.id) throw new TeamError(`PM "${pm.name}" does not own task "${task.taskKey}"`);
			if (task.status !== "review") {
				throw new TeamError(`Task "${task.taskKey}" is ${task.status}; only a task in review can be completed`);
			}
			return mutateTask(
				ctx,
				task,
				{ status: "done", leaseExpiresAt: null },
				{
					actorAgentId: pm.id,
					kind: "completed",
					body: options.body?.trim() || `completed by ${pm.name}`,
					reqIds: parseExplicitReqIds(options.reqIds),
				},
			);
		});
	} finally {
		ctx.db.close();
	}
}

export interface RejectTaskOptions extends TeamContextOptions {
	task: string;
	pm: string;
	body: string;
}

/** PM rejection: review → pending, releasing ownership so it can be reclaimed. */
export async function rejectTask(options: RejectTaskOptions): Promise<MutationResult> {
	const reason = requireText(options.body, "Rejection reason");
	const ctx = await loadContext(options);
	try {
		return ctx.db.runTransaction(() => {
			const task = readTask(ctx, options.task);
			const pm = resolvePm(ctx, options.pm);
			if (task.assignedPmId !== pm.id) throw new TeamError(`PM "${pm.name}" does not own task "${task.taskKey}"`);
			if (task.status !== "review") {
				throw new TeamError(`Task "${task.taskKey}" is ${task.status}; only a task in review can be rejected`);
			}
			return mutateTask(
				ctx,
				task,
				{ status: "pending", ownerAgentId: null, ownerRole: null, leaseExpiresAt: null },
				{ actorAgentId: pm.id, kind: "rejected", body: reason },
			);
		});
	} finally {
		ctx.db.close();
	}
}

export interface CancelTaskOptions extends TeamContextOptions {
	task: string;
	pm: string;
	body?: string;
}

export async function cancelTask(options: CancelTaskOptions): Promise<MutationResult> {
	const ctx = await loadContext(options);
	try {
		return ctx.db.runTransaction(() => {
			const task = readTask(ctx, options.task);
			const pm = resolvePm(ctx, options.pm);
			if (task.assignedPmId !== pm.id) throw new TeamError(`PM "${pm.name}" does not own task "${task.taskKey}"`);
			if (task.status === "done" || task.status === "cancelled") {
				throw new TeamError(`Task "${task.taskKey}" is already ${task.status}`);
			}
			return mutateTask(
				ctx,
				task,
				{ status: "cancelled", ownerAgentId: null, ownerRole: null, leaseExpiresAt: null },
				{ actorAgentId: pm.id, kind: "cancelled", body: options.body?.trim() || "cancelled" },
			);
		});
	} finally {
		ctx.db.close();
	}
}

export interface CommentTaskOptions extends TeamContextOptions {
	task: string;
	agent: string;
	body: string;
}

/** Any team PM/engineer/agent can append an audit note carrying `REQ-*` ids. */
export async function commentTask(options: CommentTaskOptions): Promise<MutationResult> {
	const body = requireText(options.body, "Comment body");
	const ctx = await loadContext(options);
	try {
		return ctx.db.runTransaction(() => {
			const task = readTask(ctx, options.task);
			const actor = resolveActor(ctx, options.agent);
			return mutateTask(ctx, task, {}, { kind: "comment", actorAgentId: actor.agentId, body });
		});
	} finally {
		ctx.db.close();
	}
}
