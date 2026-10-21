/**
 * Shared fixtures for resume directory/view-model suites. Kept out of the
 * `.test.ts` files so both suites build identical project/workspace shapes.
 */

import type { ResumeProjectResolver } from "@linxiraos/zeta/resume";
import { buildResumeDirectory, type BuildResumeDirectoryOptions } from "@linxiraos/zeta/resume";
import type { SessionInfo } from "@linxiraos/zeta/session/session-listing";

export const DEFAULT_WORKSPACE = "/resume-test/home/.zeta/workspace";
export const REPO_A = "/resume-test/repo-a";
export const REPO_B = "/resume-test/repo-b";
export const WORKTREE_A = "/resume-test/worktrees/feat-a";
export const EMPTY_PROJECT = "/resume-test/empty-project";

export interface SessionFixture {
	id: string;
	cwd: string;
	title?: string;
	firstMessage?: string;
	allMessagesText?: string;
	modified: number;
	created?: number;
	pinned?: boolean;
	fork?: boolean;
	status?: SessionInfo["status"];
	messageCount?: number;
}

export function makeSession(fixture: SessionFixture): SessionInfo {
	const created = new Date(fixture.created ?? fixture.modified - 1000);
	const modified = new Date(fixture.modified);
	return {
		path: `/resume-test/sessions/${fixture.id}.jsonl`,
		id: fixture.id,
		cwd: fixture.cwd,
		title: fixture.title,
		parentSessionPath: fixture.fork ? `/resume-test/sessions/parent-${fixture.id}.jsonl` : undefined,
		created,
		modified,
		messageCount: fixture.messageCount ?? 2,
		assistantTurns: 1,
		size: 100,
		firstMessage: fixture.firstMessage ?? fixture.title ?? "hello",
		allMessagesText: fixture.allMessagesText ?? fixture.firstMessage ?? fixture.title ?? "hello",
		status: fixture.status ?? "complete",
	};
}

export interface ProjectFixture {
	projectRoot: string;
	branch?: string | null;
	isWorktree?: boolean;
	isTopLevel?: boolean;
}

export interface ProjectFixtureInfo {
	projectRoot: string;
	branch: string | null;
	isWorktree: boolean;
	isTopLevel: boolean;
}

export function projectInfo(fixture: ProjectFixture): ProjectFixtureInfo {
	return {
		projectRoot: fixture.projectRoot,
		branch: fixture.branch ?? null,
		isWorktree: fixture.isWorktree ?? false,
		isTopLevel: fixture.isTopLevel ?? true,
	};
}

/** Snapshot git metadata: every cwd not listed resolves to itself. */
export function staticResolver(map: Record<string, ProjectFixtureInfo>): ResumeProjectResolver {
	return cwd => map[cwd] ?? projectInfo({ projectRoot: cwd });
}

export const STANDARD_PROJECTS: Record<string, ProjectFixtureInfo> = {
	[DEFAULT_WORKSPACE]: projectInfo({ projectRoot: DEFAULT_WORKSPACE, branch: "main" }),
	[REPO_A]: projectInfo({ projectRoot: REPO_A, branch: "main" }),
	[REPO_B]: projectInfo({ projectRoot: REPO_B, branch: "main" }),
	[WORKTREE_A]: projectInfo({ projectRoot: REPO_A, branch: "feat/a", isWorktree: true }),
	[EMPTY_PROJECT]: projectInfo({ projectRoot: EMPTY_PROJECT }),
};

export function buildDirectory(
	options: Omit<BuildResumeDirectoryOptions, "defaultWorkspace" | "resolveProject"> & {
		resolveProject?: ResumeProjectResolver;
	},
) {
	return buildResumeDirectory({
		defaultWorkspace: DEFAULT_WORKSPACE,
		resolveProject: staticResolver(STANDARD_PROJECTS),
		...options,
	});
}

export function pinnedSet(...ids: string[]): ReadonlySet<string> {
	return new Set(ids);
}
