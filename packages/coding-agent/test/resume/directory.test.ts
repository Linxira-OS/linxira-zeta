import { describe, expect, it } from "bun:test";
import { resumePathKey } from "@linxiraos/zeta/resume";
import {
	buildDirectory,
	DEFAULT_WORKSPACE,
	EMPTY_PROJECT,
	makeSession,
	pinnedSet,
	REPO_A,
	REPO_B,
	WORKTREE_A,
} from "./helpers";

const T = Date.UTC(2026, 0, 1);

function sessions() {
	return [
		makeSession({ id: "a1", cwd: REPO_A, modified: T + 1_000, title: "A one" }),
		makeSession({ id: "a2", cwd: REPO_A, modified: T + 2_000, title: "A two" }),
		makeSession({ id: "wt1", cwd: WORKTREE_A, modified: T + 3_000, title: "Worktree one" }),
		makeSession({ id: "b1", cwd: REPO_B, modified: T + 4_000, title: "B one" }),
	];
}

describe("resume directory", () => {
	it("groups every session into project → workspace → conversation", async () => {
		const directory = await buildDirectory({
			sessions: sessions(),
			preferences: { version: 1, projects: {} },
			pinnedIds: pinnedSet(),
		});

		expect(directory.projects.map(project => project.displayName)).toEqual(["workspace", "repo-b", "repo-a"]);
		expect(directory.counts).toEqual({
			projects: 3,
			workspaces: 4,
			conversations: 4,
			pinnedConversations: 0,
		});

		const repoA = directory.projects.find(project => project.key === resumePathKey(REPO_A));
		expect(repoA).toBeDefined();
		expect(repoA?.workspaces.map(workspace => workspace.name)).toEqual(["feat-a", "repo-a"]);
		expect(repoA?.conversations.map(conversation => conversation.id).sort()).toEqual(["a1", "a2", "wt1"]);
		expect(repoA?.counts).toEqual({ conversations: 3, workspaces: 2, pinnedConversations: 0 });

		const worktree = repoA?.workspaces.find(workspace => workspace.key === resumePathKey(WORKTREE_A));
		expect(worktree?.branch).toBe("feat/a");
		expect(worktree?.isWorktree).toBe(true);
		expect(worktree?.conversations.map(conversation => conversation.id)).toEqual(["wt1"]);
		expect(worktree?.counts).toEqual({ conversations: 1, pinnedConversations: 0 });

		const checkout = repoA?.workspaces.find(workspace => workspace.key === resumePathKey(REPO_A));
		expect(checkout?.branch).toBe("main");
		expect(checkout?.isWorktree).toBe(false);
		expect(checkout?.counts.conversations).toBe(2);
	});

	it("seeds the default workspace project as pinned and non-removable when empty", async () => {
		const directory = await buildDirectory({
			sessions: [],
			preferences: { version: 1, projects: {} },
			pinnedIds: pinnedSet(),
		});

		expect(directory.projects).toHaveLength(1);
		const seeded = directory.projects[0];
		expect(seeded.key).toBe(resumePathKey(DEFAULT_WORKSPACE));
		expect(seeded.isDefault).toBe(true);
		expect(seeded.pinned).toBe(true);
		expect(seeded.removable).toBe(false);
		expect(seeded.counts).toEqual({ conversations: 0, workspaces: 1, pinnedConversations: 0 });
		expect(seeded.workspaces[0].key).toBe(resumePathKey(DEFAULT_WORKSPACE));
		expect(seeded.workspaces[0].counts.conversations).toBe(0);
		expect(directory.defaultProjectKey).toBe(resumePathKey(DEFAULT_WORKSPACE));
		expect(directory.defaultWorkspaceKey).toBe(resumePathKey(DEFAULT_WORKSPACE));
	});

	it("keeps registered projects with zero conversations", async () => {
		const directory = await buildDirectory({
			sessions: [],
			preferences: { version: 1, projects: { [resumePathKey(EMPTY_PROJECT)]: { registered: true } } },
			pinnedIds: pinnedSet(),
		});

		const empty = directory.projects.find(project => project.key === resumePathKey(EMPTY_PROJECT));
		expect(empty).toBeDefined();
		expect(empty?.displayName).toBe("empty-project");
		expect(empty?.counts).toEqual({ conversations: 0, workspaces: 0, pinnedConversations: 0 });
		expect(empty?.lastActivity).toBeNull();
		expect(directory.counts.projects).toBe(2);
	});

	it("sorts pinned projects and workspaces first, then conversations by recency", async () => {
		const directory = await buildDirectory({
			sessions: sessions(),
			preferences: { version: 1, projects: { [resumePathKey(REPO_A)]: { pinned: true } } },
			pinnedIds: pinnedSet("a1"),
		});

		const defaultProject = directory.projects[0];
		expect(defaultProject.key).toBe(resumePathKey(DEFAULT_WORKSPACE));
		const repoA = directory.projects.find(project => project.key === resumePathKey(REPO_A));
		expect(repoA?.pinned).toBe(true);
		expect(directory.projects.map(project => project.displayName)).toEqual(["workspace", "repo-a", "repo-b"]);

		// The pinned conversation pulls its workspace (repo-a) above the newer worktree.
		expect(repoA?.workspaces.map(workspace => workspace.name)).toEqual(["repo-a", "feat-a"]);
		expect(repoA?.workspaces[0].pinned).toBe(true);
		// Last activity is the newest modified conversation, not the pinned one.
		expect(repoA?.lastActivity?.getTime()).toBe(T + 3_000);
		expect(repoA?.workspaces[0].lastActivity?.getTime()).toBe(T + 2_000);
		// Pinned conversation first, then most recently modified.
		expect(repoA?.conversations.map(conversation => conversation.id)).toEqual(["a1", "wt1", "a2"]);
	});

	it("classifies subagents by the session_init.agent marker and keeps plain forks", async () => {
		const parentPath = "/resume-test/sessions/parent.jsonl";
		const directory = await buildDirectory({
			sessions: [
				makeSession({ id: "parent", cwd: REPO_A, modified: T + 1_000, title: "Parent" }),
				makeSession({
					id: "sub",
					cwd: REPO_A,
					modified: T + 2_000,
					title: "Scout run",
					parent: parentPath,
					agent: "scout",
				}),
				makeSession({ id: "fork", cwd: REPO_A, modified: T + 3_000, title: "Fork", parent: parentPath }),
			],
			preferences: { version: 1, projects: {} },
			pinnedIds: pinnedSet(),
		});
		const parent = directory.conversations.find(conversation => conversation.id === "parent")!;
		const sub = directory.conversations.find(conversation => conversation.id === "sub")!;
		const fork = directory.conversations.find(conversation => conversation.id === "fork")!;

		expect(sub.isSubagent).toBe(true);
		expect(sub.fork).toBe(false);
		expect(sub.agentName).toBe("scout");
		expect(sub.parentKey).toBe(parent.key);
		expect(parent.subagents.map(conversation => conversation.id)).toEqual(["sub"]);

		expect(fork.isSubagent).toBe(false);
		expect(fork.fork).toBe(true);
		expect(fork.parentKey).toBe(parent.key);
	});

	it("appends the parent folder when two projects share a name", async () => {
		const first = "/resume-test/alpha/zeta";
		const second = "/resume-test/beta/zeta";
		const directory = await buildDirectory({
			sessions: [
				makeSession({ id: "z1", cwd: first, modified: T + 1_000, title: "One" }),
				makeSession({ id: "z2", cwd: second, modified: T + 2_000, title: "Two" }),
			],
			preferences: { version: 1, projects: {} },
			pinnedIds: pinnedSet(),
			resolveProject: cwd => ({
				projectRoot: cwd,
				branch: "main",
				isWorktree: false,
				isTopLevel: false,
			}),
		});
		const names = directory.projects
			.filter(project => project.displayName.startsWith("zeta"))
			.map(project => project.displayName)
			.sort();
		expect(names).toEqual(["zeta (alpha)", "zeta (beta)"]);
	});

	it("carries project aliases and collapse state from preferences", async () => {
		const directory = await buildDirectory({
			sessions: [],
			preferences: {
				version: 1,
				projects: {
					[resumePathKey(REPO_A)]: { registered: true, alias: "Alpha", collapsed: true },
				},
			},
			pinnedIds: pinnedSet(),
		});

		const repoA = directory.projects.find(project => project.key === resumePathKey(REPO_A));
		expect(repoA?.alias).toBe("Alpha");
		expect(repoA?.displayName).toBe("Alpha");
		expect(repoA?.collapsed).toBe(true);
		expect(repoA?.removable).toBe(true);
	});
});
