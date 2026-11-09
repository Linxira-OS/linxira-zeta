/**
 * `zetacode team` dispatch.
 *
 * Verbs are positional (`team pm add core`) because the CLI framework has one
 * command level; every flag is declared once on the `team` command.
 */

import { CLI_BIN_NAME } from "@linxiraos/pi-utils/dirs";
import { CliUsageError } from "@linxiraos/pi-utils/cli";
import { diagnoseTeam, type DoctorReport } from "../team/doctor";
import { formatTeamError, TeamError } from "../team/errors";
import { createRoom, listRooms, postRoomEvent, showRoom, type RoomView } from "../team/rooms";
import { addEngineer, addPm, addRepoClone, addRepoLink, addTaskWorktree, bindRepo, initTeam } from "../team/service";

export interface TeamCliOptions {
	action?: string;
	rest?: string[];
	root?: string;
	name?: string;
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
  doctor [--root <path>] [--json]                             Validate root, PMs, repos, worktrees, rooms

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
		const pm = room.pmId ? ` pm=${room.pmId}` : "";
		const last = room.lastSeq === null ? "no events" : `last=#${room.lastSeq}`;
		process.stdout.write(`${room.name}  ${room.kind}${pm}  members=${room.memberCount}  ${last}\n`);
	}
	if (teamRoot) process.stdout.write(`\n${rooms.length} room(s) in ${teamRoot}\n`);
}

function printRoomView(view: RoomView): void {
	const { room, members, events } = view;
	const pm = room.pmId ? ` pm=${room.pmId}` : "";
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
	const verb = requireRest(rest, 0, "room action", `${CLI_BIN_NAME} team room create|list|show|post`);
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
			const pm = result.room.pmId ? ` pm=${result.room.pmId}` : "";
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
	throw new CliUsageError(`Unknown room action "${verb}". Expected: create, list, show, post`);
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
