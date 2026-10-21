import { beforeAll, describe, expect, it } from "bun:test";
import { type ResumeSourceLike, SessionSelectorComponent } from "@linxiraos/pi-tui/overlays/session-selector";
import type { DescribeContext, NativeNode } from "@linxiraos/pi-tui/native/node";
import { initTheme } from "@linxiraos/pi-tui/theme";
import type { TspPickerAction, TspPickerItem, TspPickerProps, TspText } from "@linxiraos/pi-wire";
import { buildResumeView, type ResumeDirectory } from "@linxiraos/zeta/resume";
import type { SessionInfo } from "@linxiraos/zeta/session/session-listing";
import { buildDirectory, makeSession, pinnedSet, REPO_A, REPO_B, WORKTREE_A } from "./helpers";

const withPicker: DescribeContext = {
	cols: 140,
	reduceMotion: false,
	dark: true,
	supports: () => true,
	feature: () => true,
};

const T = Date.UTC(2026, 0, 1);

beforeAll(async () => {
	await initTheme(false);
});

function session(
	id: string,
	cwd: string,
	title: string,
	modified: number,
	extra: Partial<SessionInfo> = {},
): SessionInfo {
	return {
		...makeSession({ id, cwd, title, modified, status: "complete" }),
		assistantTurns: 4,
		model: "anthropic/claude-x",
		...extra,
	};
}

const sessions = [
	session("a1", REPO_A, "Alpha feature", T + 1_000, { assistantTurns: 7 }),
	session("a2", REPO_A, "Beta cleanup", T + 2_000, { status: "error", assistantTurns: 2, model: "openai/gpt-x" }),
	session("wt1", WORKTREE_A, "Feature work", T + 3_000, { status: "pending", assistantTurns: 5 }),
	session("b1", REPO_B, "Gamma docs", T + 4_000, {
		status: "complete",
		assistantTurns: 3,
		model: "google/gemini-x",
		parentSessionPath: "/resume-test/sessions/parent-b1.jsonl",
	}),
];

function source(directory: ResumeDirectory, subagents?: "grouped" | "inline" | "hidden"): ResumeSourceLike {
	return {
		directory,
		buildView: options => buildResumeView(directory, options),
		...(subagents ? { subagentsMode: () => subagents } : {}),
	};
}

function make(
	directory: ResumeDirectory,
	extra: Record<string, unknown> = {},
	onSelect?: (session: SessionInfo) => void,
	subagents?: "grouped" | "inline" | "hidden",
) {
	const built = source(directory, subagents);
	return new SessionSelectorComponent(
		directory.conversations.map(conversation => conversation.session),
		selected => onSelect?.(selected),
		() => {},
		() => {},
		{
			resumeSource: built,
			currentSessionPath: sessions[0]!.path,
			getTerminalRows: () => 40,
			deleteMode: "trash",
			onDelete: async () => true,
			...extra,
		},
	);
}

function props(root: NativeNode): TspPickerProps {
	if (root.k !== "picker") throw new Error(`expected a picker, got ${root.k}`);
	return root.p ?? {};
}

function items(p: TspPickerProps): readonly TspPickerItem[] {
	return p.items ?? [];
}

function item(p: TspPickerProps, path: string): TspPickerItem {
	const found = items(p).find(candidate => candidate.id === path);
	expect(found).toBeDefined();
	return found!;
}

function groups(p: TspPickerProps): { group: string; label: TspText; count?: number }[] {
	return (p.order ?? []).filter(
		(row): row is { group: string; label: TspText; count?: number } => typeof row === "object",
	);
}

function groupRow(p: TspPickerProps, id: string): { group: string; label: TspText; count?: number } {
	const found = groups(p).find(group => group.group === id);
	expect(found).toBeDefined();
	return found!;
}

function action(p: TspPickerProps, id: string): TspPickerAction {
	const found = (p.actions ?? []).find(candidate => candidate.id === id);
	expect(found).toBeDefined();
	return found!;
}

function type(selector: SessionSelectorComponent<SessionInfo>, text: string): void {
	for (const char of text) selector.handleInput(char);
}

function tab(selector: SessionSelectorComponent<SessionInfo>, value: string): void {
	selector.handleNativeEvent({ type: "action", key: "", act: "tab", value, mods: [] });
}

function nativeChildren(root: NativeNode): NativeNode[] {
	const children: NativeNode[] = [];
	for (const child of root.c ?? []) if ("k" in child) children.push(child);
	return children;
}

function spansText(value: TspText | undefined): string {
	if (value === undefined) return "";
	return typeof value === "string" ? value : value.map(part => part.t).join("");
}

function previewFacts(root: NativeNode): Map<string, string> {
	const kvNode = nativeChildren(root).find(child => child.k === "kv");
	expect(kvNode?.k).toBe("kv");
	if (kvNode?.k !== "kv") throw new Error("preview has no kv grid");
	const facts = new Map<string, string>();
	for (const entry of kvNode.p?.items ?? []) facts.set(spansText(entry.k), spansText(entry.v));
	return facts;
}

function conversationSection(root: NativeNode): NativeNode | undefined {
	return nativeChildren(root).find(child => child.k === "section" && child.p?.head === "Conversation");
}

async function standardDirectory(pinned: string[] = []): Promise<ResumeDirectory> {
	return buildDirectory({ sessions, pinnedIds: pinnedSet(...pinned) });
}

describe("resume picker sections and facts", () => {
	it("groups all projects by project → workspace and counts the scope tabs", async () => {
		const selector = make(await standardDirectory());
		const first = props(selector.describe(withPicker));
		// Workspace scope first: the live session's workspace, no section heads.
		expect(first.tabs?.map(entry => [entry.id, entry.count])).toEqual([
			["workspace", 2],
			["project", 3],
			["all", 4],
		]);
		expect(first.tab).toBe("workspace");
		expect(groups(first)).toEqual([]);

		tab(selector, "all");
		const all = props(selector.describe(withPicker));
		const directory = await standardDirectory();
		const view = buildResumeView(directory, { scope: "all", currentSessionPath: sessions[0]!.path });
		expect(all.order?.filter(row => typeof row === "string")).toEqual(
			view.conversations.map(row => row.conversation.path),
		);
		expect(groups(all).map(group => group.label)).toEqual(
			view.rows.flatMap(row => {
				if (row.type === "project") return [row.project.displayName];
				if (row.type === "workspace") {
					const branch = row.workspace.branch;
					const show =
						branch !== null && (row.key === view.currentWorkspaceKey || branch !== view.referenceBranch);
					return [show ? `${row.workspace.name} · ${branch}` : row.workspace.name];
				}
				return [];
			}),
		);
		const projectA = directory.projects.find(candidate => candidate.root === REPO_A)!.key;
		const projectB = directory.projects.find(candidate => candidate.root === REPO_B)!.key;
		const workspaceA = directory.workspaces.find(candidate => candidate.path === REPO_A)!.key;
		const worktreeA = directory.workspaces.find(candidate => candidate.path === WORKTREE_A)!.key;
		expect(groupRow(all, `project:${projectA}`)).toMatchObject({ label: "repo-a", count: 3 });
		expect(groupRow(all, `workspace:${workspaceA}`)).toMatchObject({ label: "repo-a · main", count: 2 });
		expect(groupRow(all, `workspace:${worktreeA}`)).toMatchObject({ label: "feat-a · feat/a", count: 1 });
		expect(groupRow(all, `project:${projectB}`)).toMatchObject({ label: "repo-b", count: 1 });
	});

	it("groups the project scope by workspace", async () => {
		const directory = await standardDirectory();
		const selector = make(directory);
		selector.describe(withPicker);
		tab(selector, "project");
		const project = props(selector.describe(withPicker));
		expect(project.tab).toBe("project");
		const projectKey = directory.projects.find(candidate => candidate.root === REPO_A)!.key;
		const view = buildResumeView(directory, {
			scope: { kind: "project", projectKey },
			currentSessionPath: sessions[0]!.path,
		});
		expect(groups(project).map(group => group.label)).toEqual(["feat-a · feat/a", "repo-a · main"]);
		expect(project.order?.filter(row => typeof row === "string")).toEqual(
			view.conversations.map(row => row.conversation.path),
		);
		expect(project.order?.filter(row => typeof row === "string")).toEqual([
			sessions[2]!.path,
			sessions[1]!.path,
			sessions[0]!.path,
		]);
	});

	it("replaces the file-size fact with turns and model, and omits a branch repeated by the workspace", async () => {
		const selector = make(await standardDirectory());
		const p = props(selector.describe(withPicker));
		const alpha = item(p, sessions[0]!.path);
		expect(alpha.facts).toMatchObject({ turns: 7, model: "anthropic/claude-x" });
		expect(alpha.facts?.branch).toBeUndefined();
		expect(alpha.facts).not.toHaveProperty("size");
		const beta = item(p, sessions[1]!.path);
		expect(beta.facts).toMatchObject({ turns: 2, model: "openai/gpt-x" });
		expect(beta.facts?.branch).toBeUndefined();
		expect(beta.dot).toBe("error");
	});

	it("offers the three-way scope action and the trash delete wording", async () => {
		const selector = make(await standardDirectory());
		const p = props(selector.describe(withPicker));
		expect(action(p, "scope").label).toBe("this repository");
		expect(action(p, "delete").label).toBe("Move to trash");
		expect(action(p, "resume").keys).toEqual(["enter"]);
		selector.handleNativeEvent({ type: "action", key: "", act: "delete", mods: [] });
		expect(props(selector.describe(withPicker)).confirm?.text).toBe("Move “Alpha feature” to trash?");
	});
});

describe("resume picker states", () => {
	it("uses the model's empty copy per scope and for no matches", async () => {
		const empty = await buildDirectory({ sessions: [] });
		expect(empty.defaultWorkspaceKey).toBe(empty.workspaces[0]?.key);
		const selector = make(empty, { currentSessionPath: undefined });
		const initial = props(selector.describe(withPicker));
		expect(initial.empty).toBe("No conversations in this workspace.");
		expect(initial.order).toEqual([]);

		type(selector, "nomatch");
		expect(props(selector.describe(withPicker)).empty).toBe("No conversations match “nomatch”");
	});

	it("supports structured tokens and keeps pinned rows visible during free-text search", async () => {
		const selector = make(await standardDirectory(["a2"]));
		const initial = props(selector.describe(withPicker));
		expect(item(initial, sessions[1]!.path).icon).toBe("pin");

		tab(selector, "all");
		type(selector, "branch:feat/a");
		const branch = props(selector.describe(withPicker));
		expect(branch.order?.filter(row => typeof row === "string")).toEqual([sessions[2]!.path]);

		selector.getSessionList().clearSearch();
		selector.describe(withPicker);
		type(selector, "gamma");
		const search = props(selector.describe(withPicker));
		// The pinned beta matches nothing but stays visible beside the matching Gamma.
		expect(search.order?.filter(row => typeof row === "string")).toEqual([sessions[3]!.path, sessions[1]!.path]);
		expect(search.hits?.[sessions[1]!.path]).toBeUndefined();
		expect(search.hits?.[sessions[3]!.path]).toEqual([[0, 5]]);
	});

	it("highlights free-text terms and leaves structured tokens out of the hits", async () => {
		const selector = make(await standardDirectory());
		selector.describe(withPicker);
		tab(selector, "all");
		type(selector, "gamma");
		const p = props(selector.describe(withPicker));
		expect(p.hits?.[sessions[3]!.path]).toEqual([[0, 5]]);
	});
});

describe("resume picker preview and pointer", () => {
	it("previews project, workspace, branch, status, model and the excerpt", async () => {
		const selector = make(await standardDirectory());
		selector.describe(withPicker);
		tab(selector, "all");
		selector.describe(withPicker);
		selector.handleNativeEvent({ type: "select", key: "", item: sessions[3]!.path });
		// A frame renders the selection, then the preview follows after the settle delay.
		selector.describe(withPicker);
		await Bun.sleep(80);
		const root = selector.describe(withPicker);
		const facts = previewFacts(root);
		expect(facts.get("Project")).toBe("repo-b");
		expect(facts.get("Workspace")).toBe("repo-b");
		expect(facts.get("Branch")).toBe("main");
		expect(facts.get("Status")).toMatch(/done/);
		expect(facts.get("Model")).toBe("google/gemini-x");
		expect(facts.get("Turns")).toBe("3");
		const section = conversationSection(root);
		if (section?.k !== "section") throw new Error("preview has no Conversation section");
		expect(spansText(section.p?.head)).toBe("Conversation");
		expect(JSON.stringify(section)).toContain("Gamma docs");
		expect(nativeChildren(root)[0]).toMatchObject({ k: "text", p: { text: "Gamma docs" } });
	});

	it("keeps click-to-select and double-click-to-resume", async () => {
		const resumed: SessionInfo[] = [];
		const selector = make(await standardDirectory(["a2"]), {}, selected => resumed.push(selected));
		selector.describe(withPicker);
		// Workspace scope holds a1/a2; a click selects rather than resumes.
		selector.handleNativeEvent({ type: "select", key: "", item: sessions[1]!.path });
		expect(props(selector.describe(withPicker)).selected).toBe(sessions[1]!.path);
		expect(resumed).toEqual([]);
		selector.handleNativeEvent({ type: "activate", key: "", item: sessions[0]!.path });
		expect(resumed.map(entry => entry.id)).toEqual(["a1"]);
	});

	it("shows the filtered banner from the model's hidden count", async () => {
		const selector = make(await standardDirectory());
		selector.describe(withPicker);
		tab(selector, "all");
		type(selector, "alpha");
		const p = props(selector.describe(withPicker));
		expect(p.state).toBe("ready");
		expect(p.message).toBe("3 conversations hidden by filter");
		expect(p.order?.filter(row => typeof row === "string")).toEqual([sessions[0]!.path]);
	});

	it("uses the source's scope summary for tab counts and search placeholders", async () => {
		const directory = await standardDirectory();
		const summarySource = {
			...source(directory),
			scopeSummary: () => ({
				workspaceName: "repo-a",
				projectName: "repo-a",
				counts: { workspace: 2, project: 3, all: 4 },
			}),
		};
		const selector = new SessionSelectorComponent(
			directory.conversations.map(conversation => conversation.session),
			() => {},
			() => {},
			() => {},
			{ resumeSource: summarySource, currentSessionPath: sessions[0]!.path },
		);
		const workspace = props(selector.describe(withPicker));
		expect(workspace.tabs?.map(entry => entry.count)).toEqual([2, 3, 4]);
		expect(workspace.placeholder).toBe("Search conversations in repo-a…");
		tab(selector, "all");
		expect(props(selector.describe(withPicker)).placeholder).toBe("Search all conversations…");
	});

	it("renders the loading skeleton until the directory scan lands", () => {
		const source: ResumeSourceLike = {
			directory: null,
			buildView: () => null,
			isLoading: () => true,
		};
		const selector = new SessionSelectorComponent(
			[],
			() => {},
			() => {},
			() => {},
			{ resumeSource: source },
		);
		const p = props(selector.describe(withPicker));
		expect(p.state).toBe("loading");
		expect(p.message).toBe("Loading conversations…");
		expect(p.items).toEqual([]);
	});

	it("cycles the scope with Tab without losing the live selection", async () => {
		const selector = make(await standardDirectory());
		selector.describe(withPicker);
		selector.handleInput("\t");
		const project = props(selector.describe(withPicker));
		expect(project.tab).toBe("project");
		expect(project.selected).toBe(sessions[0]!.path);
		selector.handleInput("\t");
		const all = props(selector.describe(withPicker));
		expect(all.tab).toBe("all");
		expect(all.selected).toBe(sessions[0]!.path);
		const projectB = (await standardDirectory()).projects.find(candidate => candidate.root === REPO_B)!.key;
		expect(groupRow(all, `project:${projectB}`).count).toBe(1);
	});

	it("pins the selected conversation through the source and refreshes it", async () => {
		const directory = await standardDirectory();
		const pins: [string, boolean][] = [];
		let refreshes = 0;
		const actionSource = {
			...source(directory),
			pinConversation: async (conversation: { id: string }, pinned: boolean) => {
				pins.push([conversation.id, pinned]);
			},
			refresh: async () => {
				refreshes++;
			},
		};
		const selector = new SessionSelectorComponent(
			directory.conversations.map(conversation => conversation.session),
			() => {},
			() => {},
			() => {},
			{ resumeSource: actionSource, currentSessionPath: sessions[0]!.path },
		);
		selector.describe(withPicker);
		expect(action(props(selector.describe(withPicker)), "pin").label).toBe("Pin");
		selector.handleNativeEvent({ type: "action", key: "", act: "pin", mods: [] });
		await Bun.sleep(10);
		expect(pins).toEqual([["a1", true]]);
		expect(refreshes).toBe(1);
	});

	it("deletes through the resume source when the host passes no callback", async () => {
		const directory = await standardDirectory();
		const deleted: string[] = [];
		const deleteSource = {
			...source(directory),
			deleteConversation: async (conversation: { id: string }) => {
				deleted.push(conversation.id);
				return true;
			},
		};
		const selector = new SessionSelectorComponent(
			directory.conversations.map(conversation => conversation.session),
			() => {},
			() => {},
			() => {},
			{ resumeSource: deleteSource, currentSessionPath: sessions[0]!.path },
		);
		selector.describe(withPicker);
		expect(action(props(selector.describe(withPicker)), "delete")).toBeDefined();
		selector.handleNativeEvent({ type: "action", key: "", act: "delete", mods: [] });
		selector.handleNativeEvent({ type: "action", key: "", act: "delete-confirm", mods: [] });
		await Bun.sleep(10);
		expect(deleted).toEqual(["a1"]);
		expect(props(selector.describe(withPicker)).order?.filter(row => typeof row === "string")).not.toContain(
			sessions[0]!.path,
		);
	});
});

describe("resume picker subagent modes", () => {
	async function directoryWithSubagent(): Promise<ResumeDirectory> {
		const child = {
			...session("sub", REPO_A, "Scout child", T + 5_000),
			parentSessionPath: sessions[0]!.path,
			agent: "scout",
		};
		return buildDirectory({ sessions: [...sessions, child], pinnedIds: pinnedSet() });
	}

	it("folds subagents away by default and reports the count", async () => {
		const directory = await directoryWithSubagent();
		const selector = make(directory);
		const p = props(selector.describe(withPicker));
		expect(items(p).map(entry => entry.id)).not.toContain("/resume-test/sessions/sub.jsonl");
		expect(String(p.message)).toContain("1 subagents hidden");
	});

	it("lists subagents inline when configured", async () => {
		const directory = await directoryWithSubagent();
		const selector = make(directory, {}, undefined, "inline");
		const p = props(selector.describe(withPicker));
		expect(items(p).map(entry => entry.id)).toContain("/resume-test/sessions/sub.jsonl");
		expect(String(p.message)).not.toContain("subagents hidden");
	});

	it("hides subagents entirely in hidden mode", async () => {
		const directory = await directoryWithSubagent();
		const selector = make(directory, {}, undefined, "hidden");
		const p = props(selector.describe(withPicker));
		expect(items(p).map(entry => entry.id)).not.toContain("/resume-test/sessions/sub.jsonl");
		expect(p.order?.filter(row => typeof row === "string")).not.toContain("/resume-test/sessions/sub.jsonl");
		expect(String(p.message)).toContain("1 subagents hidden");
	});
});
