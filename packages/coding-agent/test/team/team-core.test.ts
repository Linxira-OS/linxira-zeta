/**
 * Team path / DB foundation: ownerless root markers, PM workspaces, canonical
 * base repositories, PM bindings, engineer home worktrees, task worktrees, the
 * upward resolver, duplicate/branch conflicts, and doctor validation.
 *
 * Every fixture is a real temporary directory and a real temporary Git
 * repository; no mock database and no mock Git.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { TeamDb } from "../../src/team/db";
import { diagnoseTeam } from "../../src/team/doctor";
import { TeamError } from "../../src/team/errors";
import {
	engineerHomePath,
	integrationBranch,
	pmMarkerPath,
	pmWorkspacePath,
	resolveTeamLocation,
	taskBranch,
	taskWorktreePath,
	teamMarkerPath,
} from "../../src/team/paths";
import {
	addEngineer,
	addPm,
	addRepoClone,
	addRepoLink,
	addTaskWorktree,
	bindRepo,
	initTeam,
} from "../../src/team/service";

const GIT_NAME = "Zeta Test";
const GIT_EMAIL = "zeta-test@example.invalid";

function runGit(cwd: string, ...args: string[]): string {
	const proc = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
	if (proc.exitCode !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${proc.stderr.toString()}`);
	}
	return proc.stdout.toString().trim();
}

function makeFixtureRepo(parent: string, name: string): string {
	const repo = path.join(parent, name);
	fs.mkdirSync(repo, { recursive: true });
	runGit(repo, "init", "-b", "main");
	fs.writeFileSync(path.join(repo, "README.md"), "# fixture\n");
	runGit(repo, "add", "README.md");
	runGit(repo, "-c", `user.name=${GIT_NAME}`, "-c", `user.email=${GIT_EMAIL}`, "commit", "-m", "init");
	return repo;
}

function expectTeamError(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
	return promise.then(
		() => {
			throw new Error("Expected a TeamError");
		},
		error => {
			expect(error).toBeInstanceOf(TeamError);
			expect((error as Error).message).toMatch(pattern);
		},
	);
}

describe("team foundation", () => {
	let scratch: string;
	let teamRoot: string;
	let dbPath: string;
	let fixtureRepo: string;

	beforeAll(async () => {
		scratch = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-team-core-"));
		teamRoot = path.join(scratch, "acme-team");
		dbPath = path.join(scratch, "team.db");
		fixtureRepo = makeFixtureRepo(scratch, "api-base");

		await initTeam({ name: "Acme", root: teamRoot, dbPath });
		await addPm({ pm: "core", teamRoot, dbPath });
		await addRepoLink({ repo: "api", path: fixtureRepo, teamRoot, dbPath });
		await bindRepo({ repo: "api", pm: "core", teamRoot, dbPath });
	}, 120_000);

	afterAll(() => {
		try {
			fs.rmSync(scratch, { recursive: true, force: true });
		} catch {
			// Windows may still hold a Git handle; the OS temp dir is disposable.
		}
	}, 30_000);

	test("init writes an ownerless root marker and database row", async () => {
		const marker = JSON.parse(fs.readFileSync(teamMarkerPath(teamRoot), "utf8"));
		expect(marker).toMatchObject({ schemaVersion: 1, kind: "team", teamId: "acme", name: "Acme" });
		expect(fs.existsSync(path.join(teamRoot, "pms"))).toBe(true);
		expect(fs.existsSync(path.join(teamRoot, "repos"))).toBe(true);
		expect(fs.existsSync(path.join(teamRoot, "worktrees"))).toBe(true);
		expect(fs.existsSync(path.join(teamRoot, "AGENTS.md"))).toBe(false);
		expect(fs.existsSync(path.join(teamRoot, ".git"))).toBe(false);

		const db = new TeamDb(dbPath);
		try {
			expect(db.getTeam("acme")).toMatchObject({ id: "acme", name: "Acme" });
		} finally {
			db.close();
		}
	}, 30_000);

	test("duplicate init is rejected", async () => {
		await expectTeamError(initTeam({ name: "Acme", root: teamRoot, dbPath }), /already exists/i);
	}, 30_000);

	test("pm add writes a plain PM workspace with .zeta/pm.json", async () => {
		const pmRoot = pmWorkspacePath(teamRoot, "core");
		const marker = JSON.parse(fs.readFileSync(pmMarkerPath(pmRoot), "utf8"));
		expect(marker).toMatchObject({ schemaVersion: 1, kind: "pm", teamId: "acme", pmId: "core" });
		expect(fs.existsSync(path.join(pmRoot, "notes"))).toBe(true);
		expect(fs.existsSync(path.join(pmRoot, "links"))).toBe(true);
		expect(fs.existsSync(path.join(pmRoot, "repos"))).toBe(false);

		const db = new TeamDb(dbPath);
		try {
			expect(db.getPm("acme", "core")).toMatchObject({ name: "core" });
			expect(db.getBinding(db.getRepo("acme", "api")?.id ?? "", db.getPm("acme", "core")?.id ?? "")).not.toBeNull();
		} finally {
			db.close();
		}
		await expectTeamError(addPm({ pm: "core", teamRoot, dbPath }), /already exists/i);
		await expectTeamError(bindRepo({ repo: "api", pm: "core", teamRoot, dbPath }), /already bound/i);
	}, 30_000);

	test("resolver walks up from repo, PM workspace, and linked worktree", async () => {
		expect(await resolveTeamLocation(fixtureRepo)).toMatchObject({
			teamId: "acme",
			teamRoot: fs.realpathSync(teamRoot),
		});
		expect(await resolveTeamLocation(pmWorkspacePath(teamRoot, "core"))).toMatchObject({
			teamId: "acme",
			pmId: "core",
		});
		expect(await resolveTeamLocation(path.join(teamRoot, "repos", "api"))).toMatchObject({ teamId: "acme" });
	}, 30_000);

	test("engineer add creates the exact home worktree and integration branch", async () => {
		const result = await addEngineer({ name: "alice", pm: "core", repo: "api", teamRoot, dbPath });
		const expectedPath = engineerHomePath(teamRoot, "api", "core", "alice");
		expect(result.worktree.path).toBe(fs.realpathSync(expectedPath));
		expect(result.worktree.branch).toBe("team/acme/core/alice/integration");
		expect(runGit(expectedPath, "rev-parse", "--abbrev-ref", "HEAD")).toBe("team/acme/core/alice/integration");
		expect(fs.existsSync(path.join(expectedPath, "README.md"))).toBe(true);

		expect(await resolveTeamLocation(expectedPath)).toMatchObject({ teamId: "acme", pmId: "core" });

		const db = new TeamDb(dbPath);
		try {
			expect(db.getEngineer("acme", "core", "alice")).toMatchObject({ execution: "normal" });
			expect(
				db.getWorktreeByBranch(db.getRepo("acme", "api")?.id ?? "", integrationBranch("acme", "core", "alice")),
			).not.toBeNull();
		} finally {
			db.close();
		}
	}, 30_000);

	test("engineer add rejects an unbound repo and a duplicate engineer", async () => {
		await addPm({ pm: "other", teamRoot, dbPath });
		await expectTeamError(addEngineer({ name: "bob", pm: "other", repo: "api", teamRoot, dbPath }), /not bound/i);
		await expectTeamError(
			addEngineer({ name: "alice", pm: "core", repo: "api", teamRoot, dbPath }),
			/already has a home worktree/i,
		);
	}, 30_000);

	test("worktree add creates the exact task worktree from the base branch", async () => {
		const baseHead = runGit(fixtureRepo, "rev-parse", "main");
		const record = await addTaskWorktree({
			task: "T-101",
			repo: "api",
			pm: "core",
			engineer: "alice",
			teamRoot,
			dbPath,
		});
		const expectedPath = taskWorktreePath(teamRoot, "api", "core", "alice", "T-101");
		expect(record.path).toBe(fs.realpathSync(expectedPath));
		expect(record.branch).toBe("team/acme/core/alice/T-101");
		expect(runGit(expectedPath, "rev-parse", "--abbrev-ref", "HEAD")).toBe(
			taskBranch("acme", "core", "alice", "T-101"),
		);
		expect(runGit(expectedPath, "rev-parse", "HEAD")).toBe(baseHead);
		expect(await resolveTeamLocation(expectedPath)).toMatchObject({ teamId: "acme", pmId: "core" });

		const db = new TeamDb(dbPath);
		try {
			const repo = db.getRepo("acme", "api");
			expect(db.getWorktreeByPath(repo?.id ?? "", fs.realpathSync(expectedPath))).toMatchObject({
				kind: "task",
				name: "T-101",
			});
		} finally {
			db.close();
		}
	}, 30_000);

	test("worktree add rejects duplicate task and pre-existing branch conflicts", async () => {
		await expectTeamError(
			addTaskWorktree({ task: "T-101", repo: "api", pm: "core", engineer: "alice", teamRoot, dbPath }),
			/already registered/i,
		);
		runGit(fixtureRepo, "branch", "team/acme/core/alice/T-102", "main");
		await expectTeamError(
			addTaskWorktree({ task: "T-102", repo: "api", pm: "core", engineer: "alice", teamRoot, dbPath }),
			/branch .* already exists/i,
		);
	}, 30_000);

	test("doctor reports a healthy team and catches layout drift", async () => {
		const healthy = await diagnoseTeam({ teamRoot, dbPath });
		expect(healthy.ok).toBe(true);
		expect(healthy.checks.filter(check => !check.ok)).toEqual([]);

		const ghost = path.join(teamRoot, "pms", "ghost");
		fs.mkdirSync(ghost, { recursive: true });
		const broken = await diagnoseTeam({ teamRoot, dbPath });
		expect(broken.ok).toBe(false);
		expect(broken.checks.find(check => check.id === "pm.unregistered:ghost")?.ok).toBe(false);

		fs.rmSync(ghost, { recursive: true, force: true });
		const nested = path.join(teamRoot, "pms", "core", "notes", "nested-git");
		fs.mkdirSync(path.join(nested, ".git"), { recursive: true });
		const nestedReport = await diagnoseTeam({ teamRoot, dbPath });
		expect(nestedReport.ok).toBe(false);
		expect(nestedReport.checks.find(check => check.id === "pm.nested-git:core")?.ok).toBe(false);
		fs.rmSync(nested, { recursive: true, force: true });
	}, 30_000);

	test("repo add clones a canonical base repository from a URL", async () => {
		const cloneUrl = pathToFileURL(fixtureRepo).href;
		const record = await addRepoClone({ repo: "api-clone", clone: cloneUrl, teamRoot, dbPath });
		expect(record.basePath).toBe(fs.realpathSync(path.join(teamRoot, "repos", "api-clone")));
		expect(record.defaultBranch).toBe("main");
		expect(runGit(record.basePath, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
		expect(await resolveTeamLocation(path.join(record.basePath))).toMatchObject({ teamId: "acme" });
		await expectTeamError(
			addRepoClone({ repo: "api-clone", clone: cloneUrl, teamRoot, dbPath }),
			/already registered/i,
		);
	}, 60_000);
});
