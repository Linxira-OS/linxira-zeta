import { beforeAll, describe, expect, it } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { TUI } from "@linxiraos/pi-tui";
import { plainText } from "../src/native/spans";
import { visibleWidth } from "../src/utils";
import {
	ResumeTreeComponent,
	absoluteResumePath,
	flattenResumeRows,
	formatResumePath,
	middleEllipsis,
	renderConversationRow,
	renderProjectRow,
	renderProjectRule,
	renderProjectSeparator,
	renderScopeHeader,
	renderScopeHeaderHits,
	renderWorkspaceRow,
	shouldShowBranch,
	statusColumnWidth,
	truncateResumePath,
	type ResumeTreeConversation,
	type ResumeTreeConversationRow,
	type ResumeTreeProject,
	type ResumeTreeProjectRow,
	type ResumeTreePickerState,
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
import { initTheme, theme } from "../src/theme";
import { withoutTerminalMultiplexer } from "./helpers/terminal-multiplexer";
import { VirtualRenderScheduler } from "./virtual-render-scheduler";
import { VirtualTerminal } from "./virtual-terminal";

withoutTerminalMultiplexer();

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

function renameInView(view: ResumeTreeView | null, key: string, title: string): ResumeTreeView | null {
	if (!view) return view;
	const renameRow = <T extends ResumeTreeRow>(row: T): T =>
		row.type === "conversation" && row.key === key
			? ({
					...row,
					conversation: {
						...row.conversation,
						title,
						session: { ...row.conversation.session, title },
					},
				} as T)
			: row;
	return {
		...view,
		rows: view.rows.map(renameRow),
		conversations: view.conversations?.map(renameRow),
	};
}

function renameWorkspaceInView(view: ResumeTreeView | null, key: string, alias: string | null): ResumeTreeView | null {
	if (!view) return view;
	const renameRow = <T extends ResumeTreeRow>(row: T): T =>
		row.type === "workspace" && row.key === key
			? ({
					...row,
					workspace: {
						...row.workspace,
						alias,
						displayName: alias ?? row.workspace.name,
					},
				} as T)
			: row;
	return { ...view, rows: view.rows.map(renameRow) };
}

function fakeSource(
	initial: ResumeTreeView | null,
	options: {
		initialScope?: ResumeTreeScope;
		deleteMode?: "trash" | "permanent";
		viewFor?: (scope: ResumeTreeScope, query: string) => ResumeTreeView | null;
		warningNames?: readonly string[];
		pickerState?: ResumeTreePickerState;
		canRename?: boolean;
		applyRenames?: boolean;
	} = {},
) {
	const persisted: ResumeTreeScope[] = [];
	const persistedStates: ResumeTreePickerState[] = [];
	const queries: string[] = [];
	const pins: string[] = [];
	const renames: string[] = [];
	const workspaceRenames: string[] = [];
	const deletes: string[] = [];
	const opened: string[] = [];
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
		persistPickerState: state => {
			persistedStates.push(state);
		},
		...(options.pickerState ? { pickerState: () => options.pickerState! } : {}),
		refresh: async () => {
			refreshes += 1;
		},
		canRenameConversation: () => options.canRename ?? true,
		renameConversation: async (entry, title) => {
			if (options.canRename === false) return null;
			renames.push(`${entry.id}:${title}`);
			if (options.applyRenames) current = renameInView(current, entry.key, title);
			return title;
		},
		renameWorkspace: async (workspace, alias) => {
			const stored = alias?.trim() || null;
			workspaceRenames.push(`${workspace.key}:${stored ?? ""}`);
			if (options.applyRenames) current = renameWorkspaceInView(current, workspace.key, stored);
			return stored ?? workspace.name;
		},
		pinWorkspace: async (workspace, pinned) => {
			pins.push(`workspace:${workspace.key}:${pinned}`);
		},
		openWorkspace: workspace => {
			opened.push(workspace.key);
		},
		pinConversation: async (entry, pinned) => {
			pins.push(`${entry.id}:${pinned}`);
		},
		pinProject: async (_entry, pinned) => {
			pins.push(`project:${pinned}`);
		},
		projectByKey: key => (key === project.key ? project : undefined),
		deleteConversation: async conversation => {
			deletes.push(conversation.id);
			return true;
		},
		scanWarningNames: () => options.warningNames ?? [],
	};
	return {
		source,
		persisted,
		persistedStates,
		queries,
		pins,
		renames,
		workspaceRenames,
		deletes,
		opened,
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
			" ".repeat(13) + "done  Alpha feature wor…  ⋯",
			" ".repeat(13) + "done  Alpha feature work with a long ti…  4 turns  ·  2 hours ago ⋯",
			" ".repeat(13) +
				"done  Alpha feature work with a long title                                        4 turns  ·  2 hours ago ⋯",
		]);
		expect(
			widths.map(width => plainText(renderWorkspaceRow(workspaceRow, { width, selected: false, collapsed: false }))),
		).toEqual([
			"  " + "  " + "▾ app [feat/tree]  2 conversations ⋯",
			"  " + "  " + "▾ app [feat/tree]  packages/app                            2 conversations ⋯",
			"  " +
				"  " +
				"▾ app [feat/tree]  packages/app                                                                    2 conversations ⋯",
		]);
		expect(
			widths.map(width =>
				plainText(renderProjectRow(projectRow, { width, selected: false, collapsed: false, now: T + HOUR })),
			),
		).toEqual([
			"  " + "▾ 📌 repo (work/repo)  2 conversations",
			"  " + "▾ 📌 repo (work/repo)           2 conversations  ·  1 workspace  ·  1 hour ago",
			"  " +
				"▾ 📌 repo (work/repo)                                                   2 conversations  ·  1 workspace  ·  1 hour ago",
		]);
	});

	it("renders exact-width single-line rows and a full-width project rule", () => {
		for (const width of [40, 80, 120]) {
			const line = plainText(renderConversationRow(row, { width, selected: false, now: T + 2 * HOUR }));
			expect(line).not.toContain("\n");
			expect(line.length).toBe(width);
			expect(plainText(renderProjectRule(width)).length).toBe(width);
		}
		// The status column is fixed for every row, independent of status.
		const interrupted = conversationRow("i1", "Interrupted", {
			conversation: { ...conversation("i1", "Interrupted"), status: "interrupted" },
		});
		const first = plainText(renderConversationRow(row, { width: 80, selected: false, now: T }));
		const second = plainText(renderConversationRow(interrupted, { width: 80, selected: false, now: T }));
		expect(first.indexOf("Alpha")).toBe(second.indexOf("Interrupted"));
		expect(statusColumnWidth()).toBeGreaterThanOrEqual("interrupted".length);
	});

	it("draws a distinct colored rule between project groups only", () => {
		for (const width of [20, 40, 80, 120]) {
			const separator = renderProjectSeparator(width);
			expect(plainText(separator)).toBe(theme.boxRound.horizontal.repeat(width));
			expect(separator).toBe(theme.fg("muted", theme.boxRound.horizontal.repeat(width)));
			// Brighter than the header rule, but still a quiet full-width line.
			expect(separator).not.toBe(renderProjectRule(width));
			expect(plainText(renderProjectRule(width))).toBe(plainText(separator));
		}
	});

	it("middle-ellipsizes long paths and keeps the tail", () => {
		const result = middleEllipsis("/home/user/projects/zeta/packages/tui/src/overlays/session-selector.ts", 40);
		expect(result).toContain("…");
		expect(result.startsWith("/home")).toBe(true);
		expect(result.endsWith("session-selector.ts")).toBe(true);
		expect(result.length).toBeLessThanOrEqual(40);
	});

	it("spells full paths with their own platform syntax", () => {
		expect(absoluteResumePath("D:\\CODE\\proj")).toBe("D:\\CODE\\proj");
		expect(absoluteResumePath("D:/CODE/proj")).toBe("D:\\CODE\\proj");
		expect(absoluteResumePath("\\\\server\\share\\proj")).toBe("\\\\server\\share\\proj");
		expect(absoluteResumePath("//server/share/proj")).toBe("\\\\server\\share\\proj");
		expect(absoluteResumePath("/home/user/proj")).toBe("/home/user/proj");
		expect(absoluteResumePath("/mnt/c/CODE/proj")).toBe("/mnt/c/CODE/proj");

		expect(formatResumePath("D:\\CODE\\proj", false)).toBe("CODE\\proj");
		expect(formatResumePath("\\\\server\\share\\proj", false)).toBe("share\\proj");
		expect(formatResumePath("/home/user/proj", false)).toBe("user/proj");
		expect(formatResumePath("/mnt/c/CODE/proj", false)).toBe("CODE/proj");
	});

	it("truncates full paths from the left at 40, 80 and 120 columns", () => {
		const windows = "D:\\CODE\\zeta\\packages\\tui\\src\\overlays\\resume-tree.ts";
		const unc = "\\\\server\\share\\zeta\\packages\\tui\\src\\overlays\\resume-tree.ts";
		const linux = "/home/user/projects/zeta/packages/tui/src/overlays/resume-tree.ts";
		for (const path of [windows, unc, linux]) {
			for (const width of widths) {
				const rendered = truncateResumePath(path, width);
				expect(visibleWidth(rendered)).toBeLessThanOrEqual(width);
				expect(rendered).not.toContain("\n");
				if (visibleWidth(path) > width) {
					expect(rendered).toContain("…");
					expect(rendered.endsWith("resume-tree.ts")).toBe(true);
				} else {
					expect(rendered).toBe(path);
				}
			}
		}
		expect(truncateResumePath(windows, 40).startsWith("D:\\…")).toBe(true);
		expect(truncateResumePath(unc, 40).startsWith("\\\\server\\share\\…")).toBe(true);
		expect(truncateResumePath(linux, 40).startsWith("…")).toBe(true);
	});

	it("applies full paths to project, workspace and cwd labels", () => {
		const windowsRoot = "D:\\CODE\\zeta";
		const windowsProject = {
			...projectRow,
			key: windowsRoot,
			project: { ...project, key: windowsRoot, root: windowsRoot, name: "zeta", displayName: "zeta" },
		};
		const shortProject = plainText(
			renderProjectRow(windowsProject, { width: 120, selected: false, collapsed: false, fullPaths: false }),
		);
		const fullProject = plainText(
			renderProjectRow(windowsProject, { width: 120, selected: false, collapsed: false, fullPaths: true }),
		);
		expect(shortProject).toContain("(CODE\\zeta)");
		expect(fullProject).toContain("(D:\\CODE\\zeta)");

		const windowsWorkspace = {
			...workspaceRow,
			workspace: { ...workspace, path: "D:\\CODE\\zeta\\packages\\app" },
		};
		expect(
			plainText(renderWorkspaceRow(windowsWorkspace, { width: 120, selected: false, collapsed: false })),
		).toContain("packages\\app");
		expect(
			plainText(
				renderWorkspaceRow(windowsWorkspace, { width: 120, selected: false, collapsed: false, fullPaths: true }),
			),
		).toContain("D:\\CODE\\zeta\\packages\\app");

		const cwdRow = conversationRow("windows", "Windows run", {
			conversation: { ...conversation("windows", "Windows run"), cwd: "D:\\CODE\\proj" },
		});
		expect(plainText(renderConversationRow(cwdRow, { width: 120, selected: false, fullPaths: true }))).toContain(
			"D:\\CODE\\proj",
		);
		expect(plainText(renderConversationRow(cwdRow, { width: 120, selected: false, fullPaths: false }))).not.toContain(
			"D:\\CODE\\proj",
		);

		for (const root of [windowsRoot, "\\\\server\\share\\zeta", "/home/user/zeta"]) {
			const row = {
				...projectRow,
				key: root,
				project: { ...project, key: root, root, name: "zeta", displayName: "zeta" },
			};
			for (const width of widths) {
				const line = plainText(
					renderProjectRow(row, { width, selected: false, collapsed: false, fullPaths: true }),
				);
				expect(line).not.toContain("\n");
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
		}
		for (const width of widths) {
			const lines = [
				plainText(renderProjectRow(windowsProject, { width, selected: false, collapsed: false, fullPaths: true })),
				plainText(
					renderWorkspaceRow(windowsWorkspace, { width, selected: false, collapsed: false, fullPaths: true }),
				),
				plainText(renderConversationRow(cwdRow, { width, selected: false, fullPaths: true })),
			];
			for (const line of lines) {
				expect(line).not.toContain("\n");
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
		}
	});

	it("shows a branch only when it differs from the current workspace", () => {
		expect(shouldShowBranch("main", "main", false)).toBe(false);
		expect(shouldShowBranch("feat/x", "main", false)).toBe(true);
		expect(shouldShowBranch("main", "main", true)).toBe(true);
		expect(shouldShowBranch("app", undefined, false, "app")).toBe(false);
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
		expect(source.persistedStates.map(state => state.scope)).toEqual(["project", "all", "workspace", "all"]);
	});

	it("toggles full paths in project and all scopes and persists the choice", () => {
		for (const initialScope of ["project", "all"] as const) {
			const { component, source } = make(view(rows), { initialScope, searchFocused: false });
			expect(component.fullPaths).toBe(false);
			expect(plainText(component.render(80).join("\n"))).toContain("(work/repo)");
			component.handleInput("\x06");
			expect(component.fullPaths).toBe(true);
			expect(plainText(component.render(80).join("\n"))).toContain("(/work/repo)");
			expect(source.persistedStates.at(-1)?.fullPaths).toBe(true);
			component.handleInput("\x06");
			expect(component.fullPaths).toBe(false);
			expect(source.persistedStates.at(-1)?.fullPaths).toBe(false);
		}
	});

	it("does not toggle full paths in workspace scope and explains why", () => {
		const { component, source } = make(view(rows), { initialScope: "workspace", searchFocused: false });
		component.handleInput("\x06");
		expect(component.fullPaths).toBe(false);
		expect(source.persistedStates).toEqual([]);
		expect(plainText(component.render(80).join("\n"))).toContain("Full paths matter outside this workspace");
		component.handleInput("\t"); // project scope
		component.handleInput("\x06");
		expect(component.fullPaths).toBe(true);
		expect(source.persistedStates.at(-1)?.fullPaths).toBe(true);
	});

	it("restores fullPaths from the picker state", () => {
		const { component } = make(view(rows), {
			initialScope: "project",
			pickerState: { scope: "project", fullPaths: true },
			searchFocused: false,
		});
		expect(component.fullPaths).toBe(true);
		expect(plainText(component.render(80).join("\n"))).toContain("(/work/repo)");
	});

	it("keeps the search hint on one line", () => {
		const { component } = make(view(rows), { initialScope: "workspace" });
		const lines = component.render(80).map(plainText);
		expect(lines.some(line => line.includes("/") && line.includes("Search conversations in app"))).toBe(true);
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
		await flush();
		pinning.component.handleInput("P");
		await flush();
		expect(pinning.source.pins).toEqual(["a1:true", "project:false"]);

		// r refreshes.
		const refreshing = make(view(rows), { searchFocused: false });
		refreshing.component.handleInput("r");
		await flush();
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

	it("hit-tests mouse clicks, double clicks, headers, wheel and scope segments", () => {
		const mouse = (button: number, col: number, row: number) => `\x1b[<${button};${col + 1};${row + 1}M`;
		const many = Array.from({ length: 8 }, (_, index) => conversationRow(`c${index + 1}`, `Row ${index + 1}`));
		const { component, selected } = make(view(many), { initialScope: "workspace", searchFocused: false });
		component.render(80);

		// Click selects only; keyboard still resumes the clicked row.
		component.handleInput(mouse(0, 5, 4));
		component.handleInput("\r");
		expect(selected.map(entry => entry.id)).toEqual(["c2"]);

		// A double click resumes directly.
		const double = make(view(many), { initialScope: "workspace", searchFocused: false });
		double.component.render(80);
		double.component.handleInput(mouse(0, 5, 3));
		double.component.handleInput(mouse(0, 5, 3));
		expect(double.selected.map(entry => entry.id)).toEqual(["c1"]);

		// Wheel moves three rows; the keyboard keeps working afterwards.
		const wheel = make(view(many), { initialScope: "workspace", searchFocused: false });
		wheel.component.render(80);
		wheel.component.handleInput(mouse(65, 5, 1));
		wheel.component.handleInput("\r");
		expect(wheel.selected.map(entry => entry.id)).toEqual(["c4"]);

		// Clicking a scope segment switches scope.
		const scope = make(view(many), { initialScope: "workspace", searchFocused: false });
		scope.component.render(80);
		const summary = { workspaceName: "app", projectName: "repo", counts: { workspace: 8, project: 8, all: 8 } };
		const projectHit = renderScopeHeaderHits("workspace", summary, 80).hits.find(hit => hit.kind === "project")!;
		scope.component.handleInput(mouse(0, projectHit.start, 0));
		expect(scope.component.scope).toBe("project");
	});

	async function flush(): Promise<void> {
		for (let index = 0; index < 6; index++) await Promise.resolve();
	}

	function clickModalButton(component: ResumeTreeComponent, label: string): void {
		const lines = component.render(80).map(plainText);
		const line = lines.findIndex(candidate => candidate.includes(label));
		expect(line).toBeGreaterThanOrEqual(0);
		const column = lines[line]!.indexOf(label) + 1;
		component.handleInput(`\x1b[<0;${column};${line + 1}M`);
	}

	it("opens the workspace menu, renames the alias and runs the other actions", async () => {
		const { component, source } = make(view(rows), { searchFocused: false });
		component.handleInput("\x1b[B"); // workspace
		component.handleInput("m");
		expect(plainText(component.render(80).join("\n"))).toContain("workspace");

		component.handleInput("\r"); // rename
		component.handleInput(" renamed");
		component.handleInput("\r");
		await flush();
		expect(source.workspaceRenames.at(-1)).toBe(`${workspace.key}:app renamed`);

		component.handleInput("m");
		component.handleInput("\x1b[B"); // collapse/expand
		component.handleInput("\r");
		expect(plainText(component.render(80).join("\n"))).not.toContain("Alpha");

		component.handleInput("m");
		component.handleInput("\x1b[B");
		component.handleInput("\x1b[B"); // open
		component.handleInput("\r");
		await Promise.resolve();
		expect(source.opened).toEqual([workspace.key]);

		component.handleInput("m");
		component.handleInput("\x1b[B");
		component.handleInput("\x1b[B");
		component.handleInput("\x1b[B"); // pin
		component.handleInput("\r");
		await flush();
		expect(source.pins).toContain(`workspace:${workspace.key}:true`);
	});

	it("renames a conversation through the session-title API", async () => {
		const { component, source } = make(view(rows), { searchFocused: false });
		component.handleInput("\x1b[B");
		component.handleInput("\x1b[B"); // first conversation
		component.handleInput("m");
		component.handleInput("\r"); // rename
		component.handleInput(" updated");
		component.handleInput("\r");
		await flush();
		expect(source.renames).toEqual(["a1:Alpha updated"]);
	});

	it("disables rename for a read-only conversation", async () => {
		const { component, source } = make(view(rows), { searchFocused: false, canRename: false });
		component.handleInput("\x1b[B");
		component.handleInput("\x1b[B");
		component.handleInput("m");
		component.handleInput("\r"); // disabled rename does nothing
		expect(plainText(component.render(80).join("\n"))).not.toContain("✎");
		expect(source.renames).toEqual([]);
	});

	it("types f into search while Ctrl+F toggles full paths", () => {
		const { component } = make(view(rows), { initialScope: "project", searchFocused: true });
		component.handleInput("f");
		const lines = component.render(80).map(plainText);
		expect(lines[1]).toContain("/ f");
		expect(component.fullPaths).toBe(false);
		component.handleInput("\x06");
		expect(component.fullPaths).toBe(true);
		expect(component.render(80).map(plainText)[1]).toContain("/ f");
	});

	it("renames the selected conversation with Ctrl+R", async () => {
		const { component, source } = make(view(rows), { searchFocused: false });
		component.handleInput("\x1b[B");
		component.handleInput("\x1b[B");
		component.handleInput("\x12");
		expect(plainText(component.render(80).join("\n"))).toContain("✎ Rename conversation");
		component.handleInput(" updated");
		component.handleInput("\r");
		await flush();
		expect(source.renames).toEqual(["a1:Alpha updated"]);
	});

	it("renames the selected workspace with Ctrl+R and leaves projects inert", () => {
		const { component } = make(view(rows), { searchFocused: false });
		component.handleInput("\x12"); // project
		expect(plainText(component.render(80).join("\n"))).not.toContain("Rename");
		component.handleInput("\x1b[B"); // workspace
		component.handleInput("\x12");
		expect(plainText(component.render(80).join("\n"))).toContain("✎ Rename workspace");
	});

	it("isolates every tree key while the rename box is open", () => {
		const { component, source } = make(view(rows), { searchFocused: false });
		component.handleInput("\x1b[B");
		component.handleInput("\x1b[B");
		component.handleInput("m");
		component.handleInput("\r"); // rename conversation
		component.handleInput("x/m");
		component.handleInput("\t");
		component.handleInput("\x1b[C");
		component.handleInput("\x1b[3~");
		const rendered = plainText(component.render(80).join("\n"));
		expect(rendered).toContain("Alphax/m");
		expect(rendered).toContain("✎ Rename conversation");
		expect(rendered).toContain("Enter saves");
		expect(component.render(80).map(plainText)[1]).toContain("Search all conversations");
		// Tab did not switch scope and the delete modal did not open.
		expect(component.scope).toBe("all");
		expect(rendered).not.toContain("Move “");
		// Esc cancels without renaming.
		component.handleInput("\x1b");
		expect(source.renames).toEqual([]);
		expect(plainText(component.render(80).join("\n"))).not.toContain("✎");
	});

	it("keeps the rename box open on an empty name", () => {
		const { component, source } = make(view(rows), { searchFocused: false });
		component.handleInput("\x12");
		component.handleInput("\x1b[B");
		component.handleInput("\x1b[B"); // move selection before Ctrl+R
		component.handleInput("\x12");
		for (let index = 0; index < 5; index++) component.handleInput("\x7f");
		component.handleInput("\r");
		const rendered = plainText(component.render(80).join("\n"));
		expect(rendered).toContain("✎ Rename conversation");
		expect(rendered).toContain("A name is required");
		expect(source.renames).toEqual([]);
	});

	it("disables Ctrl+R rename for a read-only conversation", () => {
		const { component, source } = make(view(rows), { searchFocused: false, canRename: false });
		component.handleInput("\x1b[B");
		component.handleInput("\x1b[B");
		component.handleInput("\x12");
		expect(plainText(component.render(80).join("\n"))).not.toContain("Rename conversation");
		expect(source.renames).toEqual([]);
	});

	it("refreshes and shows the stored conversation name after rename", async () => {
		const { component, source } = make(view(rows), { searchFocused: false, applyRenames: true });
		component.handleInput("\x1b[B");
		component.handleInput("\x1b[B");
		component.handleInput("\x12");
		component.handleInput(" renamed");
		component.handleInput("\r");
		await flush();
		expect(source.refreshes).toBeGreaterThan(0);
		const rendered = plainText(component.render(80).join("\n"));
		expect(rendered).toContain("Alpha renamed");
		expect(rendered).not.toContain("still shows");
	});

	it("reports a refresh that still shows the old name", async () => {
		const { component, source } = make(view(rows), { searchFocused: false });
		component.handleInput("\x1b[B");
		component.handleInput("\x1b[B");
		component.handleInput("\x12");
		component.handleInput(" renamed");
		component.handleInput("\r");
		await flush();
		expect(source.renames).toEqual(["a1:Alpha renamed"]);
		expect(source.refreshes).toBeGreaterThan(0);
		expect(plainText(component.render(80).join("\n"))).toContain("still shows “Alpha”");
	});

	it("refreshes and shows the stored workspace alias after rename", async () => {
		const { component } = make(view(rows), { searchFocused: false, applyRenames: true });
		component.handleInput("\x1b[B");
		component.handleInput("\x12");
		component.handleInput(" alias");
		component.handleInput("\r");
		await flush();
		const rendered = plainText(component.render(80).join("\n"));
		expect(rendered).toContain("app alias");
		expect(rendered).not.toContain("still shows");
	});

	it("confirms and cancels rename with the box buttons", async () => {
		const { component, source } = make(view(rows), { searchFocused: false });
		component.handleInput("\x1b[B");
		component.handleInput("\x1b[B");
		component.handleInput("\x12");
		component.handleInput("!");
		clickModalButton(component, "[Cancel]");
		expect(plainText(component.render(80).join("\n"))).not.toContain("Rename conversation");

		component.handleInput("\x12");
		component.handleInput("!");
		clickModalButton(component, "[Confirm]");
		await flush();
		expect(source.renames).toEqual(["a1:Alpha!"]);
	});

	it("runs conversation pin and delete from the menu", async () => {
		const { component, source } = make(view(rows), { searchFocused: false });
		component.handleInput("\x1b[B");
		component.handleInput("\x1b[B");
		component.handleInput("m");
		component.handleInput("\x1b[B"); // pin
		component.handleInput("\r");
		await flush();
		expect(source.pins).toContain("a1:true");

		component.handleInput("m");
		component.handleInput("\x1b[B");
		component.handleInput("\x1b[B"); // delete
		component.handleInput("\r");
		expect(plainText(component.render(80).join("\n"))).toContain("Move “Alpha” to trash?");
	});

	it("opens the menu from the right-edge affordance and clicks a menu item", () => {
		const { component } = make(view([workspaceRow]), { searchFocused: false });
		component.render(80);
		// Line 3 is the workspace row; column 80 is its `⋯`.
		component.handleInput("\x1b[<0;80;4M");
		expect(plainText(component.render(80).join("\n"))).toContain("┌ workspace");
		// The first menu item is the next rendered line.
		component.handleInput("\x1b[<0;4;6M");
		expect(plainText(component.render(80).join("\n"))).toContain("✎");
	});

	it("never deletes from plain Enter", () => {
		const { component, selected, source } = make(view(rows), { searchFocused: false });
		component.handleInput("\x1b[B");
		component.handleInput("\x1b[B");
		component.handleInput("\r");
		expect(selected.map(entry => entry.id)).toEqual(["a1"]);
		component.handleInput("\x1b[A");
		component.handleInput("\r"); // workspace header collapses
		component.handleInput("\r"); // expands again
		expect(source.deletes).toEqual([]);

		const empty = make(view([]), { searchFocused: false });
		empty.component.handleInput("\r");
		expect(empty.source.deletes).toEqual([]);
	});

	it("opens the trash/permanent modal only from Ctrl+Enter or Delete", async () => {
		for (const deleteMode of ["trash", "permanent"] as const) {
			const { component, source } = make(view(rows), { searchFocused: false, deleteMode });
			component.handleInput("\x1b[B");
			component.handleInput("\x1b[B");
			component.handleInput("\x1b[13;5u");
			const text = plainText(component.render(80).join("\n"));
			expect(text).toContain(deleteMode === "permanent" ? "Permanently delete “Alpha”?" : "Move “Alpha” to trash?");
			expect(source.deletes).toEqual([]);
			component.handleInput("\r");
			await Promise.resolve();
			await Promise.resolve();
			expect(source.deletes).toEqual(["a1"]);
		}

		const viaDelete = make(view(rows), { searchFocused: false });
		viaDelete.component.handleInput("\x1b[B");
		viaDelete.component.handleInput("\x1b[B");
		viaDelete.component.handleInput("\x1b[3~");
		expect(plainText(viaDelete.component.render(80).join("\n"))).toContain("Move “Alpha” to trash?");
		expect(viaDelete.source.deletes).toEqual([]);
	});

	it("isolates every key while the delete modal is open", () => {
		const { component, source } = make(view(rows), { searchFocused: false });
		component.handleInput("\x1b[B");
		component.handleInput("\x1b[B");
		component.handleInput("\x1b[13;5u");
		for (const key of ["/", "m", "\t", "r", "p"]) component.handleInput(key);
		const rendered = plainText(component.render(80).join("\n"));
		expect(rendered).toContain("Move “Alpha” to trash?");
		expect(component.scope).toBe("all");
		expect(component.render(80).map(plainText)[1]).toContain("Search all conversations");
		expect(source.deletes).toEqual([]);
		component.handleInput("n");
		expect(plainText(component.render(80).join("\n"))).not.toContain("Move “Alpha”");
		expect(source.deletes).toEqual([]);
	});

	it("confirms and cancels deletion with modal buttons", async () => {
		const { component, source } = make(view(rows), { searchFocused: false });
		component.handleInput("\x1b[B");
		component.handleInput("\x1b[B");
		component.handleInput("\x1b[13;5u");
		clickModalButton(component, "[Cancel]");
		expect(plainText(component.render(80).join("\n"))).not.toContain("Move “Alpha”");
		expect(source.deletes).toEqual([]);

		component.handleInput("\x1b[13;5u");
		clickModalButton(component, "[Confirm]");
		await flush();
		expect(source.deletes).toEqual(["a1"]);
	});

	it("opens the same delete modal from the row menu", async () => {
		const { component, source } = make(view(rows), { searchFocused: false });
		component.handleInput("\x1b[B");
		component.handleInput("\x1b[B");
		component.handleInput("m");
		component.handleInput("\x1b[B");
		component.handleInput("\x1b[B");
		component.handleInput("\r");
		expect(plainText(component.render(80).join("\n"))).toContain("Move “Alpha” to trash?");
		expect(source.deletes).toEqual([]);
		component.handleInput("y");
		await flush();
		expect(source.deletes).toEqual(["a1"]);
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

	it("splits the footer into key hints on the left and mouse hints on the right", () => {
		const source = fakeSource(view(rows), { initialScope: "workspace" });
		const selector = new SessionSelectorComponent<SessionSelectorEntry>(
			[],
			() => {},
			() => {},
			() => {},
			{
				resumeSource: source.source,
				getTerminalRows: () => 24,
			} as SessionSelectorOptions<SessionSelectorEntry> & { resumeSource: ResumeTreeSource },
		);
		for (const width of [80, 120]) {
			const rendered = selector.render(width).map(plainText);
			const footer = rendered.find(line => line.includes("click select"));
			expect(footer).toBeDefined();
			expect(footer!).toContain("wheel");
			expect(footer!.length).toBeLessThanOrEqual(width);
			expect(footer!.indexOf("enter resume")).toBeLessThan(footer!.indexOf("click select"));
			expect(footer!).not.toContain("full paths");
		}
		selector.handleInput("\t");
		for (const width of [80, 120]) {
			const projectFooter = selector
				.render(width)
				.map(plainText)
				.find(line => line.includes("click select"));
			expect(projectFooter).toContain("^f full paths");
		}
		selector.dispose();
	});

	it("routes mouse reports from the selector into the tree without breaking keys", () => {
		const source = fakeSource(view([conversationRow("a1", "Alpha"), conversationRow("a2", "Beta")]), {
			initialScope: "workspace",
		});
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
		selector.render(80);
		// Tree line 3 (screen row 4 with the panel chrome) is the first row.
		selector.handleInput("\x1b[<0;5;6M");
		selector.handleInput("\r");
		expect(selected.map(entry => entry.id)).toEqual(["a1"]);
		selector.dispose();
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

describe("resume project group separators", () => {
	const WIDTH = 80;
	const HEIGHT = 40;
	const RULE = "─";

	function groupedView(options: { collapsed?: string; projectNames?: readonly string[] } = {}): ResumeTreeView {
		const names = options.projectNames ?? ["alpha", "beta", "gamma"];
		const built: ResumeTreeRow[] = [];
		for (const name of names) {
			const root = `/work/${name}`;
			const projectEntry: ResumeTreeProject = {
				key: root,
				root,
				name,
				alias: null,
				displayName: name,
				isDefault: false,
				pinned: false,
				collapsed: options.collapsed === name,
				lastActivity: new Date(T),
				counts: { conversations: 2, workspaces: 2, pinnedConversations: 0 },
			};
			built.push({
				type: "project",
				key: root,
				project: projectEntry,
				pinned: false,
				collapsed: projectEntry.collapsed,
				conversationCount: 2,
				totalConversationCount: 2,
				workspaceCount: 2,
				totalWorkspaceCount: 2,
			});
			if (projectEntry.collapsed) continue;
			for (const workspaceName of ["app", "lib"]) {
				const workspaceKey = `${root}/${workspaceName}`;
				const workspaceEntry: ResumeTreeWorkspace = {
					key: workspaceKey,
					path: workspaceKey,
					name: workspaceName,
					projectKey: root,
					branch: null,
					pinned: false,
					lastActivity: new Date(T),
					counts: { conversations: 1, pinnedConversations: 0 },
				};
				built.push({
					type: "workspace",
					key: workspaceKey,
					workspace: workspaceEntry,
					projectKey: root,
					pinned: false,
					conversationCount: 1,
					totalConversationCount: 1,
				});
				const id = `${name}-${workspaceName}`;
				const entry = conversation(id, `${name} ${workspaceName} note`, T, {
					projectKey: root,
					workspaceKey,
					cwd: workspaceKey,
				});
				built.push({
					type: "conversation",
					key: id,
					conversation: entry,
					projectKey: root,
					workspaceKey,
					pinned: false,
					current: false,
					pinnedOnly: false,
				});
			}
		}
		return view(built);
	}

	function subset(initial: ResumeTreeView, key: string): ResumeTreeView {
		const rows = initial.rows.filter(row => (row.type === "project" ? row.key === key : row.projectKey === key));
		return view(rows, { totalConversations: initial.counts.totalConversations });
	}

	async function mount(
		initial: ResumeTreeView,
		options: {
			width?: number;
			height?: number;
			viewFor?: (scope: ResumeTreeScope, query: string) => ResumeTreeView | null;
		} = {},
	) {
		const width = options.width ?? WIDTH;
		const height = options.height ?? HEIGHT;
		const terminal = new VirtualTerminal(width, height);
		const scheduler = new VirtualRenderScheduler();
		const tui = new TUI(terminal, true, { renderScheduler: scheduler });
		const source = fakeSource(initial, { viewFor: options.viewFor });
		const component = new ResumeTreeComponent({
			source: source.source,
			getTerminalRows: () => height,
			onSelect: () => {},
			onCancel: () => {},
			onExit: () => {},
			searchFocused: false,
		});
		component.onRequestRender = () => tui.requestRender();
		tui.start();
		tui.showOverlay(component, {
			anchor: "top-left",
			width: "100%",
			maxHeight: "100%",
			margin: 0,
			fullscreen: true,
		});
		tui.setFocus(component);
		await scheduler.settle(terminal);
		return { terminal, tui, component, scheduler };
	}

	function plainViewport(terminal: VirtualTerminal): string[] {
		return terminal.getViewport().map(row => stripVTControlCharacters(row).trimEnd());
	}

	function isRule(line: string | undefined, width = WIDTH): boolean {
		return line !== undefined && line.length === width && /^─+$/.test(line);
	}

	/** Project headers are the only rows whose text starts with a fold glyph at project depth. */
	function headerIndexes(lines: readonly string[]): number[] {
		return lines.flatMap((line, index) => (/^(?: {2}|❯ )(?:▾|▸) /.test(line) ? [index] : []));
	}

	function ruleIndexes(lines: readonly string[], width = WIDTH): number[] {
		return lines.flatMap((line, index) => (isRule(line, width) ? [index] : []));
	}

	it("draws exactly one boundary rule between three projects and keeps the header rule", async () => {
		const initial = groupedView();
		const { terminal, tui, component } = await mount(initial);
		try {
			const lines = plainViewport(terminal);
			const headers = headerIndexes(lines);
			expect(headers).toHaveLength(3);
			expect(ruleIndexes(lines)).toHaveLength(5);

			const expected = new Set<number>();
			for (const [position, index] of headers.entries()) {
				// The path/workspace rule under the header stays.
				expect(isRule(lines[index + 1])).toBe(true);
				expected.add(index + 1);
				if (position === 0) {
					expect(isRule(lines[index - 1])).toBe(false);
					continue;
				}
				// Exactly one boundary rule sits above every later project.
				expect(isRule(lines[index - 1])).toBe(true);
				expected.add(index - 1);
			}
			// No rule exists between workspaces or conversations.
			expect(new Set(ruleIndexes(lines))).toEqual(expected);

			const raw = component.render(WIDTH);
			expect(raw.filter(line => line === renderProjectSeparator(WIDTH))).toHaveLength(2);
			expect(raw.filter(line => line === renderProjectRule(WIDTH))).toHaveLength(3);
			for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(WIDTH);
		} finally {
			tui.stop();
		}
	});

	it("keeps both boundary rules when a project is collapsed", async () => {
		const initial = groupedView({ collapsed: "beta" });
		const { terminal, tui } = await mount(initial);
		try {
			const lines = plainViewport(terminal);
			const headers = headerIndexes(lines);
			expect(headers).toHaveLength(3);
			expect(ruleIndexes(lines)).toHaveLength(5);
			expect(isRule(lines[headers[1]! - 1])).toBe(true);
			expect(isRule(lines[headers[2]! - 1])).toBe(true);
			// Four workspaces stay listed; no rule was invented between them.
			const workspaceRows = lines.filter(line => /^(?: {4}|❯ {3})(?:▾|▸) /.test(line));
			expect(workspaceRows).toHaveLength(4);
		} finally {
			tui.stop();
		}
	});

	it("drops boundary rules when a search leaves one project", async () => {
		const initial = groupedView();
		const filtered = subset(initial, "/work/gamma");
		const { terminal, tui, scheduler } = await mount(initial, {
			viewFor: (_scope, query) => (query.trim() ? filtered : initial),
		});
		try {
			terminal.sendInput("/");
			for (const glyph of "gamma") terminal.sendInput(glyph);
			await scheduler.settle(terminal);
			const lines = plainViewport(terminal);
			const headers = headerIndexes(lines);
			expect(headers).toHaveLength(1);
			expect(ruleIndexes(lines)).toEqual([headers[0]! + 1]);
			expect(isRule(lines[headers[0]! - 1])).toBe(false);
		} finally {
			tui.stop();
		}
	});

	it("shows no rule at all when the search matches nothing", async () => {
		const initial = groupedView();
		const empty = view([], { totalConversations: initial.counts.totalConversations });
		const { terminal, tui, scheduler } = await mount(initial, {
			viewFor: (_scope, query) => (query.trim() ? { ...empty, query: { raw: query } } : initial),
		});
		try {
			terminal.sendInput("/");
			for (const glyph of "zzz") terminal.sendInput(glyph);
			await scheduler.settle(terminal);
			const lines = plainViewport(terminal);
			expect(lines.join("\n")).toContain("No conversations match");
			expect(ruleIndexes(lines)).toEqual([]);
			expect(headerIndexes(lines)).toEqual([]);
		} finally {
			tui.stop();
		}
	});

	it("keeps boundary rules full width when the terminal is narrow", async () => {
		const narrow = 28;
		const initial = groupedView();
		const { terminal, tui } = await mount(initial, { width: narrow });
		try {
			const lines = plainViewport(terminal);
			const headers = headerIndexes(lines);
			const separatorIndexes = ruleIndexes(lines, narrow).filter(index => !headers.includes(index - 1));
			expect(headers).toHaveLength(3);
			// Two boundary rules, both exactly the content width.
			expect(separatorIndexes).toHaveLength(2);
			for (const index of separatorIndexes) expect(lines[index]).toBe(RULE.repeat(narrow));
			for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(narrow);
		} finally {
			tui.stop();
		}
	});

	it("never lets the selection land on a boundary rule", async () => {
		const initial = groupedView();
		const { terminal, tui, component, scheduler } = await mount(initial);
		try {
			const before = plainViewport(terminal);
			const headers = headerIndexes(before);
			const separator = headers[1]! - 1;
			const cursorRow = before.findIndex(line => line.startsWith(`${theme.nav.cursor} `));
			expect(cursorRow).toBeGreaterThan(0);

			component.handleInput(`\x1b[<0;5;${separator + 1}M`);
			tui.requestRender();
			await scheduler.settle(terminal);
			const clicked = plainViewport(terminal);
			expect(clicked.findIndex(line => line.startsWith(`${theme.nav.cursor} `))).toBe(cursorRow);
			expect(clicked[separator]).toBe(RULE.repeat(WIDTH));

			component.handleInput("\x1b[B");
			tui.requestRender();
			await scheduler.settle(terminal);
			const moved = plainViewport(terminal);
			const movedRow = moved.findIndex(line => line.startsWith(`${theme.nav.cursor} `));
			// Down steps over the header rule line to the workspace, never onto a rule.
			expect(movedRow).toBe(cursorRow + 2);
			expect(isRule(moved[movedRow])).toBe(false);
			expect(moved[movedRow]).toContain("app");
		} finally {
			tui.stop();
		}
	});

	it("counts boundary rules while scrolling to the last project", async () => {
		const names = ["p1", "p2", "p3", "p4", "p5", "p6"];
		const initial = groupedView({ projectNames: names });
		const height = 24;
		const { terminal, tui, component, scheduler } = await mount(initial, { height });
		try {
			for (let step = 0; step < 29; step++) component.handleInput("\x1b[B");
			tui.requestRender();
			await scheduler.settle(terminal);
			const lines = plainViewport(terminal);
			expect(lines).toHaveLength(height);
			expect(lines.join("\n")).toContain("p6 lib note");
			const cursorRow = lines.findIndex(line => line.startsWith(`${theme.nav.cursor} `));
			expect(cursorRow).toBeGreaterThanOrEqual(0);
			expect(lines[cursorRow]).toContain("p6 lib note");
			// Every visible rule still belongs to a project header, top or bottom cut included.
			const headers = headerIndexes(lines);
			const boundaries = ruleIndexes(lines).filter(index => !headers.includes(index - 1));
			expect(boundaries.length).toBeLessThanOrEqual(5);
			for (const index of boundaries) {
				// A window that starts on a boundary keeps its header right below.
				if (index + 1 < lines.length && index > 0) expect(headers).toContain(index + 1);
			}
		} finally {
			tui.stop();
		}
	});
});
