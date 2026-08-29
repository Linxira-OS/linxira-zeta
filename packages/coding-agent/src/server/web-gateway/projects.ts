/**
 * Project resolution for session grouping: cwd → { projectRoot, branch }.
 *
 * A worktree's `git rev-parse --git-common-dir` points at the *main* repo's
 * .git directory, so its parent is the project root shared by all worktrees.
 * Non-git directories resolve to themselves. Results are cached with a short
 * TTL (the gateway is a long-lived Bun process; a plain module map is safe).
 */

import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";
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
		const isWorktreeTopLevel = gitDir !== commonDir && isTopLevel;
		info = {
			projectRoot: isWorktreeTopLevel ? dirname(commonDir) : cwd,
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
