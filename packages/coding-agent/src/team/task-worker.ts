/**
 * Opt-in Team task worker for an existing engineer session.
 *
 * The worker never creates a session, spawns an agent, or starts Vibe. The
 * caller (an engineer's live session) supplies `agentId` and `execute`; the
 * loop reuses the queue's compare-and-set claim, lease renewal, submit, and
 * release. Auto-start is therefore a caller decision, not a Team side effect.
 */

import * as logger from "@linxiraos/pi-utils/logger";
import { AgentRegistry } from "../registry/agent-registry";
import { TeamDb, type TaskRecord } from "./db";
import { TeamError } from "./errors";
import { loadContext, type TeamContextOptions } from "./service";
import { claimTask, listTasks, releaseTask, renewTaskLease, submitTask } from "./tasks";

const DEFAULT_POLL_MS = 1000;
const DEFAULT_LEASE_SECONDS = 900;

export interface TaskWorkerExecution {
	body?: string;
	reqIds?: string[];
}

export interface TaskWorkerOptions extends TeamContextOptions {
	/** Team engineer name or full row id. */
	engineer: string;
	/** Live registry id of the engineer session that will execute work. */
	agentId: string;
	leaseSeconds?: number;
	renewEveryMs?: number;
	pollMs?: number;
	/** Stop after this many submitted tasks; default unlimited. */
	maxTasks?: number;
	/** Return false while the caller's session is busy; no task is claimed then. */
	canClaim?: () => boolean;
	signal?: AbortSignal;
	execute: (task: TaskRecord, signal: AbortSignal) => Promise<TaskWorkerExecution>;
}

export interface TaskWorkerHandle {
	/** Stop polling, abort the in-flight execution, and release an owned lease. */
	stop(): Promise<void>;
	/** Resolve when the loop exits (including stop). */
	done: Promise<void>;
	current(): TaskRecord | undefined;
	running(): boolean;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
	const { promise, resolve, reject } = Promise.withResolvers<void>();
	if (signal.aborted) {
		reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
		return promise;
	}
	const onAbort = (): void => {
		clearTimeout(timer);
		reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
	};
	const timer = setTimeout(
		() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		},
		Math.max(1, ms),
	);
	signal.addEventListener("abort", onAbort, { once: true });
	return promise;
}

interface WorkerEngineer {
	id: string;
	name: string;
	pmId: string;
}

async function workerEngineer(options: TaskWorkerOptions): Promise<WorkerEngineer> {
	const ctx = await loadContext(options);
	try {
		const db = ctx.db;
		const direct = db.getEngineerById(options.engineer);
		if (direct && direct.teamId === ctx.team.id) return direct;
		const engineers = db.listEngineers(ctx.team.id).filter(row => row.name === options.engineer);
		if (engineers.length === 1) return engineers[0];
		if (engineers.length > 1) {
			throw new TeamError(`Ambiguous engineer "${options.engineer}"; use <pm>/<engineer> or the full row id`);
		}
		if (options.engineer.includes("/")) {
			const [pmName, engineerName] = options.engineer.split("/");
			if (pmName && engineerName) {
				const engineer = db.getEngineer(ctx.team.id, pmName, engineerName);
				if (engineer) return engineer;
			}
		}
		throw new TeamError(`Unknown engineer "${options.engineer}" in team "${ctx.team.id}"`);
	} finally {
		ctx.db.close();
	}
}

function claimable(task: TaskRecord, worker: WorkerEngineer): boolean {
	if (task.status !== "pending") return false;
	if (task.assignedPmId !== worker.pmId) return false;
	return task.assigneeAgentId === null || task.assigneeAgentId === worker.id;
}

/**
 * Start the opt-in loop. The returned handle is the only lifecycle surface;
 * abort via `signal` or `stop()`. It never runs without a declared engineer and
 * live registry session.
 */
export function startTaskWorker(options: TaskWorkerOptions): TaskWorkerHandle {
	const controller = new AbortController();
	const parent = options.signal;
	const onParentAbort = (): void => controller.abort(parent?.reason);
	if (parent) {
		if (parent.aborted) controller.abort(parent.reason);
		else parent.addEventListener("abort", onParentAbort, { once: true });
	}
	let running = false;
	let current: TaskRecord | undefined;
	let loop: Promise<void> = Promise.resolve();

	const stop = async (): Promise<void> => {
		controller.abort(new Error("Task worker stopped"));
		await loop.catch(() => undefined);
		if (parent) parent.removeEventListener("abort", onParentAbort);
	};

	const handle: TaskWorkerHandle = {
		stop,
		get done() {
			return loop;
		},
		current: () => current,
		running: () => running,
	};

	loop = (async () => {
		const ref = AgentRegistry.global().get(options.agentId);
		if (!ref || !ref.session) {
			throw new TeamError(`Task worker needs a live registered session "${options.agentId}"`);
		}
		const worker = await workerEngineer(options);
		const leaseSeconds = options.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
		const renewEveryMs = options.renewEveryMs ?? Math.max(1000, Math.floor((leaseSeconds * 1000) / 3));
		const maxTasks = options.maxTasks ?? Number.POSITIVE_INFINITY;
		let submitted = 0;
		running = true;
		try {
			while (!controller.signal.aborted && submitted < maxTasks) {
				if (options.canClaim && !options.canClaim()) {
					await sleep(options.pollMs ?? DEFAULT_POLL_MS, controller.signal);
					continue;
				}
				const tasks = await listTasks({ ...options, status: "pending" });
				const next = tasks.find(task => claimable(task, worker));
				if (!next) {
					await sleep(options.pollMs ?? DEFAULT_POLL_MS, controller.signal);
					continue;
				}
				let claim;
				try {
					claim = await claimTask({
						...options,
						task: next.taskKey,
						agent: options.engineer,
						leaseSeconds,
					});
				} catch (error) {
					// Another worker won the CAS or the task changed; try the next poll.
					logger.debug("team task worker claim skipped", {
						task: next.taskKey,
						error: error instanceof Error ? error.message : String(error),
					});
					await sleep(options.pollMs ?? DEFAULT_POLL_MS, controller.signal);
					continue;
				}
				current = claim.task;
				const execution = new AbortController();
				const onWorkerAbort = (): void => execution.abort(controller.signal.reason);
				controller.signal.addEventListener("abort", onWorkerAbort, { once: true });
				const renew = setInterval(() => {
					void renewTaskLease({
						...options,
						task: claim.task.taskKey,
						agent: options.engineer,
						leaseSeconds,
					}).catch(error => {
						logger.warn("team task worker lost lease", {
							task: claim.task.taskKey,
							error: error instanceof Error ? error.message : String(error),
						});
						execution.abort(error);
					});
				}, renewEveryMs);
				renew.unref?.();
				try {
					const result = await options.execute(claim.task, execution.signal);
					if (execution.signal.aborted) {
						throw execution.signal.reason instanceof Error
							? execution.signal.reason
							: new Error("execution aborted");
					}
					await submitTask({
						...options,
						task: claim.task.taskKey,
						agent: options.engineer,
						body: result.body,
						reqIds: result.reqIds,
					});
					submitted += 1;
				} catch (error) {
					await releaseTask({
						...options,
						task: claim.task.taskKey,
						agent: options.engineer,
						body: `worker failed: ${error instanceof Error ? error.message : String(error)}`,
					}).catch(releaseError => {
						logger.warn("team task worker release failed", {
							task: claim.task.taskKey,
							error: releaseError instanceof Error ? releaseError.message : String(releaseError),
						});
					});
					if (!controller.signal.aborted) throw error;
				} finally {
					clearInterval(renew);
					controller.signal.removeEventListener("abort", onWorkerAbort);
					current = undefined;
				}
			}
		} finally {
			running = false;
			if (parent) parent.removeEventListener("abort", onParentAbort);
		}
	})();

	return handle;
}

/** Convenience for tests/one-shot callers: run one claim/execute/submit cycle. */
export async function runTaskWorkerOnce(options: TaskWorkerOptions): Promise<void> {
	const handle = startTaskWorker({ ...options, maxTasks: 1 });
	await handle.done;
}
