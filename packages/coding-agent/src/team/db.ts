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
];

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
}
