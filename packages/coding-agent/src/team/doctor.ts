/**
 * `zetacode team doctor`: validate the ownerless team root, PM workspaces,
 * canonical base repositories, database rows, and linked worktrees.
 *
 * Doctor reports drift; it never repairs. Database rows are authoritative, so
 * a marker or directory that has no row is an error, and so is a row whose
 * filesystem object is missing or has the wrong shape.
 */

import { getProjectDir } from "@linxiraos/pi-utils/dirs";
import type { VcsGitRepo } from "@linxiraos/pi-natives";
import * as vcs from "@linxiraos/pi-natives/vcs";
import * as fs from "node:fs";
import * as path from "node:path";
import { resolveTeamDbPath, TeamDb, type RepoRecord } from "./db";
import { TeamError } from "./errors";
import {
	baseRepoPath,
	canonicalPath,
	engineerHomePath,
	integrationBranch,
	parsePmMarker,
	parseTeamMemberMarker,
	parseTeamMarker,
	pmMarkerPath,
	pmWorkspacePath,
	pmsRoot,
	reposRoot,
	resolveTeamLocation,
	samePath,
	taskBranch,
	taskWorktreePath,
	teamMarkerPath,
	teamMemberMarkerPath,
	type TeamMarker,
} from "./paths";

export type DoctorLevel = "error" | "warning";

export interface DoctorCheck {
	id: string;
	level: DoctorLevel;
	ok: boolean;
	detail: string;
}

export interface DoctorReport {
	teamRoot: string | null;
	teamId?: string;
	ok: boolean;
	checks: DoctorCheck[];
}

export interface DoctorOptions {
	teamRoot?: string;
	cwd?: string;
	dbPath?: string;
}

class Doctor {
	readonly checks: DoctorCheck[] = [];

	add(id: string, ok: boolean, detail: string, level: DoctorLevel = "error"): void {
		this.checks.push({ id, level, ok, detail });
	}

	fail(id: string, detail: string, level: DoctorLevel = "error"): void {
		this.add(id, false, detail, level);
	}

	get ok(): boolean {
		return !this.checks.some(check => !check.ok && check.level === "error");
	}
}

/** Recursively list `.git` entries below `root` (does not follow symlinks). */
async function findNestedGitEntries(root: string, prefix = ""): Promise<string[]> {
	const found: string[] = [];
	let entries: fs.Dirent[];
	try {
		entries = await fs.promises.readdir(root, { withFileTypes: true });
	} catch {
		return found;
	}
	for (const entry of entries) {
		const rel = prefix ? path.join(prefix, entry.name) : entry.name;
		if (entry.name === ".git") {
			found.push(rel);
			continue;
		}
		if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
		if (entry.name === "node_modules") continue;
		found.push(...(await findNestedGitEntries(path.join(root, entry.name), rel)));
	}
	return found;
}

/** List linked-worktree roots below `root` (a worktree root has a `.git` file). */
async function findLinkedWorktrees(root: string): Promise<string[]> {
	const found: string[] = [];
	let entries: fs.Dirent[];
	try {
		entries = await fs.promises.readdir(root, { withFileTypes: true });
	} catch {
		return found;
	}
	for (const entry of entries) {
		if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name === "node_modules") continue;
		const child = path.join(root, entry.name);
		const gitEntry = path.join(child, ".git");
		if (fs.existsSync(gitEntry)) {
			found.push(child);
			continue;
		}
		found.push(...(await findLinkedWorktrees(child)));
	}
	return found;
}

async function listDirectories(root: string): Promise<string[]> {
	try {
		const entries = await fs.promises.readdir(root, { withFileTypes: true });
		return entries.filter(entry => entry.isDirectory() && !entry.isSymbolicLink()).map(entry => entry.name);
	} catch {
		return [];
	}
}

async function checkTeamRoot(doctor: Doctor, teamRoot: string): Promise<TeamMarker | null> {
	let marker: TeamMarker | null = null;
	try {
		const markerPath = teamMarkerPath(teamRoot);
		if (!fs.existsSync(markerPath)) {
			doctor.fail("team.marker", `Missing ownerless team marker: ${markerPath}`);
		} else {
			marker = parseTeamMarker(await Bun.file(markerPath).json(), markerPath);
			doctor.add("team.marker", true, `teamId "${marker.teamId}" · name "${marker.name}"`);
		}
	} catch (error) {
		doctor.fail("team.marker", error instanceof Error ? error.message : String(error));
	}

	const git = vcs.git(teamRoot);
	doctor.add(
		"team.ownerless.not-git",
		git === null && !fs.existsSync(path.join(teamRoot, ".git")),
		git ? `Team root is inside a Git repository (${git.info().repoRoot}); it must not be` : "not a Git repository",
	);
	doctor.add(
		"team.ownerless.no-agents-md",
		!fs.existsSync(path.join(teamRoot, "AGENTS.md")),
		fs.existsSync(path.join(teamRoot, "AGENTS.md"))
			? "Team root has AGENTS.md; the root must carry no automatic agent instructions"
			: "no AGENTS.md at the team root",
	);
	return marker;
}

async function checkBaseRepo(
	doctor: Doctor,
	teamRoot: string,
	teamId: string,
	repo: RepoRecord,
	pmsDir: string,
): Promise<VcsGitRepo | null> {
	const expected = baseRepoPath(teamRoot, repo.name);
	if (!fs.existsSync(repo.basePath)) {
		doctor.fail(`repo.path:${repo.name}`, `Missing base repository path: ${repo.basePath}`);
		return null;
	}
	const handle = vcs.git(repo.basePath);
	if (!handle) {
		doctor.fail(`repo.git:${repo.name}`, `Base repository is not a Git repository: ${repo.basePath}`);
		return null;
	}
	const linked = handle.linkedWorktree();
	doctor.add(
		`repo.primary:${repo.name}`,
		linked === null,
		linked === null ? "primary checkout" : "Base repository is a linked worktree, not a primary checkout",
	);
	const info = handle.info();
	doctor.add(
		`repo.root:${repo.name}`,
		samePath(info.repoRoot, repo.basePath),
		samePath(info.repoRoot, repo.basePath)
			? `repository root ${info.repoRoot}`
			: `${repo.basePath} resolves to repository root ${info.repoRoot}`,
	);
	const insideTeamRepos = repo.basePath.startsWith(`${canonicalPath(reposRoot(teamRoot))}${path.sep}`);
	if (insideTeamRepos) {
		doctor.add(
			`repo.convention:${repo.name}`,
			samePath(repo.basePath, expected),
			samePath(repo.basePath, expected)
				? `canonical path ${expected}`
				: `Base repos under repos/ must live at ${expected}, found ${repo.basePath}`,
		);
	} else {
		doctor.add(`repo.convention:${repo.name}`, true, `linked external repository ${repo.basePath}`, "warning");
	}
	if (repo.basePath.startsWith(`${canonicalPath(pmsDir)}${path.sep}`)) {
		doctor.fail(`repo.pm-isolation:${repo.name}`, `Base repository is inside pms/: ${repo.basePath}`);
	}
	const current = await handle.currentBranch();
	doctor.add(
		`repo.branch:${repo.name}`,
		current === repo.defaultBranch,
		current === repo.defaultBranch
			? `on default branch "${current}"`
			: `Base repo is on "${current ?? "(detached)"}", expected "${repo.defaultBranch}"`,
	);

	const breadcrumbPath = teamMemberMarkerPath(repo.basePath);
	if (fs.existsSync(breadcrumbPath)) {
		try {
			const breadcrumb = parseTeamMemberMarker(await Bun.file(breadcrumbPath).json(), breadcrumbPath);
			doctor.add(
				`repo.breadcrumb:${repo.name}`,
				breadcrumb.teamId === teamId &&
					breadcrumb.repoName === repo.name &&
					samePath(breadcrumb.teamRoot, teamRoot),
				breadcrumb.teamId === teamId && breadcrumb.repoName === repo.name && samePath(breadcrumb.teamRoot, teamRoot)
					? "team-member breadcrumb matches this team"
					: `breadcrumb names team "${breadcrumb.teamId}", repo "${breadcrumb.repoName}", root ${breadcrumb.teamRoot}`,
			);
		} catch (error) {
			doctor.fail(`repo.breadcrumb:${repo.name}`, error instanceof Error ? error.message : String(error), "warning");
		}
	} else {
		doctor.fail(
			`repo.breadcrumb:${repo.name}`,
			"No .zeta/team-member.json breadcrumb (external checkouts cannot resolve this team offline)",
			"warning",
		);
	}
	return handle;
}

/**
 * Validate one team. `ok` is false only for error-level checks; warnings are
 * reported but do not fail the command.
 */
export async function diagnoseTeam(options: DoctorOptions = {}): Promise<DoctorReport> {
	const doctor = new Doctor();
	let teamRoot: string | null = options.teamRoot ? canonicalPath(options.teamRoot) : null;
	if (!teamRoot) {
		const location = await resolveTeamLocation(options.cwd ?? getProjectDir());
		teamRoot = location?.teamRoot ?? null;
	}
	if (!teamRoot) {
		return {
			teamRoot: null,
			ok: false,
			checks: [
				{
					id: "team.marker",
					level: "error",
					ok: false,
					detail: "No .zeta/team.json found from the current directory",
				},
			],
		};
	}

	await checkTeamRoot(doctor, teamRoot);
	let teamId: string | undefined;
	const db = new TeamDb(options.dbPath ?? resolveTeamDbPath());
	try {
		const markerPath = teamMarkerPath(teamRoot);
		let markerTeamId: string | undefined;
		if (fs.existsSync(markerPath)) {
			try {
				markerTeamId = parseTeamMarker(await Bun.file(markerPath).json(), markerPath).teamId;
			} catch {
				markerTeamId = undefined;
			}
		}
		teamId = markerTeamId;
		const team = teamId ? db.getTeam(teamId) : null;
		doctor.add(
			"db.team",
			team !== null && samePath(team.rootPath, teamRoot),
			team
				? samePath(team.rootPath, teamRoot)
					? `registered at ${team.rootPath}`
					: `Database registers team "${team.id}" at ${team.rootPath}, marker resolves to ${teamRoot}`
				: `No database row for team "${teamId ?? "(unreadable marker)"}" in ${resolveTeamDbPath()}`,
		);
		if (!team) {
			return { teamRoot, teamId, ok: doctor.ok, checks: doctor.checks };
		}

		const pmsDir = pmsRoot(teamRoot);
		const pms = db.listPms(team.id);
		const pmIds = new Set(pms.map(pm => pm.name));
		for (const pm of pms) {
			const expected = pmWorkspacePath(teamRoot, pm.name);
			const exists = fs.existsSync(expected);
			doctor.add(`pm.dir:${pm.name}`, exists, exists ? expected : `Missing PM workspace: ${expected}`);
			doctor.add(
				`pm.path:${pm.name}`,
				samePath(pm.workspacePath, expected),
				samePath(pm.workspacePath, expected)
					? "workspace path matches pms/<pm>"
					: `Database path ${pm.workspacePath} does not match ${expected}`,
			);
			if (!exists) continue;
			const markerFile = pmMarkerPath(expected);
			if (!fs.existsSync(markerFile)) {
				doctor.fail(`pm.marker:${pm.name}`, `Missing PM marker: ${markerFile}`);
			} else {
				try {
					const marker = parsePmMarker(await Bun.file(markerFile).json(), markerFile);
					doctor.add(
						`pm.marker:${pm.name}`,
						marker.teamId === team.id && marker.pmId === pm.name,
						marker.teamId === team.id && marker.pmId === pm.name
							? `pmId "${marker.pmId}"`
							: `PM marker names team "${marker.teamId}", pm "${marker.pmId}"`,
					);
				} catch (error) {
					doctor.fail(`pm.marker:${pm.name}`, error instanceof Error ? error.message : String(error));
				}
			}
			doctor.add(
				`pm.ownerless.not-git:${pm.name}`,
				vcs.git(expected) === null && !fs.existsSync(path.join(expected, ".git")),
				vcs.git(expected) ? "PM workspace is inside a Git repository; it must be a plain folder" : "plain folder",
			);
			doctor.add(
				`pm.no-repos:${pm.name}`,
				!fs.existsSync(path.join(expected, "repos")),
				fs.existsSync(path.join(expected, "repos"))
					? `PM workspace contains a repos/ directory; canonical repos live at ${reposRoot(teamRoot)}`
					: "no repos/ inside the PM workspace",
			);
			const nested = await findNestedGitEntries(expected);
			doctor.add(
				`pm.nested-git:${pm.name}`,
				nested.length === 0,
				nested.length === 0 ? "no nested Git entries" : `Nested Git entries: ${nested.join(", ")}`,
			);
		}
		for (const dir of await listDirectories(pmsDir)) {
			if (!pmIds.has(dir)) {
				doctor.fail(`pm.unregistered:${dir}`, `pms/${dir} exists but has no team_pms row`);
			}
		}

		const repos = db.listRepos(team.id);
		const repoNames = new Set(repos.map(repo => repo.name));
		for (const repo of repos) {
			await checkBaseRepo(doctor, teamRoot, team.id, repo, pmsDir);
		}
		for (const dir of await listDirectories(reposRoot(teamRoot))) {
			if (!repoNames.has(dir)) {
				doctor.fail(`repo.unregistered:${dir}`, `repos/${dir} exists but has no repos row`);
			}
		}

		for (const binding of db.listBindings(team.id)) {
			const repo = db.getRepoById(binding.repoId);
			const pm = db.getPmById(binding.pmId);
			const ok = repo !== null && pm !== null && repo.teamId === team.id && pm.teamId === team.id;
			doctor.add(
				`binding:${repo?.name ?? binding.repoId}:${pm?.name ?? binding.pmId}`,
				ok,
				ok ? "binding resolves to this team's repo and PM" : "binding references a missing or foreign row",
			);
		}

		const engineers = db.listEngineers(team.id);
		for (const engineer of engineers) {
			const pm = db.getPmById(engineer.pmId);
			const home = db.listWorktrees(team.id).find(row => row.engineerId === engineer.id && row.kind === "home");
			const homeBranch = pm ? integrationBranch(team.id, pm.name, engineer.name) : "";
			doctor.add(
				`engineer.home:${pm?.name ?? engineer.pmId}/${engineer.name}`,
				home !== undefined,
				home ? `home worktree ${home.path}` : `No home worktree row for branch "${homeBranch}"`,
			);
			doctor.add(
				`engineer.execution:${pm?.name ?? engineer.pmId}/${engineer.name}`,
				engineer.execution === "normal" || engineer.execution === "vibe",
				`execution "${engineer.execution}"`,
			);
		}

		for (const worktree of db.listWorktrees(team.id)) {
			const repo = db.getRepoById(worktree.repoId);
			const pm = db.getPmById(worktree.pmId);
			const engineer = db.getEngineerById(worktree.engineerId);
			const label = `${repo?.name ?? worktree.repoId}/${pm?.name ?? worktree.pmId}/${
				engineer?.name ?? worktree.engineerId
			}/${worktree.name}`;
			if (!repo || !pm || !engineer) {
				doctor.fail(`worktree.refs:${label}`, "Worktree row references a missing repo, PM, or engineer");
				continue;
			}
			const expectedPath =
				worktree.kind === "home"
					? engineerHomePath(teamRoot, repo.name, pm.name, engineer.name)
					: taskWorktreePath(teamRoot, repo.name, pm.name, engineer.name, worktree.name);
			const expectedBranch =
				worktree.kind === "home"
					? integrationBranch(team.id, pm.name, engineer.name)
					: taskBranch(team.id, pm.name, engineer.name, worktree.name);
			doctor.add(
				`worktree.path:${label}`,
				samePath(worktree.path, expectedPath),
				samePath(worktree.path, expectedPath)
					? expectedPath
					: `Recorded ${worktree.path}, expected ${expectedPath}`,
			);
			doctor.add(
				`worktree.branch:${label}`,
				worktree.branch === expectedBranch,
				worktree.branch === expectedBranch
					? expectedBranch
					: `Recorded ${worktree.branch}, expected ${expectedBranch}`,
			);
			if (!fs.existsSync(worktree.path)) {
				doctor.fail(`worktree.exists:${label}`, `Missing worktree path: ${worktree.path}`);
				continue;
			}
			const handle = vcs.git(worktree.path);
			if (!handle) {
				doctor.fail(`worktree.git:${label}`, `Not a Git worktree: ${worktree.path}`);
				continue;
			}
			doctor.add(
				`worktree.root:${label}`,
				samePath(handle.info().repoRoot, worktree.path),
				`Git root ${handle.info().repoRoot}`,
			);
			const current = await handle.currentBranch();
			doctor.add(
				`worktree.checked-out:${label}`,
				current === worktree.branch,
				current === worktree.branch ? `on ${current}` : `On "${current ?? "(detached)"}"`,
			);
			const baseHandle = vcs.git(repo.basePath);
			const listed = baseHandle
				? (await baseHandle.worktrees()).some(entry => samePath(entry.path, worktree.path))
				: false;
			doctor.add(
				`worktree.registered:${label}`,
				listed,
				listed ? "listed by the base repository" : `Base repository does not list ${worktree.path}`,
			);
		}

		const registeredWorktrees = new Set(db.listWorktrees(team.id).map(row => canonicalPath(row.path)));
		for (const worktree of await findLinkedWorktrees(path.join(teamRoot, "worktrees"))) {
			if (!registeredWorktrees.has(canonicalPath(worktree))) {
				doctor.fail(
					`worktree.unregistered:${path.relative(teamRoot, worktree)}`,
					"Linked worktree on disk has no worktrees row",
				);
			}
		}

		return { teamRoot, teamId: team.id, ok: doctor.ok, checks: doctor.checks };
	} catch (error) {
		if (error instanceof TeamError) {
			doctor.fail("team", error.message);
			return { teamRoot, teamId, ok: false, checks: doctor.checks };
		}
		throw error;
	} finally {
		db.close();
	}
}
