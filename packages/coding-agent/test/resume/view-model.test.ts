import { describe, expect, it } from "bun:test";
import { buildResumeView, resumePathKey, type ResumeView } from "@linxiraos/zeta/resume";
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

function standardSessions() {
	return [
		makeSession({
			id: "a1",
			cwd: REPO_A,
			title: "Alpha feature",
			firstMessage: "add alpha",
			allMessagesText: "add alpha",
			modified: T + 1_000,
			status: "complete",
		}),
		makeSession({
			id: "a2",
			cwd: REPO_A,
			title: "Beta cleanup",
			firstMessage: "remove beta",
			allMessagesText: "remove beta",
			modified: T + 2_000,
			status: "error",
		}),
		makeSession({
			id: "wt1",
			cwd: WORKTREE_A,
			title: "Feature work",
			firstMessage: "worktree branch",
			allMessagesText: "worktree branch",
			modified: T + 3_000,
			status: "pending",
		}),
		makeSession({
			id: "b1",
			cwd: REPO_B,
			title: "Gamma docs",
			firstMessage: "write gamma",
			allMessagesText: "write gamma",
			modified: T + 4_000,
			status: "complete",
			fork: true,
		}),
	];
}

async function standardDirectory(pinned: string[] = []) {
	return buildDirectory({
		sessions: standardSessions(),
		pinnedIds: pinnedSet(...pinned),
		preferences: { version: 1, projects: { [resumePathKey(EMPTY_PROJECT)]: { registered: true } } },
	});
}

function conversationIds(view: ResumeView): string[] {
	return view.conversations.map(row => row.conversation.id);
}

function rowTypes(view: ResumeView): string[] {
	return view.rows.map(row => row.type);
}

describe("resume view model scopes", () => {
	it("workspace scope lists only that workspace's conversations", async () => {
		const directory = await standardDirectory();
		const view = buildResumeView(directory, {
			scope: { kind: "workspace", key: resumePathKey(REPO_A) },
		});

		expect(rowTypes(view)).toEqual(["conversation", "conversation"]);
		expect(conversationIds(view)).toEqual(["a2", "a1"]);
		expect(view.scope).toEqual({
			kind: "workspace",
			workspaceKey: resumePathKey(REPO_A),
			projectKey: resumePathKey(REPO_A),
		});
		expect(view.counts).toMatchObject({
			conversations: 2,
			totalConversations: 2,
			workspaces: 1,
			totalWorkspaces: 1,
			projects: 1,
			totalProjects: 1,
		});
	});

	it("defaults a keyless workspace scope to the current conversation, then the seeded workspace", async () => {
		const directory = await standardDirectory();
		const seeded = buildResumeView(directory);
		expect(seeded.scope.kind).toBe("workspace");
		expect(seeded.scope.workspaceKey).toBe(resumePathKey(DEFAULT_WORKSPACE));
		expect(seeded.rows).toEqual([]);

		const current = buildResumeView(directory, { currentSessionPath: "/resume-test/sessions/a1.jsonl" });
		expect(current.scope.workspaceKey).toBe(resumePathKey(REPO_A));
		expect(conversationIds(current)).toEqual(["a2", "a1"]);
	});

	it("project scope emits workspace headers before their conversations", async () => {
		const directory = await standardDirectory();
		const view = buildResumeView(directory, { scope: { kind: "project", key: resumePathKey(REPO_A) } });

		expect(rowTypes(view)).toEqual(["workspace", "conversation", "workspace", "conversation", "conversation"]);
		expect(view.rows.map(row => ("workspace" in row ? row.workspace.name : row.key))).toEqual([
			"feat-a",
			"wt1",
			"repo-a",
			"a2",
			"a1",
		]);
		const firstWorkspace = view.rows[0];
		expect(firstWorkspace.type === "workspace" && firstWorkspace.conversationCount).toBe(1);
		expect(view.counts).toMatchObject({
			conversations: 3,
			totalConversations: 3,
			workspaces: 2,
			totalWorkspaces: 2,
			projects: 1,
		});
	});

	it("all-projects scope emits project headers plus workspace headers", async () => {
		const directory = await standardDirectory();
		const view = buildResumeView(directory, { scope: "all" });

		expect(rowTypes(view)).toEqual([
			"project",
			"workspace",
			"project",
			"workspace",
			"conversation",
			"project",
			"workspace",
			"conversation",
			"workspace",
			"conversation",
			"conversation",
			"project",
		]);
		expect(view.rows.filter(row => row.type === "project").map(row => row.key)).toEqual([
			resumePathKey(DEFAULT_WORKSPACE),
			resumePathKey(REPO_B),
			resumePathKey(REPO_A),
			resumePathKey(EMPTY_PROJECT),
		]);
		expect(conversationIds(view)).toEqual(["b1", "wt1", "a2", "a1"]);
		expect(view.counts).toMatchObject({
			conversations: 4,
			totalConversations: 4,
			workspaces: 4,
			totalWorkspaces: 4,
			projects: 4,
			totalProjects: 4,
		});
	});

	it("keeps the seeded default project and its empty workspace visible", async () => {
		const directory = await standardDirectory();
		const view = buildResumeView(directory, { scope: "all" });

		const first = view.rows[0];
		expect(first.type).toBe("project");
		if (first.type !== "project") throw new Error("expected project row");
		expect(first.project.isDefault).toBe(true);
		expect(first.pinned).toBe(true);
		expect(first.collapsed).toBe(false);
		expect(first.conversationCount).toBe(0);
		expect(first.totalConversationCount).toBe(0);
		expect(first.workspaceCount).toBe(1);

		const workspace = view.rows[1];
		expect(workspace.type).toBe("workspace");
		if (workspace.type !== "workspace") throw new Error("expected workspace row");
		expect(workspace.workspace.key).toBe(resumePathKey(DEFAULT_WORKSPACE));
		expect(workspace.conversationCount).toBe(0);
	});

	it("collapses a project to its header until a search expands it", async () => {
		const directory = await standardDirectory();
		const repoA = directory.projects.find(project => project.key === resumePathKey(REPO_A));
		expect(repoA).toBeDefined();
		if (repoA) repoA.collapsed = true;

		const collapsed = buildResumeView(directory, { scope: "all" });
		const repoARow = collapsed.rows.find(row => row.type === "project" && row.key === resumePathKey(REPO_A));
		expect(repoARow?.type === "project" && repoARow.collapsed).toBe(true);
		expect(conversationIds(collapsed)).not.toContain("a1");

		const expanded = buildResumeView(directory, { scope: "all", query: "alpha" });
		expect(conversationIds(expanded)).toEqual(["a1"]);
	});
});

describe("resume view model search", () => {
	it("matches plain text and keeps pinned conversations visible", async () => {
		const directory = await standardDirectory(["b1"]);
		const view = buildResumeView(directory, { scope: "all", query: "alpha" });

		expect(conversationIds(view)).toEqual(["b1", "a1"]);
		const byId = new Map(view.conversations.map(row => [row.conversation.id, row]));
		expect(byId.get("b1")?.pinnedOnly).toBe(true);
		expect(byId.get("a1")?.pinnedOnly).toBe(false);

		const projectA = view.rows.find(row => row.type === "project" && row.key === resumePathKey(REPO_A));
		expect(projectA?.type === "project" && projectA.conversationCount).toBe(1);
		expect(projectA?.type === "project" && projectA.totalConversationCount).toBe(3);
		expect(view.counts).toMatchObject({ conversations: 2, totalConversations: 4 });
	});

	it("parses structured tokens for project, workspace, branch, status, current, fork and pinned", async () => {
		const directory = await standardDirectory(["a2"]);
		const cases: [string, string[]][] = [
			["project:repo-b", ["b1"]],
			["workspace:repo-a", ["a2", "a1"]],
			["branch:feat/a", ["wt1"]],
			["status:error", ["a2"]],
			["fork:true", ["b1"]],
			["pinned:true", ["a2"]],
			['project:"repo-a"', ["a2", "a1", "wt1"]],
		];
		for (const [query, expected] of cases) {
			expect(conversationIds(buildResumeView(directory, { scope: "all", query }))).toEqual(expected);
		}

		const current = buildResumeView(directory, {
			scope: "all",
			query: "current:true",
			currentSessionPath: "/resume-test/sessions/a1.jsonl",
		});
		expect(conversationIds(current)).toEqual(["a1"]);
		expect(current.conversations[0].current).toBe(true);
	});

	it("keeps a pinned non-matching conversation during search", async () => {
		const directory = await standardDirectory(["a2"]);
		const view = buildResumeView(directory, { scope: "all", query: "gamma" });

		expect(conversationIds(view)).toEqual(["b1", "a2"]);
		const pinned = view.conversations.find(row => row.conversation.id === "a2");
		expect(pinned?.pinnedOnly).toBe(true);
		expect(pinned?.pinned).toBe(true);
	});

	it("ranks matches by relevance before recency", async () => {
		const directory = await buildDirectory({
			sessions: [
				makeSession({
					id: "title-hit",
					cwd: REPO_B,
					title: "Postgres tuning notes",
					firstMessage: "unrelated",
					allMessagesText: "unrelated",
					modified: T + 1_000,
				}),
				makeSession({
					id: "body-hit",
					cwd: REPO_B,
					title: "Other notes",
					firstMessage: "unrelated",
					allMessagesText: "postgres mention",
					modified: T + 9_000,
				}),
			],
			pinnedIds: pinnedSet(),
			preferences: { version: 1, projects: {} },
		});

		const view = buildResumeView(directory, {
			scope: { kind: "project", key: resumePathKey(REPO_B) },
			query: "postgres",
		});
		expect(conversationIds(view)).toEqual(["title-hit", "body-hit"]);
		expect(view.conversations[0].score).toBeGreaterThan(view.conversations[1].score);
	});

	it("defaults unmatchable free text to an empty view without hiding empty groups", async () => {
		const directory = await standardDirectory();
		const view = buildResumeView(directory, { scope: "all", query: "no-such-text-anywhere" });
		expect(view.conversations).toEqual([]);
		// The default project stays pinned and visible; other empty groups hide.
		expect(view.rows.map(row => row.type)).toEqual(["project"]);
	});
});
