import { describe, expect, it } from "bun:test";
import { filterHiddenResumeDirectory, resumePathKey } from "@linxiraos/zeta/resume";
import { buildDirectory, makeSession, pinnedSet, REPO_A, REPO_B } from "./helpers";

const T = Date.UTC(2026, 0, 1);

function sessions() {
	return [
		makeSession({ id: "a1", cwd: REPO_A, modified: T + 1_000, title: "A one" }),
		makeSession({ id: "a2", cwd: REPO_A, modified: T + 2_000, title: "A two" }),
		makeSession({ id: "b1", cwd: REPO_B, modified: T + 3_000, title: "B one" }),
	];
}

describe("resume visibility metadata", () => {
	it("marks hidden conversations and filters them from the default view", async () => {
		const directory = await buildDirectory({
			sessions: sessions(),
			preferences: { version: 1, projects: {} },
			pinnedIds: pinnedSet(),
			hiddenIds: new Set(["a2"]),
		});

		expect(directory.hiddenCounts.conversations).toBe(1);
		expect(directory.conversations.find(conversation => conversation.id === "a2")?.hidden).toBe(true);

		const visible = filterHiddenResumeDirectory(directory);
		expect(visible.conversations.map(conversation => conversation.id).sort()).toEqual(["a1", "b1"]);
		expect(visible.hiddenCounts.conversations).toBe(1);

		const shown = filterHiddenResumeDirectory(directory, true);
		expect(shown.conversations.map(conversation => conversation.id).sort()).toEqual(["a1", "a2", "b1"]);
	});

	it("hides a folder without deleting its sessions or checkout", async () => {
		const directory = await buildDirectory({
			sessions: sessions(),
			preferences: {
				version: 1,
				projects: {},
				workspaces: { [resumePathKey(REPO_A)]: { hidden: true } },
			},
			pinnedIds: pinnedSet(),
		});

		expect(
			directory.conversations
				.filter(conversation => conversation.workspaceKey === resumePathKey(REPO_A))
				.every(conversation => conversation.hidden),
		).toBe(true);
		expect(directory.hiddenCounts.workspaces).toBe(1);
		expect(directory.hiddenCounts.conversations).toBe(2);

		const visible = filterHiddenResumeDirectory(directory);
		expect(visible.workspaces.some(workspace => workspace.key === resumePathKey(REPO_A))).toBe(false);
		expect(visible.projects.some(project => project.root === REPO_A)).toBe(false);
		expect(visible.conversations.map(conversation => conversation.id)).toEqual(["b1"]);

		// Show hidden reveals the same directory unchanged: nothing was removed.
		expect(filterHiddenResumeDirectory(directory, true).counts.conversations).toBe(3);
	});

	it("hides a project while keeping its registry entry and transcripts", async () => {
		const directory = await buildDirectory({
			sessions: sessions(),
			preferences: {
				version: 1,
				projects: { [resumePathKey(REPO_A)]: { hidden: true } },
			},
			pinnedIds: pinnedSet(),
		});

		expect(directory.projects.find(project => project.key === resumePathKey(REPO_A))?.hidden).toBe(true);
		expect(directory.hiddenCounts.projects).toBe(1);
		expect(directory.conversations).toHaveLength(3);

		const visible = filterHiddenResumeDirectory(directory);
		expect(visible.projects.some(project => project.key === resumePathKey(REPO_A))).toBe(false);
		expect(visible.conversations.map(conversation => conversation.id)).toEqual(["b1"]);
	});
});
