/**
 * Project resolution for session grouping: cwd → { projectRoot, branch }.
 *
 * A worktree's `git rev-parse --git-common-dir` points at the *main* repo's
 * .git directory, so its parent is the project root shared by all worktrees.
 * Non-git directories resolve to themselves. Results are cached with a short
 * TTL (the gateway is a long-lived Bun process; a plain module map is safe).
 */

import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
	type ResumeDirectory,
	type ResumeProject,
	type ResumeWorkspace,
	filterHiddenResumeDirectory,
	loadResumeDirectory,
	loadResumePreferences,
	registerProject,
	setProjectPreference,
	setWorkspaceHidden,
	unregisterProject,
} from "../../resume";
// Upstream v18.0.9 deleted src/utils/git.ts — git discovery now lives in the
// pi-vcs native addon (crates/pi-vcs, exposed through pi-natives/vcs).
import { git, gitInfo } from "@linxiraos/pi-natives/vcs";

export interface ProjectInfo {
	projectRoot: string;
	/** Current branch of the cwd, null for non-git dirs or detached HEAD */
	branch: string | null;
	/** True when cwd is a linked worktree (not the main checkout) */
	isWorktree: boolean;
	/** True when cwd is the top-level directory of a checkout (main or linked). */
	isTopLevel: boolean;
}

const PROJECT_CACHE_TTL_MS = 60_000;

const projectCache = new Map<string, { info: ProjectInfo; expiresAt: number }>();

export function invalidateProjectCache(): void {
	projectCache.clear();
}

/**
 * addWorktree() places worktrees in `<repoRoot>-worktrees/<dir>`. When such a
 * directory no longer exists (worktree removed), group its sessions back
 * under the main repo instead of letting them dangle as a phantom project.
 * The dir name is the sanitized branch name — close enough for display.
 */
function inferRemovedWorktree(cwd: string): ProjectInfo | null {
	const parent = dirname(cwd);
	if (!parent.endsWith("-worktrees")) return null;
	const repoRoot = parent.slice(0, -"-worktrees".length);
	if (!repoRoot || !existsSync(join(repoRoot, ".git"))) return null;
	return { projectRoot: repoRoot, branch: basename(cwd), isWorktree: true, isTopLevel: true };
}

export async function resolveProject(cwd: string): Promise<ProjectInfo> {
	const cached = projectCache.get(cwd);
	if (cached && cached.expiresAt > Date.now()) return cached.info;

	let info: ProjectInfo;
	try {
		if (!existsSync(cwd)) {
			info = inferRemovedWorktree(cwd) ?? { projectRoot: cwd, branch: null, isWorktree: false, isTopLevel: false };
			projectCache.set(cwd, { info, expiresAt: Date.now() + PROJECT_CACHE_TTL_MS });
			return info;
		}
		// Replaces `git rev-parse --path-format=absolute --git-common-dir
		// --git-dir --show-toplevel --abbrev-ref HEAD` from the deleted
		// src/utils/git.ts. `gitInfo` reads the same metadata without spawning
		// git; `headSync().branch` is undefined on a detached HEAD.
		const discovered = gitInfo(cwd);
		const commonDir = discovered?.commonDir;
		const gitDir = discovered?.gitDir;
		const toplevel = discovered?.repoRoot;
		const ref = git(cwd)?.headSync()?.branch ?? null;
		// git prints resolved (symlink-free) paths; normalize cwd the same way
		let realCwd = cwd;
		try {
			realCwd = realpathSync(cwd);
		} catch {
			// keep as-is
		}
		// For a linked worktree, --git-dir differs from --git-common-dir.
		// Only collapse *worktree toplevels* into the main repo. A session whose
		// cwd is a subdirectory of a repo keeps its own project identity —
		// grouping subdirs under the repo root would change where new sessions
		// are created for existing users.
		const isTopLevel = toplevel === realCwd;
		const isWorktreeTopLevel = gitDir !== undefined && commonDir !== undefined && gitDir !== commonDir && isTopLevel;
		info = {
			projectRoot: isWorktreeTopLevel && commonDir ? dirname(commonDir) : cwd,
			branch: ref && ref !== "HEAD" ? ref : null,
			isWorktree: isWorktreeTopLevel,
			isTopLevel,
		};
	} catch {
		info = { projectRoot: cwd, branch: null, isWorktree: false, isTopLevel: false };
	}

	projectCache.set(cwd, { info, expiresAt: Date.now() + PROJECT_CACHE_TTL_MS });
	return info;
}

// ---------------------------------------------------------------------------
// Project registry — the shell's project list.
//
// GET  /api/projects → the local directory model (projects → workspaces →
//                      conversations) built from the on-disk registry plus
//                      session files.
// PUT  /api/projects → register one project, or update its alias / pin /
//                      collapse state. `{ path, registered: false }` drops it
//                      from the registry (sessions are untouched; the cascade
//                      delete stays on DELETE /api/projects).
//
// The registry file (`<agent dir>/resume-projects.json`) is shared with the
// terminal resume picker, so a project added here appears there too.
// ---------------------------------------------------------------------------

function json(data: unknown, status = 200): Response {
	return Response.json(data, { status });
}

/** Preferences-only record of one project, as the shell's "+" needs it. */
export interface WebProjectSummary {
	/** Canonical project root (the registry key); `path` is the wire name. */
	path: string;
	key: string;
	name: string;
	alias: string | null;
	displayName: string;
	isDefault: boolean;
	pinned: boolean;
	removable: boolean;
	collapsed: boolean;
	lastActivity: string | null;
	counts: ResumeProject["counts"];
	workspaces: WebWorkspaceSummary[];
}

export interface WebWorkspaceSummary {
	path: string;
	key: string;
	name: string;
	alias: string | null;
	displayName: string;
	branch: string | null;
	isWorktree: boolean;
	pinned: boolean;
	lastActivity: string | null;
	/**
	 * Epoch ms the project containing this workspace was last opened, from the
	 * persisted preferences. Distinct from `lastActivity` (newest conversation):
	 * a registered workspace with no conversations has a `lastOpened` and no
	 * activity, and callers must be able to date it without inventing a value.
	 */
	lastOpened: number | null;
	counts: ResumeWorkspace["counts"];
}

function isoOrNull(value: Date | null): string | null {
	return value ? value.toISOString() : null;
}

function toWorkspaceSummary(workspace: ResumeWorkspace): WebWorkspaceSummary {
	return {
		path: workspace.path,
		key: workspace.key,
		name: workspace.name,
		alias: workspace.alias,
		displayName: workspace.displayName,
		branch: workspace.branch,
		isWorktree: workspace.isWorktree,
		pinned: workspace.pinned,
		lastActivity: isoOrNull(workspace.lastActivity),
		lastOpened: null,
		counts: workspace.counts,
	};
}

function toProjectSummary(project: ResumeProject): WebProjectSummary {
	return {
		path: project.root,
		key: project.key,
		name: project.name,
		alias: project.alias,
		displayName: project.displayName,
		isDefault: project.isDefault,
		pinned: project.pinned,
		removable: project.removable,
		collapsed: project.collapsed,
		lastActivity: isoOrNull(project.lastActivity),
		counts: project.counts,
		workspaces: project.workspaces.map(toWorkspaceSummary),
	};
}

/** Wire shape shared by GET and PUT, so the shell can replace its whole list. */
export interface WebProjectsResponse {
	projects: WebProjectSummary[];
	defaultProjectKey: string;
	defaultWorkspaceKey: string;
	counts: ResumeDirectory["counts"];
}

function toProjectsResponse(directory: ResumeDirectory): WebProjectsResponse {
	return {
		projects: directory.projects.map(toProjectSummary),
		defaultProjectKey: directory.defaultProjectKey,
		defaultWorkspaceKey: directory.defaultWorkspaceKey,
		counts: directory.counts,
	};
}

async function loadResponse(includeHidden = false): Promise<WebProjectsResponse> {
	// Visibility is metadata, not an ownership boundary. Internal history/open
	// callers may resolve a hidden workspace without adding it to the sidebar.
	const directory = filterHiddenResumeDirectory(await loadResumeDirectory({ filterSubagents: true }), includeHidden);
	const response = toProjectsResponse(directory);
	// `lastOpened` lives in the preferences file, not in the directory scan; a
	// registered workspace with zero conversations is dated only by it.
	const preferences = await loadResumePreferences();
	for (const project of response.projects) {
		const lastOpened = preferences.projects[project.key]?.lastOpened ?? null;
		for (const workspace of project.workspaces) workspace.lastOpened = lastOpened;
	}
	return response;
}

/** GET /api/projects — every registered project with its workspaces. */
export async function handleProjectsGet(req: Request): Promise<Response> {
	try {
		return json(await loadResponse(new URL(req.url).searchParams.get("includeHidden") === "true"));
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, 500);
	}
}

/**
 * PUT /api/projects — register/update one project.
 *
 * Body: `{ path: string, alias?: string | null, pinned?: boolean,
 * collapsed?: boolean, registered?: boolean, hidden?: boolean }`. A `null`
 * alias clears it; an absent field is left untouched. `registered: false`
 * removes the project from the registry. `hidden` sets the folder-level
 * visibility flag for `path` itself (a workspace directory) and never touches
 * sessions or the checkout; the shared TUI picker reads the same preference.
 */
export async function handleProjectsPut(req: Request): Promise<Response> {
	const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body) return json({ error: "a JSON body is required" }, 400);
	const rawPath = typeof body.path === "string" ? body.path.trim() : "";
	if (!rawPath) return json({ error: "path is required" }, 400);
	const projectPath = resolve(rawPath);
	if (typeof body.alias === "string" && body.alias.length > 200) {
		return json({ error: "alias is too long" }, 400);
	}
	if (typeof body.hidden === "boolean") {
		try {
			await setWorkspaceHidden(projectPath, body.hidden);
		} catch (error) {
			return json({ error: error instanceof Error ? error.message : String(error) }, 400);
		}
		invalidateProjectCache();
		return json(await loadResponse());
	}
	if (body.registered === false) {
		try {
			await unregisterProject(projectPath);
		} catch (error) {
			return json({ error: error instanceof Error ? error.message : String(error) }, 400);
		}
		invalidateProjectCache();
		return json(await loadResponse());
	}
	if (!existsSync(projectPath)) return json({ error: `directory does not exist: ${projectPath}` }, 400);

	try {
		await registerProject(projectPath);
		const patch: { alias?: string; pinned?: boolean; collapsed?: boolean; lastOpened?: number } = {
			lastOpened: Date.now(),
		};
		if (typeof body.alias === "string") patch.alias = body.alias;
		else if (body.alias === null) patch.alias = "";
		if (typeof body.pinned === "boolean") patch.pinned = body.pinned;
		if (typeof body.collapsed === "boolean") patch.collapsed = body.collapsed;
		await setProjectPreference(projectPath, patch);
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, 500);
	}
	invalidateProjectCache();
	return json(await loadResponse());
}
