import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { buildResumeDirectory, resumePathKey } from "@linxiraos/zeta/resume";
import { parseTitleSlotFromContent, serializeTitleSlot } from "@linxiraos/zeta/session/session-title-slot";
import { FileSessionStorage } from "@linxiraos/zeta/session/session-storage";
import type { ResumeTreeConversation } from "@linxiraos/pi-tui/overlays/resume-tree";
import {
	LiveResumePickerSource,
	loadResumePickerScope,
	loadResumePickerState,
	RESUME_PICKER_STATE_FILENAME,
	RESUME_PICKER_STATE_VERSION,
	saveResumePickerScope,
	saveResumePickerState,
} from "../../src/modes/resume-picker-source";
import { makeSession, pinnedSet, REPO_A, REPO_B, staticResolver, STANDARD_PROJECTS } from "./helpers";

let agentDir: string;

beforeAll(async () => {
	agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "resume-picker-source-"));
});

afterAll(async () => {
	await fs.rm(agentDir, { recursive: true, force: true });
});

const T = Date.UTC(2026, 0, 1);

async function directory() {
	return buildResumeDirectory({
		sessions: [
			makeSession({ id: "a1", cwd: REPO_A, title: "Alpha", modified: T + 1_000 }),
			makeSession({ id: "b1", cwd: REPO_B, title: "Beta", modified: T + 2_000 }),
		],
		pinnedIds: pinnedSet("a1"),
		preferences: { version: 1, projects: {} },
		resolveProject: staticResolver(STANDARD_PROJECTS),
		defaultWorkspace: STANDARD_PROJECTS[REPO_A] ? REPO_A : undefined,
	});
}

describe("resume picker scope persistence", () => {
	it("defaults to the workspace scope and round-trips the chosen scope", async () => {
		expect(await loadResumePickerScope(agentDir)).toBe("workspace");
		await saveResumePickerScope("project", agentDir);
		expect(await loadResumePickerScope(agentDir)).toBe("project");
		await saveResumePickerScope("all", agentDir);
		expect(await loadResumePickerScope(agentDir)).toBe("all");
	});

	it("round-trips expansion state under the v2 file name", async () => {
		await saveResumePickerState(
			{
				scope: "project",
				collapsedProjects: ["/one"],
				expandedProjects: ["/two"],
				collapsedWorkspaces: ["/three"],
				fullPaths: true,
			},
			agentDir,
		);
		const raw = JSON.parse(await fs.readFile(path.join(agentDir, RESUME_PICKER_STATE_FILENAME), "utf-8"));
		expect(raw.version).toBe(RESUME_PICKER_STATE_VERSION);
		expect(raw.fullPaths).toBe(true);
		const state = await loadResumePickerState(agentDir);
		expect(state).toMatchObject({
			scope: "project",
			collapsedProjects: ["/one"],
			expandedProjects: ["/two"],
			collapsedWorkspaces: ["/three"],
			fullPaths: true,
		});
		await saveResumePickerState({ scope: "project", fullPaths: false }, agentDir);
		expect((await loadResumePickerState(agentDir)).fullPaths).toBe(false);
	});

	it("ignores the legacy state file instead of migrating it", async () => {
		await fs.rm(path.join(agentDir, RESUME_PICKER_STATE_FILENAME), { force: true });
		await fs.writeFile(path.join(agentDir, "resume-picker-state.json"), JSON.stringify({ scope: "all" }), "utf-8");
		expect(await loadResumePickerState(agentDir)).toEqual({ scope: "workspace" });
		await saveResumePickerScope("project", agentDir);
		expect(await loadResumePickerScope(agentDir)).toBe("project");
		// The legacy file is left untouched.
		const legacy = JSON.parse(await fs.readFile(path.join(agentDir, "resume-picker-state.json"), "utf-8"));
		expect(legacy.scope).toBe("all");
	});

	it("degrades to workspace on a corrupt state file", async () => {
		await fs.writeFile(path.join(agentDir, RESUME_PICKER_STATE_FILENAME), "{not json", "utf-8");
		expect(await loadResumePickerScope(agentDir)).toBe("workspace");
	});
});

describe("live resume source", () => {
	function make() {
		return new LiveResumePickerSource({
			initialScope: "all",
			deleteMode: "trash",
			agentDir,
			deleteConversation: async () => true,
		});
	}

	it("returns null before the directory lands, then projects model views", async () => {
		const source = make();
		expect(source.isLoading()).toBe(true);
		expect(source.buildView({ scope: "all", query: "" })).toBeNull();
		source.directory = await directory();
		const view = source.buildView({ scope: "all", query: "" });
		expect(view?.rows[0]?.type).toBe("project");
		expect(view?.conversations?.map(row => row.conversation.id)).toEqual(["a1", "b1"]);
		const workspace = source.buildView({ scope: "workspace", query: "" });
		expect(workspace?.conversations?.length).toBe(1);
		expect(source.scopeSummary().counts.all).toBe(2);
		expect(source.scopeSummary().projectName).toBeTruthy();
	});

	it("restores and persists the picker state", async () => {
		const source = new LiveResumePickerSource({
			initialScope: "all",
			initialState: { scope: "project", collapsedWorkspaces: ["/one"] },
			deleteMode: "trash",
			agentDir,
			deleteConversation: async () => true,
		});
		expect(source.initialScope).toBe("project");
		expect(source.pickerState().collapsedWorkspaces).toEqual(["/one"]);
		await source.persistPickerState({ scope: "all", collapsedWorkspaces: ["/two"] });
		expect(await loadResumePickerState(agentDir)).toMatchObject({
			scope: "all",
			collapsedWorkspaces: ["/two"],
		});
	});

	it("renames the persisted session title", async () => {
		const file = path.join(agentDir, "rename-session.jsonl");
		const updatedAt = "2026-01-01T00:00:00.000Z";
		await fs.writeFile(
			file,
			`${serializeTitleSlot({ title: "Old title", source: "auto", updatedAt })}${JSON.stringify({
				type: "session",
				id: "rename-test",
				cwd: REPO_A,
				timestamp: updatedAt,
			})}\n`,
			"utf-8",
		);
		const source = new LiveResumePickerSource({
			initialScope: "all",
			deleteMode: "trash",
			agentDir,
			storage: new FileSessionStorage(),
			deleteConversation: async () => true,
		});
		const conversation = {
			path: file,
			id: "rename-test",
			session: { path: file, id: "rename-test", cwd: REPO_A, modified: new Date(updatedAt) },
		} as unknown as ResumeTreeConversation;
		expect(source.canRenameConversation(conversation)).toBe(true);
		expect(await source.renameConversation(conversation, "  New title  ")).toBe("New title");
		expect(await source.renameConversation(conversation, "   ")).toBeNull();
		const slot = parseTitleSlotFromContent(await fs.readFile(file, "utf-8"));
		expect(slot?.title).toBe("New title");
		expect(slot?.source).toBe("user");
	});

	it("filters subagent sessions and their counts from the picker directory", async () => {
		const source = make();
		source.directory = await buildResumeDirectory({
			sessions: [
				makeSession({ id: "parent", cwd: REPO_A, modified: T + 1_000 }),
				makeSession({
					id: "sub",
					cwd: REPO_A,
					modified: T + 2_000,
					parent: "/resume-test/sessions/parent.jsonl",
					agent: "scout",
				}),
			],
			pinnedIds: pinnedSet(),
			preferences: { version: 1, projects: {} },
			filterSubagents: true,
			resolveProject: staticResolver(STANDARD_PROJECTS),
			defaultWorkspace: REPO_A,
		});
		expect(source.directory.conversations.map(conversation => conversation.id)).toEqual(["parent"]);
		expect(source.directory.projects.find(project => project.root === REPO_A)?.counts.conversations).toBe(1);
	});

	it("accepts the model's structured scope object as well as a bare kind", async () => {
		const source = make();
		source.directory = await directory();
		const scoped = source.buildView({
			scope: { kind: "project", projectKey: resumePathKey(REPO_B) },
			query: "",
		});
		expect(scoped?.conversations?.map(row => row.conversation.id)).toEqual(["b1"]);
	});
});
