import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { buildResumeDirectory, resumePathKey } from "@linxiraos/zeta/resume";
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
				expandedSubagents: ["parent"],
			},
			agentDir,
		);
		const raw = JSON.parse(await fs.readFile(path.join(agentDir, RESUME_PICKER_STATE_FILENAME), "utf-8"));
		expect(raw.version).toBe(RESUME_PICKER_STATE_VERSION);
		const state = await loadResumePickerState(agentDir);
		expect(state).toMatchObject({
			scope: "project",
			collapsedProjects: ["/one"],
			expandedProjects: ["/two"],
			collapsedWorkspaces: ["/three"],
			expandedSubagents: ["parent"],
		});
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
	function make(subagents?: "grouped" | "inline" | "hidden") {
		return new LiveResumePickerSource({
			initialScope: "all",
			deleteMode: "trash",
			agentDir,
			...(subagents ? { subagents } : {}),
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

	it("exposes resume.subagents and the restored picker state", async () => {
		const source = new LiveResumePickerSource({
			initialScope: "all",
			initialState: { scope: "project", expandedSubagents: ["parent"] },
			subagents: "hidden",
			deleteMode: "trash",
			agentDir,
			deleteConversation: async () => true,
		});
		expect(source.initialScope).toBe("project");
		expect(source.subagentsMode()).toBe("hidden");
		expect(source.pickerState().expandedSubagents).toEqual(["parent"]);
		await source.persistPickerState({ scope: "all", expandedSubagents: ["next"] });
		expect(await loadResumePickerState(agentDir)).toMatchObject({
			scope: "all",
			expandedSubagents: ["next"],
		});
		expect(make().subagentsMode()).toBe("grouped");
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
