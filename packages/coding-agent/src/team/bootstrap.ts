/**
 * Transactional `/initzetateam` bootstrap.
 *
 * A plan is pure: it validates names, paths, Git/ownerless constraints, and
 * database collisions before any write. Apply records each step in the durable
 * `team_bootstrap_runs` / `team_bootstrap_steps` journal, calls the existing
 * service functions, and compensates only objects created by that run. Resume
 * skips `done` steps and re-runs preflight; rollback walks completed steps in
 * reverse. A successful run ends with `team doctor`.
 *
 * A single-engineer plan (`mode: "engineer"`) uses the same journal against an
 * existing team; it never re-creates the root, PMs, or repositories.
 */

import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vcs from "@linxiraos/pi-natives/vcs";
import {
	resolveTeamDbPath,
	TeamDb,
	type BootstrapMode,
	type BootstrapRunRecord,
	type BootstrapStepRecord,
	type EngineerRecord,
	type PmRecord,
	type RepoRecord,
} from "./db";
import { diagnoseTeam, type DoctorReport } from "./doctor";
import { TeamError } from "./errors";
import {
	baseRepoPath,
	canonicalPath,
	engineerHomePath,
	integrationBranch,
	pathWithin,
	pmMarkerPath,
	pmWorkspacePath,
	pmsRoot,
	readTeamMarker,
	reposRoot,
	samePath,
	teamMarkerPath,
	worktreesRoot,
	writePmMarker,
	writeTeamMarker,
	TEAM_SCHEMA_VERSION,
} from "./paths";
import {
	addEngineer,
	addPm,
	addRepoClone,
	addRepoLink,
	bindRepo,
	initTeam,
	slugifyTeamName,
	validateSegment,
	type TeamContextOptions,
} from "./service";
import { createRoom } from "./rooms";

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

export interface BootstrapPmInput {
	name: string;
	displayName?: string;
}

export interface BootstrapRepoInput {
	name: string;
	/** Clone URL; mutually exclusive with `link`. */
	clone?: string;
	/** Existing primary checkout path. */
	link?: string;
	/** PMs to bind; defaults to every PM in the plan. */
	bindPms?: string[];
}

export interface BootstrapEngineerInput {
	name: string;
	pm: string;
	repo: string;
	execution?: "normal" | "vibe";
}

export interface BootstrapRoomInput {
	name: string;
	kind?: "pm" | "coordination" | "room";
	pm?: string;
	shared?: boolean;
	members?: string[];
}

export interface BootstrapInput {
	name: string;
	root: string;
	displayName?: string;
	pms: BootstrapPmInput[];
	repos?: BootstrapRepoInput[];
	engineers?: BootstrapEngineerInput[];
	rooms?: BootstrapRoomInput[];
	/** Existing team: only add the listed resources. */
	engineerOnly?: boolean;
}

type NormalizedBootstrapInput = Omit<BootstrapInput, "repos" | "engineers" | "rooms"> & {
	repos: BootstrapRepoInput[];
	engineers: BootstrapEngineerInput[];
	rooms: BootstrapRoomInput[];
};

export type BootstrapStepKind =
	| "init-team"
	| "add-pm"
	| "add-repo-clone"
	| "add-repo-link"
	| "bind-repo"
	| "add-engineer"
	| "create-room";

export interface BootstrapPlanStep {
	stepId: string;
	seq: number;
	kind: BootstrapStepKind;
	description: string;
	payload: Record<string, unknown>;
	createdByRun: boolean;
}

export interface BootstrapCheck {
	id: string;
	ok: boolean;
	detail: string;
	level: "error" | "warning";
}

export interface BootstrapPreflight {
	ok: boolean;
	errors: string[];
	warnings: string[];
	checks: BootstrapCheck[];
}

export interface BootstrapPlan {
	version: 1;
	mode: BootstrapMode;
	teamId: string;
	teamRoot: string;
	displayName: string;
	input: BootstrapInput;
	steps: BootstrapPlanStep[];
	preflight: BootstrapPreflight;
}

export interface BootstrapApplyOptions extends TeamContextOptions {
	runId?: string;
	/** Default true: compensate this run's objects on failure. */
	rollbackOnFailure?: boolean;
	onStep?: (step: BootstrapPlanStep) => void;
}

export interface BootstrapResult {
	run: BootstrapRunRecord;
	steps: BootstrapStepRecord[];
	doctor?: DoctorReport;
}

export interface BootstrapRollbackResult {
	run: BootstrapRunRecord;
	steps: BootstrapStepRecord[];
	errors: string[];
}

interface TeamReadRows {
	teams: Array<{ id: string; rootPath: string }>;
	pms: PmRecord[];
	repos: RepoRecord[];
	bindings: Array<{ repoId: string; pmId: string }>;
	engineers: EngineerRecord[];
	worktrees: Array<{ id: string; repoId: string; pmId: string; engineerId: string; path: string; branch: string }>;
	rooms: Array<{ name: string; kind: string; pmId: string | null }>;
}

function emptyRows(): TeamReadRows {
	return { teams: [], pms: [], repos: [], bindings: [], engineers: [], worktrees: [], rooms: [] };
}

/** Read-only DB facts used by plan/preflight; never migrates or creates a DB. */
function readTeamRows(dbPath: string, teamId?: string): TeamReadRows {
	if (!fs.existsSync(dbPath)) return emptyRows();
	let db: Database;
	try {
		db = new Database(dbPath, { readonly: true });
	} catch {
		return emptyRows();
	}
	try {
		const has = (name: string): boolean =>
			db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== null;
		if (!has("teams")) return emptyRows();
		const rows = emptyRows();
		rows.teams = db
			.query<{ id: string; root_path: string }, []>("SELECT id, root_path FROM teams ORDER BY id")
			.all()
			.map(row => ({ id: row.id, rootPath: row.root_path }));
		if (!teamId) return rows;
		if (has("team_pms")) {
			rows.pms = db
				.query<
					{
						id: string;
						team_id: string;
						name: string;
						workspace_path: string;
						created_at: number;
					},
					[string]
				>("SELECT * FROM team_pms WHERE team_id = ? ORDER BY name")
				.all(teamId)
				.map(row => ({
					id: row.id,
					teamId: row.team_id,
					name: row.name,
					workspacePath: row.workspace_path,
					createdAt: row.created_at,
				}));
		}
		if (has("repos")) {
			rows.repos = db
				.query<
					{
						id: string;
						team_id: string;
						name: string;
						base_path: string;
						remote_url: string | null;
						default_branch: string;
						created_at: number;
					},
					[string]
				>("SELECT * FROM repos WHERE team_id = ? ORDER BY name")
				.all(teamId)
				.map(row => ({
					id: row.id,
					teamId: row.team_id,
					name: row.name,
					basePath: row.base_path,
					remoteUrl: row.remote_url,
					defaultBranch: row.default_branch,
					createdAt: row.created_at,
				}));
		}
		if (has("repo_bindings")) {
			rows.bindings = db
				.query<{ repo_id: string; pm_id: string }, [string]>(
					`SELECT b.repo_id, b.pm_id FROM repo_bindings b
					 JOIN repos r ON r.id = b.repo_id WHERE r.team_id = ?`,
				)
				.all(teamId)
				.map(row => ({ repoId: row.repo_id, pmId: row.pm_id }));
		}
		if (has("engineers")) {
			rows.engineers = db
				.query<
					{
						id: string;
						team_id: string;
						pm_id: string;
						name: string;
						execution: "normal" | "vibe";
						created_at: number;
					},
					[string]
				>("SELECT * FROM engineers WHERE team_id = ? ORDER BY name")
				.all(teamId)
				.map(row => ({
					id: row.id,
					teamId: row.team_id,
					pmId: row.pm_id,
					name: row.name,
					execution: row.execution,
					createdAt: row.created_at,
				}));
		}
		if (has("worktrees")) {
			rows.worktrees = db
				.query<
					{
						id: string;
						repo_id: string;
						pm_id: string;
						engineer_id: string;
						path: string;
						branch: string;
					},
					[string]
				>("SELECT id, repo_id, pm_id, engineer_id, path, branch FROM worktrees WHERE team_id = ?")
				.all(teamId)
				.map(row => ({
					id: row.id,
					repoId: row.repo_id,
					pmId: row.pm_id,
					engineerId: row.engineer_id,
					path: row.path,
					branch: row.branch,
				}));
		}
		if (has("rooms")) {
			rows.rooms = db
				.query<{ name: string; kind: string; pm_id: string | null }, [string]>(
					"SELECT name, kind, pm_id FROM rooms WHERE team_id = ? ORDER BY name",
				)
				.all(teamId)
				.map(row => ({ name: row.name, kind: row.kind, pmId: row.pm_id }));
		}
		return rows;
	} catch {
		return emptyRows();
	} finally {
		db.close();
	}
}

function addCheck(
	checks: BootstrapCheck[],
	errors: string[],
	warnings: string[],
	id: string,
	ok: boolean,
	detail: string,
	level: "error" | "warning" = "error",
): void {
	checks.push({ id, ok, detail, level });
	if (!ok) (level === "warning" ? warnings : errors).push(`${id}: ${detail}`);
}

function uniqueNames<T>(items: readonly T[], name: (item: T) => string): string | undefined {
	const seen = new Set<string>();
	for (const item of items) {
		const value = name(item);
		if (seen.has(value)) return value;
		seen.add(value);
	}
	return undefined;
}

async function inspectLinkRepo(
	link: string,
): Promise<{ ok: true; basePath: string; defaultBranch: string } | { ok: false; error: string }> {
	const requested = path.resolve(link);
	if (!fs.existsSync(requested)) return { ok: false, error: `repository path does not exist: ${requested}` };
	const basePath = canonicalPath(requested);
	const handle = vcs.git(basePath);
	if (!handle) return { ok: false, error: `not a Git repository: ${basePath}` };
	const info = handle.info();
	if (!info.repoRoot || canonicalPath(info.repoRoot) !== basePath) {
		return { ok: false, error: `${basePath} is not a repository root` };
	}
	if (handle.linkedWorktree())
		return { ok: false, error: `${basePath} is a linked worktree; link its primary checkout` };
	const defaultBranch = (await handle.defaultBranch()) ?? (await handle.currentBranch());
	const current = await handle.currentBranch();
	if (!defaultBranch || !current) return { ok: false, error: `${basePath} has no usable branch` };
	if (current !== defaultBranch) {
		return { ok: false, error: `${basePath} is on "${current}", expected default branch "${defaultBranch}"` };
	}
	return { ok: true, basePath, defaultBranch };
}

function directoryNonEmpty(dir: string): boolean {
	try {
		return fs.readdirSync(dir).length > 0;
	} catch {
		return false;
	}
}

function nestedGitEntries(root: string, prefix = ""): string[] {
	const found: string[] = [];
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(root, { withFileTypes: true });
	} catch {
		return found;
	}
	for (const entry of entries) {
		const rel = prefix ? path.join(prefix, entry.name) : entry.name;
		if (entry.name === ".git") {
			found.push(rel);
			continue;
		}
		if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name === "node_modules") continue;
		found.push(...nestedGitEntries(path.join(root, entry.name), rel));
	}
	return found;
}

function normalizeInput(input: BootstrapInput): NormalizedBootstrapInput {
	const pms = input.pms.map(pm => ({ ...pm, name: pm.name.trim() }));
	const repos = (input.repos ?? []).map(repo => ({ ...repo, name: repo.name.trim() }));
	const pmsByName = new Map(pms.map(pm => [pm.name, pm]));
	for (const repo of repos) {
		for (const pm of repo.bindPms ?? []) {
			if (!pmsByName.has(pm)) throw new TeamError(`Repo "${repo.name}" binds unknown PM "${pm}"`);
		}
	}
	const engineers = (input.engineers ?? []).map(engineer => ({
		...engineer,
		name: engineer.name.trim(),
		pm: engineer.pm.trim(),
		repo: engineer.repo.trim(),
	}));
	for (const engineer of engineers) {
		if (!pmsByName.has(engineer.pm))
			throw new TeamError(`Engineer "${engineer.name}" names unknown PM "${engineer.pm}"`);
		if (!repos.some(repo => repo.name === engineer.repo)) {
			throw new TeamError(`Engineer "${engineer.name}" names unknown repo "${engineer.repo}"`);
		}
	}
	const rooms = (input.rooms ?? []).map(room => ({ ...room, name: room.name.trim() }));
	return { ...input, pms, repos, engineers, rooms };
}

/**
 * Build a validated, serializable plan. Reads markers/files/DB but performs no
 * writes; apply is the only step that creates anything.
 */
export async function planTeamBootstrap(
	input: BootstrapInput,
	options: TeamContextOptions = {},
): Promise<BootstrapPlan> {
	const normalized = normalizeInput(input);
	const dbPath = options.dbPath ?? resolveTeamDbPath();
	const checks: BootstrapCheck[] = [];
	const errors: string[] = [];
	const warnings: string[] = [];
	const mode: BootstrapMode = normalized.engineerOnly ? "engineer" : "team";
	const root = canonicalPath(path.resolve(normalized.root));

	let teamId: string;
	let displayName: string;
	if (mode === "team") {
		teamId = slugifyTeamName(normalized.name);
		displayName = normalized.displayName?.trim() || normalized.name.trim();
	} else {
		const marker = await readTeamMarker(root);
		if (!marker) {
			errors.push(`team.marker: no .zeta/team.json at ${root}`);
			teamId = slugifyTeamName(normalized.name);
		} else {
			teamId = marker.teamId;
		}
		displayName = normalized.displayName?.trim() || normalized.name.trim();
	}

	const rows = readTeamRows(dbPath, teamId);
	const existingTeam = rows.teams.find(team => team.id === teamId || canonicalPath(team.rootPath) === root);
	const existingPms = new Map(rows.pms.map(pm => [pm.name, pm]));
	const existingRepos = new Map(rows.repos.map(repo => [repo.name, repo]));
	const existingBindings = new Set(rows.bindings.map(binding => `${binding.repoId}:${binding.pmId}`));
	const existingWorktrees = new Map(rows.worktrees.map(worktree => [worktree.id, worktree]));
	const existingRooms = new Set(rows.rooms.map(room => room.name));

	// Names and local duplicates.
	addCheck(checks, errors, warnings, "name.team", /^[a-z0-9][a-z0-9-]*$/.test(teamId), `team id "${teamId}"`);
	for (const pm of normalized.pms) {
		try {
			validateSegment("PM name", pm.name);
			addCheck(checks, errors, warnings, `name.pm:${pm.name}`, true, "valid");
		} catch (error) {
			addCheck(checks, errors, warnings, `name.pm:${pm.name}`, false, String(error));
		}
	}
	const duplicatePm = uniqueNames(normalized.pms, pm => pm.name);
	addCheck(
		checks,
		errors,
		warnings,
		"plan.pm-unique",
		duplicatePm === undefined,
		duplicatePm ? `duplicate PM "${duplicatePm}"` : "unique",
	);
	const duplicateRepo = uniqueNames(normalized.repos, repo => repo.name);
	addCheck(
		checks,
		errors,
		warnings,
		"plan.repo-unique",
		duplicateRepo === undefined,
		duplicateRepo ? `duplicate repo "${duplicateRepo}"` : "unique",
	);
	const duplicateEngineer = uniqueNames(normalized.engineers, engineer => `${engineer.pm}/${engineer.name}`);
	addCheck(
		checks,
		errors,
		warnings,
		"plan.engineer-unique",
		duplicateEngineer === undefined,
		duplicateEngineer ? `duplicate engineer "${duplicateEngineer}"` : "unique",
	);

	if (mode === "team") {
		addCheck(
			checks,
			errors,
			warnings,
			"team.marker-absent",
			!fs.existsSync(teamMarkerPath(root)),
			`no marker at ${teamMarkerPath(root)}`,
		);
		addCheck(
			checks,
			errors,
			warnings,
			"db.team-absent",
			existingTeam === undefined,
			existingTeam ? `already registered at ${existingTeam.rootPath}` : "not registered",
		);
		const probe = fs.existsSync(root) ? root : path.dirname(root);
		const git = vcs.git(probe);
		addCheck(
			checks,
			errors,
			warnings,
			"root.ownerless.not-git",
			git === null && !fs.existsSync(path.join(root, ".git")),
			git ? `inside Git repository ${git.info().repoRoot}` : "not a Git repository",
		);
		addCheck(
			checks,
			errors,
			warnings,
			"root.ownerless.no-agents-md",
			!fs.existsSync(path.join(root, "AGENTS.md")),
			"no root AGENTS.md",
		);
		const nested = nestedGitEntries(root);
		addCheck(
			checks,
			errors,
			warnings,
			"root.nested-git",
			nested.length === 0,
			nested.length ? `nested Git entries: ${nested.join(", ")}` : "none",
		);
		addCheck(
			checks,
			errors,
			warnings,
			"root.layout-empty",
			!directoryNonEmpty(pmsRoot(root)) &&
				!directoryNonEmpty(reposRoot(root)) &&
				!directoryNonEmpty(worktreesRoot(root)),
			"pms/, repos/, worktrees/ absent or empty",
		);
	} else {
		const marker = await readTeamMarker(root);
		addCheck(
			checks,
			errors,
			warnings,
			"team.marker",
			marker !== null,
			marker ? `team "${marker.teamId}"` : `no .zeta/team.json at ${root}`,
		);
		addCheck(
			checks,
			errors,
			warnings,
			"db.team",
			existingTeam !== undefined,
			existingTeam ? `registered at ${existingTeam.rootPath}` : `no row for "${teamId}"`,
		);
		if (existingTeam && !canonicalPath(existingTeam.rootPath).startsWith(canonicalPath(root))) {
			addCheck(
				checks,
				errors,
				warnings,
				"team.root",
				canonicalPath(existingTeam.rootPath) === root,
				`database root ${existingTeam.rootPath}`,
			);
		}
	}

	for (const pm of normalized.pms) {
		const inDb = existingPms.has(pm.name);
		addCheck(checks, errors, warnings, `plan.pm:${pm.name}`, !inDb, inDb ? "PM already exists" : "new");
		if (mode === "team") {
			addCheck(
				checks,
				errors,
				warnings,
				`plan.pm-path:${pm.name}`,
				!fs.existsSync(pmWorkspacePath(root, pm.name)),
				pmWorkspacePath(root, pm.name),
			);
		}
	}

	for (const repo of normalized.repos) {
		const inDb = existingRepos.has(repo.name);
		addCheck(checks, errors, warnings, `plan.repo:${repo.name}`, !inDb, inDb ? "repo already exists" : "new");
		if (repo.clone && repo.link) {
			addCheck(checks, errors, warnings, `plan.repo-source:${repo.name}`, false, "choose clone or link, not both");
		} else if (repo.clone) {
			addCheck(
				checks,
				errors,
				warnings,
				`plan.repo-dest:${repo.name}`,
				!directoryNonEmpty(baseRepoPath(root, repo.name)),
				baseRepoPath(root, repo.name),
			);
		} else if (repo.link) {
			const inspected = await inspectLinkRepo(repo.link);
			addCheck(
				checks,
				errors,
				warnings,
				`plan.repo-link:${repo.name}`,
				inspected.ok,
				inspected.ok ? inspected.basePath : inspected.error,
			);
			if (inspected.ok && pathWithin(pmsRoot(root), inspected.basePath)) {
				addCheck(
					checks,
					errors,
					warnings,
					`plan.repo-pm-isolation:${repo.name}`,
					false,
					"link path is inside pms/",
				);
			}
		} else {
			addCheck(checks, errors, warnings, `plan.repo-source:${repo.name}`, false, "repo needs clone or link");
		}
		for (const pm of repo.bindPms ?? normalized.pms.map(entry => entry.name)) {
			if (!normalized.pms.some(entry => entry.name === pm)) {
				addCheck(checks, errors, warnings, `plan.bind:${repo.name}:${pm}`, false, `unknown PM "${pm}"`);
				continue;
			}
			const pmRecord = existingPms.get(pm);
			const repoRecord = existingRepos.get(repo.name);
			const bound = pmRecord && repoRecord ? existingBindings.has(`${repoRecord.id}:${pmRecord.id}`) : false;
			addCheck(checks, errors, warnings, `plan.bind:${repo.name}:${pm}`, !bound, bound ? "already bound" : "new");
		}
	}

	for (const engineer of normalized.engineers) {
		const pm = existingPms.get(engineer.pm);
		const repo = existingRepos.get(engineer.repo);
		const worktree =
			pm && repo ? existingWorktrees.get(`${teamId}:${repo.name}:${pm.name}:${engineer.name}:home:home`) : undefined;
		const already = rows.engineers.some(row => row.pmId === pm?.id && row.name === engineer.name);
		addCheck(
			checks,
			errors,
			warnings,
			`plan.engineer:${engineer.pm}/${engineer.name}`,
			!already || worktree === undefined,
			already
				? worktree
					? "engineer and home worktree already exist"
					: "engineer row exists; home worktree will be added"
				: "new",
		);
		if (mode === "engineer") {
			addCheck(
				checks,
				errors,
				warnings,
				`plan.engineer-pm:${engineer.name}`,
				pm !== undefined,
				pm ? pm.name : `PM "${engineer.pm}" not registered`,
			);
			addCheck(
				checks,
				errors,
				warnings,
				`plan.engineer-repo:${engineer.name}`,
				repo !== undefined,
				repo ? repo.name : `repo "${engineer.repo}" not registered`,
			);
			if (pm && repo) {
				addCheck(
					checks,
					errors,
					warnings,
					`plan.engineer-binding:${engineer.name}`,
					existingBindings.has(`${repo.id}:${pm.id}`),
					`${repo.name} bound to ${pm.name}`,
				);
			}
		}
		const home = engineerHomePath(root, engineer.repo, engineer.pm, engineer.name);
		addCheck(checks, errors, warnings, `plan.engineer-path:${engineer.name}`, !fs.existsSync(home), home);
		const branch = integrationBranch(teamId, engineer.pm, engineer.name);
		addCheck(
			checks,
			errors,
			warnings,
			`plan.engineer-branch:${engineer.name}`,
			!rows.worktrees.some(row => row.branch === branch),
			branch,
		);
	}

	for (const room of normalized.rooms) {
		const exists = existingRooms.has(room.name);
		addCheck(checks, errors, warnings, `plan.room:${room.name}`, !exists, exists ? "room already exists" : "new");
	}
	const duplicateRoom = uniqueNames(normalized.rooms, room => room.name);
	addCheck(
		checks,
		errors,
		warnings,
		"plan.room-unique",
		duplicateRoom === undefined,
		duplicateRoom ? `duplicate room "${duplicateRoom}"` : "unique",
	);

	// Default coordination + PM rooms when callers did not specify rooms.
	const roomNames = new Set(normalized.rooms.map(room => room.name));
	const rooms = [...normalized.rooms];
	if (mode === "team") {
		if (!roomNames.has("coordination")) rooms.push({ name: "coordination", shared: true, kind: "coordination" });
		for (const pm of normalized.pms) {
			if (!roomNames.has(pm.name)) rooms.push({ name: pm.name, kind: "pm", pm: pm.name });
		}
	}

	const steps: BootstrapPlanStep[] = [];
	const addStep = (kind: BootstrapStepKind, description: string, payload: Record<string, unknown>): void => {
		const slug = description
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 48);
		const stepId = `${String(steps.length + 1).padStart(3, "0")}-${kind}-${slug}`;
		steps.push({ stepId, seq: steps.length, kind, description, payload, createdByRun: true });
	};
	if (mode === "team") {
		addStep("init-team", `create team root ${root}`, { name: normalized.name, root, displayName });
	}
	for (const pm of normalized.pms)
		addStep("add-pm", `add PM ${pm.name}`, { pm: pm.name, displayName: pm.displayName });
	for (const repo of normalized.repos) {
		if (repo.clone) addStep("add-repo-clone", `clone ${repo.name}`, { repo: repo.name, clone: repo.clone });
		else if (repo.link) addStep("add-repo-link", `link ${repo.name}`, { repo: repo.name, path: repo.link });
		for (const pm of repo.bindPms ?? normalized.pms.map(entry => entry.name)) {
			addStep("bind-repo", `bind ${repo.name} to ${pm}`, { repo: repo.name, pm });
		}
	}
	for (const engineer of normalized.engineers) {
		addStep("add-engineer", `add engineer ${engineer.pm}/${engineer.name}`, {
			name: engineer.name,
			pm: engineer.pm,
			repo: engineer.repo,
			execution: engineer.execution ?? "normal",
		});
	}
	for (const room of rooms) {
		addStep("create-room", `create room ${room.name}`, {
			name: room.name,
			kind: room.kind,
			pm: room.pm,
			shared: room.shared,
			members: room.members,
		});
	}

	return {
		version: 1,
		mode,
		teamId,
		teamRoot: root,
		displayName,
		input: normalized,
		steps,
		preflight: { ok: errors.length === 0, errors, warnings, checks },
	};
}

/** Re-run the plan's checks without writing; returns the current preflight. */
export async function preflightTeamBootstrap(
	plan: BootstrapPlan,
	options: TeamContextOptions = {},
): Promise<BootstrapPreflight> {
	const fresh = await planTeamBootstrap(plan.input, { ...options, dbPath: options.dbPath });
	return fresh.preflight;
}

function requirePreflight(plan: BootstrapPlan): void {
	if (!plan.preflight.ok) {
		throw new TeamError(`Bootstrap preflight failed:\n${plan.preflight.errors.join("\n")}`);
	}
}

async function executeStep(
	step: BootstrapPlanStep,
	plan: BootstrapPlan,
	dbPath: string,
): Promise<Record<string, unknown>> {
	const base = { teamRoot: plan.teamRoot, dbPath };
	const payload = step.payload;
	switch (step.kind) {
		case "init-team": {
			const result = await initTeam({
				name: String(payload.name),
				root: String(payload.root),
				displayName: typeof payload.displayName === "string" ? payload.displayName : undefined,
				dbPath,
			});
			return { teamId: result.teamId };
		}
		case "add-pm": {
			const result = await addPm({
				pm: String(payload.pm),
				displayName: typeof payload.displayName === "string" ? payload.displayName : undefined,
				...base,
			});
			return { pmId: result.pm.id, path: result.pm.workspacePath };
		}
		case "add-repo-clone": {
			const result = await addRepoClone({ repo: String(payload.repo), clone: String(payload.clone), ...base });
			const handle = vcs.git(result.basePath);
			const head = handle ? ((await handle.headSha()) ?? null) : null;
			let entries: string[] = [];
			try {
				entries = fs.readdirSync(result.basePath).sort();
			} catch {
				entries = [];
			}
			return { repoId: result.id, basePath: result.basePath, cloned: true, head, entries };
		}
		case "add-repo-link": {
			const result = await addRepoLink({ repo: String(payload.repo), path: String(payload.path), ...base });
			return { repoId: result.id, basePath: result.basePath, linked: true };
		}
		case "bind-repo": {
			const result = await bindRepo({ repo: String(payload.repo), pm: String(payload.pm), ...base });
			return { repoId: result.repo.id, pmId: result.pm.id };
		}
		case "add-engineer": {
			const db = new TeamDb(dbPath);
			let createdEngineer = false;
			try {
				createdEngineer = db.getEngineer(plan.teamId, String(payload.pm), String(payload.name)) === null;
			} finally {
				db.close();
			}
			const result = await addEngineer({
				name: String(payload.name),
				pm: String(payload.pm),
				repo: String(payload.repo),
				execution: payload.execution === "vibe" ? "vibe" : "normal",
				...base,
			});
			const handle = vcs.git(result.worktree.path);
			const head = handle ? ((await handle.headSha()) ?? null) : null;
			return {
				engineerId: result.engineer.id,
				worktreeId: result.worktree.id,
				worktreePath: result.worktree.path,
				branch: result.worktree.branch,
				repoId: result.worktree.repoId,
				createdEngineer,
				head,
			};
		}
		case "create-room": {
			const result = await createRoom({
				name: String(payload.name),
				kind: typeof payload.kind === "string" ? payload.kind : undefined,
				pm: typeof payload.pm === "string" ? payload.pm : undefined,
				shared: payload.shared === true,
				members: Array.isArray(payload.members) ? payload.members.map(String) : undefined,
				...base,
			});
			return { roomId: result.room.id, members: result.members.length };
		}
	}
}

function listEntries(dir: string): string[] {
	try {
		return fs.readdirSync(dir).sort();
	} catch {
		return [];
	}
}

function removeEmptyDir(dir: string): boolean {
	const entries = listEntries(dir);
	if (entries.length > 0) return false;
	try {
		fs.rmdirSync(dir);
		return true;
	} catch {
		return false;
	}
}

/** Remove a tree without following junctions/symlinks into user data. */
function removeTreeNoFollow(root: string): void {
	for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
		const full = path.join(root, entry.name);
		const stat = fs.lstatSync(full);
		if (stat.isSymbolicLink()) {
			fs.unlinkSync(full);
		} else if (stat.isDirectory()) {
			removeTreeNoFollow(full);
		} else {
			fs.unlinkSync(full);
		}
	}
	fs.rmdirSync(root);
}

function sameEntries(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function preserve(reason: string): never {
	throw new TeamError(`rollback_failed: ${reason}; the database row was kept for manual recovery`);
}

async function compensateStep(step: BootstrapStepRecord, plan: BootstrapPlan, dbPath: string): Promise<void> {
	const payload = step.payload as { result?: Record<string, unknown>; [key: string]: unknown };
	const result = payload.result ?? {};
	const db = new TeamDb(dbPath);
	try {
		switch (step.kind) {
			case "create-room": {
				const roomId =
					typeof result.roomId === "string"
						? result.roomId
						: db.getRoom(plan.teamId, String(payload.name ?? ""))?.id;
				if (roomId) db.deleteRoom(roomId);
				break;
			}
			case "bind-repo": {
				const repoId =
					typeof result.repoId === "string"
						? result.repoId
						: db.getRepo(plan.teamId, String(payload.repo ?? ""))?.id;
				const pmId =
					typeof result.pmId === "string" ? result.pmId : db.getPm(plan.teamId, String(payload.pm ?? ""))?.id;
				if (repoId && pmId) db.deleteBinding(repoId, pmId);
				break;
			}
			case "add-repo-link": {
				const repo =
					typeof result.repoId === "string"
						? db.getRepoById(result.repoId)
						: db.getRepo(plan.teamId, String(payload.repo ?? ""));
				if (!repo) break;
				const breadcrumb = path.join(repo.basePath, ".zeta", "team-member.json");
				if (fs.existsSync(breadcrumb)) {
					let matches = false;
					try {
						const marker = JSON.parse(fs.readFileSync(breadcrumb, "utf8")) as {
							teamId?: string;
							teamRoot?: string;
						};
						matches = marker.teamId === plan.teamId && canonicalPath(marker.teamRoot ?? "") === plan.teamRoot;
					} catch {
						matches = false;
					}
					if (!matches) preserve(`breadcrumb ${breadcrumb} changed after bootstrap`);
					fs.rmSync(breadcrumb, { force: true });
				}
				db.deleteRepo(repo.id);
				break;
			}
			case "add-repo-clone": {
				if (typeof result.repoId !== "string") preserve("clone has no journal fingerprint");
				const repo = db.getRepoById(result.repoId);
				if (!repo) break;
				if (!fs.existsSync(repo.basePath)) {
					db.deleteRepo(result.repoId);
					break;
				}
				const handle = vcs.git(repo.basePath);
				if (!handle) preserve(`clone ${repo.basePath} is no longer a Git repository`);
				const status = await handle.statusSummary();
				const head = await handle.headSha();
				const entries = listEntries(repo.basePath);
				const expectedEntries = Array.isArray(result.entries) ? result.entries.map(String) : undefined;
				const expectedHead = typeof result.head === "string" ? result.head : undefined;
				if (status.staged + status.unstaged + status.untracked > 0) {
					preserve(`clone ${repo.basePath} contains user changes`);
				}
				if (expectedHead && head !== expectedHead) preserve(`clone ${repo.basePath} HEAD moved`);
				if (expectedEntries && !sameEntries(entries, expectedEntries)) {
					preserve(`clone ${repo.basePath} gained files after bootstrap`);
				}
				removeTreeNoFollow(repo.basePath);
				db.deleteRepo(repo.id);
				break;
			}
			case "add-engineer": {
				let worktreeId = typeof result.worktreeId === "string" ? result.worktreeId : undefined;
				let repo = typeof result.repoId === "string" ? db.getRepoById(result.repoId) : null;
				let worktreePath = typeof result.worktreePath === "string" ? result.worktreePath : undefined;
				let branch = typeof result.branch === "string" ? result.branch : undefined;
				if (!worktreeId) {
					const pm = db.getPm(plan.teamId, String(payload.pm ?? ""));
					const engineer = pm ? db.getEngineer(plan.teamId, pm.name, String(payload.name ?? "")) : null;
					const home = engineer
						? db.listWorktrees(plan.teamId).find(row => row.engineerId === engineer.id && row.kind === "home")
						: undefined;
					repo = home ? db.getRepoById(home.repoId) : repo;
					worktreeId = home?.id;
					worktreePath = home?.path;
					branch = home?.branch;
				}
				if (!worktreeId || !repo || !worktreePath || !branch) break;
				if (typeof result.head !== "string") {
					preserve(`worktree ${worktreePath} has no journal fingerprint`);
				}
				const handle = vcs.git(repo.basePath);
				if (!handle) preserve(`base repository ${repo.basePath} is missing`);
				if (!fs.existsSync(worktreePath)) {
					const deleted = await handle.deleteBranch(branch, false);
					if (!deleted) preserve(`worktree ${worktreePath} is missing but branch ${branch} could not be deleted`);
					db.deleteWorktree(worktreeId);
					if (result.createdEngineer === true && typeof result.engineerId === "string") {
						db.deleteEngineer(result.engineerId);
					}
					break;
				}
				const worktree = vcs.git(worktreePath);
				if (!worktree) preserve(`worktree ${worktreePath} is no longer a Git checkout`);
				const status = await worktree.statusSummary();
				const head = await worktree.headSha();
				const expectedHead = typeof result.head === "string" ? result.head : undefined;
				if (status.staged + status.unstaged + status.untracked > 0) {
					preserve(`worktree ${worktreePath} contains user changes`);
				}
				if (expectedHead && head !== expectedHead) {
					preserve(`worktree ${worktreePath} HEAD moved`);
				}
				const removed = await handle.worktreeRemove(worktreePath, false);
				if (!removed) preserve(`git refused to remove clean worktree ${worktreePath}`);
				const deletedBranch = await handle.deleteBranch(branch, false);
				if (!deletedBranch) preserve(`branch ${branch} could not be deleted after removing its worktree`);
				db.deleteWorktree(worktreeId);
				if (result.createdEngineer === true && typeof result.engineerId === "string") {
					db.deleteEngineer(result.engineerId);
				}
				break;
			}
			case "add-pm": {
				const pm =
					typeof result.pmId === "string"
						? db.getPmById(result.pmId)
						: db.getPm(plan.teamId, String(payload.pm ?? ""));
				if (!pm) break;
				const marker = pmMarkerPath(pm.workspacePath);
				fs.rmSync(marker, { force: true });
				removeEmptyDir(path.join(pm.workspacePath, "notes"));
				removeEmptyDir(path.join(pm.workspacePath, "links"));
				if (!removeEmptyDir(pm.workspacePath)) {
					preserve(`PM workspace ${pm.workspacePath} contains files created after bootstrap`);
				}
				db.deletePm(pm.id);
				break;
			}
			case "init-team": {
				const team = db.getTeam(plan.teamId);
				if (!team) {
					fs.rmSync(teamMarkerPath(plan.teamRoot), { force: true });
					break;
				}
				if (!fs.existsSync(plan.teamRoot)) {
					db.deleteTeam(plan.teamId);
					break;
				}
				const allowed = new Set([".zeta", "pms", "repos", "worktrees"]);
				const unexpected = listEntries(plan.teamRoot).filter(entry => !allowed.has(entry));
				if (unexpected.length > 0) {
					preserve(`team root ${plan.teamRoot} contains files created after bootstrap: ${unexpected.join(", ")}`);
				}
				for (const dir of [pmsRoot(plan.teamRoot), reposRoot(plan.teamRoot), worktreesRoot(plan.teamRoot)]) {
					if (!removeEmptyDir(dir)) preserve(`${dir} is not empty; child steps did not roll back cleanly`);
				}
				fs.rmSync(teamMarkerPath(plan.teamRoot), { force: true });
				removeEmptyDir(path.dirname(teamMarkerPath(plan.teamRoot)));
				if (!removeEmptyDir(plan.teamRoot)) {
					preserve(`team root ${plan.teamRoot} contains files created after bootstrap`);
				}
				db.deleteTeam(plan.teamId);
				break;
			}
		}
	} finally {
		db.close();
	}
}

/**
 * Preflight only the steps that still need work. Existing matching objects are
 * adoptable (crash between execute and journal done); mismatched objects fail.
 */
async function preflightRemaining(
	plan: BootstrapPlan,
	steps: readonly BootstrapStepRecord[],
	dbPath: string,
): Promise<void> {
	const rows = readTeamRows(dbPath, plan.teamId);
	const errors: string[] = [];
	const check = (id: string, ok: boolean, detail: string): void => {
		if (!ok) errors.push(`${id}: ${detail}`);
	};
	for (const step of steps) {
		if (step.status === "done") continue;
		const payload = step.payload as Record<string, unknown>;
		switch (step.kind as BootstrapStepKind) {
			case "init-team": {
				const marker = await readTeamMarker(plan.teamRoot);
				const team = rows.teams.find(row => row.id === plan.teamId);
				if (marker || team) {
					check(
						`apply.init-team:${step.stepId}`,
						marker?.teamId === plan.teamId && team !== undefined && samePath(team.rootPath, plan.teamRoot),
						"root/DB belong to a different team or path",
					);
				} else {
					check(
						`apply.init-team:${step.stepId}`,
						!fs.existsSync(teamMarkerPath(plan.teamRoot)),
						"marker appeared",
					);
				}
				break;
			}
			case "add-pm": {
				const name = String(payload.pm);
				const existing = rows.pms.find(pm => pm.name === name);
				if (existing) {
					check(
						`apply.pm:${name}`,
						samePath(existing.workspacePath, pmWorkspacePath(plan.teamRoot, name)),
						"registered PM path differs from plan",
					);
				} else {
					check(`apply.pm:${name}`, !fs.existsSync(pmWorkspacePath(plan.teamRoot, name)), "PM path appeared");
				}
				break;
			}
			case "add-repo-clone":
			case "add-repo-link": {
				const name = String(payload.repo);
				const existing = rows.repos.find(repo => repo.name === name);
				const expected =
					step.kind === "add-repo-link" && typeof payload.path === "string"
						? canonicalPath(path.resolve(payload.path))
						: baseRepoPath(plan.teamRoot, name);
				if (existing) {
					check(
						`apply.repo:${name}`,
						samePath(existing.basePath, expected),
						"registered repo path differs from plan",
					);
				} else if (step.kind === "add-repo-clone") {
					check(`apply.repo:${name}`, !directoryNonEmpty(expected), "clone destination is not empty");
				} else if (typeof payload.path === "string") {
					const inspected = await inspectLinkRepo(payload.path);
					check(`apply.repo:${name}`, inspected.ok, inspected.ok ? inspected.basePath : inspected.error);
				}
				break;
			}
			case "bind-repo":
				// Both endpoint rows are created by earlier steps or already exist;
				// an existing binding is adoptable and a missing one is created.
				break;
			case "add-engineer": {
				const name = String(payload.name);
				const pmName = String(payload.pm);
				const repoName = String(payload.repo);
				const engineer = rows.engineers.find(row => row.name === name && row.pmId === `${plan.teamId}:${pmName}`);
				const home = rows.worktrees.find(
					row =>
						row.engineerId === engineer?.id &&
						row.path === engineerHomePath(plan.teamRoot, repoName, pmName, name),
				);
				const branch = integrationBranch(plan.teamId, pmName, name);
				if (home) {
					check(
						`apply.engineer:${pmName}/${name}`,
						fs.existsSync(home.path),
						"registered home worktree is missing",
					);
				} else {
					check(
						`apply.engineer-path:${name}`,
						!fs.existsSync(engineerHomePath(plan.teamRoot, repoName, pmName, name)),
						"engineer path appeared",
					);
					check(
						`apply.engineer-branch:${name}`,
						!rows.worktrees.some(row => row.branch === branch),
						"branch appeared",
					);
				}
				break;
			}
			case "create-room": {
				const name = String(payload.name);
				check(
					`apply.room:${name}`,
					!rows.rooms.some(room => room.name === name) || rows.rooms.some(room => room.name === name),
					"room exists",
				);
				break;
			}
		}
	}
	if (errors.length > 0) throw new TeamError(`Bootstrap resume preflight failed:\n${errors.join("\n")}`);
}

/** Adopt a step whose service call succeeded before the journal `done` write. */
async function adoptStep(
	step: BootstrapPlanStep,
	plan: BootstrapPlan,
	dbPath: string,
	runCreatedAt: number,
): Promise<Record<string, unknown> | null> {
	const db = new TeamDb(dbPath);
	try {
		const payload = step.payload as Record<string, unknown>;
		switch (step.kind) {
			case "init-team": {
				const team = db.getTeam(plan.teamId);
				if (!team || !samePath(team.rootPath, plan.teamRoot)) return null;
				if (!fs.existsSync(teamMarkerPath(plan.teamRoot))) {
					for (const dir of [pmsRoot(plan.teamRoot), reposRoot(plan.teamRoot), worktreesRoot(plan.teamRoot)]) {
						fs.mkdirSync(dir, { recursive: true });
					}
					await writeTeamMarker(plan.teamRoot, {
						schemaVersion: TEAM_SCHEMA_VERSION,
						kind: "team",
						teamId: plan.teamId,
						name: plan.displayName,
					});
				}
				return { teamId: plan.teamId };
			}
			case "add-pm": {
				const name = String(payload.pm);
				const pm = db.getPm(plan.teamId, name);
				if (!pm) return null;
				if (!fs.existsSync(pmMarkerPath(pm.workspacePath))) {
					fs.mkdirSync(path.join(pm.workspacePath, "notes"), { recursive: true });
					fs.mkdirSync(path.join(pm.workspacePath, "links"), { recursive: true });
					await writePmMarker(pm.workspacePath, {
						schemaVersion: TEAM_SCHEMA_VERSION,
						kind: "pm",
						teamId: plan.teamId,
						pmId: pm.name,
						name: typeof payload.displayName === "string" ? payload.displayName : pm.name,
					});
				}
				return { pmId: pm.id, path: pm.workspacePath };
			}
			case "add-repo-clone":
			case "add-repo-link": {
				const repo = db.getRepo(plan.teamId, String(payload.repo));
				if (!repo) return null;
				if (step.kind === "add-repo-clone") {
					const handle = vcs.git(repo.basePath);
					const head = handle ? ((await handle.headSha()) ?? null) : null;
					return {
						repoId: repo.id,
						basePath: repo.basePath,
						cloned: true,
						head,
						entries: listEntries(repo.basePath),
					};
				}
				return { repoId: repo.id, basePath: repo.basePath, linked: true };
			}
			case "bind-repo": {
				const repo = db.getRepo(plan.teamId, String(payload.repo));
				const pm = db.getPm(plan.teamId, String(payload.pm));
				if (!repo || !pm || !db.getBinding(repo.id, pm.id)) return null;
				return { repoId: repo.id, pmId: pm.id };
			}
			case "add-engineer": {
				const name = String(payload.name);
				const pm = db.getPm(plan.teamId, String(payload.pm));
				const repo = db.getRepo(plan.teamId, String(payload.repo));
				const engineer = pm ? db.getEngineer(plan.teamId, pm.name, name) : null;
				if (!repo || !engineer) return null;
				const home = db
					.listWorktrees(plan.teamId)
					.find(row => row.engineerId === engineer.id && row.kind === "home" && row.repoId === repo.id);
				if (!home || !fs.existsSync(home.path)) return null;
				const handle = vcs.git(home.path);
				const head = handle ? ((await handle.headSha()) ?? null) : null;
				return {
					engineerId: engineer.id,
					worktreeId: home.id,
					worktreePath: home.path,
					branch: home.branch,
					repoId: home.repoId,
					createdEngineer: engineer.createdAt >= runCreatedAt - 1,
					head,
				};
			}
			case "create-room": {
				const room = db.getRoom(plan.teamId, String(payload.name));
				return room ? { roomId: room.id, members: db.listRoomMembers(room.id).length } : null;
			}
		}
	} finally {
		db.close();
	}
}

async function runPlan(
	plan: BootstrapPlan,
	options: BootstrapApplyOptions,
	run: BootstrapRunRecord,
): Promise<BootstrapResult> {
	const dbPath = options.dbPath ?? resolveTeamDbPath();
	const db = new TeamDb(dbPath);
	let steps: BootstrapStepRecord[];
	try {
		steps = db.listBootstrapSteps(run.runId);
	} finally {
		db.close();
	}
	if (steps.length === 0) {
		const connection = new TeamDb(dbPath);
		try {
			for (const step of plan.steps) {
				connection.insertBootstrapStep({
					runId: run.runId,
					stepId: step.stepId,
					seq: step.seq,
					kind: step.kind,
					status: "planned",
					payload: step.payload,
					createdAt: 0,
					updatedAt: 0,
					error: null,
				});
			}
			steps = connection.listBootstrapSteps(run.runId);
		} finally {
			connection.close();
		}
	}
	const setRun = (fields: { status?: BootstrapRunRecord["status"]; error?: string; teamId?: string }): void => {
		const connection = new TeamDb(dbPath);
		try {
			connection.updateBootstrapRun(run.runId, fields);
			run = { ...run, ...fields };
		} finally {
			connection.close();
		}
	};
	try {
		await preflightRemaining(plan, steps, dbPath);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		setRun({ status: "failed", error: message });
		throw error;
	}
	setRun({ status: "running", error: "" });

	for (const stepRecord of steps) {
		if (stepRecord.status === "done") continue;
		const step = plan.steps.find(candidate => candidate.stepId === stepRecord.stepId) ?? {
			stepId: stepRecord.stepId,
			seq: stepRecord.seq,
			kind: stepRecord.kind as BootstrapStepKind,
			description: stepRecord.kind,
			payload: stepRecord.payload as Record<string, unknown>,
			createdByRun: true,
		};
		const adopted = await adoptStep(step, plan, dbPath, run.createdAt);
		if (adopted) {
			const update = new TeamDb(dbPath);
			try {
				update.updateBootstrapStep(run.runId, step.stepId, {
					status: "done",
					payload: { ...step.payload, result: adopted },
					error: "",
				});
			} finally {
				update.close();
			}
			continue;
		}
		const connection = new TeamDb(dbPath);
		try {
			connection.updateBootstrapStep(run.runId, step.stepId, { status: "running", error: "" });
		} finally {
			connection.close();
		}
		try {
			options.onStep?.(step);
			const result = await executeStep(step, plan, dbPath);
			const update = new TeamDb(dbPath);
			try {
				update.updateBootstrapStep(run.runId, step.stepId, {
					status: "done",
					payload: { ...step.payload, result },
					error: "",
				});
			} finally {
				update.close();
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const failed = new TeamDb(dbPath);
			try {
				failed.updateBootstrapStep(run.runId, step.stepId, { status: "failed", error: message });
			} finally {
				failed.close();
			}
			const rollback = options.rollbackOnFailure ?? true;
			if (rollback) {
				const recovered = await rollbackBootstrapRun(run.runId, { dbPath });
				return { run: recovered.run, steps: recovered.steps, doctor: undefined };
			}
			setRun({ status: "failed", error: message });
			throw new TeamError(`Bootstrap run ${run.runId} failed: ${message}`);
		}
	}

	let doctor: DoctorReport | undefined;
	try {
		doctor = await diagnoseTeam({ teamRoot: plan.teamRoot, dbPath });
		if (!doctor.ok) {
			const details = doctor.checks
				.filter(check => !check.ok && check.level === "error")
				.map(check => `${check.id}: ${check.detail}`)
				.join("\n");
			throw new TeamError(`Team doctor failed after bootstrap:\n${details}`);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (options.rollbackOnFailure ?? true) {
			const recovered = await rollbackBootstrapRun(run.runId, { dbPath });
			return { run: recovered.run, steps: recovered.steps, doctor: undefined };
		}
		setRun({ status: "failed", error: message });
		throw new TeamError(`Bootstrap run ${run.runId} failed: ${message}`);
	}
	setRun({ status: "done", error: "", teamId: plan.teamId });
	const finalDb = new TeamDb(dbPath);
	try {
		steps = finalDb.listBootstrapSteps(run.runId);
	} finally {
		finalDb.close();
	}
	const finalRun = new TeamDb(dbPath);
	try {
		return { run: finalRun.getBootstrapRun(run.runId) ?? run, steps, doctor };
	} finally {
		finalRun.close();
	}
}

export async function applyTeamBootstrap(
	plan: BootstrapPlan,
	options: BootstrapApplyOptions = {},
): Promise<BootstrapResult> {
	const dbPath = options.dbPath ?? resolveTeamDbPath();
	// Re-plan immediately before the first write: the caller's plan may be stale
	// (TOCTOU), and apply must use the current filesystem/DB facts.
	const fresh = await planTeamBootstrap(plan.input, { ...options, dbPath });
	requirePreflight(fresh);
	const run: BootstrapRunRecord = {
		runId: options.runId ?? `bootstrap-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
		teamId: fresh.teamId,
		rootPath: fresh.teamRoot,
		mode: fresh.mode,
		status: "planned",
		plan: fresh.input,
		createdAt: nowSeconds(),
		updatedAt: nowSeconds(),
		error: null,
	};
	const db = new TeamDb(dbPath);
	try {
		db.insertBootstrapRun(run);
	} finally {
		db.close();
	}
	return runPlan(fresh, options, run);
}

export async function resumeTeamBootstrap(
	runId: string,
	options: BootstrapApplyOptions = {},
): Promise<BootstrapResult> {
	const dbPath = options.dbPath ?? resolveTeamDbPath();
	const lookup = new TeamDb(dbPath);
	let run: BootstrapRunRecord | null;
	try {
		run = lookup.getBootstrapRun(runId);
	} finally {
		lookup.close();
	}
	if (!run) throw new TeamError(`Unknown bootstrap run "${runId}"`);
	if (run.status === "done") {
		const final = new TeamDb(dbPath);
		try {
			return {
				run,
				steps: final.listBootstrapSteps(runId),
				doctor: await diagnoseTeam({ teamRoot: run.rootPath, dbPath }),
			};
		} finally {
			final.close();
		}
	}
	const plan = await planTeamBootstrap(run.plan as BootstrapInput, { dbPath });
	if (run.status === "compensated" || run.status === "rolled_back") {
		const reset = new TeamDb(dbPath);
		try {
			for (const step of reset.listBootstrapSteps(runId)) {
				reset.updateBootstrapStep(runId, step.stepId, { status: "planned", error: "" });
			}
			reset.updateBootstrapRun(runId, { status: "planned", error: "" });
		} finally {
			reset.close();
		}
		const fresh = new TeamDb(dbPath);
		try {
			run = fresh.getBootstrapRun(runId) ?? run;
		} finally {
			fresh.close();
		}
	}
	return runPlan(plan, { ...options, dbPath }, { ...run, status: "planned" });
}

export async function rollbackBootstrapRun(
	runId: string,
	options: BootstrapApplyOptions = {},
): Promise<BootstrapRollbackResult> {
	const dbPath = options.dbPath ?? resolveTeamDbPath();
	const db = new TeamDb(dbPath);
	let run = db.getBootstrapRun(runId);
	let steps = db.listBootstrapSteps(runId);
	db.close();
	if (!run) throw new TeamError(`Unknown bootstrap run "${runId}"`);
	const plan: BootstrapPlan = {
		version: 1,
		mode: run.mode,
		teamId: run.teamId ?? "",
		teamRoot: run.rootPath,
		displayName: run.teamId ?? "",
		input: run.plan as BootstrapInput,
		steps: [],
		preflight: { ok: true, errors: [], warnings: [], checks: [] },
	};
	const errors: string[] = [];
	for (const step of [...steps].reverse()) {
		if (step.status !== "done" && step.status !== "failed" && step.status !== "running") continue;
		try {
			await compensateStep(step, plan, dbPath);
			const update = new TeamDb(dbPath);
			try {
				update.updateBootstrapStep(runId, step.stepId, { status: "compensated", error: "" });
			} finally {
				update.close();
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			errors.push(`${step.stepId}: ${message}`);
			const update = new TeamDb(dbPath);
			try {
				update.updateBootstrapStep(runId, step.stepId, { status: "failed", error: message });
			} finally {
				update.close();
			}
		}
	}
	const final = new TeamDb(dbPath);
	try {
		final.updateBootstrapRun(runId, {
			status: errors.length === 0 ? "compensated" : "failed",
			error: errors.length === 0 ? "" : errors.join("\n"),
		});
		return {
			run: final.getBootstrapRun(runId) as BootstrapRunRecord,
			steps: final.listBootstrapSteps(runId),
			errors,
		};
	} finally {
		final.close();
	}
}

export function listBootstrapRuns(teamRoot: string, options: TeamContextOptions = {}): BootstrapRunRecord[] {
	const db = new TeamDb(options.dbPath ?? resolveTeamDbPath());
	try {
		return db.listBootstrapRuns(canonicalPath(teamRoot));
	} finally {
		db.close();
	}
}
