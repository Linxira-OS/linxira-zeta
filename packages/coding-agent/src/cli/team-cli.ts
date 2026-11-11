/**
 * `zetacode team` dispatch.
 *
 * Verbs are positional (`team pm add core`) because the CLI framework has one
 * command level; every flag is declared once on the `team` command.
 */

import { CLI_BIN_NAME } from "@linxiraos/pi-utils/dirs";
import { CliUsageError } from "@linxiraos/pi-utils/cli";
import { runInitTeamCommand } from "../team/bootstrap-command";
import { diagnoseTeam, type DoctorReport } from "../team/doctor";
import type { TaskEventRecord, TaskRecord } from "../team/db";
import { formatTeamError, TeamError } from "../team/errors";
import { createRoom, listRooms, postRoomEvent, showRoom, type RoomView } from "../team/rooms";
import {
	ackRoom,
	deliverPendingRoomEvents,
	listRoomSubscriptions,
	pendingRoomEvents,
	subscribeRoom,
} from "../team/room-delivery";
import { addEngineer, addPm, addRepoClone, addRepoLink, addTaskWorktree, bindRepo, initTeam } from "../team/service";
import {
	assignTask,
	cancelTask,
	claimTask,
	commentTask,
	completeTask,
	createTask,
	listTasks,
	rejectTask,
	releaseTask,
	renewTaskLease,
	showTask,
	submitTask,
	type TaskView,
} from "../team/tasks";

export interface TeamCliOptions {
	action?: string;
	rest?: string[];
	root?: string;
	name?: string;
	cwd?: string;
	clone?: string;
	pm?: string;
	repo?: string;
	engineer?: string;
	execution?: string;
	shared?: boolean;
	kind?: string;
	members?: string;
	body?: string;
	sender?: string;
	replyTo?: string;
	limit?: string;
	title?: string;
	assignee?: string;
	agent?: string;
	lease?: string;
	req?: string;
	status?: string;
	fromSeq?: string;
	seq?: string;
	pms?: string[];
	repos?: string[];
	engineers?: string[];
	rooms?: string[];
	binds?: string[];
	displayName?: string;
	engineerOnly?: boolean;
	noRollback?: boolean;
	resume?: string;
	rollback?: string;
	json?: boolean;
}

const USAGE = `${CLI_BIN_NAME} team <command>

Commands:
  init <name> --root <path>                                   Create an ownerless team root
  pm add <pm> [--root <path>]                                 Create pms/<pm>/ with .zeta/pm.json
  repo add <repo> --clone <url> [--root <path>]               Clone a canonical base repo into repos/<repo>
  repo link <repo> <path> [--root <path>]                     Register an existing repo root
  repo bind <repo> --pm <pm> [--root <path>]                  Bind a base repo to a PM
  engineer add <name> --pm <pm> --repo <repo>                 Create the engineer home worktree
              [--execution normal|vibe]
  worktree add <task> --repo <repo> --pm <pm> --engineer <n>  Create a task worktree
  room create <name> --pm <pm> [--members a,b]                Create a PM room
  room create <name> --shared [--members a,b]                 Create a coordination room
  room list [--root <path>]                                   List database-only rooms
  room show <room> [--limit <n>]                              Show members and ordered events
  room post <room> --body <text> [--sender <id>] [--reply-to <seq>]
                                                              Append one room event
  room subscribe <room> --agent <id> [--from-seq <n>]         Subscribe (default starts at latest)
  room ack <room> --agent <id> --seq <n>                      Acknowledge read through seq
  room pending <room> --agent <id> [--limit <n>]              Events not yet accepted for delivery
  room deliver --agent <id> [--cwd <path>]                    Drain this session's pending rooms
  room subscriptions <room>                                   List delivery cursors
  task create <key> --pm <pm> --title <title> [--body <text>] Durable work item (status: pending)
              [--assignee <engineer>] [--req REQ-1,REQ-2]
  task list [--status pending|claimed|review|done|cancelled] List tasks with owner, lease, and REQ ids
  task show <key>                                             Show task fields and ordered events
  task assign <key> --pm <pm> --assignee <engineer>           Assign a pending task to one engineer
  task claim <key> --agent <engineer> [--lease <seconds>]     Claim a task; default lease 900s
  task renew <key> --agent <engineer> [--lease <seconds>]     Extend the caller's lease
  task release <key> --agent <engineer>                       Release the caller's claim
  task submit <key> --agent <engineer> [--body <text>]        Hand off claimed -> review
  task complete <key> --pm <pm> [--body <text>]               Approve review -> done
  task reject <key> --pm <pm> --body <reason>                 Reject review -> pending
  task cancel <key> --pm <pm> [--body <text>]                 Cancel a non-done task
  task comment <key> --agent <actor> --body <text>            Append an audit note carrying REQ-* ids
  bootstrap [--name <team>] --root <path> [--pm <name>...]    Plan/apply a full team (journaled)
              [--repo <name>=clone:<url>|link:<path>...]
              [--bind <repo>:<pm>...]
              [--engineer <name>:<pm>:<repo>[:normal|vibe]...]
              [--room <name>[=shared|pm:<pm>]...]
              [--engineer-only] [--resume <runId>] [--rollback <runId>]
  doctor [--root <path>] [--json]                             Validate root, PMs, repos, worktrees, rooms, tasks

Global flags: --json prints machine-readable results. ZETA_TEAM_DB overrides
the global database path (default ~/.zeta/data/zeta.db).`;

function requireRest(rest: string[], index: number, label: string, usage: string): string {
	const value = rest[index];
	if (!value) throw new CliUsageError(`Missing ${label}. Usage: ${usage}`);
	return value;
}

function requireFlag(value: string | undefined, flag: string, usage: string): string {
	if (!value?.trim()) throw new CliUsageError(`Missing ${flag}. Usage: ${usage}`);
	return value;
}

function parseNonNegativeInt(value: string | undefined, flag: string): number | undefined {
	if (value === undefined) return undefined;
	if (!/^[0-9]+$/.test(value.trim())) {
		throw new CliUsageError(`${flag} must be a non-negative integer; got "${value}"`);
	}
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 0) {
		throw new CliUsageError(`${flag} must be a non-negative integer; got "${value}"`);
	}
	return parsed;
}

function parsePositiveInt(value: string | undefined, flag: string): number | undefined {
	if (value === undefined) return undefined;
	if (!/^[0-9]+$/.test(value.trim())) {
		throw new CliUsageError(`${flag} must be a positive integer; got "${value}"`);
	}
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 1) {
		throw new CliUsageError(`${flag} must be a positive integer; got "${value}"`);
	}
	return parsed;
}

function writeJson(value: unknown): void {
	process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printDoctor(report: DoctorReport): void {
	for (const check of report.checks) {
		const status = check.ok ? "ok  " : check.level === "warning" ? "warn" : "FAIL";
		process.stdout.write(`${status}  ${check.id.padEnd(36)} ${check.detail}\n`);
	}
	const errors = report.checks.filter(check => !check.ok && check.level === "error").length;
	const warnings = report.checks.filter(check => !check.ok && check.level === "warning").length;
	process.stdout.write(
		`\n${report.teamRoot ?? "(no team root)"}: ${errors === 0 ? "healthy" : `${errors} error(s)`}${
			warnings > 0 ? `, ${warnings} warning(s)` : ""
		}\n`,
	);
	if (!report.ok) process.exitCode = 1;
}

async function runInit(options: TeamCliOptions, rest: string[]): Promise<void> {
	const name = requireRest(rest, 0, "team name", `${CLI_BIN_NAME} team init <name> --root <path>`);
	const root = requireFlag(options.root, "--root <path>", `${CLI_BIN_NAME} team init <name> --root <path>`);
	const result = await initTeam({ name, root, displayName: options.name });
	if (options.json) writeJson(result);
	else process.stdout.write(`Initialized team "${result.teamId}" at ${result.teamRoot}\n`);
}

async function runPm(options: TeamCliOptions, rest: string[]): Promise<void> {
	const verb = requireRest(rest, 0, "PM action", `${CLI_BIN_NAME} team pm add <pm>`);
	if (verb !== "add") throw new CliUsageError(`Unknown pm action "${verb}". Expected: add`);
	const pm = requireRest(rest, 1, "PM name", `${CLI_BIN_NAME} team pm add <pm>`);
	const result = await addPm({ pm, teamRoot: options.root, displayName: options.name });
	if (options.json) writeJson(result);
	else process.stdout.write(`Added PM "${result.pm.name}" at ${result.pm.workspacePath}\n`);
}

async function runRepo(options: TeamCliOptions, rest: string[]): Promise<void> {
	const verb = requireRest(rest, 0, "repo action", `${CLI_BIN_NAME} team repo add|link|bind`);
	const repo = requireRest(rest, 1, "repository name", `${CLI_BIN_NAME} team repo ${verb} <repo>`);
	if (verb === "add") {
		const clone = requireFlag(options.clone, "--clone <url>", `${CLI_BIN_NAME} team repo add <repo> --clone <url>`);
		const record = await addRepoClone({ repo, clone, teamRoot: options.root });
		if (options.json) writeJson(record);
		else process.stdout.write(`Cloned ${repo} into ${record.basePath} (${record.defaultBranch})\n`);
		return;
	}
	if (verb === "link") {
		const target = requireRest(rest, 2, "repository path", `${CLI_BIN_NAME} team repo link <repo> <path>`);
		const record = await addRepoLink({ repo, path: target, teamRoot: options.root });
		if (options.json) writeJson(record);
		else process.stdout.write(`Linked ${repo} at ${record.basePath} (${record.defaultBranch})\n`);
		return;
	}
	if (verb === "bind") {
		const pm = requireFlag(options.pm, "--pm <pm>", `${CLI_BIN_NAME} team repo bind <repo> --pm <pm>`);
		const result = await bindRepo({ repo, pm, teamRoot: options.root });
		if (options.json) writeJson({ repo: result.repo, pm: result.pm, bound: true });
		else process.stdout.write(`Bound ${result.repo.name} to PM ${result.pm.name}\n`);
		return;
	}
	throw new CliUsageError(`Unknown repo action "${verb}". Expected: add, link, bind`);
}

async function runEngineer(options: TeamCliOptions, rest: string[]): Promise<void> {
	const verb = requireRest(rest, 0, "engineer action", `${CLI_BIN_NAME} team engineer add <name>`);
	if (verb !== "add") throw new CliUsageError(`Unknown engineer action "${verb}". Expected: add`);
	const name = requireRest(
		rest,
		1,
		"engineer name",
		`${CLI_BIN_NAME} team engineer add <name> --pm <pm> --repo <repo>`,
	);
	const pm = requireFlag(options.pm, "--pm <pm>", `${CLI_BIN_NAME} team engineer add <name> --pm <pm> --repo <repo>`);
	const repo = requireFlag(
		options.repo,
		"--repo <repo>",
		`${CLI_BIN_NAME} team engineer add <name> --pm <pm> --repo <repo>`,
	);
	let execution: "normal" | "vibe" | undefined;
	if (options.execution !== undefined) {
		if (options.execution !== "normal" && options.execution !== "vibe") {
			throw new CliUsageError(`--execution must be "normal" or "vibe"; got "${options.execution}"`);
		}
		execution = options.execution;
	}
	const result = await addEngineer({ name, pm, repo, execution, teamRoot: options.root });
	if (options.json) writeJson(result);
	else {
		process.stdout.write(
			`Added engineer "${result.engineer.name}" (${result.engineer.execution}) at ${result.worktree.path}\n`,
		);
	}
}

async function runWorktree(options: TeamCliOptions, rest: string[]): Promise<void> {
	const verb = requireRest(rest, 0, "worktree action", `${CLI_BIN_NAME} team worktree add <task>`);
	if (verb !== "add") throw new CliUsageError(`Unknown worktree action "${verb}". Expected: add`);
	const task = requireRest(rest, 1, "task name", `${CLI_BIN_NAME} team worktree add <task> --repo <repo>`);
	const repo = requireFlag(options.repo, "--repo <repo>", `${CLI_BIN_NAME} team worktree add <task> --repo <repo>`);
	const pm = requireFlag(options.pm, "--pm <pm>", `${CLI_BIN_NAME} team worktree add <task> --pm <pm>`);
	const engineer = requireFlag(
		options.engineer,
		"--engineer <name>",
		`${CLI_BIN_NAME} team worktree add <task> --engineer <name>`,
	);
	const record = await addTaskWorktree({ task, repo, pm, engineer, teamRoot: options.root });
	if (options.json) writeJson(record);
	else process.stdout.write(`Created task worktree ${record.name} at ${record.path} (${record.branch})\n`);
}

function printRoomList(teamRoot: string | undefined, rooms: Awaited<ReturnType<typeof listRooms>>): void {
	if (rooms.length === 0) {
		process.stdout.write("No rooms. Create one with `zetacode team room create <name> --pm <pm>`.\n");
		return;
	}
	for (const room of rooms) {
		const pm = room.pmId ? `(${room.pmId})` : "";
		const last = room.lastSeq === null ? "no events" : `last=#${room.lastSeq}`;
		process.stdout.write(`${room.name}  ${room.kind}${pm}  members=${room.memberCount}  ${last}\n`);
	}
	if (teamRoot) process.stdout.write(`\n${rooms.length} room(s) in ${teamRoot}\n`);
}

function printRoomView(view: RoomView): void {
	const { room, members, events } = view;
	const pm = room.pmId ? ` ${room.pmId}` : "";
	process.stdout.write(`Room ${room.name} (${room.kind}${pm}) ${members.length} member(s)\n`);
	for (const member of members) process.stdout.write(`  - ${member.agentId} (${member.role})\n`);
	if (events.length === 0) {
		process.stdout.write("  (no events)\n");
		return;
	}
	process.stdout.write("\n");
	for (const event of events) {
		const at = new Date(event.sentAt * 1000).toISOString();
		const reply = event.replyTo === null ? "" : ` (reply to #${event.replyTo})`;
		const mentions = event.mentions.length > 0 ? ` @${event.mentions.join(" @")}` : "";
		const body = event.body.replace(/\r?\n/g, "\n    ");
		process.stdout.write(
			`#${event.seq} ${at} ${event.senderAgentId} [${event.kind}]${reply}${mentions}\n  ${body}\n`,
		);
	}
}

async function runRoom(options: TeamCliOptions, rest: string[]): Promise<void> {
	const verb = requireRest(
		rest,
		0,
		"room action",
		`${CLI_BIN_NAME} team room create|list|show|post|subscribe|ack|pending|deliver`,
	);
	const agent = (): string =>
		requireFlag(options.agent, "--agent <id>", `${CLI_BIN_NAME} team room ${verb} <room> --agent <id>`);
	if (verb === "create") {
		const name = requireRest(rest, 1, "room name", `${CLI_BIN_NAME} team room create <name> --pm <pm>`);
		const result = await createRoom({
			name,
			pm: options.pm,
			shared: options.shared,
			kind: options.kind,
			members: options.members,
			teamRoot: options.root,
		});
		if (options.json) {
			writeJson(result);
		} else {
			const pm = result.room.pmId ? ` ${result.room.pmId}` : "";
			process.stdout.write(
				`Created room "${result.room.name}" (${result.room.kind}${pm}) with ${result.members.length} member(s)\n`,
			);
		}
		return;
	}
	if (verb === "list") {
		const rooms = await listRooms({ teamRoot: options.root });
		if (options.json) writeJson(rooms);
		else printRoomList(options.root, rooms);
		return;
	}
	if (verb === "show") {
		const room = requireRest(rest, 1, "room name", `${CLI_BIN_NAME} team room show <room> [--limit <n>]`);
		const view = await showRoom({ room, limit: parsePositiveInt(options.limit, "--limit"), teamRoot: options.root });
		if (options.json) writeJson(view);
		else printRoomView(view);
		return;
	}
	if (verb === "subscribe") {
		const room = requireRest(rest, 1, "room name", `${CLI_BIN_NAME} team room subscribe <room> --agent <id>`);
		const subscription = await subscribeRoom({
			room,
			agent: agent(),
			fromSeq: parseNonNegativeInt(options.fromSeq, "--from-seq"),
			teamRoot: options.root,
		});
		if (options.json) writeJson(subscription);
		else
			process.stdout.write(`Subscribed ${subscription.agentId} to ${room} from #${subscription.acceptedThrough}\n`);
		return;
	}
	if (verb === "ack") {
		const room = requireRest(rest, 1, "room name", `${CLI_BIN_NAME} team room ack <room> --agent <id> --seq <n>`);
		const seq = requireFlag(options.seq, "--seq <n>", `${CLI_BIN_NAME} team room ack <room> --agent <id> --seq <n>`);
		const subscription = await ackRoom({
			room,
			agent: agent(),
			throughSeq: parseNonNegativeInt(seq, "--seq") ?? 0,
			teamRoot: options.root,
		});
		if (options.json) writeJson(subscription);
		else
			process.stdout.write(
				`Acked ${room} through #${subscription.readThrough} (accepted #${subscription.acceptedThrough})\n`,
			);
		return;
	}
	if (verb === "pending") {
		const room = requireRest(rest, 1, "room name", `${CLI_BIN_NAME} team room pending <room> --agent <id>`);
		const events = await pendingRoomEvents({
			room,
			agent: agent(),
			limit: parsePositiveInt(options.limit, "--limit"),
			teamRoot: options.root,
		});
		if (options.json) writeJson(events);
		else if (events.length === 0) process.stdout.write("No pending events.\n");
		else for (const event of events) process.stdout.write(`#${event.seq} ${event.senderAgentId} ${event.body}\n`);
		return;
	}
	if (verb === "deliver") {
		const results = await deliverPendingRoomEvents({
			agentId: agent(),
			cwd: options.cwd,
			teamRoot: options.root,
			limit: parsePositiveInt(options.limit, "--limit"),
		});
		if (options.json) writeJson(results);
		else if (results.length === 0) process.stdout.write("No pending room deliveries.\n");
		else
			for (const result of results)
				process.stdout.write(
					`#${result.seq} ${result.roomId} ${result.agentId} ${result.outcome}${result.error ? ` — ${result.error}` : ""}\n`,
				);
		return;
	}
	if (verb === "subscriptions") {
		const room = requireRest(rest, 1, "room name", `${CLI_BIN_NAME} team room subscriptions <room>`);
		const subscriptions = listRoomSubscriptions(room);
		if (options.json) writeJson(subscriptions);
		else if (subscriptions.length === 0) process.stdout.write("No subscriptions.\n");
		else
			for (const subscription of subscriptions)
				process.stdout.write(
					`${subscription.agentId} accepted=#${subscription.acceptedThrough} read=#${subscription.readThrough}\n`,
				);
		return;
	}
	if (verb === "post") {
		const room = requireRest(rest, 1, "room name", `${CLI_BIN_NAME} team room post <room> --body <text>`);
		const body = requireFlag(options.body, "--body <text>", `${CLI_BIN_NAME} team room post <room> --body <text>`);
		const result = await postRoomEvent({
			room,
			body,
			sender: options.sender,
			replyTo: parsePositiveInt(options.replyTo, "--reply-to"),
			teamRoot: options.root,
		});
		if (options.json) writeJson(result);
		else {
			process.stdout.write(
				`Posted #${result.event.seq} to room "${result.room.name}" as ${result.event.senderAgentId}\n`,
			);
		}
		return;
	}
	throw new CliUsageError(
		`Unknown room action "${verb}". Expected: create, list, show, post, subscribe, ack, pending, deliver, subscriptions`,
	);
}

function formatTaskLease(task: TaskRecord): string {
	if (task.leaseExpiresAt === null) return "-";
	return new Date(task.leaseExpiresAt * 1000).toISOString();
}

function printTaskList(tasks: readonly TaskRecord[]): void {
	if (tasks.length === 0) {
		process.stdout.write("No tasks. Create one with `zetacode team task create <key> --pm <pm> --title <title>`.\n");
		return;
	}
	for (const task of tasks) {
		const assignee = task.assigneeAgentId ?? "-";
		const owner = task.ownerAgentId ?? "-";
		const reqs = task.reqIds.length > 0 ? `  ${task.reqIds.join(",")}` : "";
		process.stdout.write(
			`${task.taskKey}  ${task.status.padEnd(9)}  pm=${task.assignedPmId}  assignee=${assignee}  owner=${owner}  lease=${formatTaskLease(task)}${reqs}  ${task.title}\n`,
		);
	}
}

function printTaskEvent(event: TaskEventRecord): void {
	const at = new Date(event.at * 1000).toISOString();
	const transition = event.fromStatus
		? `${event.fromStatus}->${event.toStatus ?? event.fromStatus}`
		: `->${event.toStatus ?? "-"}`;
	const reqs = event.reqIds.length > 0 ? ` ${event.reqIds.join(",")}` : "";
	const body = event.body.replace(/\r?\n/g, "\n    ");
	process.stdout.write(`#${event.seq} ${at} ${event.actorAgentId} [${event.kind}] ${transition}${reqs}\n  ${body}\n`);
}

function printTaskView(view: TaskView): void {
	const { task, events } = view;
	process.stdout.write(
		`Task ${task.taskKey} [${task.status}] ${task.title}\n` +
			`  PM: ${task.assignedPmId}  assignee: ${task.assigneeAgentId ?? "-"}  owner: ${
				task.ownerAgentId ?? "-"
			}  lease: ${formatTaskLease(task)}  revision: ${task.revision}\n` +
			`  REQ: ${task.reqIds.length > 0 ? task.reqIds.join(", ") : "-"}\n`,
	);
	if (task.body) process.stdout.write(`  ${task.body.replace(/\r?\n/g, "\n  ")}\n`);
	process.stdout.write("\n");
	if (events.length === 0) {
		process.stdout.write("  (no events)\n");
		return;
	}
	for (const event of events) printTaskEvent(event);
}

async function runTask(options: TeamCliOptions, rest: string[]): Promise<void> {
	const verb = requireRest(rest, 0, "task action", `${CLI_BIN_NAME} team task create|list|show|claim|...`);
	const task = (): string => requireRest(rest, 1, "task key", `${CLI_BIN_NAME} team task ${verb} <key>`);
	const pm = (): string => requireFlag(options.pm, "--pm <pm>", `${CLI_BIN_NAME} team task ${verb} <key> --pm <pm>`);
	const agent = (): string =>
		requireFlag(options.agent, "--agent <engineer>", `${CLI_BIN_NAME} team task ${verb} <key> --agent <engineer>`);
	const lease = (): number | undefined => parsePositiveInt(options.lease, "--lease");

	if (verb === "create") {
		const title = requireFlag(
			options.title,
			"--title <title>",
			`${CLI_BIN_NAME} team task create <key> --pm <pm> --title <title>`,
		);
		const result = await createTask({
			taskKey: task(),
			title,
			body: options.body,
			pm: pm(),
			assignee: options.assignee,
			reqIds: options.req,
			teamRoot: options.root,
		});
		if (options.json) writeJson(result);
		else
			process.stdout.write(
				`Created task "${result.task.taskKey}" (${result.task.status}) for PM ${result.task.assignedPmId}\n`,
			);
		return;
	}
	if (verb === "list") {
		const tasks = await listTasks({ status: options.status, teamRoot: options.root });
		if (options.json) writeJson(tasks);
		else printTaskList(tasks);
		return;
	}
	if (verb === "show") {
		const view = await showTask({ task: task(), teamRoot: options.root });
		if (options.json) writeJson(view);
		else printTaskView(view);
		return;
	}
	if (verb === "assign") {
		const result = await assignTask({
			task: task(),
			pm: pm(),
			assignee: requireFlag(
				options.assignee,
				"--assignee <engineer>",
				`${CLI_BIN_NAME} team task assign <key> --pm <pm> --assignee <engineer>`,
			),
			body: options.body,
			teamRoot: options.root,
		});
		if (options.json) writeJson(result);
		else process.stdout.write(`Assigned "${result.task.taskKey}" to ${result.task.assigneeAgentId}\n`);
		return;
	}
	if (verb === "claim" || verb === "renew") {
		const action = verb === "claim" ? claimTask : renewTaskLease;
		const result = await action({
			task: task(),
			agent: agent(),
			leaseSeconds: lease(),
			body: options.body,
			teamRoot: options.root,
		});
		if (options.json) writeJson(result);
		else {
			process.stdout.write(
				`${verb === "claim" ? "Claimed" : "Renewed"} "${result.task.taskKey}" as ${result.task.ownerAgentId} until ${formatTaskLease(result.task)}\n`,
			);
		}
		return;
	}
	if (verb === "release") {
		const result = await releaseTask({ task: task(), agent: agent(), body: options.body, teamRoot: options.root });
		if (options.json) writeJson(result);
		else process.stdout.write(`Released "${result.task.taskKey}" (${result.task.status})\n`);
		return;
	}
	if (verb === "submit") {
		const result = await submitTask({
			task: task(),
			agent: agent(),
			body: options.body,
			reqIds: options.req,
			teamRoot: options.root,
		});
		if (options.json) writeJson(result);
		else process.stdout.write(`Submitted "${result.task.taskKey}" for review\n`);
		return;
	}
	if (verb === "complete") {
		const result = await completeTask({
			task: task(),
			pm: pm(),
			body: options.body,
			reqIds: options.req,
			teamRoot: options.root,
		});
		if (options.json) writeJson(result);
		else process.stdout.write(`Completed "${result.task.taskKey}"\n`);
		return;
	}
	if (verb === "reject") {
		const result = await rejectTask({
			task: task(),
			pm: pm(),
			body: requireFlag(
				options.body,
				"--body <reason>",
				`${CLI_BIN_NAME} team task reject <key> --pm <pm> --body <reason>`,
			),
			teamRoot: options.root,
		});
		if (options.json) writeJson(result);
		else process.stdout.write(`Rejected "${result.task.taskKey}" back to ${result.task.status}\n`);
		return;
	}
	if (verb === "cancel") {
		const result = await cancelTask({ task: task(), pm: pm(), body: options.body, teamRoot: options.root });
		if (options.json) writeJson(result);
		else process.stdout.write(`Cancelled "${result.task.taskKey}"\n`);
		return;
	}
	if (verb === "comment") {
		const result = await commentTask({
			task: task(),
			agent: agent(),
			body: requireFlag(
				options.body,
				"--body <text>",
				`${CLI_BIN_NAME} team task comment <key> --agent <actor> --body <text>`,
			),
			teamRoot: options.root,
		});
		if (options.json) writeJson(result);
		else process.stdout.write(`Commented on "${result.task.taskKey}" (#${result.event.seq})\n`);
		return;
	}
	throw new CliUsageError(
		`Unknown task action "${verb}". Expected: create, list, show, assign, claim, renew, release, submit, complete, reject, cancel, comment`,
	);
}

async function runBootstrap(options: TeamCliOptions): Promise<void> {
	const result = await runInitTeamCommand({
		name: options.name,
		root: options.root,
		displayName: options.displayName,
		pms: options.pms,
		repos: options.repos,
		engineers: options.engineers,
		rooms: options.rooms,
		binds: options.binds,
		engineerOnly: options.engineerOnly,
		noRollback: options.noRollback,
		resume: options.resume,
		rollback: options.rollback,
		json: options.json,
	});
	if (options.json) writeJson(result.result ?? { text: result.text });
	else process.stdout.write(`${result.text}\n`);
}

async function runDoctor(options: TeamCliOptions): Promise<void> {
	const report = await diagnoseTeam({ teamRoot: options.root });
	if (options.json) {
		writeJson(report);
		if (!report.ok) process.exitCode = 1;
		return;
	}
	printDoctor(report);
}

/** Execute one parsed `team` invocation. */
export async function runTeamCommand(options: TeamCliOptions): Promise<void> {
	const rest = options.rest ?? [];
	const action = options.action;
	try {
		switch (action) {
			case "init":
				await runInit(options, rest);
				return;
			case "pm":
				await runPm(options, rest);
				return;
			case "repo":
				await runRepo(options, rest);
				return;
			case "engineer":
				await runEngineer(options, rest);
				return;
			case "worktree":
				await runWorktree(options, rest);
				return;
			case "room":
				await runRoom(options, rest);
				return;
			case "task":
				await runTask(options, rest);
				return;
			case "bootstrap":
				await runBootstrap(options);
				return;
			case "doctor":
				await runDoctor(options);
				return;
			default:
				process.stdout.write(`${USAGE}\n`);
				if (action !== undefined) process.exitCode = 1;
				return;
		}
	} catch (error) {
		if (error instanceof CliUsageError) {
			process.stderr.write(`${error.message}\n`);
		} else if (error instanceof TeamError) {
			process.stderr.write(`Error: ${error.message}\n`);
		} else {
			process.stderr.write(`Error: ${formatTeamError(error)}\n`);
		}
		process.exitCode = 1;
	}
}
