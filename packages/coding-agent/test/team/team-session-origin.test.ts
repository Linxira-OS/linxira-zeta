/**
 * Team session provenance: a session created inside a resolved Team location
 * (PM workspace, engineer home/task worktree, team base repository) is stamped
 * from the markers and, when it exists, the authoritative Team database. The
 * stamp is a name-only display label plus deterministic row ids; a malformed
 * marker never hides a personal session.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SessionManager } from "../../src/session/session-manager";
import { TeamDb, engineerRowId, pmRowId, repoRowId, worktreeRowId } from "../../src/team/db";
import { resolveTeamSessionOrigin } from "../../src/team/session-origin";
import { canonicalPath } from "../../src/team/paths";

const dirs: string[] = [];
afterEach(async () => {
	await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

async function tempDir(prefix: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), prefix));
	dirs.push(dir);
	return dir;
}

async function writeJson(file: string, value: unknown): Promise<void> {
	await mkdir(dirname(file), { recursive: true });
	await writeFile(file, `${JSON.stringify(value, null, "\t")}\n`, "utf8");
}

/** A minimal team root with one PM workspace marker. */
async function seedTeam(teamRoot: string): Promise<void> {
	await writeJson(join(teamRoot, ".zeta", "team.json"), {
		schemaVersion: 1,
		kind: "team",
		teamId: "acme",
		name: "Acme",
	});
	await writeJson(join(teamRoot, "pms", "core", ".zeta", "pm.json"), {
		schemaVersion: 1,
		kind: "pm",
		teamId: "acme",
		pmId: "core",
		name: "Core",
	});
}

describe("team session stamping", () => {
	test("an engineer task worktree session is stamped with row ids and a path-free label", async () => {
		const root = await tempDir("zeta-team-origin-");
		const teamRoot = join(root, "acme");
		await seedTeam(teamRoot);
		const task = join(teamRoot, "worktrees", "api", "core", "alice", "T-101");
		await mkdir(task, { recursive: true });

		const manager = SessionManager.create(task, join(root, "sessions"));
		const stamped = manager.getOrigin();
		expect(stamped).toEqual({
			kind: "team",
			teamId: "acme",
			pmId: "acme:core",
			engineerId: "acme:core:alice",
			repoId: "acme:api",
			workspaceAlias: "core / alice / api / T-101",
		});
		expect(stamped?.workspaceAlias).not.toContain(root);

		await manager.ensureOnDisk();
		const file = manager.getSessionFile();
		if (!file) throw new Error("session file not materialized");
		await manager.close();
		const reopened = await SessionManager.open(file);
		try {
			expect(reopened.getOrigin()).toEqual(stamped);
		} finally {
			await reopened.close();
		}
	});

	test("PM workspace and engineer home worktrees carry their own scope", async () => {
		const root = await tempDir("zeta-team-origin-");
		const teamRoot = join(root, "acme");
		await seedTeam(teamRoot);
		const pmRoot = join(teamRoot, "pms", "core");
		const home = join(teamRoot, "worktrees", "api", "core", "alice", "home");
		await mkdir(home, { recursive: true });

		const pmManager = SessionManager.create(pmRoot, join(root, "sessions"));
		expect(pmManager.getOrigin()).toEqual({
			kind: "team",
			teamId: "acme",
			pmId: "acme:core",
			workspaceAlias: "core",
		});

		const homeManager = SessionManager.create(home, join(root, "sessions"));
		expect(homeManager.getOrigin()).toEqual({
			kind: "team",
			teamId: "acme",
			pmId: "acme:core",
			engineerId: "acme:core:alice",
			repoId: "acme:api",
			workspaceAlias: "core / alice / api",
		});
	});

	test("a malformed team marker leaves the session personal", async () => {
		const root = await tempDir("zeta-team-origin-");
		const teamRoot = join(root, "acme");
		await writeJson(join(teamRoot, ".zeta", "team.json"), { schemaVersion: 1, kind: "team", name: "Acme" });
		await mkdir(join(teamRoot, "pms", "core"), { recursive: true });

		const manager = SessionManager.create(join(teamRoot, "pms", "core"), join(root, "sessions"));
		expect(manager.getOrigin()).toBeUndefined();
	});
});

describe("team database refinement", () => {
	test("an external linked worktree resolves its ids and names from the DB", async () => {
		const root = await tempDir("zeta-team-origin-db-");
		const teamRoot = join(root, "acme");
		await seedTeam(teamRoot);
		const external = join(root, "elsewhere", "api-task");
		await mkdir(external, { recursive: true });
		await writeJson(join(external, ".zeta", "team-member.json"), {
			schemaVersion: 1,
			kind: "team-member",
			teamId: "acme",
			repoName: "api",
			teamRoot,
		});

		const pmId = pmRowId("acme", "core");
		const repoId = repoRowId("acme", "api-web");
		const engineerId = engineerRowId("acme", "core", "alice");
		const dbPath = join(root, "zeta.db");
		const db = new TeamDb(dbPath);
		try {
			db.insertTeam({ id: "acme", name: "Acme", rootPath: canonicalPath(teamRoot), createdAt: 0 });
			db.insertPm({
				id: pmId,
				teamId: "acme",
				name: "Core",
				workspacePath: join(teamRoot, "pms", "core"),
				createdAt: 0,
			});
			db.insertRepo({
				id: repoId,
				teamId: "acme",
				name: "api-web",
				basePath: join(teamRoot, "repos", "api-web"),
				remoteUrl: null,
				defaultBranch: "main",
				createdAt: 0,
			});
			db.insertEngineer({
				id: engineerId,
				teamId: "acme",
				pmId,
				name: "alice",
				execution: "normal",
				createdAt: 0,
			});
			db.insertWorktree({
				id: worktreeRowId("acme", "api-web", "core", "alice", "task", "T-101"),
				teamId: "acme",
				repoId,
				pmId,
				engineerId,
				kind: "task",
				name: "T-101",
				path: external,
				branch: "team/acme/core/alice/T-101",
				baseBranch: "main",
				createdAt: 0,
			});
		} finally {
			db.close();
		}

		// The breadcrumb alone proves only the team; the DB supplies the rest.
		expect(resolveTeamSessionOrigin(external, { dbPath: join(root, "missing.db") })).toEqual({
			kind: "team",
			teamId: "acme",
		});
		const refined = resolveTeamSessionOrigin(external, { dbPath });
		expect(refined).toEqual({
			kind: "team",
			teamId: "acme",
			pmId,
			engineerId,
			repoId,
			workspaceAlias: "Core / alice / api-web / T-101",
		});
		expect(refined?.workspaceAlias).not.toContain(root);
	});
});
