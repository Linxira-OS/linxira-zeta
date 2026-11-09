/**
 * Team structural commands: ownerless root init, PM workspaces, canonical base
 * repositories (clone or link), PM bindings, engineers, and linked worktrees.
 *
 * All structural facts go to the single global database. Git operations go
 * through the `pi-natives` VCS addon, never through hand-spawned `git`.
 *
 * First vertical slice only: no rooms, no tasks/board rows, no Team Hub, no PM
 * mode, and no Vibe auto-start. `--execution vibe` records the engineer's
 * execution choice; it does not start a worker.
 */

import { getProjectDir } from "@linxiraos/pi-utils/dirs";
import * as logger from "@linxiraos/pi-utils/logger";
import type { VcsGitRepo } from "@linxiraos/pi-natives";
import * as vcs from "@linxiraos/pi-natives/vcs";
import * as fs from "node:fs";
import * as path from "node:path";
import {
	engineerRowId,
	pmRowId,
	repoRowId,
	resolveTeamDbPath,
	TeamDb,
	type EngineerRecord,
	type PmRecord,
	type RepoRecord,
	type TeamRecord,
	type WorktreeRecord,
	worktreeRowId,
} from "./db";
import { TeamError } from "./errors";
import {
	baseRepoPath,
	canonicalPath,
	engineerHomePath,
	integrationBranch,
	pmsRoot,
	pmMarkerPath,
	pmWorkspacePath,
	pathWithin,
	readTeamMarker,
	resolveTeamLocation,
	samePath,
	taskBranch,
	taskWorktreePath,
	TEAM_SCHEMA_VERSION,
	type PmMarker,
	type TeamMarker,
	writePmMarker,
	writeTeamMarker,
	writeTeamMemberMarker,
} from "./paths";

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const TEAM_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Resolve a requested team name into a branch/path-safe id. */
export function slugifyTeamName(name: string): string {
	const slug = name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	if (!slug) throw new TeamError(`Team name "${name}" does not contain any usable characters`);
	return slug;
}

function validateSegment(kind: string, value: string): void {
	if (!NAME_RE.test(value) || value === "." || value === ".." || value.endsWith(".")) {
		throw new TeamError(
			`Invalid ${kind} "${value}". Use letters, digits, ".", "_" or "-", starting with a letter or digit.`,
		);
	}
}

export interface TeamContextOptions {
	/** Explicit `--root`; otherwise resolved by walking up from `cwd`. */
	teamRoot?: string;
	cwd?: string;
	dbPath?: string;
}

interface TeamContext {
	db: TeamDb;
	team: TeamRecord;
	teamRoot: string;
}

async function loadContext(options: TeamContextOptions): Promise<TeamContext> {
	const db = new TeamDb(options.dbPath ?? resolveTeamDbPath());
	try {
		let teamRoot: string;
		let marker: TeamMarker | null;
		if (options.teamRoot) {
			teamRoot = canonicalPath(options.teamRoot);
			marker = await readTeamMarker(teamRoot);
			if (!marker) {
				throw new TeamError(`No ownerless team marker at ${path.join(teamRoot, ".zeta", "team.json")}`);
			}
		} else {
			const location = await resolveTeamLocation(options.cwd ?? getProjectDir());
			if (!location) {
				throw new TeamError(
					"No .zeta/team.json found from the current directory. Pass --root or create a team with `zetacode team init`.",
				);
			}
			teamRoot = location.teamRoot;
			marker = {
				schemaVersion: TEAM_SCHEMA_VERSION,
				kind: "team",
				teamId: location.teamId,
				name: location.teamName,
			};
		}

		const team = db.getTeam(marker.teamId);
		if (!team) {
			throw new TeamError(
				`Team "${marker.teamId}" has a marker at ${teamRoot} but no database row in the global team database. Run \`zetacode team doctor\` and re-initialize if the database was lost.`,
			);
		}
		if (!samePath(team.rootPath, teamRoot)) {
			throw new TeamError(
				`Team "${marker.teamId}" is registered at ${team.rootPath}, but the marker resolves to ${teamRoot}`,
			);
		}
		return { db, team, teamRoot };
	} catch (error) {
		db.close();
		throw error;
	}
}

export interface InitTeamOptions {
	name: string;
	root: string;
	displayName?: string;
	dbPath?: string;
}

export interface TeamInitResult {
	teamId: string;
	teamRoot: string;
	marker: TeamMarker;
}

/** Create the ownerless team root. No Agent, no session, no Git, no AGENTS.md. */
export async function initTeam(options: InitTeamOptions): Promise<TeamInitResult> {
	const teamId = slugifyTeamName(options.name);
	if (!TEAM_ID_RE.test(teamId)) throw new TeamError(`Invalid team id "${teamId}"`);
	const teamRoot = path.resolve(options.root);
	const displayName = options.displayName?.trim() || options.name.trim();

	if (!fs.existsSync(teamRoot)) fs.mkdirSync(teamRoot, { recursive: true });
	if (!fs.statSync(teamRoot).isDirectory()) throw new TeamError(`Team root is not a directory: ${teamRoot}`);
	const canonicalRoot = canonicalPath(teamRoot);
	const existing = await readTeamMarker(canonicalRoot);
	if (existing) {
		throw new TeamError(`A team already exists at ${canonicalRoot} (teamId "${existing.teamId}")`);
	}

	const db = new TeamDb(options.dbPath ?? resolveTeamDbPath());
	try {
		const byId = db.getTeam(teamId);
		if (byId) throw new TeamError(`Team id "${teamId}" is already registered at ${byId.rootPath}`);
		const byRoot = db.getTeamByRoot(canonicalRoot);
		if (byRoot) throw new TeamError(`${canonicalRoot} is already registered as team "${byRoot.id}"`);

		const marker: TeamMarker = {
			schemaVersion: TEAM_SCHEMA_VERSION,
			kind: "team",
			teamId,
			name: displayName,
		};
		db.insertTeam({ id: teamId, name: displayName, rootPath: canonicalRoot, createdAt: 0 });
		try {
			for (const dir of [
				pmsRoot(canonicalRoot),
				path.join(canonicalRoot, "repos"),
				path.join(canonicalRoot, "worktrees"),
			]) {
				fs.mkdirSync(dir, { recursive: true });
			}
			await writeTeamMarker(canonicalRoot, marker);
		} catch (error) {
			db.deleteTeam(teamId);
			throw error;
		}
		return { teamId, teamRoot: canonicalRoot, marker };
	} finally {
		db.close();
	}
}

export interface AddPmOptions extends TeamContextOptions {
	pm: string;
	displayName?: string;
}

export interface AddPmResult {
	pm: PmRecord;
	marker: PmMarker;
}

/** Create a PM main-agent workspace (`pms/<pm>/`, a plain folder, not Git). */
export async function addPm(options: AddPmOptions): Promise<AddPmResult> {
	validateSegment("PM name", options.pm);
	const ctx = await loadContext(options);
	try {
		if (ctx.db.getPm(ctx.team.id, options.pm)) {
			throw new TeamError(`PM "${options.pm}" already exists in team "${ctx.team.id}"`);
		}
		const pmRoot = pmWorkspacePath(ctx.teamRoot, options.pm);
		if (fs.existsSync(pmMarkerPath(pmRoot))) {
			throw new TeamError(`PM workspace ${pmRoot} already has a .zeta/pm.json marker`);
		}
		const marker: PmMarker = {
			schemaVersion: TEAM_SCHEMA_VERSION,
			kind: "pm",
			teamId: ctx.team.id,
			pmId: options.pm,
			name: options.displayName?.trim() || options.pm,
		};
		const record: PmRecord = {
			id: pmRowId(ctx.team.id, options.pm),
			teamId: ctx.team.id,
			name: options.pm,
			workspacePath: canonicalPath(pmRoot),
			createdAt: nowSeconds(),
		};
		ctx.db.insertPm(record);
		try {
			fs.mkdirSync(path.join(pmRoot, "notes"), { recursive: true });
			fs.mkdirSync(path.join(pmRoot, "links"), { recursive: true });
			await writePmMarker(pmRoot, marker);
		} catch (error) {
			ctx.db.deletePm(record.id);
			throw error;
		}
		return { pm: record, marker };
	} finally {
		ctx.db.close();
	}
}

export interface BaseRepoFacts {
	defaultBranch: string;
	remoteUrl: string | null;
	headBranch: string;
}

async function inspectBaseRepo(basePath: string): Promise<BaseRepoFacts> {
	const handle = vcs.git(basePath);
	if (!handle) throw new TeamError(`Not a Git repository: ${basePath}`);
	const info = handle.info();
	if (!samePath(info.repoRoot, basePath)) {
		throw new TeamError(`${basePath} is not a repository root (repository root is ${info.repoRoot})`);
	}
	const defaultBranch = (await handle.defaultBranch()) ?? (await handle.currentBranch());
	if (!defaultBranch) throw new TeamError(`Cannot determine the default branch of ${basePath}`);
	const branch = await handle.currentBranch();
	if (!branch) throw new TeamError(`${basePath} has a detached HEAD; check out its default branch first`);
	const remoteUrl = await handle.remoteUrl("origin").catch(() => null);
	return { defaultBranch, remoteUrl: remoteUrl ?? null, headBranch: branch };
}

/** Keep the discovery breadcrumb out of the base repo's own status via local exclude. */
async function excludeBreadcrumbLocally(repoPath: string): Promise<void> {
	const handle = vcs.git(repoPath);
	if (!handle) return;
	const excludePath = path.join(handle.info().gitDir, "info", "exclude");
	const pattern = "/.zeta/team-member.json";
	let text = "";
	try {
		text = await Bun.file(excludePath).text();
	} catch {
		// No local exclude yet; Bun.write creates the file (and parent dirs).
	}
	const lines = text.split(/\r?\n/).map(line => line.trim());
	if (lines.includes(pattern)) return;
	const separator = text.length > 0 && !text.endsWith("\n") ? "\n" : "";
	await Bun.write(excludePath, `${text}${separator}${pattern}\n`);
}

async function registerRepoBreadcrumb(ctx: TeamContext, repo: RepoRecord): Promise<void> {
	try {
		await writeTeamMemberMarker(repo.basePath, {
			schemaVersion: TEAM_SCHEMA_VERSION,
			kind: "team-member",
			teamId: ctx.team.id,
			repoName: repo.name,
			teamRoot: ctx.teamRoot,
		});
		await excludeBreadcrumbLocally(repo.basePath);
	} catch (error) {
		// The database is authoritative; doctor reports a missing breadcrumb.
		logger.warn("team: failed to write repository breadcrumb", {
			repo: repo.basePath,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

export interface AddRepoOptions extends TeamContextOptions {
	repo: string;
	clone: string;
}

export interface LinkRepoOptions extends TeamContextOptions {
	repo: string;
	path: string;
}

/** Clone one canonical base repository into `<team>/repos/<repo>`. */
export async function addRepoClone(options: AddRepoOptions): Promise<RepoRecord> {
	validateSegment("repository name", options.repo);
	if (!options.clone.trim()) throw new TeamError("Missing --clone <url>");
	const ctx = await loadContext(options);
	try {
		if (ctx.db.getRepo(ctx.team.id, options.repo)) {
			throw new TeamError(`Repository "${options.repo}" is already registered in team "${ctx.team.id}"`);
		}
		const target = baseRepoPath(ctx.teamRoot, options.repo);
		if (fs.existsSync(target) && fs.readdirSync(target).length > 0) {
			throw new TeamError(`Repository path already exists and is not empty: ${target}`);
		}
		try {
			await vcs.clone(options.clone, target);
		} catch (error) {
			throw new TeamError(
				`git clone failed for ${options.clone}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		const basePath = canonicalPath(target);
		let facts: BaseRepoFacts;
		try {
			facts = await inspectBaseRepo(basePath);
			if (facts.headBranch !== facts.defaultBranch) {
				throw new TeamError(
					`Cloned repository ${basePath} is on "${facts.headBranch}", expected default branch "${facts.defaultBranch}"`,
				);
			}
		} catch (error) {
			fs.rmSync(target, { recursive: true, force: true });
			throw error;
		}
		const record: RepoRecord = {
			id: repoRowId(ctx.team.id, options.repo),
			teamId: ctx.team.id,
			name: options.repo,
			basePath,
			remoteUrl: facts.remoteUrl,
			defaultBranch: facts.defaultBranch,
			createdAt: nowSeconds(),
		};
		try {
			ctx.db.insertRepo(record);
			await registerRepoBreadcrumb(ctx, record);
		} catch (error) {
			ctx.db.deleteRepo(record.id);
			throw error;
		}
		return record;
	} finally {
		ctx.db.close();
	}
}

/** Register an existing repository root without moving or copying it. */
export async function addRepoLink(options: LinkRepoOptions): Promise<RepoRecord> {
	validateSegment("repository name", options.repo);
	const ctx = await loadContext(options);
	try {
		if (ctx.db.getRepo(ctx.team.id, options.repo)) {
			throw new TeamError(`Repository "${options.repo}" is already registered in team "${ctx.team.id}"`);
		}
		const requested = path.resolve(options.path);
		if (!fs.existsSync(requested)) throw new TeamError(`Repository path does not exist: ${requested}`);
		const basePath = canonicalPath(requested);
		if (pathWithin(pmsRoot(ctx.teamRoot), basePath)) {
			throw new TeamError(`A PM workspace cannot contain a repository (${basePath}); link a repo outside pms/`);
		}
		const facts = await inspectBaseRepo(basePath);
		if (facts.headBranch !== facts.defaultBranch) {
			throw new TeamError(
				`Repository ${basePath} is on "${facts.headBranch}", expected default branch "${facts.defaultBranch}" (base repositories stay on main/master)`,
			);
		}
		const duplicate = ctx.db.getRepoByPath(ctx.team.id, basePath);
		if (duplicate) {
			throw new TeamError(`Repository path ${basePath} is already registered as "${duplicate.name}"`);
		}
		const record: RepoRecord = {
			id: repoRowId(ctx.team.id, options.repo),
			teamId: ctx.team.id,
			name: options.repo,
			basePath,
			remoteUrl: facts.remoteUrl,
			defaultBranch: facts.defaultBranch,
			createdAt: nowSeconds(),
		};
		try {
			ctx.db.insertRepo(record);
			await registerRepoBreadcrumb(ctx, record);
		} catch (error) {
			ctx.db.deleteRepo(record.id);
			throw error;
		}
		return record;
	} finally {
		ctx.db.close();
	}
}

export interface BindRepoOptions extends TeamContextOptions {
	repo: string;
	pm: string;
}

/** Bind a repo to a PM. One repo can serve several PMs; ownership is this row. */
export async function bindRepo(options: BindRepoOptions): Promise<{ repo: RepoRecord; pm: PmRecord }> {
	const ctx = await loadContext(options);
	try {
		const repo = ctx.db.getRepo(ctx.team.id, options.repo);
		if (!repo) throw new TeamError(`Unknown repository "${options.repo}" in team "${ctx.team.id}"`);
		const pm = ctx.db.getPm(ctx.team.id, options.pm);
		if (!pm) throw new TeamError(`Unknown PM "${options.pm}" in team "${ctx.team.id}"`);
		if (ctx.db.getBinding(repo.id, pm.id)) {
			throw new TeamError(`Repository "${repo.name}" is already bound to PM "${pm.name}"`);
		}
		ctx.db.insertBinding(repo.id, pm.id);
		return { repo, pm };
	} finally {
		ctx.db.close();
	}
}

async function resolveBaseRef(handle: VcsGitRepo, defaultBranch: string): Promise<string> {
	if (await handle.refExists(`refs/heads/${defaultBranch}`)) return defaultBranch;
	if (await handle.refExists(`refs/remotes/origin/${defaultBranch}`)) return `origin/${defaultBranch}`;
	throw new TeamError(`Base branch "${defaultBranch}" does not exist in the base repository`);
}

async function createLinkedWorktree(repo: RepoRecord, worktreePath: string, branch: string): Promise<void> {
	if (fs.existsSync(worktreePath)) {
		throw new TeamError(`Worktree path already exists: ${worktreePath}`);
	}
	const handle = vcs.git(repo.basePath);
	if (!handle) throw new TeamError(`Base repository is missing: ${repo.basePath}`);
	if (await handle.refExists(`refs/heads/${branch}`)) {
		throw new TeamError(`Branch "${branch}" already exists in ${repo.basePath}`);
	}
	const baseRef = await resolveBaseRef(handle, repo.defaultBranch);
	await handle.createBranch(branch, baseRef, false);
	try {
		await handle.worktreeAdd(worktreePath, branch, { detach: false, clone: false });
	} catch (error) {
		await handle.deleteBranch(branch, true).catch(() => false);
		throw new TeamError(
			`git worktree add failed for ${worktreePath} (${branch}): ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

async function removeLinkedWorktree(repo: RepoRecord, worktreePath: string, branch: string): Promise<void> {
	const handle = vcs.git(repo.basePath);
	if (!handle) return;
	await handle.worktreeRemove(worktreePath, true).catch(() => false);
	await handle.deleteBranch(branch, true).catch(() => false);
}

export interface AddEngineerOptions extends TeamContextOptions {
	name: string;
	pm: string;
	repo: string;
	execution?: "normal" | "vibe";
}

export interface AddEngineerResult {
	engineer: EngineerRecord;
	worktree: WorktreeRecord;
}

/** Register an engineer and create their home worktree from the base repo. */
export async function addEngineer(options: AddEngineerOptions): Promise<AddEngineerResult> {
	validateSegment("engineer name", options.name);
	const execution = options.execution ?? "normal";
	const ctx = await loadContext(options);
	try {
		const pm = ctx.db.getPm(ctx.team.id, options.pm);
		if (!pm) throw new TeamError(`Unknown PM "${options.pm}" in team "${ctx.team.id}"`);
		const repo = ctx.db.getRepo(ctx.team.id, options.repo);
		if (!repo) throw new TeamError(`Unknown repository "${options.repo}" in team "${ctx.team.id}"`);
		if (!ctx.db.getBinding(repo.id, pm.id)) {
			throw new TeamError(
				`Repository "${repo.name}" is not bound to PM "${pm.name}"; run \`zetacode team repo bind ${repo.name} --pm ${pm.name}\``,
			);
		}
		const worktreePath = engineerHomePath(ctx.teamRoot, repo.name, pm.name, options.name);
		const branch = integrationBranch(ctx.team.id, pm.name, options.name);
		if (ctx.db.getWorktreeByPath(repo.id, canonicalPath(worktreePath))) {
			throw new TeamError(
				`Engineer "${options.name}" already has a home worktree for repo "${repo.name}" at ${worktreePath}`,
			);
		}
		if (ctx.db.getWorktreeByBranch(repo.id, branch)) {
			throw new TeamError(`Branch "${branch}" is already registered as a worktree`);
		}
		let engineer = ctx.db.getEngineer(ctx.team.id, options.pm, options.name);
		let createdEngineer = false;
		if (engineer) {
			// An engineer may own a home worktree per repo; reuse the roster row.
			if (options.execution && options.execution !== engineer.execution) {
				throw new TeamError(
					`Engineer "${options.name}" is already recorded with execution "${engineer.execution}", not "${options.execution}"`,
				);
			}
		} else {
			engineer = {
				id: engineerRowId(ctx.team.id, pm.name, options.name),
				teamId: ctx.team.id,
				pmId: pm.id,
				name: options.name,
				execution,
				createdAt: nowSeconds(),
			};
			ctx.db.insertEngineer(engineer);
			createdEngineer = true;
		}
		const ownEngineerId = engineer.id;
		try {
			await createLinkedWorktree(repo, worktreePath, branch);
		} catch (error) {
			if (createdEngineer) ctx.db.deleteEngineer(ownEngineerId);
			throw error;
		}
		const worktree: WorktreeRecord = {
			id: worktreeRowId(ctx.team.id, repo.name, pm.name, options.name, "home", "home"),
			teamId: ctx.team.id,
			repoId: repo.id,
			pmId: pm.id,
			engineerId: engineer.id,
			kind: "home",
			name: "home",
			path: canonicalPath(worktreePath),
			branch,
			baseBranch: repo.defaultBranch,
			createdAt: nowSeconds(),
		};
		try {
			ctx.db.insertWorktree(worktree);
		} catch (error) {
			await removeLinkedWorktree(repo, worktreePath, branch);
			if (createdEngineer) ctx.db.deleteEngineer(ownEngineerId);
			throw error;
		}
		return { engineer, worktree };
	} finally {
		ctx.db.close();
	}
}

export interface AddWorktreeOptions extends TeamContextOptions {
	task: string;
	repo: string;
	pm: string;
	engineer: string;
}

/** Create a task worktree under the engineer's home (base branch → task branch). */
export async function addTaskWorktree(options: AddWorktreeOptions): Promise<WorktreeRecord> {
	validateSegment("task name", options.task);
	if (options.task === "home") throw new TeamError(`"home" is reserved for the engineer integration worktree`);
	const ctx = await loadContext(options);
	try {
		const pm = ctx.db.getPm(ctx.team.id, options.pm);
		if (!pm) throw new TeamError(`Unknown PM "${options.pm}" in team "${ctx.team.id}"`);
		const repo = ctx.db.getRepo(ctx.team.id, options.repo);
		if (!repo) throw new TeamError(`Unknown repository "${options.repo}" in team "${ctx.team.id}"`);
		if (!ctx.db.getBinding(repo.id, pm.id)) {
			throw new TeamError(`Repository "${repo.name}" is not bound to PM "${pm.name}"`);
		}
		const engineer = ctx.db.getEngineer(ctx.team.id, options.pm, options.engineer);
		if (!engineer) {
			throw new TeamError(`Unknown engineer "${options.engineer}" under PM "${options.pm}"`);
		}
		const home = ctx.db.getWorktreeByPath(repo.id, engineerHomePath(ctx.teamRoot, repo.name, pm.name, engineer.name));
		if (!home) {
			throw new TeamError(
				`Engineer "${engineer.name}" has no home worktree for repo "${repo.name}"; re-add the engineer or run \`zetacode team doctor\``,
			);
		}
		const worktreePath = taskWorktreePath(ctx.teamRoot, repo.name, pm.name, engineer.name, options.task);
		const branch = taskBranch(ctx.team.id, pm.name, engineer.name, options.task);
		if (ctx.db.getWorktreeByPath(repo.id, canonicalPath(worktreePath))) {
			throw new TeamError(`A worktree is already registered at ${worktreePath}`);
		}
		if (ctx.db.getWorktreeByBranch(repo.id, branch)) {
			throw new TeamError(`Branch "${branch}" is already registered as a worktree`);
		}
		await createLinkedWorktree(repo, worktreePath, branch);
		const record: WorktreeRecord = {
			id: worktreeRowId(ctx.team.id, repo.name, pm.name, engineer.name, "task", options.task),
			teamId: ctx.team.id,
			repoId: repo.id,
			pmId: pm.id,
			engineerId: engineer.id,
			kind: "task",
			name: options.task,
			path: canonicalPath(worktreePath),
			branch,
			baseBranch: repo.defaultBranch,
			createdAt: nowSeconds(),
		};
		try {
			ctx.db.insertWorktree(record);
		} catch (error) {
			await removeLinkedWorktree(repo, worktreePath, branch);
			throw error;
		}
		return record;
	} finally {
		ctx.db.close();
	}
}
