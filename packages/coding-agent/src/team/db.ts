/**
 * The single global team database (`~/.zeta/data/zeta.db`).
 *
 * Every structural fact (team, PM, base repo, PM↔repo binding, engineer,
 * worktree) lives here. Markers under a team root are discovery hints only:
 * the database is authoritative, and `team doctor` reports drift.
 *
 * Schema versioning follows the repository convention: `PRAGMA user_version`
 * gates an ordered migration list, and each migration runs in a transaction.
 */

import { Database } from "bun:sqlite";
import { getZetaDbPath } from "@linxiraos/pi-utils/dirs";
import * as fs from "node:fs";
import * as path from "node:path";

const MIGRATIONS: readonly string[] = [
	`
CREATE TABLE IF NOT EXISTS teams (
	id          TEXT PRIMARY KEY,
	name        TEXT NOT NULL,
	root_path   TEXT NOT NULL UNIQUE,
	created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS team_pms (
	id              TEXT PRIMARY KEY,
	team_id         TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
	name            TEXT NOT NULL,
	workspace_path  TEXT NOT NULL,
	created_at      INTEGER NOT NULL,
	UNIQUE(team_id, name)
);

CREATE TABLE IF NOT EXISTS repos (
	id              TEXT PRIMARY KEY,
	team_id         TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
	name            TEXT NOT NULL,
	base_path       TEXT NOT NULL,
	remote_url      TEXT,
	default_branch  TEXT NOT NULL,
	created_at      INTEGER NOT NULL,
	UNIQUE(team_id, name),
	UNIQUE(team_id, base_path)
);

CREATE TABLE IF NOT EXISTS repo_bindings (
	repo_id     TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
	pm_id       TEXT NOT NULL REFERENCES team_pms(id) ON DELETE CASCADE,
	created_at  INTEGER NOT NULL,
	PRIMARY KEY (repo_id, pm_id)
);

CREATE TABLE IF NOT EXISTS engineers (
	id          TEXT PRIMARY KEY,
	team_id     TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
	pm_id       TEXT NOT NULL REFERENCES team_pms(id) ON DELETE CASCADE,
	name        TEXT NOT NULL,
	execution   TEXT NOT NULL DEFAULT 'normal' CHECK (execution IN ('normal', 'vibe')),
	created_at  INTEGER NOT NULL,
	UNIQUE(pm_id, name)
);

CREATE TABLE IF NOT EXISTS worktrees (
	id           TEXT PRIMARY KEY,
	team_id      TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
	repo_id      TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
	pm_id        TEXT NOT NULL REFERENCES team_pms(id) ON DELETE CASCADE,
	engineer_id  TEXT NOT NULL REFERENCES engineers(id) ON DELETE CASCADE,
	kind         TEXT NOT NULL CHECK (kind IN ('home', 'task')),
	name         TEXT NOT NULL,
	path         TEXT NOT NULL,
	branch       TEXT NOT NULL,
	base_branch  TEXT NOT NULL,
	created_at   INTEGER NOT NULL,
	UNIQUE(repo_id, path),
	UNIQUE(repo_id, branch)
);

CREATE INDEX IF NOT EXISTS idx_team_pms_team ON team_pms(team_id);
CREATE INDEX IF NOT EXISTS idx_repos_team ON repos(team_id);
CREATE INDEX IF NOT EXISTS idx_engineers_pm ON engineers(pm_id);
CREATE INDEX IF NOT EXISTS idx_worktrees_repo ON worktrees(repo_id);
CREATE INDEX IF NOT EXISTS idx_worktrees_engineer ON worktrees(engineer_id);
`,
	`
CREATE TABLE IF NOT EXISTS rooms (
	room_id     TEXT PRIMARY KEY,
	team_id     TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
	pm_id       TEXT REFERENCES team_pms(id) ON DELETE CASCADE,
	name        TEXT NOT NULL,
	kind        TEXT NOT NULL CHECK (kind IN ('pm', 'coordination', 'room')),
	created_at  INTEGER NOT NULL,
	UNIQUE(team_id, name)
);

CREATE TABLE IF NOT EXISTS room_members (
	room_id     TEXT NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
	agent_id    TEXT NOT NULL,
	role        TEXT NOT NULL,
	created_at  INTEGER NOT NULL,
	PRIMARY KEY (room_id, agent_id)
);

CREATE TABLE IF NOT EXISTS room_events (
	seq              INTEGER PRIMARY KEY AUTOINCREMENT,
	room_id          TEXT NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
	sent_at          INTEGER NOT NULL,
	sender_agent_id  TEXT NOT NULL,
	kind             TEXT NOT NULL,
	body             TEXT NOT NULL,
	reply_to         INTEGER REFERENCES room_events(seq) ON DELETE SET NULL,
	mentions_json    TEXT
);

CREATE INDEX IF NOT EXISTS idx_rooms_team ON rooms(team_id);
CREATE INDEX IF NOT EXISTS idx_room_members_agent ON room_members(agent_id);
CREATE INDEX IF NOT EXISTS idx_room_events_room ON room_events(room_id, seq);
`,
	`
CREATE TABLE IF NOT EXISTS agents (
	agent_id         TEXT PRIMARY KEY,
	team_id          TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
	pm_id            TEXT NOT NULL REFERENCES team_pms(id) ON DELETE CASCADE,
	role             TEXT NOT NULL CHECK (role IN ('secretary')),
	persistence      TEXT NOT NULL CHECK (persistence IN ('persistent')),
	parent_agent_id  TEXT NOT NULL,
	session_id       TEXT,
	session_file     TEXT,
	state            TEXT NOT NULL,
	created_at       INTEGER NOT NULL,
	updated_at       INTEGER NOT NULL,
	UNIQUE(pm_id, role)
);

CREATE INDEX IF NOT EXISTS idx_agents_team ON agents(team_id);
CREATE INDEX IF NOT EXISTS idx_agents_pm ON agents(pm_id);
`,
	`
CREATE TABLE IF NOT EXISTS agent_skills (
	team_id         TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
	pm_id           TEXT NOT NULL REFERENCES team_pms(id) ON DELETE CASCADE,
	engineer_id     TEXT NOT NULL REFERENCES engineers(id) ON DELETE CASCADE,
	skill_name      TEXT NOT NULL,
	source          TEXT NOT NULL,
	qualified_name  TEXT NOT NULL,
	assigned_by     TEXT NOT NULL,
	created_at      INTEGER NOT NULL,
	PRIMARY KEY (engineer_id, qualified_name),
	UNIQUE (engineer_id, skill_name)
);

CREATE INDEX IF NOT EXISTS idx_agent_skills_pm ON agent_skills(pm_id);
CREATE INDEX IF NOT EXISTS idx_agent_skills_team ON agent_skills(team_id);
`,
	`
CREATE TABLE IF NOT EXISTS tasks (
	id                 TEXT PRIMARY KEY,
	team_id            TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
	task_key           TEXT NOT NULL,
	title              TEXT NOT NULL,
	body               TEXT NOT NULL DEFAULT '',
	status             TEXT NOT NULL CHECK (status IN ('pending', 'claimed', 'review', 'done', 'cancelled')),
	assigned_pm_id     TEXT NOT NULL REFERENCES team_pms(id) ON DELETE CASCADE,
	assignee_agent_id  TEXT REFERENCES engineers(id) ON DELETE SET NULL,
	owner_agent_id     TEXT,
	owner_role         TEXT,
	lease_expires_at   INTEGER,
	req_ids_json       TEXT,
	revision           INTEGER NOT NULL DEFAULT 0,
	created_at         INTEGER NOT NULL,
	updated_at         INTEGER NOT NULL,
	UNIQUE(team_id, task_key)
);

CREATE TABLE IF NOT EXISTS task_events (
	seq              INTEGER PRIMARY KEY AUTOINCREMENT,
	task_id          TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
	at               INTEGER NOT NULL,
	actor_agent_id   TEXT NOT NULL,
	kind             TEXT NOT NULL,
	body             TEXT NOT NULL DEFAULT '',
	from_status      TEXT,
	to_status        TEXT,
	req_ids_json     TEXT,
	lease_expires_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_tasks_team_status ON tasks(team_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_owner ON tasks(owner_agent_id);
CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events(task_id, seq);
`,
	`
CREATE TABLE IF NOT EXISTS team_bootstrap_runs (
	run_id       TEXT PRIMARY KEY,
	team_id      TEXT,
	root_path    TEXT NOT NULL,
	mode         TEXT NOT NULL CHECK (mode IN ('team', 'engineer')),
	status       TEXT NOT NULL CHECK (status IN ('planned', 'running', 'done', 'failed', 'compensated', 'rolled_back')),
	plan_json    TEXT NOT NULL,
	created_at   INTEGER NOT NULL,
	updated_at   INTEGER NOT NULL,
	error        TEXT
);

CREATE TABLE IF NOT EXISTS team_bootstrap_steps (
	run_id       TEXT NOT NULL REFERENCES team_bootstrap_runs(run_id) ON DELETE CASCADE,
	step_id      TEXT NOT NULL,
	seq          INTEGER NOT NULL,
	kind         TEXT NOT NULL,
	status       TEXT NOT NULL CHECK (status IN ('planned', 'running', 'done', 'failed', 'compensated')),
	payload_json TEXT NOT NULL,
	created_at   INTEGER NOT NULL,
	updated_at   INTEGER NOT NULL,
	error        TEXT,
	PRIMARY KEY (run_id, step_id)
);

CREATE INDEX IF NOT EXISTS idx_bootstrap_runs_root ON team_bootstrap_runs(root_path, created_at);
CREATE INDEX IF NOT EXISTS idx_bootstrap_steps_run ON team_bootstrap_steps(run_id, seq);

CREATE TABLE IF NOT EXISTS room_subscriptions (
	room_id        TEXT NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
	agent_id       TEXT NOT NULL,
	last_seq       INTEGER NOT NULL DEFAULT 0,
	subscribed_at  INTEGER NOT NULL,
	updated_at     INTEGER NOT NULL,
	PRIMARY KEY (room_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_room_subscriptions_agent ON room_subscriptions(agent_id);
`,
];

/** Room kinds. A PM room names its owning PM; the other kinds have no PM. */
export type RoomKind = "pm" | "coordination" | "room";

export const ROOM_KINDS: readonly RoomKind[] = ["pm", "coordination", "room"];

/** Default database file, with an explicit test/smoke override. */
export function resolveTeamDbPath(): string {
	const override = process.env.ZETA_TEAM_DB?.trim();
	return override ? path.resolve(override) : getZetaDbPath();
}

export interface TeamRecord {
	id: string;
	name: string;
	rootPath: string;
	createdAt: number;
}

export interface PmRecord {
	id: string;
	teamId: string;
	name: string;
	workspacePath: string;
	createdAt: number;
}

export interface RepoRecord {
	id: string;
	teamId: string;
	name: string;
	basePath: string;
	remoteUrl: string | null;
	defaultBranch: string;
	createdAt: number;
}

export interface BindingRecord {
	repoId: string;
	pmId: string;
	createdAt: number;
}

export interface EngineerRecord {
	id: string;
	teamId: string;
	pmId: string;
	name: string;
	execution: "normal" | "vibe";
	createdAt: number;
}

/**
 * A skill a PM assigned to one of its own engineers. The row references the
 * skill by name and discovery source — never by filesystem path — so an
 * assignment cannot inject arbitrary files. `qualified_name` is
 * `<provider>:<skill name>` and is the assignment's identity inside one
 * engineer (`PRIMARY KEY (engineer_id, qualified_name)`).
 */
export interface AgentSkillRecord {
	teamId: string;
	pmId: string;
	engineerId: string;
	skillName: string;
	/** Discovery source (`<provider>:<level>`), e.g. `native:project`. */
	source: string;
	/** Stable `<provider>:<skill name>` identity. */
	qualifiedName: string;
	/** PM row id that made the assignment (audit). */
	assignedBy: string;
	createdAt: number;
}

export interface WorktreeRecord {
	id: string;
	teamId: string;
	repoId: string;
	pmId: string;
	engineerId: string;
	kind: "home" | "task";
	name: string;
	path: string;
	branch: string;
	baseBranch: string;
	createdAt: number;
}

/** Persistent subagent roles a PM can own. */
export type AgentRole = "secretary";

/** Only persistent subagents are registered here in this slice. */
export type AgentPersistence = "persistent";

/** Durable lifecycle state of a PM-owned subagent. */
export type AgentState = "starting" | "idle" | "parked" | "dead" | "unknown";

/**
 * A PM-owned persistent subagent. It has no folder, repository, or branch:
 * `agent_id` is the runtime registry id, `pm_id` is the database owner, and
 * `session_file` is the resumable child transcript.
 */
export interface AgentRecord {
	id: string;
	teamId: string;
	pmId: string;
	role: AgentRole;
	persistence: AgentPersistence;
	parentAgentId: string;
	sessionId: string | null;
	sessionFile: string | null;
	state: AgentState;
	createdAt: number;
	updatedAt: number;
}

/** A room is a database row plus events; it is never a folder. */
export interface RoomRecord {
	id: string;
	teamId: string;
	/** Owning PM row id for a `pm` room; null for coordination and arbitrary rooms. */
	pmId: string | null;
	name: string;
	kind: RoomKind;
	createdAt: number;
}

export interface RoomMemberRecord {
	roomId: string;
	agentId: string;
	role: string;
	createdAt: number;
}

export interface RoomEventRecord {
	seq: number;
	roomId: string;
	sentAt: number;
	senderAgentId: string;
	kind: string;
	body: string;
	replyTo: number | null;
	mentions: string[];
}

/** Room list row with its member count and latest event markers. */
export interface RoomSummaryRecord extends RoomRecord {
	memberCount: number;
	lastSeq: number | null;
	lastSentAt: number | null;
}

/** Durable work-item statuses. `review` keeps the author as owner without a lease. */
export type TaskStatus = "pending" | "claimed" | "review" | "done" | "cancelled";

export const TASK_STATUSES: readonly TaskStatus[] = ["pending", "claimed", "review", "done", "cancelled"];

/**
 * One durable Team work item. `owner_agent_id` is an engineer row id while the
 * task is claimed; a lease makes the claim reclaimable after a crash. PMs are
 * recorded as `assignedPmId` (the dispatcher) and never as a worker owner.
 */
export interface TaskRecord {
	id: string;
	teamId: string;
	taskKey: string;
	title: string;
	body: string;
	status: TaskStatus;
	assignedPmId: string;
	assigneeAgentId: string | null;
	ownerAgentId: string | null;
	ownerRole: string | null;
	leaseExpiresAt: number | null;
	/** `REQ-*` repository-ledger ids collected from the task and its events. */
	reqIds: string[];
	/** Optimistic concurrency token; every successful mutation increments it. */
	revision: number;
	createdAt: number;
	updatedAt: number;
}

export interface TaskEventRecord {
	seq: number;
	taskId: string;
	at: number;
	actorAgentId: string;
	kind: string;
	body: string;
	fromStatus: TaskStatus | null;
	toStatus: TaskStatus | null;
	reqIds: string[];
	leaseExpiresAt: number | null;
}

export type BootstrapMode = "team" | "engineer";

export type BootstrapRunStatus = "planned" | "running" | "done" | "failed" | "compensated" | "rolled_back";

/** One durable `/initzetateam` run. `plan_json` is the exact confirmed plan. */
export interface BootstrapRunRecord {
	runId: string;
	teamId: string | null;
	rootPath: string;
	mode: BootstrapMode;
	status: BootstrapRunStatus;
	plan: unknown;
	createdAt: number;
	updatedAt: number;
	error: string | null;
}

export type BootstrapStepStatus = "planned" | "running" | "done" | "failed" | "compensated";

export interface BootstrapStepRecord {
	runId: string;
	stepId: string;
	seq: number;
	kind: string;
	status: BootstrapStepStatus;
	payload: unknown;
	createdAt: number;
	updatedAt: number;
	error: string | null;
}

/** Per-room delivery cursor for one Team member or registered agent id. */
export interface RoomSubscriptionRecord {
	roomId: string;
	agentId: string;
	/** Highest seq whose delivery was accepted by a real transport/host. */
	acceptedThrough: number;
	/** Highest seq the consumer explicitly acknowledged as read. */
	readThrough: number;
	subscribedAt: number;
	updatedAt: number;
}

interface DbTeamRow {
	id: string;
	name: string;
	root_path: string;
	created_at: number;
}

interface DbPmRow {
	id: string;
	team_id: string;
	name: string;
	workspace_path: string;
	created_at: number;
}

interface DbRepoRow {
	id: string;
	team_id: string;
	name: string;
	base_path: string;
	remote_url: string | null;
	default_branch: string;
	created_at: number;
}

interface DbEngineerRow {
	id: string;
	team_id: string;
	pm_id: string;
	name: string;
	execution: "normal" | "vibe";
	created_at: number;
}

interface DbAgentSkillRow {
	team_id: string;
	pm_id: string;
	engineer_id: string;
	skill_name: string;
	source: string;
	qualified_name: string;
	assigned_by: string;
	created_at: number;
}

interface DbWorktreeRow {
	id: string;
	team_id: string;
	repo_id: string;
	pm_id: string;
	engineer_id: string;
	kind: "home" | "task";
	name: string;
	path: string;
	branch: string;
	base_branch: string;
	created_at: number;
}

interface DbAgentRow {
	agent_id: string;
	team_id: string;
	pm_id: string;
	role: AgentRole;
	persistence: AgentPersistence;
	parent_agent_id: string;
	session_id: string | null;
	session_file: string | null;
	state: AgentState;
	created_at: number;
	updated_at: number;
}

interface DbRoomRow {
	room_id: string;
	team_id: string;
	pm_id: string | null;
	name: string;
	kind: RoomKind;
	created_at: number;
}

interface DbRoomSummaryRow extends DbRoomRow {
	member_count: number;
	last_seq: number | null;
	last_sent_at: number | null;
}

interface DbRoomMemberRow {
	room_id: string;
	agent_id: string;
	role: string;
	created_at: number;
}

interface DbRoomEventRow {
	seq: number;
	room_id: string;
	sent_at: number;
	sender_agent_id: string;
	kind: string;
	body: string;
	reply_to: number | null;
	mentions_json: string | null;
}

interface DbTaskRow {
	id: string;
	team_id: string;
	task_key: string;
	title: string;
	body: string;
	status: TaskStatus;
	assigned_pm_id: string;
	assignee_agent_id: string | null;
	owner_agent_id: string | null;
	owner_role: string | null;
	lease_expires_at: number | null;
	req_ids_json: string | null;
	revision: number;
	created_at: number;
	updated_at: number;
}

interface DbTaskEventRow {
	seq: number;
	task_id: string;
	at: number;
	actor_agent_id: string;
	kind: string;
	body: string;
	from_status: TaskStatus | null;
	to_status: TaskStatus | null;
	req_ids_json: string | null;
	lease_expires_at: number | null;
}

interface DbBootstrapRunRow {
	run_id: string;
	team_id: string | null;
	root_path: string;
	mode: BootstrapMode;
	status: BootstrapRunStatus;
	plan_json: string;
	created_at: number;
	updated_at: number;
	error: string | null;
}

interface DbBootstrapStepRow {
	run_id: string;
	step_id: string;
	seq: number;
	kind: string;
	status: BootstrapStepStatus;
	payload_json: string;
	created_at: number;
	updated_at: number;
	error: string | null;
}

interface DbRoomSubscriptionRow {
	room_id: string;
	agent_id: string;
	accepted_through: number;
	read_through: number;
	subscribed_at: number;
	updated_at: number;
}

function toTeam(row: DbTeamRow): TeamRecord {
	return { id: row.id, name: row.name, rootPath: row.root_path, createdAt: row.created_at };
}

function toPm(row: DbPmRow): PmRecord {
	return {
		id: row.id,
		teamId: row.team_id,
		name: row.name,
		workspacePath: row.workspace_path,
		createdAt: row.created_at,
	};
}

function toRepo(row: DbRepoRow): RepoRecord {
	return {
		id: row.id,
		teamId: row.team_id,
		name: row.name,
		basePath: row.base_path,
		remoteUrl: row.remote_url,
		defaultBranch: row.default_branch,
		createdAt: row.created_at,
	};
}

function toEngineer(row: DbEngineerRow): EngineerRecord {
	return {
		id: row.id,
		teamId: row.team_id,
		pmId: row.pm_id,
		name: row.name,
		execution: row.execution,
		createdAt: row.created_at,
	};
}

function toAgentSkill(row: DbAgentSkillRow): AgentSkillRecord {
	return {
		teamId: row.team_id,
		pmId: row.pm_id,
		engineerId: row.engineer_id,
		skillName: row.skill_name,
		source: row.source,
		qualifiedName: row.qualified_name,
		assignedBy: row.assigned_by,
		createdAt: row.created_at,
	};
}

function toWorktree(row: DbWorktreeRow): WorktreeRecord {
	return {
		id: row.id,
		teamId: row.team_id,
		repoId: row.repo_id,
		pmId: row.pm_id,
		engineerId: row.engineer_id,
		kind: row.kind,
		name: row.name,
		path: row.path,
		branch: row.branch,
		baseBranch: row.base_branch,
		createdAt: row.created_at,
	};
}

function toAgent(row: DbAgentRow): AgentRecord {
	return {
		id: row.agent_id,
		teamId: row.team_id,
		pmId: row.pm_id,
		role: row.role,
		persistence: row.persistence,
		parentAgentId: row.parent_agent_id,
		sessionId: row.session_id,
		sessionFile: row.session_file,
		state: row.state,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function toRoom(row: DbRoomRow): RoomRecord {
	return {
		id: row.room_id,
		teamId: row.team_id,
		pmId: row.pm_id,
		name: row.name,
		kind: row.kind,
		createdAt: row.created_at,
	};
}

function toRoomSummary(row: DbRoomSummaryRow): RoomSummaryRecord {
	return {
		...toRoom(row),
		memberCount: row.member_count,
		lastSeq: row.last_seq,
		lastSentAt: row.last_sent_at,
	};
}

function toRoomMember(row: DbRoomMemberRow): RoomMemberRecord {
	return {
		roomId: row.room_id,
		agentId: row.agent_id,
		role: row.role,
		createdAt: row.created_at,
	};
}

function toRoomEvent(row: DbRoomEventRow): RoomEventRecord {
	return {
		seq: row.seq,
		roomId: row.room_id,
		sentAt: row.sent_at,
		senderAgentId: row.sender_agent_id,
		kind: row.kind,
		body: row.body,
		replyTo: row.reply_to,
		mentions: parseStringArray(row.mentions_json),
	};
}

function parseStringArray(raw: string | null): string[] {
	if (!raw) return [];
	try {
		const value: unknown = JSON.parse(raw);
		return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
	} catch {
		return [];
	}
}

function toTask(row: DbTaskRow): TaskRecord {
	return {
		id: row.id,
		teamId: row.team_id,
		taskKey: row.task_key,
		title: row.title,
		body: row.body,
		status: row.status,
		assignedPmId: row.assigned_pm_id,
		assigneeAgentId: row.assignee_agent_id,
		ownerAgentId: row.owner_agent_id,
		ownerRole: row.owner_role,
		leaseExpiresAt: row.lease_expires_at,
		reqIds: parseStringArray(row.req_ids_json),
		revision: row.revision,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function toTaskEvent(row: DbTaskEventRow): TaskEventRecord {
	return {
		seq: row.seq,
		taskId: row.task_id,
		at: row.at,
		actorAgentId: row.actor_agent_id,
		kind: row.kind,
		body: row.body,
		fromStatus: row.from_status,
		toStatus: row.to_status,
		reqIds: parseStringArray(row.req_ids_json),
		leaseExpiresAt: row.lease_expires_at,
	};
}

function parseJson(raw: string): unknown {
	try {
		return JSON.parse(raw) as unknown;
	} catch {
		return null;
	}
}

function toBootstrapRun(row: DbBootstrapRunRow): BootstrapRunRecord {
	return {
		runId: row.run_id,
		teamId: row.team_id,
		rootPath: row.root_path,
		mode: row.mode,
		status: row.status,
		plan: parseJson(row.plan_json),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		error: row.error,
	};
}

function toBootstrapStep(row: DbBootstrapStepRow): BootstrapStepRecord {
	return {
		runId: row.run_id,
		stepId: row.step_id,
		seq: row.seq,
		kind: row.kind,
		status: row.status,
		payload: parseJson(row.payload_json),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		error: row.error,
	};
}

function toRoomSubscription(row: DbRoomSubscriptionRow): RoomSubscriptionRecord {
	return {
		roomId: row.room_id,
		agentId: row.agent_id,
		acceptedThrough: row.accepted_through,
		readThrough: row.read_through,
		subscribedAt: row.subscribed_at,
		updatedAt: row.updated_at,
	};
}

function nowSeconds(): number {
	return Math.floor(Date.now() / 1000);
}

/** Deterministic ids: team, then `team:pm`, `team:repo`, … */
export function pmRowId(teamId: string, pmId: string): string {
	return `${teamId}:${pmId}`;
}

export function repoRowId(teamId: string, repoName: string): string {
	return `${teamId}:${repoName}`;
}

export function engineerRowId(teamId: string, pmId: string, engineer: string): string {
	return `${teamId}:${pmId}:${engineer}`;
}

export function worktreeRowId(
	teamId: string,
	repoName: string,
	pmId: string,
	engineer: string,
	kind: "home" | "task",
	name: string,
): string {
	return `${teamId}:${repoName}:${pmId}:${engineer}:${kind}:${name}`;
}

/** Deterministic room id; room names are unique per team. */
export function roomRowId(teamId: string, roomName: string): string {
	return `${teamId}:${roomName}`;
}

/** Deterministic task id; task keys are unique per team. */
export function taskRowId(teamId: string, taskKey: string): string {
	return `${teamId}:task:${taskKey}`;
}

/** One open connection to the global team database. */
export class TeamDb {
	#db: Database;

	constructor(dbPath: string = resolveTeamDbPath()) {
		fs.mkdirSync(path.dirname(dbPath), { recursive: true });
		this.#db = new Database(dbPath);
		// Install the busy handler before any lock-taking statement (see #2421).
		this.#db.run("PRAGMA busy_timeout = 5000");
		this.#db.run("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;");
		this.#migrate();
	}

	close(): void {
		this.#db.close();
	}

	#migrate(): void {
		const row = this.#db.query("PRAGMA user_version").get() as { user_version: number } | null;
		const current = row?.user_version ?? 0;
		for (let version = current; version < MIGRATIONS.length; version++) {
			this.#db.transaction(() => {
				this.#db.run(MIGRATIONS[version]);
				this.#db.run(`PRAGMA user_version = ${version + 1}`);
			})();
		}
	}

	// ── teams ──────────────────────────────────────────────────────────────

	/** Every registered team, ordered for a stable read-model projection. */
	listTeams(): TeamRecord[] {
		return this.#db.query<DbTeamRow, []>("SELECT * FROM teams ORDER BY name, id").all().map(toTeam);
	}

	getTeam(id: string): TeamRecord | null {
		const row = this.#db.query<DbTeamRow, [string]>("SELECT * FROM teams WHERE id = ?").get(id);
		return row ? toTeam(row) : null;
	}

	getTeamByRoot(rootPath: string): TeamRecord | null {
		const row = this.#db.query<DbTeamRow, [string]>("SELECT * FROM teams WHERE root_path = ?").get(rootPath);
		return row ? toTeam(row) : null;
	}

	insertTeam(record: TeamRecord): void {
		this.#db
			.query("INSERT INTO teams (id, name, root_path, created_at) VALUES (?, ?, ?, ?)")
			.run(record.id, record.name, record.rootPath, record.createdAt || nowSeconds());
	}

	deleteTeam(id: string): void {
		this.#db.query("DELETE FROM teams WHERE id = ?").run(id);
	}

	// ── PM workspaces ──────────────────────────────────────────────────────

	listPms(teamId: string): PmRecord[] {
		return this.#db
			.query<DbPmRow, [string]>("SELECT * FROM team_pms WHERE team_id = ? ORDER BY name")
			.all(teamId)
			.map(toPm);
	}

	getPm(teamId: string, pmId: string): PmRecord | null {
		const row = this.#db
			.query<DbPmRow, [string, string]>("SELECT * FROM team_pms WHERE team_id = ? AND name = ?")
			.get(teamId, pmId);
		return row ? toPm(row) : null;
	}

	getPmById(id: string): PmRecord | null {
		const row = this.#db.query<DbPmRow, [string]>("SELECT * FROM team_pms WHERE id = ?").get(id);
		return row ? toPm(row) : null;
	}

	insertPm(record: PmRecord): void {
		this.#db
			.query("INSERT INTO team_pms (id, team_id, name, workspace_path, created_at) VALUES (?, ?, ?, ?, ?)")
			.run(record.id, record.teamId, record.name, record.workspacePath, record.createdAt || nowSeconds());
	}

	deletePm(id: string): void {
		this.#db.query("DELETE FROM team_pms WHERE id = ?").run(id);
	}

	// ── base repositories ─────────────────────────────────────────────────

	listRepos(teamId: string): RepoRecord[] {
		return this.#db
			.query<DbRepoRow, [string]>("SELECT * FROM repos WHERE team_id = ? ORDER BY name")
			.all(teamId)
			.map(toRepo);
	}

	getRepo(teamId: string, name: string): RepoRecord | null {
		const row = this.#db
			.query<DbRepoRow, [string, string]>("SELECT * FROM repos WHERE team_id = ? AND name = ?")
			.get(teamId, name);
		return row ? toRepo(row) : null;
	}

	getRepoById(id: string): RepoRecord | null {
		const row = this.#db.query<DbRepoRow, [string]>("SELECT * FROM repos WHERE id = ?").get(id);
		return row ? toRepo(row) : null;
	}

	getRepoByPath(teamId: string, basePath: string): RepoRecord | null {
		const row = this.#db
			.query<DbRepoRow, [string, string]>("SELECT * FROM repos WHERE team_id = ? AND base_path = ?")
			.get(teamId, basePath);
		return row ? toRepo(row) : null;
	}

	insertRepo(record: RepoRecord): void {
		this.#db
			.query(
				"INSERT INTO repos (id, team_id, name, base_path, remote_url, default_branch, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
			)
			.run(
				record.id,
				record.teamId,
				record.name,
				record.basePath,
				record.remoteUrl,
				record.defaultBranch,
				record.createdAt || nowSeconds(),
			);
	}

	deleteRepo(id: string): void {
		this.#db.query("DELETE FROM repos WHERE id = ?").run(id);
	}

	// ── repo ↔ PM bindings ────────────────────────────────────────────────

	listBindings(teamId: string): BindingRecord[] {
		const rows = this.#db
			.query<{ repo_id: string; pm_id: string; created_at: number }, [string]>(
				`SELECT b.repo_id, b.pm_id, b.created_at
				 FROM repo_bindings b
				 JOIN repos r ON r.id = b.repo_id
				 WHERE r.team_id = ?
				 ORDER BY b.repo_id, b.pm_id`,
			)
			.all(teamId);
		return rows.map(row => ({ repoId: row.repo_id, pmId: row.pm_id, createdAt: row.created_at }));
	}

	getBinding(repoId: string, pmId: string): BindingRecord | null {
		const row = this.#db
			.query<{ repo_id: string; pm_id: string; created_at: number }, [string, string]>(
				"SELECT repo_id, pm_id, created_at FROM repo_bindings WHERE repo_id = ? AND pm_id = ?",
			)
			.get(repoId, pmId);
		return row ? { repoId: row.repo_id, pmId: row.pm_id, createdAt: row.created_at } : null;
	}

	insertBinding(repoId: string, pmId: string): void {
		this.#db
			.query("INSERT INTO repo_bindings (repo_id, pm_id, created_at) VALUES (?, ?, ?)")
			.run(repoId, pmId, nowSeconds());
	}

	deleteBinding(repoId: string, pmId: string): void {
		this.#db.query("DELETE FROM repo_bindings WHERE repo_id = ? AND pm_id = ?").run(repoId, pmId);
	}

	// ── engineers ─────────────────────────────────────────────────────────

	listEngineers(teamId: string): EngineerRecord[] {
		return this.#db
			.query<DbEngineerRow, [string]>("SELECT * FROM engineers WHERE team_id = ? ORDER BY name")
			.all(teamId)
			.map(toEngineer);
	}

	getEngineer(teamId: string, pmId: string, name: string): EngineerRecord | null {
		const row = this.#db
			.query<DbEngineerRow, [string, string, string]>(
				`SELECT e.* FROM engineers e
				 JOIN team_pms p ON p.id = e.pm_id
				 WHERE e.team_id = ? AND p.name = ? AND e.name = ?`,
			)
			.get(teamId, pmId, name);
		return row ? toEngineer(row) : null;
	}

	getEngineerById(id: string): EngineerRecord | null {
		const row = this.#db.query<DbEngineerRow, [string]>("SELECT * FROM engineers WHERE id = ?").get(id);
		return row ? toEngineer(row) : null;
	}

	insertEngineer(record: EngineerRecord): void {
		this.#db
			.query("INSERT INTO engineers (id, team_id, pm_id, name, execution, created_at) VALUES (?, ?, ?, ?, ?, ?)")
			.run(record.id, record.teamId, record.pmId, record.name, record.execution, record.createdAt || nowSeconds());
	}

	deleteEngineer(id: string): void {
		this.#db.query("DELETE FROM engineers WHERE id = ?").run(id);
	}

	// ── agent skills (PM → engineer assignment) ────────────────────────────

	/** Assignments for one engineer, ordered by skill name for a stable read model. */
	listAgentSkills(engineerId: string): AgentSkillRecord[] {
		return this.#db
			.query<DbAgentSkillRow, [string]>(
				"SELECT * FROM agent_skills WHERE engineer_id = ? ORDER BY skill_name, qualified_name",
			)
			.all(engineerId)
			.map(toAgentSkill);
	}

	/** Every assignment made by one PM, ordered by engineer then skill. */
	listAgentSkillsForPm(pmId: string): AgentSkillRecord[] {
		return this.#db
			.query<DbAgentSkillRow, [string]>(
				"SELECT * FROM agent_skills WHERE pm_id = ? ORDER BY engineer_id, skill_name, qualified_name",
			)
			.all(pmId)
			.map(toAgentSkill);
	}

	getAgentSkill(engineerId: string, qualifiedName: string): AgentSkillRecord | null {
		const row = this.#db
			.query<DbAgentSkillRow, [string, string]>(
				"SELECT * FROM agent_skills WHERE engineer_id = ? AND qualified_name = ?",
			)
			.get(engineerId, qualifiedName);
		return row ? toAgentSkill(row) : null;
	}

	insertAgentSkill(record: AgentSkillRecord): void {
		this.#db
			.query(
				`INSERT INTO agent_skills
				 (team_id, pm_id, engineer_id, skill_name, source, qualified_name, assigned_by, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				record.teamId,
				record.pmId,
				record.engineerId,
				record.skillName,
				record.source,
				record.qualifiedName,
				record.assignedBy,
				record.createdAt || nowSeconds(),
			);
	}

	deleteAgentSkill(engineerId: string, qualifiedName: string): boolean {
		const before = this.getAgentSkill(engineerId, qualifiedName);
		if (!before) return false;
		this.#db
			.query("DELETE FROM agent_skills WHERE engineer_id = ? AND qualified_name = ?")
			.run(engineerId, qualifiedName);
		return true;
	}

	// ── worktrees ─────────────────────────────────────────────────────────

	listWorktrees(teamId: string): WorktreeRecord[] {
		return this.#db
			.query<DbWorktreeRow, [string]>("SELECT * FROM worktrees WHERE team_id = ? ORDER BY path")
			.all(teamId)
			.map(toWorktree);
	}

	getWorktreeById(id: string): WorktreeRecord | null {
		const row = this.#db.query<DbWorktreeRow, [string]>("SELECT * FROM worktrees WHERE id = ?").get(id);
		return row ? toWorktree(row) : null;
	}

	getWorktreeByPath(repoId: string, worktreePath: string): WorktreeRecord | null {
		const row = this.#db
			.query<DbWorktreeRow, [string, string]>("SELECT * FROM worktrees WHERE repo_id = ? AND path = ?")
			.get(repoId, worktreePath);
		return row ? toWorktree(row) : null;
	}

	getWorktreeByBranch(repoId: string, branch: string): WorktreeRecord | null {
		const row = this.#db
			.query<DbWorktreeRow, [string, string]>("SELECT * FROM worktrees WHERE repo_id = ? AND branch = ?")
			.get(repoId, branch);
		return row ? toWorktree(row) : null;
	}

	insertWorktree(record: WorktreeRecord): void {
		this.#db
			.query(
				`INSERT INTO worktrees
				 (id, team_id, repo_id, pm_id, engineer_id, kind, name, path, branch, base_branch, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				record.id,
				record.teamId,
				record.repoId,
				record.pmId,
				record.engineerId,
				record.kind,
				record.name,
				record.path,
				record.branch,
				record.baseBranch,
				record.createdAt || nowSeconds(),
			);
	}

	deleteWorktree(id: string): void {
		this.#db.query("DELETE FROM worktrees WHERE id = ?").run(id);
	}

	// ── rooms ─────────────────────────────────────────────────────────────

	listRooms(teamId: string): RoomRecord[] {
		return this.#db
			.query<DbRoomRow, [string]>("SELECT * FROM rooms WHERE team_id = ? ORDER BY name")
			.all(teamId)
			.map(toRoom);
	}

	listRoomSummaries(teamId: string): RoomSummaryRecord[] {
		return this.#db
			.query<DbRoomSummaryRow, [string]>(
				`SELECT r.*,
				        (SELECT COUNT(*) FROM room_members m WHERE m.room_id = r.room_id) AS member_count,
				        (SELECT MAX(seq) FROM room_events e WHERE e.room_id = r.room_id) AS last_seq,
				        (SELECT sent_at FROM room_events e WHERE e.room_id = r.room_id ORDER BY seq DESC LIMIT 1) AS last_sent_at
				 FROM rooms r
				 WHERE r.team_id = ?
				 ORDER BY r.name`,
			)
			.all(teamId)
			.map(toRoomSummary);
	}

	getRoom(teamId: string, name: string): RoomRecord | null {
		const row = this.#db
			.query<DbRoomRow, [string, string]>("SELECT * FROM rooms WHERE team_id = ? AND name = ?")
			.get(teamId, name);
		return row ? toRoom(row) : null;
	}

	getRoomById(id: string): RoomRecord | null {
		const row = this.#db.query<DbRoomRow, [string]>("SELECT * FROM rooms WHERE room_id = ?").get(id);
		return row ? toRoom(row) : null;
	}

	insertRoom(record: RoomRecord): void {
		this.#db
			.query("INSERT INTO rooms (room_id, team_id, pm_id, name, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)")
			.run(record.id, record.teamId, record.pmId, record.name, record.kind, record.createdAt || nowSeconds());
	}

	deleteRoom(id: string): void {
		this.#db.query("DELETE FROM rooms WHERE room_id = ?").run(id);
	}

	updateRoom(id: string, fields: { kind?: RoomKind; pmId?: string | null }): boolean {
		const assignments: string[] = [];
		const values: (string | null)[] = [];
		if (fields.kind !== undefined) {
			assignments.push("kind = ?");
			values.push(fields.kind);
		}
		if (fields.pmId !== undefined) {
			assignments.push("pm_id = ?");
			values.push(fields.pmId);
		}
		if (assignments.length === 0) return false;
		return (
			this.#db.query(`UPDATE rooms SET ${assignments.join(", ")} WHERE room_id = ?`).run(...values, id).changes === 1
		);
	}

	// ── room membership ───────────────────────────────────────────────────

	listRoomMembers(roomId: string): RoomMemberRecord[] {
		return this.#db
			.query<DbRoomMemberRow, [string]>("SELECT * FROM room_members WHERE room_id = ? ORDER BY agent_id")
			.all(roomId)
			.map(toRoomMember);
	}

	getRoomMember(roomId: string, agentId: string): RoomMemberRecord | null {
		const row = this.#db
			.query<DbRoomMemberRow, [string, string]>("SELECT * FROM room_members WHERE room_id = ? AND agent_id = ?")
			.get(roomId, agentId);
		return row ? toRoomMember(row) : null;
	}

	insertRoomMember(record: RoomMemberRecord): void {
		this.#db
			.query("INSERT INTO room_members (room_id, agent_id, role, created_at) VALUES (?, ?, ?, ?)")
			.run(record.roomId, record.agentId, record.role, record.createdAt || nowSeconds());
	}

	deleteRoomMember(roomId: string, agentId: string): void {
		this.#db.query("DELETE FROM room_members WHERE room_id = ? AND agent_id = ?").run(roomId, agentId);
	}

	/** Rooms this agent belongs to, for a future TUI/Studio read model. */
	listRoomsForAgent(teamId: string, agentId: string): RoomRecord[] {
		return this.#db
			.query<DbRoomRow, [string, string]>(
				`SELECT r.* FROM rooms r
				 JOIN room_members m ON m.room_id = r.room_id
				 WHERE r.team_id = ? AND m.agent_id = ?
				 ORDER BY r.name`,
			)
			.all(teamId, agentId)
			.map(toRoom);
	}

	// ── room events ───────────────────────────────────────────────────────

	/**
	 * Events in sequence order. With `limit`, the newest `limit` events are
	 * returned still in ascending sequence order, so readers can page back.
	 */
	listRoomEvents(roomId: string, limit?: number): RoomEventRecord[] {
		if (limit === undefined) {
			return this.#db
				.query<DbRoomEventRow, [string]>("SELECT * FROM room_events WHERE room_id = ? ORDER BY seq")
				.all(roomId)
				.map(toRoomEvent);
		}
		return this.#db
			.query<DbRoomEventRow, [string, number]>(
				"SELECT * FROM room_events WHERE room_id = ? ORDER BY seq DESC LIMIT ?",
			)
			.all(roomId, limit)
			.reverse()
			.map(toRoomEvent);
	}

	/** Events after `afterSeq`, for incremental room reads. */
	listRoomEventsAfter(roomId: string, afterSeq: number): RoomEventRecord[] {
		return this.#db
			.query<DbRoomEventRow, [string, number]>(
				"SELECT * FROM room_events WHERE room_id = ? AND seq > ? ORDER BY seq",
			)
			.all(roomId, afterSeq)
			.map(toRoomEvent);
	}

	getRoomEvent(seq: number): RoomEventRecord | null {
		const row = this.#db.query<DbRoomEventRow, [number]>("SELECT * FROM room_events WHERE seq = ?").get(seq);
		return row ? toRoomEvent(row) : null;
	}

	getLastRoomEvent(roomId: string): RoomEventRecord | null {
		const row = this.#db
			.query<DbRoomEventRow, [string]>("SELECT * FROM room_events WHERE room_id = ? ORDER BY seq DESC LIMIT 1")
			.get(roomId);
		return row ? toRoomEvent(row) : null;
	}

	// ── PM-owned persistent agents ────────────────────────────────────────

	listAgents(teamId: string): AgentRecord[] {
		return this.#db
			.query<DbAgentRow, [string]>("SELECT * FROM agents WHERE team_id = ? ORDER BY pm_id, role")
			.all(teamId)
			.map(toAgent);
	}

	getAgentById(id: string): AgentRecord | null {
		const row = this.#db.query<DbAgentRow, [string]>("SELECT * FROM agents WHERE agent_id = ?").get(id);
		return row ? toAgent(row) : null;
	}

	getAgentForPm(teamId: string, pmId: string, role: AgentRole): AgentRecord | null {
		const row = this.#db
			.query<DbAgentRow, [string, string, AgentRole]>(
				"SELECT * FROM agents WHERE team_id = ? AND pm_id = ? AND role = ?",
			)
			.get(teamId, pmId, role);
		return row ? toAgent(row) : null;
	}

	insertAgent(record: AgentRecord): void {
		const now = nowSeconds();
		this.#db
			.query(
				`INSERT INTO agents
				 (agent_id, team_id, pm_id, role, persistence, parent_agent_id, session_id, session_file, state, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				record.id,
				record.teamId,
				record.pmId,
				record.role,
				record.persistence,
				record.parentAgentId,
				record.sessionId,
				record.sessionFile,
				record.state,
				record.createdAt || now,
				record.updatedAt || now,
			);
	}

	updateAgent(
		id: string,
		fields: Partial<Pick<AgentRecord, "sessionId" | "sessionFile" | "state" | "parentAgentId">>,
	): void {
		const assignments: string[] = [];
		const values: (string | null)[] = [];
		if (fields.sessionId !== undefined) {
			assignments.push("session_id = ?");
			values.push(fields.sessionId);
		}
		if (fields.sessionFile !== undefined) {
			assignments.push("session_file = ?");
			values.push(fields.sessionFile);
		}
		if (fields.state !== undefined) {
			assignments.push("state = ?");
			values.push(fields.state);
		}
		if (fields.parentAgentId !== undefined) {
			assignments.push("parent_agent_id = ?");
			values.push(fields.parentAgentId);
		}
		if (assignments.length === 0) return;
		assignments.push("updated_at = ?");
		values.push(String(nowSeconds()));
		this.#db.query(`UPDATE agents SET ${assignments.join(", ")} WHERE agent_id = ?`).run(...values, id);
	}

	deleteAgent(id: string): void {
		this.#db.query("DELETE FROM agents WHERE agent_id = ?").run(id);
	}

	/** Host assigns `seq`; the caller supplies the rest. */
	insertRoomEvent(record: Omit<RoomEventRecord, "seq">): RoomEventRecord {
		const mentionsJson = record.mentions.length > 0 ? JSON.stringify(record.mentions) : null;
		const row = this.#db
			.query<{ seq: number }, [string, number, string, string, string, number | null, string | null]>(
				`INSERT INTO room_events
				 (room_id, sent_at, sender_agent_id, kind, body, reply_to, mentions_json)
				 VALUES (?, ?, ?, ?, ?, ?, ?)
				 RETURNING seq`,
			)
			.get(
				record.roomId,
				record.sentAt,
				record.senderAgentId,
				record.kind,
				record.body,
				record.replyTo,
				mentionsJson,
			);
		if (!row) throw new Error("room_events insert returned no sequence");
		return { ...record, seq: row.seq };
	}

	// ── tasks (durable work queue) ────────────────────────────────────────

	/** Run several reads/writes atomically; nested calls reuse the SQLite savepoint. */
	runTransaction<T>(work: () => T): T {
		return this.#db.transaction(work)();
	}

	listTasks(teamId: string, status?: TaskStatus): TaskRecord[] {
		if (status) {
			return this.#db
				.query<DbTaskRow, [string, TaskStatus]>(
					"SELECT * FROM tasks WHERE team_id = ? AND status = ? ORDER BY task_key",
				)
				.all(teamId, status)
				.map(toTask);
		}
		return this.#db
			.query<DbTaskRow, [string]>("SELECT * FROM tasks WHERE team_id = ? ORDER BY task_key")
			.all(teamId)
			.map(toTask);
	}

	getTask(teamId: string, taskKey: string): TaskRecord | null {
		const row = this.#db
			.query<DbTaskRow, [string, string]>("SELECT * FROM tasks WHERE team_id = ? AND task_key = ?")
			.get(teamId, taskKey);
		return row ? toTask(row) : null;
	}

	getTaskById(id: string): TaskRecord | null {
		const row = this.#db.query<DbTaskRow, [string]>("SELECT * FROM tasks WHERE id = ?").get(id);
		return row ? toTask(row) : null;
	}

	insertTask(record: TaskRecord): void {
		const now = nowSeconds();
		this.#db
			.query(
				`INSERT INTO tasks
				 (id, team_id, task_key, title, body, status, assigned_pm_id, assignee_agent_id,
				  owner_agent_id, owner_role, lease_expires_at, req_ids_json, revision, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				record.id,
				record.teamId,
				record.taskKey,
				record.title,
				record.body,
				record.status,
				record.assignedPmId,
				record.assigneeAgentId,
				record.ownerAgentId,
				record.ownerRole,
				record.leaseExpiresAt,
				record.reqIds.length > 0 ? JSON.stringify(record.reqIds) : null,
				record.revision,
				record.createdAt || now,
				record.updatedAt || now,
			);
	}

	/**
	 * Compare-and-set update. With `expectedRevision`, the write is rejected when
	 * another process already changed the row. Every successful update bumps
	 * `revision`, so callers can use the returned boolean as the claim outcome.
	 */
	updateTask(
		id: string,
		fields: Partial<
			Pick<
				TaskRecord,
				| "title"
				| "body"
				| "status"
				| "assignedPmId"
				| "assigneeAgentId"
				| "ownerAgentId"
				| "ownerRole"
				| "leaseExpiresAt"
				| "reqIds"
			>
		>,
		expectedRevision?: number,
	): boolean {
		const assignments: string[] = [];
		const values: (string | number | null)[] = [];
		const set = (column: string, value: string | number | null): void => {
			assignments.push(`${column} = ?`);
			values.push(value);
		};
		if (fields.title !== undefined) set("title", fields.title);
		if (fields.body !== undefined) set("body", fields.body);
		if (fields.status !== undefined) set("status", fields.status);
		if (fields.assignedPmId !== undefined) set("assigned_pm_id", fields.assignedPmId);
		if (fields.assigneeAgentId !== undefined) set("assignee_agent_id", fields.assigneeAgentId);
		if (fields.ownerAgentId !== undefined) set("owner_agent_id", fields.ownerAgentId);
		if (fields.ownerRole !== undefined) set("owner_role", fields.ownerRole);
		if (fields.leaseExpiresAt !== undefined) set("lease_expires_at", fields.leaseExpiresAt);
		if (fields.reqIds !== undefined) {
			set("req_ids_json", fields.reqIds.length > 0 ? JSON.stringify(fields.reqIds) : null);
		}
		if (assignments.length === 0 && expectedRevision === undefined) return false;
		assignments.push("updated_at = ?", "revision = revision + 1");
		values.push(nowSeconds());
		const where = expectedRevision === undefined ? "id = ?" : "id = ? AND revision = ?";
		const result = this.#db
			.query(`UPDATE tasks SET ${assignments.join(", ")} WHERE ${where}`)
			.run(...values, id, ...(expectedRevision === undefined ? [] : [expectedRevision]));
		return result.changes === 1;
	}

	deleteTask(id: string): void {
		this.#db.query("DELETE FROM tasks WHERE id = ?").run(id);
	}

	listTaskEvents(taskId: string): TaskEventRecord[] {
		return this.#db
			.query<DbTaskEventRow, [string]>("SELECT * FROM task_events WHERE task_id = ? ORDER BY seq")
			.all(taskId)
			.map(toTaskEvent);
	}

	/** Host assigns `seq`; the caller supplies the rest. */
	insertTaskEvent(record: Omit<TaskEventRecord, "seq">): TaskEventRecord {
		const reqJson = record.reqIds.length > 0 ? JSON.stringify(record.reqIds) : null;
		const row = this.#db
			.query<
				{ seq: number },
				[string, number, string, string, string, TaskStatus | null, TaskStatus | null, string | null, number | null]
			>(
				`INSERT INTO task_events
				 (task_id, at, actor_agent_id, kind, body, from_status, to_status, req_ids_json, lease_expires_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
				 RETURNING seq`,
			)
			.get(
				record.taskId,
				record.at,
				record.actorAgentId,
				record.kind,
				record.body,
				record.fromStatus,
				record.toStatus,
				reqJson,
				record.leaseExpiresAt,
			);
		if (!row) throw new Error("task_events insert returned no sequence");
		return { ...record, seq: row.seq };
	}

	// ── bootstrap journal ────────────────────────────────────────────────

	insertBootstrapRun(record: BootstrapRunRecord): void {
		const now = nowSeconds();
		this.#db
			.query(
				`INSERT INTO team_bootstrap_runs
				 (run_id, team_id, root_path, mode, status, plan_json, created_at, updated_at, error)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				record.runId,
				record.teamId,
				record.rootPath,
				record.mode,
				record.status,
				JSON.stringify(record.plan),
				record.createdAt || now,
				record.updatedAt || now,
				record.error,
			);
	}

	getBootstrapRun(runId: string): BootstrapRunRecord | null {
		const row = this.#db
			.query<DbBootstrapRunRow, [string]>("SELECT * FROM team_bootstrap_runs WHERE run_id = ?")
			.get(runId);
		return row ? toBootstrapRun(row) : null;
	}

	listBootstrapRuns(rootPath: string, limit = 20): BootstrapRunRecord[] {
		return this.#db
			.query<DbBootstrapRunRow, [string, number]>(
				"SELECT * FROM team_bootstrap_runs WHERE root_path = ? ORDER BY created_at DESC LIMIT ?",
			)
			.all(rootPath, limit)
			.map(toBootstrapRun);
	}

	updateBootstrapRun(
		runId: string,
		fields: Partial<Pick<BootstrapRunRecord, "teamId" | "status" | "plan" | "error">>,
	): boolean {
		const assignments: string[] = [];
		const values: (string | number | null)[] = [];
		if (fields.teamId !== undefined) {
			assignments.push("team_id = ?");
			values.push(fields.teamId);
		}
		if (fields.status !== undefined) {
			assignments.push("status = ?");
			values.push(fields.status);
		}
		if (fields.plan !== undefined) {
			assignments.push("plan_json = ?");
			values.push(JSON.stringify(fields.plan));
		}
		if (fields.error !== undefined) {
			assignments.push("error = ?");
			values.push(fields.error);
		}
		if (assignments.length === 0) return false;
		assignments.push("updated_at = ?");
		values.push(nowSeconds());
		return (
			this.#db
				.query(`UPDATE team_bootstrap_runs SET ${assignments.join(", ")} WHERE run_id = ?`)
				.run(...values, runId).changes === 1
		);
	}

	insertBootstrapStep(record: BootstrapStepRecord): void {
		const now = nowSeconds();
		this.#db
			.query(
				`INSERT INTO team_bootstrap_steps
				 (run_id, step_id, seq, kind, status, payload_json, created_at, updated_at, error)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				record.runId,
				record.stepId,
				record.seq,
				record.kind,
				record.status,
				JSON.stringify(record.payload),
				record.createdAt || now,
				record.updatedAt || now,
				record.error,
			);
	}

	updateBootstrapStep(
		runId: string,
		stepId: string,
		fields: Partial<Pick<BootstrapStepRecord, "status" | "payload" | "error">>,
	): boolean {
		const assignments: string[] = [];
		const values: (string | number | null)[] = [];
		if (fields.status !== undefined) {
			assignments.push("status = ?");
			values.push(fields.status);
		}
		if (fields.payload !== undefined) {
			assignments.push("payload_json = ?");
			values.push(JSON.stringify(fields.payload));
		}
		if (fields.error !== undefined) {
			assignments.push("error = ?");
			values.push(fields.error);
		}
		if (assignments.length === 0) return false;
		assignments.push("updated_at = ?");
		values.push(nowSeconds());
		return (
			this.#db
				.query(`UPDATE team_bootstrap_steps SET ${assignments.join(", ")} WHERE run_id = ? AND step_id = ?`)
				.run(...values, runId, stepId).changes === 1
		);
	}

	listBootstrapSteps(runId: string): BootstrapStepRecord[] {
		return this.#db
			.query<DbBootstrapStepRow, [string]>("SELECT * FROM team_bootstrap_steps WHERE run_id = ? ORDER BY seq")
			.all(runId)
			.map(toBootstrapStep);
	}

	// ── room subscriptions / delivery cursors ─────────────────────────────

	getRoomSubscription(roomId: string, agentId: string): RoomSubscriptionRecord | null {
		const row = this.#db
			.query<DbRoomSubscriptionRow, [string, string]>(
				"SELECT * FROM room_subscriptions WHERE room_id = ? AND agent_id = ?",
			)
			.get(roomId, agentId);
		return row ? toRoomSubscription(row) : null;
	}

	listRoomSubscriptions(roomId: string): RoomSubscriptionRecord[] {
		return this.#db
			.query<DbRoomSubscriptionRow, [string]>("SELECT * FROM room_subscriptions WHERE room_id = ? ORDER BY agent_id")
			.all(roomId)
			.map(toRoomSubscription);
	}

	listRoomSubscriptionsForAgent(teamId: string, agentId: string): RoomSubscriptionRecord[] {
		return this.#db
			.query<DbRoomSubscriptionRow, [string, string]>(
				`SELECT s.* FROM room_subscriptions s
				 JOIN rooms r ON r.room_id = s.room_id
				 WHERE r.team_id = ? AND s.agent_id = ?
				 ORDER BY r.name`,
			)
			.all(teamId, agentId)
			.map(toRoomSubscription);
	}

	/** Subscribe or advance cursors; neither cursor ever moves backwards. */
	upsertRoomSubscription(record: RoomSubscriptionRecord): void {
		const now = nowSeconds();
		this.#db
			.query(
				`INSERT INTO room_subscriptions
				 (room_id, agent_id, accepted_through, read_through, subscribed_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?)
				 ON CONFLICT(room_id, agent_id) DO UPDATE SET
				   accepted_through = MAX(room_subscriptions.accepted_through, excluded.accepted_through),
				   read_through = MAX(room_subscriptions.read_through, excluded.read_through),
				   updated_at = excluded.updated_at`,
			)
			.run(
				record.roomId,
				record.agentId,
				record.acceptedThrough,
				record.readThrough,
				record.subscribedAt || now,
				record.updatedAt || now,
			);
	}

	/**
	 * Monotonic compare-and-set for the accepted cursor. Returns false when a
	 * concurrent delivery already advanced it; callers must not skip a gap.
	 */
	advanceRoomAccepted(roomId: string, agentId: string, throughSeq: number): boolean {
		const result = this.#db
			.query(
				`UPDATE room_subscriptions
				 SET accepted_through = ?, updated_at = ?
				 WHERE room_id = ? AND agent_id = ? AND accepted_through < ?`,
			)
			.run(throughSeq, nowSeconds(), roomId, agentId, throughSeq);
		return result.changes === 1;
	}

	/** Consumer ack; cannot pass the accepted cursor. */
	advanceRoomRead(roomId: string, agentId: string, throughSeq: number): boolean {
		const result = this.#db
			.query(
				`UPDATE room_subscriptions
				 SET read_through = ?, updated_at = ?
				 WHERE room_id = ? AND agent_id = ?
				   AND read_through < ? AND accepted_through >= ?`,
			)
			.run(throughSeq, nowSeconds(), roomId, agentId, throughSeq, throughSeq);
		return result.changes === 1;
	}

	deleteRoomSubscription(roomId: string, agentId: string): void {
		this.#db.query("DELETE FROM room_subscriptions WHERE room_id = ? AND agent_id = ?").run(roomId, agentId);
	}
}
