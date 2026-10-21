import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { buildResumeDirectory, resumePathKey } from "@linxiraos/zeta/resume";
import {
	LiveResumePickerSource,
	loadResumePickerScope,
	RESUME_PICKER_STATE_FILENAME,
	saveResumePickerScope,
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
