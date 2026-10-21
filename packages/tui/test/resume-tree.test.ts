import { beforeAll, describe, expect, it } from "bun:test";
import { plainText } from "../src/native/spans";
import {
	ResumeTreeComponent,
	flattenResumeRows,
	middleEllipsis,
	renderConversationRow,
	renderProjectRow,
	renderScopeHeader,
	renderWorkspaceRow,
	type ResumeTreeConversation,
	type ResumeTreeConversationRow,
	type ResumeTreeProject,
	type ResumeTreeProjectRow,
	type ResumeTreeRow,
	type ResumeTreeScope,
	type ResumeTreeSource,
	type ResumeTreeView,
	type ResumeTreeWorkspace,
	type ResumeTreeWorkspaceRow,
} from "../src/overlays/resume-tree";
import {
	type SessionSelectorEntry,
	SessionSelectorComponent,
	type SessionSelectorOptions,
} from "../src/overlays/session-selector";
import { initTheme } from "../src/theme";

beforeAll(async () => {
	await initTheme(false);
});

const T = Date.UTC(2026, 0, 1);
const HOUR = 3_600_000;

function conversation(
	id: string,
	title: string,
	modified = T,
	overrides: Partial<ResumeTreeConversation> = {},
): ResumeTreeConversation {
	return {
		session: {
			path: `/work/repo/.zeta/${id}.jsonl`,
			id,
			cwd: "/work/repo",
			size: 4_096,
			title,
			modified: new Date(modified),
			firstMessage: `${title} prompt`,
		},
		key: id,
		id,
		path: `/work/repo/.zeta/${id}.jsonl`,
		title,
		cwd: "/work/repo",
		projectKey: "/work/repo",
		workspaceKey: "/work/repo",
		created: new Date(modified - HOUR),
		modified: new Date(modified),
		status: "complete",
		pinned: false,
		current: false,
		fork: false,
		messageCount: 4,
		...overrides,
	};
}

const project: ResumeTreeProject = {
	key: "/work/repo",
	root: "/work/repo",
	name: "repo",
	alias: null,
	displayName: "repo",
	isDefault: false,
	pinned: true,
	collapsed: false,
	lastActivity: new Date(T),
	counts: { conversations: 2, workspaces: 1, pinnedConversations: 0 },
};

const workspace: ResumeTreeWorkspace = {
	key: "/work/repo",
	path: "/work/repo/packages/app",
	name: "app",
	projectKey: "/work/repo",
	branch: "feat/tree",
	pinned: false,
	lastActivity: new Date(T),
	counts: { conversations: 2, pinnedConversations: 0 },
};

const projectRow: ResumeTreeProjectRow = {
	type: "project",
	key: project.key,
	project,
	pinned: true,
	collapsed: false,
	conversationCount: 2,
	totalConversationCount: 2,
	workspaceCount: 1,
	totalWorkspaceCount: 1,
};

const workspaceRow: ResumeTreeWorkspaceRow = {
	type: "workspace",
	key: workspace.key,
	workspace,
	projectKey: project.key,
	pinned: false,
	conversationCount: 2,
	totalConversationCount: 2,
};

function conversationRow(
	id: string,
	title: string,
	overrides: Partial<ResumeTreeConversationRow> = {},
): ResumeTreeConversationRow {
	const entry = conversation(id, title);
	return {
		type: "conversation",
		key: entry.key,
		conversation: entry,
		projectKey: entry.projectKey,
		workspaceKey: entry.workspaceKey,
		pinned: entry.pinned,
		current: entry.current,
		...overrides,
	};
}

function view(rows: ResumeTreeRow[], overrides: Partial<ResumeTreeView["counts"]> = {}, raw = ""): ResumeTreeView {
	const conversations = rows.filter((row): row is ResumeTreeConversationRow => row.type === "conversation");
	return {
		scope: { kind: "all" },
		query: { raw },
		rows,
		conversations,
		counts: {
			conversations: conversations.length,
			totalConversations: conversations.length,
			...overrides,
		},
	};
}

function fakeSource(
	initial: ResumeTreeView | null,
	options: {
		initialScope?: ResumeTreeScope;
		deleteMode?: "trash" | "permanent";
		viewFor?: (scope: ResumeTreeScope, query: string) => ResumeTreeView | null;
		warningNames?: readonly string[];
	} = {},
) {
	const persisted: ResumeTreeScope[] = [];
	const queries: string[] = [];
	const pins: string[] = [];
	let refreshes = 0;
	let current = initial;
	const source: ResumeTreeSource = {
		initialScope: options.initialScope ?? "all",
		deleteMode: options.deleteMode ?? "trash",
		buildView: ({ scope, query }) => {
			queries.push(query);
			if (options.viewFor) return options.viewFor(scope, query);
			return current ? { ...current, scope: { ...current.scope, kind: scope }, query: { raw: query } } : null;
		},
		scopeSummary: () => ({
			workspaceName: "app",
			projectName: "repo",
			counts: { workspace: 2, project: 2, all: 5 },
		}),
		isLoading: () => current === null,
		persistScope: scope => {
			persisted.push(scope);
		},
		refresh: async () => {
			refreshes += 1;
		},
		pinConversation: async (entry, pinned) => {
			pins.push(`${entry.id}:${pinned}`);
		},
		pinProject: async (_entry, pinned) => {
			pins.push(`project:${pinned}`);
		},
		projectByKey: key => (key === project.key ? project : undefined),
		deleteConversation: async () => true,
		scanWarningNames: () => options.warningNames ?? [],
	};
	return {
		source,
		persisted,
		queries,
		pins,
		get refreshes() {
			return refreshes;
		},
		setView: (next: ResumeTreeView | null) => {
			current = next;
		},
	};
}

describe("resume tree rows", () => {
	const row = conversationRow("a1", "Alpha feature work with a long title");
	const widths = [40, 80, 120] as const;

	it("keeps the status word at every width and drops the lowest-priority segments first", () => {
		for (const width of widths) {
			const line = plainText(renderConversationRow(row, { width, selected: false, now: T + 2 * HOUR }));
			expect(line).toContain("done");
			expect(line.length).toBeLessThanOrEqual(width);
		}
		expect(plainText(renderConversationRow(row, { width: 40, selected: false, now: T + 2 * HOUR }))).not.toContain(
			"turns",
		);
		expect(plainText(renderConversationRow(row, { width: 120, selected: false, now: T + 2 * HOUR }))).toContain(
			"4 turns",
		);
	});

	it("renders golden rows at 40, 80 and 120 columns", () => {
		const golden = widths.map(width =>
			plainText(renderConversationRow(row, { width, selected: false, now: T + 2 * HOUR })),
		);
		expect(golden).toEqual([
			"  " + "    " + "done  ·  Alpha feature work with …",
			"  " + "    " + "done  ·  Alpha feature work with a long title  ·  2 hours ago  ·  4 turns",
			"  " + "    " + "done  ·  Alpha feature work with a long title  ·  2 hours ago  ·  4 turns",
		]);
		expect(
			widths.map(width => plainText(renderWorkspaceRow(workspaceRow, { width, selected: false, collapsed: false }))),
		).toEqual([
			"  " + "  " + "▾ feat/tree  ·  2 conversations",
			"  " + "  " + "▾ feat/tree  ·  packages/app  ·  2 conversations",
			"  " + "  " + "▾ feat/tree  ·  packages/app  ·  2 conversations",
		]);
		expect(
			widths.map(width =>
				plainText(renderProjectRow(projectRow, { width, selected: false, collapsed: false, now: T + HOUR })),
			),
		).toEqual([
			"  " + "▾ 📌 repo  ·  2 conversations",
			"  " + "▾ 📌 repo  ·  2 conversations  ·  1 workspace  ·  1 hour ago",
			"  " + "▾ 📌 repo  ·  2 conversations  ·  1 workspace  ·  1 hour ago",
		]);
	});

	it("middle-ellipsizes long paths and keeps the tail", () => {
		const result = middleEllipsis("/home/user/projects/zeta/packages/tui/src/overlays/session-selector.ts", 40);
		expect(result).toContain("…");
		expect(result.startsWith("/home")).toBe(true);
		expect(result.endsWith("session-selector.ts")).toBe(true);
		expect(result.length).toBeLessThanOrEqual(40);
	});

	it("renders the scope control with counts and shortens the selected tab", () => {
		const summary = { workspaceName: "app", projectName: "repo", counts: { workspace: 2, project: 9, all: 40 } };
		const wide = plainText(renderScopeHeader("project", summary, 120));
		expect(wide).toContain("[this repository]");
		expect(wide).toContain("this workspace");
		expect(wide).toContain("all projects");
		expect(wide).toContain("40");
		expect(plainText(renderScopeHeader("project", summary, 40)).length).toBeLessThanOrEqual(40);
	});

	it("flattens rows under collapse state and expands everything while searching", () => {
		const rows = [projectRow, workspaceRow, conversationRow("a1", "Alpha")];
		expect(
			flattenResumeRows(
				rows,
				{ collapsedProjects: new Set(), expandedProjects: new Set(), collapsedWorkspaces: new Set() },
				false,
			),
		).toHaveLength(3);
		expect(
			flattenResumeRows(
				rows,
				{ collapsedProjects: new Set(["/work/repo"]), expandedProjects: new Set(), collapsedWorkspaces: new Set() },
				false,
			),
		).toHaveLength(1);
		expect(
			flattenResumeRows(
				rows,
				{ collapsedProjects: new Set(["/work/repo"]), expandedProjects: new Set(), collapsedWorkspaces: new Set() },
				true,
			),
		).toHaveLength(3);
		expect(
			flattenResumeRows(
				rows,
				{ collapsedProjects: new Set(), expandedProjects: new Set(), collapsedWorkspaces: new Set(["/work/repo"]) },
				false,
			),
		).toHaveLength(2);
	});
});

describe("resume tree component", () => {
	function make(
		initial: ResumeTreeView | null,
		options: Parameters<typeof fakeSource>[1] & {
			onSelect?: (conversation: ResumeTreeConversation) => void;
			onCancel?: () => void;
			searchFocused?: boolean;
		} = {},
	) {
		const source = fakeSource(initial, options);
		const selected: ResumeTreeConversation[] = [];
		let cancelled = 0;
		const component = new ResumeTreeComponent({
			source: source.source,
			getTerminalRows: () => 24,
			onSelect: conversation => {
				selected.push(conversation);
				options.onSelect?.(conversation);
			},
			onCancel: () => {
				cancelled += 1;
				options.onCancel?.();
			},
			onExit: () => {},
			searchFocused: options.searchFocused,
		});
		return { component, source, selected, cancelled: () => cancelled };
	}

	const rows = [projectRow, workspaceRow, conversationRow("a1", "Alpha"), conversationRow("a2", "Beta")];

	it("cycles scope in both directions and remembers the choice", () => {
		const { component, source } = make(view(rows), { initialScope: "workspace", searchFocused: false });
		expect(component.scope).toBe("workspace");
		component.handleInput("\t");
		expect(component.scope).toBe("project");
		component.handleInput("\t");
		expect(component.scope).toBe("all");
		component.handleInput("\t");
		expect(component.scope).toBe("workspace");
		component.handleInput("\x1b[Z");
		expect(component.scope).toBe("all");
		expect(source.persisted).toEqual(["project", "all", "workspace", "all"]);
	});

	it("follows the scope in the search placeholder", () => {
		const { component } = make(view(rows), { initialScope: "workspace" });
		expect(plainText(component.render(80).join("\n"))).toContain("Search conversations in app…");
		component.handleInput("\t");
		expect(plainText(component.render(80).join("\n"))).toContain("Search conversations in repo…");
		component.handleInput("\t");
		expect(plainText(component.render(80).join("\n"))).toContain("Search all conversations…");
	});

	it("renders a skeleton before the first scan lands", () => {
		const { component } = make(null);
		const rendered = plainText(component.render(60).join("\n"));
		expect(rendered).toContain("Loading conversations…");
		expect(rendered).toContain("░");
	});

	it("distinguishes an empty scope, an empty search and filtering", () => {
		const scopeEmpty = make(view([], { totalConversations: 0 }));
		expect(plainText(scopeEmpty.component.render(60).join("\n"))).toContain("No conversations yet.");

		const workspaceEmpty = make(view([], { totalConversations: 0 }), { initialScope: "workspace" });
		expect(plainText(workspaceEmpty.component.render(60).join("\n"))).toContain(
			"No conversations in this workspace.",
		);

		const projectEmpty = make(view([], { totalConversations: 0 }), { initialScope: "project" });
		expect(plainText(projectEmpty.component.render(60).join("\n"))).toContain("No conversations in this repository.");

		const noMatch = make(view([], { totalConversations: 5, conversations: 0 }));
		noMatch.component.handleInput("z");
		noMatch.component.handleInput("z");
		noMatch.component.handleInput("z");
		const text = plainText(noMatch.component.render(60).join("\n"));
		expect(text).toContain("No conversations match “zzz”");
		expect(text).toContain("Esc clears the search");

		const filtered = make(view(rows, { totalConversations: 5, conversations: 2 }));
		filtered.component.handleInput("a");
		expect(plainText(filtered.component.render(60).join("\n"))).toContain("3 conversations hidden by filter");
	});

	it("surfaces partial scan failures as a banner while keeping rows listed", () => {
		const { component } = make(view(rows), { warningNames: ["broken-project"] });
		const text = plainText(component.render(80).join("\n"));
		expect(text).toContain("Some conversation folders could not be read: broken-project");
		expect(text).toContain("Alpha");
	});

	it("maps the resume keys", async () => {
		const { component, selected } = make(view(rows), { searchFocused: false });
		// Enter resumes the selected conversation once the cursor is on one.
		component.handleInput("\x1b[B");
		component.handleInput("\x1b[B");
		component.handleInput("\r");
		expect(selected.map(entry => entry.id)).toEqual(["a1"]);

		// Left collapses a group, right expands it again.
		component.handleInput("\x1b[A");
		component.handleInput("\x1b[A");
		expect(plainText(component.render(60).join("\n"))).toContain("Alpha");
		component.handleInput("\x1b[D");
		expect(plainText(component.render(60).join("\n"))).not.toContain("Alpha");
		component.handleInput("\x1b[C");
		expect(plainText(component.render(60).join("\n"))).toContain("Alpha");

		// p pins the selected conversation, P pins its project.
		const pinning = make(view(rows), { searchFocused: false });
		pinning.component.handleInput("\x1b[B");
		pinning.component.handleInput("\x1b[B");
		pinning.component.handleInput("p");
		await Promise.resolve();
		await Promise.resolve();
		pinning.component.handleInput("P");
		await Promise.resolve();
		await Promise.resolve();
		expect(pinning.source.pins).toEqual(["a1:true", "project:false"]);

		// r refreshes.
		const refreshing = make(view(rows), { searchFocused: false });
		refreshing.component.handleInput("r");
		await Promise.resolve();
		await Promise.resolve();
		expect(refreshing.source.refreshes).toBe(1);

		// / focuses search; Esc clears it, then a second Esc closes.
		const searching = make(view(rows), { searchFocused: false });
		searching.component.handleInput("/");
		searching.component.handleInput("x");
		expect(searching.source.queries.at(-1)).toBe("x");
		searching.component.handleInput("\x1b");
		expect(searching.source.queries.at(-1)).toBe("");
		searching.component.handleInput("\x1b");
		expect(searching.cancelled()).toBe(1);
	});

	it("words delete after what actually happens and confirms before deleting", () => {
		const trash = make(view(rows), { searchFocused: false });
		trash.component.handleInput("\x1b[B");
		trash.component.handleInput("\x1b[B");
		trash.component.handleInput("\x1b[3~");
		const trashText = plainText(trash.component.render(80).join("\n"));
		expect(trashText).toContain("Move “Alpha” to trash?");
		expect(trashText).toContain("restored from the trash");

		const permanent = make(view(rows), { searchFocused: false, deleteMode: "permanent" });
		permanent.component.handleInput("\x1b[B");
		permanent.component.handleInput("\x1b[B");
		permanent.component.handleInput("\x1b[3~");
		const permanentText = plainText(permanent.component.render(80).join("\n"));
		expect(permanentText).toContain("Permanently delete “Alpha”?");
		expect(permanentText).toContain("cannot be undone");
	});

	it("mounts the ANSI tree through SessionSelectorComponent when a resume source is supplied", () => {
		const source = fakeSource(view(rows), { initialScope: "workspace" });
		const selected: SessionSelectorEntry[] = [];
		const selector = new SessionSelectorComponent<SessionSelectorEntry>(
			[],
			session => selected.push(session),
			() => {},
			() => {},
			{
				resumeSource: source.source,
				getTerminalRows: () => 24,
			} as SessionSelectorOptions<SessionSelectorEntry> & { resumeSource: ResumeTreeSource },
		);
		expect(selector.getResumeTree()).toBeDefined();
		selector.handleInput("\t");
		expect(selector.getResumeTree()?.scope).toBe("project");
		expect(plainText(selector.render(80).join("\n"))).toContain("[this repository]");
		selector.handleInput("\x1b[B");
		selector.handleInput("\x1b[B");
		selector.handleInput("\x1b[3~");
		expect(plainText(selector.render(80).join("\n"))).toContain("Move");
		selector.dispose();
		expect(selected).toHaveLength(0);
	});

	it("keeps every rendered line inside the requested width", () => {
		for (const width of [40, 80, 120]) {
			const { component } = make(view(rows));
			for (const line of component.render(width)) {
				expect(plainText(line).length).toBeLessThanOrEqual(width);
			}
		}
	});
});
