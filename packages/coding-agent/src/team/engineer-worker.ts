/**
 * Real engineer-session entry for the Team task worker.
 *
 * `/teamworker on|off|status [normal|vibe]` starts a loop only from an
 * engineer worktree session. The loop claims only while the session is idle,
 * queues a real follow-up turn, waits for its terminal `agent_end`, and then
 * submits for review. It never starts Vibe or a daemon; the engineer's recorded
 * execution mode is displayed/validated, not toggled.
 */

import type { AgentSession } from "../session/agent-session";
import { AgentRegistry } from "../registry/agent-registry";
import { resolveTeamEntry } from "./entry";
import { TeamDb, type TaskRecord } from "./db";
import { TeamError } from "./errors";
import { startTaskWorker, type TaskWorkerHandle } from "./task-worker";

interface ActiveWorker {
	handle: TaskWorkerHandle;
	mode: "normal" | "vibe";
	engineer: string;
}

const workers = new Map<string, ActiveWorker>();

function sessionKey(session: AgentSession): string {
	return session.sessionManager.getSessionId();
}

function liveAgentId(session: AgentSession): string {
	const ref = AgentRegistry.global()
		.list()
		.find(candidate => candidate.session === session && candidate.status !== "aborted");
	if (!ref) throw new TeamError("This session is not registered; cannot start a Team task worker");
	return ref.id;
}

async function engineerContext(
	session: AgentSession,
	cwd: string,
	dbPath?: string,
): Promise<{ teamRoot: string; engineer: string; mode: "normal" | "vibe" }> {
	const entry = await resolveTeamEntry(cwd);
	if (entry.kind !== "engineer-worktree" || !entry.teamRoot || !entry.engineerName || !entry.pmName) {
		throw new TeamError(
			"Task worker is available only in an engineer worktree (worktrees/<repo>/<pm>/<engineer>/home).",
		);
	}
	if (session.getLeadModeState()?.enabled) {
		throw new TeamError("Exit Lead mode before starting an engineer task worker.");
	}
	const db = new TeamDb(dbPath);
	try {
		const team = db.getTeamByRoot(entry.teamRoot);
		if (!team) throw new TeamError(`No Team row for ${entry.teamRoot}`);
		const engineer = db.getEngineer(team.id, entry.pmName, entry.engineerName);
		if (!engineer) throw new TeamError(`Unknown engineer "${entry.pmName}/${entry.engineerName}" in this Team`);
		return { teamRoot: entry.teamRoot, engineer: `${entry.pmName}/${entry.engineerName}`, mode: engineer.execution };
	} finally {
		db.close();
	}
}

async function executeTask(
	session: AgentSession,
	task: TaskRecord,
	signal: AbortSignal,
): Promise<{ body: string; reqIds: string[] }> {
	if (session.isStreaming) throw new TeamError("Engineer session is busy; task execution was not started");
	const done = Promise.withResolvers<void>();
	const onAbort = (): void => {
		done.reject(signal.reason instanceof Error ? signal.reason : new Error("task execution aborted"));
	};
	if (signal.aborted) onAbort();
	else signal.addEventListener("abort", onAbort, { once: true });
	const unsubscribe = session.subscribe(event => {
		if (event.type === "agent_end" && (event.isTerminal || event.yielded)) done.resolve();
	});
	try {
		await session.sendUserMessage(
			[
				`You are an engineer working a Team task in your own worktree.`,
				`Task ${task.taskKey}: ${task.title}`,
				task.body ? `Details:\n${task.body}` : "",
				task.reqIds.length > 0 ? `Repository ledger ids: ${task.reqIds.join(", ")}` : "",
				"Do the work with your normal tools, then report completion concisely.",
			]
				.filter(Boolean)
				.join("\n\n"),
		);
		await done.promise;
		return {
			body: `Completed Team task ${task.taskKey} in the engineer session.`,
			reqIds: task.reqIds,
		};
	} finally {
		unsubscribe();
		signal.removeEventListener("abort", onAbort);
	}
}

export async function runTeamWorkerCommand(
	session: AgentSession,
	cwd: string,
	args: string,
	dbPath?: string,
): Promise<string> {
	const tokens = args.trim().split(/\s+/).filter(Boolean);
	const verb = (tokens[0] ?? "status").toLowerCase();
	const key = sessionKey(session);
	if (verb === "off" || verb === "stop") {
		const active = workers.get(key);
		if (!active) return "No Team task worker is running in this session.";
		workers.delete(key);
		await active.handle.stop();
		return `Stopped the ${active.mode} Team task worker for ${active.engineer}.`;
	}
	if (verb === "status") {
		const active = workers.get(key);
		if (!active) return "Team task worker: off.";
		const task = active.handle.current();
		return `Team task worker: on (${active.mode}) for ${active.engineer}; current task ${task?.taskKey ?? "none"}.`;
	}
	if (verb !== "on" && verb !== "start") {
		throw new TeamError("Usage: /teamworker on|off|status [normal|vibe]");
	}
	if (workers.has(key)) return "A Team task worker is already running in this session.";
	const context = await engineerContext(session, cwd, dbPath);
	const requested = tokens[1]?.toLowerCase();
	if (requested !== undefined && requested !== "normal" && requested !== "vibe") {
		throw new TeamError("Worker mode must be normal or vibe.");
	}
	if (requested !== undefined && requested !== context.mode) {
		throw new TeamError(
			`Engineer ${context.engineer} is recorded as "${context.mode}"; do not claim a different execution mode.`,
		);
	}
	const controller = new AbortController();
	const agentId = liveAgentId(session);
	const handle = startTaskWorker({
		teamRoot: context.teamRoot,
		dbPath,
		engineer: context.engineer,
		agentId,
		signal: controller.signal,
		canClaim: () => !session.isStreaming,
		execute: (task, signal) => executeTask(session, task, signal),
	});
	workers.set(key, { handle, mode: context.mode, engineer: context.engineer });
	void handle.done
		.catch(() => undefined)
		.finally(() => {
			if (workers.get(key)?.handle === handle) workers.delete(key);
		});
	return `Team task worker on (${context.mode}) for ${context.engineer}. It claims only while this session is idle.`;
}

/** Stop all workers for process teardown. */
export async function stopAllTeamWorkers(): Promise<void> {
	const active = [...workers.values()];
	workers.clear();
	await Promise.all(active.map(worker => worker.handle.stop().catch(() => undefined)));
}
