/**
 * Team TUI entry matrix: exact Team root, exact PM workspace, base repository,
 * engineer home/task worktrees, unmarked Team subdirectories, external linked
 * repositories, and malformed markers. Every fixture is a real temporary
 * directory tree; no mocks and no database (the entry resolver never opens one).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isTeamHubEntry, resolveTeamEntry } from "../../src/team/entry";
import { teamMemberMarkerPath, writePmMarker, writeTeamMarker } from "../../src/team/paths";

const TEAM_ID = "acme";
const TEAM_NAME = "Acme";

let scratch: string;
let teamRoot: string;
let pmRoot: string;
let repoRoot: string;
let homeRoot: string;
let taskRoot: string;
let externalRepo: string;

beforeAll(async () => {
	scratch = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-team-entry-"));
	teamRoot = path.join(scratch, "acme-team");
	pmRoot = path.join(teamRoot, "pms", "core");
	repoRoot = path.join(teamRoot, "repos", "api");
	homeRoot = path.join(teamRoot, "worktrees", "api", "core", "alice");
	taskRoot = path.join(homeRoot, "T-101");

	for (const dir of [pmRoot, repoRoot, homeRoot, taskRoot, path.join(teamRoot, "docs")]) {
		fs.mkdirSync(dir, { recursive: true });
	}
	await writeTeamMarker(teamRoot, {
		schemaVersion: 1,
		kind: "team",
		teamId: TEAM_ID,
		name: TEAM_NAME,
	});
	await writePmMarker(pmRoot, {
		schemaVersion: 1,
		kind: "pm",
		teamId: TEAM_ID,
		pmId: "core",
		name: "Core",
	});

	externalRepo = path.join(scratch, "external-api");
	fs.mkdirSync(path.join(externalRepo, ".zeta"), { recursive: true });
	await Bun.write(
		teamMemberMarkerPath(externalRepo),
		`${JSON.stringify({
			schemaVersion: 1,
			kind: "team-member",
			teamId: TEAM_ID,
			repoName: "external-api",
			teamRoot,
		})}\n`,
	);
});

afterAll(() => {
	fs.rmSync(scratch, { recursive: true, force: true });
});

describe("team TUI entry matrix", () => {
	test("exact team root opens the Team Hub, not an agent", async () => {
		const entry = await resolveTeamEntry(teamRoot);
		expect(entry.kind).toBe("team-root");
		expect(entry.teamId).toBe(TEAM_ID);
		expect(entry.teamName).toBe(TEAM_NAME);
		expect(entry.pmId).toBeUndefined();
		expect(entry.breadcrumb).toBeUndefined();
		expect(isTeamHubEntry(entry)).toBe(true);
	});

	test("exact PM workspace opens the Hub focused on that PM", async () => {
		const entry = await resolveTeamEntry(pmRoot);
		expect(entry.kind).toBe("pm-root");
		expect(entry.teamId).toBe(TEAM_ID);
		expect(entry.pmId).toBe("core");
		expect(entry.pmName).toBe("Core");
		expect(isTeamHubEntry(entry)).toBe(true);
	});

	test("canonical base repository warns and shows no engineer breadcrumb", async () => {
		const entry = await resolveTeamEntry(path.join(repoRoot, "packages", "api"));
		expect(entry.kind).toBe("base-repo");
		expect(entry.repoName).toBe("api");
		expect(entry.engineerName).toBeUndefined();
		expect(entry.warning).toContain("never an agent workspace");
		expect(entry.breadcrumb).toEqual([TEAM_NAME, "repos", "api"]);
		expect(isTeamHubEntry(entry)).toBe(false);
	});

	test("engineer home worktree resolves the full breadcrumb", async () => {
		const entry = await resolveTeamEntry(path.join(homeRoot, "home", "src"));
		expect(entry.kind).toBe("engineer-worktree");
		expect(entry.pmId).toBe("core");
		expect(entry.pmName).toBe("Core");
		expect(entry.repoName).toBe("api");
		expect(entry.engineerName).toBe("alice");
		expect(entry.worktreeKind).toBe("home");
		expect(entry.breadcrumb).toEqual([TEAM_NAME, "Core", "api", "alice", "home"]);
		expect(entry.warning).toBeUndefined();
	});

	test("task worktree names the task, not home", async () => {
		const entry = await resolveTeamEntry(path.join(taskRoot, "packages", "tui"));
		expect(entry.kind).toBe("engineer-worktree");
		expect(entry.worktreeKind).toBe("task");
		expect(entry.worktreeName).toBe("T-101");
		expect(entry.breadcrumb).toEqual([TEAM_NAME, "Core", "api", "alice", "T-101"]);
	});

	test("unmarked Team subdirectories warn and do not guess siblings", async () => {
		for (const dir of [path.join(teamRoot, "docs"), path.join(pmRoot, "notes"), path.join(teamRoot, "repos")]) {
			fs.mkdirSync(dir, { recursive: true });
			const entry = await resolveTeamEntry(dir);
			expect(entry.kind).toBe("unmarked-team-subdir");
			expect(entry.warning).toContain("normal coding session");
			expect(isTeamHubEntry(entry)).toBe(false);
		}
	});

	test("an engineer directory without home/task is unmarked, not a worktree", async () => {
		const entry = await resolveTeamEntry(homeRoot);
		expect(entry.kind).toBe("unmarked-team-subdir");
		expect(entry.warning).toBeDefined();
	});

	test("outside every team is an ordinary coding launch", async () => {
		const entry = await resolveTeamEntry(scratch);
		expect(entry.kind).toBe("outside");
		expect(entry.teamId).toBeUndefined();
		expect(entry.warning).toBeUndefined();
		expect(isTeamHubEntry(entry)).toBe(false);
	});

	test("an external linked base repository resolves through its breadcrumb", async () => {
		const entry = await resolveTeamEntry(externalRepo);
		expect(entry.kind).toBe("base-repo");
		expect(entry.externalRepo).toBe(true);
		expect(entry.repoName).toBe("external-api");
		expect(entry.teamId).toBe(TEAM_ID);
		expect(entry.warning).toContain("linked base repository");
	});

	test("a malformed team marker falls back to coding with a warning", async () => {
		const brokenRoot = path.join(scratch, "broken-team");
		fs.mkdirSync(path.join(brokenRoot, ".zeta"), { recursive: true });
		await Bun.write(
			path.join(brokenRoot, ".zeta", "team.json"),
			`${JSON.stringify({ schemaVersion: 99, kind: "team", teamId: "x", name: "X" })}\n`,
		);
		const entry = await resolveTeamEntry(brokenRoot);
		expect(entry.kind).toBe("outside");
		expect(entry.invalidMarker).toBe(true);
		expect(entry.warning).toContain("schemaVersion");
	});
});
