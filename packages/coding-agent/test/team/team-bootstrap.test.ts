/**
 * Transactional Team bootstrap: preflight, journal, default resources, single
 * engineer, failure/resume, crash adoption, and rollback preservation.
 * Every fixture is a real directory, SQLite DB, and Git repository.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { TeamDb } from "../../src/team/db";
import {
	applyTeamBootstrap,
	planTeamBootstrap,
	resumeTeamBootstrap,
	rollbackBootstrapRun,
	type BootstrapInput,
	type BootstrapPlan,
	type BootstrapResult,
} from "../../src/team/bootstrap";
import { diagnoseTeam } from "../../src/team/doctor";
import { TeamError } from "../../src/team/errors";
import { engineerHomePath } from "../../src/team/paths";
import { addPm, initTeam } from "../../src/team/service";

const GIT_NAME = "Zeta Test";
const GIT_EMAIL = "zeta-test@example.invalid";

function runGit(cwd: string, ...args: string[]): string {
	const proc = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
	if (proc.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${proc.stderr.toString()}`);
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

function input(scratch: string, overrides: Partial<BootstrapInput> = {}): BootstrapInput {
	return {
		name: "Acme",
		root: path.join(scratch, "team"),
		pms: [{ name: "core" }],
		repos: [],
		engineers: [],
		...overrides,
	};
}

async function apply(
	plan: BootstrapPlan,
	dbPath: string,
	options: { rollbackOnFailure?: boolean } = {},
): Promise<BootstrapResult> {
	return applyTeamBootstrap(plan, { dbPath, ...options });
}

describe("team bootstrap", () => {
	let scratch: string;
	let fixtureRepo: string;
	let dbPath: string;

	beforeAll(() => {
		scratch = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-team-bootstrap-"));
		fixtureRepo = makeFixtureRepo(scratch, "api-base");
		dbPath = path.join(scratch, "team.db");
	}, 120_000);

	afterAll(() => {
		try {
			fs.rmSync(scratch, { recursive: true, force: true });
		} catch {
			// Windows may hold a Git handle; the OS temp dir is disposable.
		}
	}, 30_000);

	test("preflight rejects an ownerless-root violation before writing", async () => {
		const gitRoot = makeFixtureRepo(scratch, "inside-git");
		const plan = await planTeamBootstrap(input(scratch, { root: gitRoot }), { dbPath });
		expect(plan.preflight.ok).toBe(false);
		expect(plan.preflight.errors.join("\n")).toMatch(/inside Git repository/);
		expect(fs.existsSync(path.join(gitRoot, ".zeta"))).toBe(false);

		const agentsRoot = path.join(scratch, "agents-root");
		fs.mkdirSync(agentsRoot, { recursive: true });
		fs.writeFileSync(path.join(agentsRoot, "AGENTS.md"), "# no\n");
		const agentsPlan = await planTeamBootstrap(input(scratch, { root: agentsRoot }), { dbPath });
		expect(agentsPlan.preflight.ok).toBe(false);
		expect(agentsPlan.preflight.errors.join("\n")).toMatch(/AGENTS\.md/);

		const nestedRoot = path.join(scratch, "nested-root");
		fs.mkdirSync(nestedRoot, { recursive: true });
		makeFixtureRepo(nestedRoot, "nested");
		const nestedPlan = await planTeamBootstrap(input(scratch, { root: nestedRoot }), { dbPath });
		expect(nestedPlan.preflight.ok).toBe(false);
		expect(nestedPlan.preflight.errors.join("\n")).toMatch(/nested Git/);
	}, 30_000);

	test("apply creates PM/repo/binding/engineer/default rooms and a done journal", async () => {
		const plan = await planTeamBootstrap(
			input(scratch, {
				repos: [{ name: "api", link: fixtureRepo }],
				engineers: [{ name: "alice", pm: "core", repo: "api", execution: "vibe" }],
			}),
			{ dbPath },
		);
		expect(plan.preflight.ok).toBe(true);
		const result = await apply(plan, dbPath);
		expect(result.run.status).toBe("done");
		expect(result.doctor?.ok).toBe(true);
		expect(result.steps.every(step => step.status === "done")).toBe(true);
		expect(result.steps.some(step => step.kind === "create-room")).toBe(true);

		const db = new TeamDb(dbPath);
		try {
			const runs = db.listBootstrapRuns(plan.teamRoot);
			expect(runs).toHaveLength(1);
			expect(runs[0].status).toBe("done");
			expect(db.getPm("acme", "core")).not.toBeNull();
			expect(db.getEngineer("acme", "core", "alice")?.execution).toBe("vibe");
			expect(db.getRoom("acme", "coordination")).not.toBeNull();
			expect(db.getRoom("acme", "core")).not.toBeNull();
		} finally {
			db.close();
		}
	}, 120_000);

	test("single-engineer mode adds to an existing Team without re-creating it", async () => {
		const root = path.join(scratch, "existing-team");
		const existingDb = path.join(scratch, "existing.db");
		await initTeam({ name: "Existing", root, dbPath: existingDb });
		await addPm({ pm: "core", teamRoot: root, dbPath: existingDb });
		const plan = await planTeamBootstrap(
			{
				name: "Existing",
				root,
				pms: [],
				engineerOnly: true,
				engineers: [{ name: "bob", pm: "core", repo: "api" }],
			},
			{ dbPath: existingDb },
		);
		// The repo is not registered in this existing team; the plan must fail.
		expect(plan.preflight.ok).toBe(false);

		const existingRepo = makeFixtureRepo(scratch, "existing-api");
		const db = new TeamDb(existingDb);
		try {
			db.insertRepo({
				id: "existing:api",
				teamId: "existing",
				name: "api",
				basePath: existingRepo,
				remoteUrl: null,
				defaultBranch: "main",
				createdAt: 1,
			});
			db.insertBinding("existing:api", "existing:core");
		} finally {
			db.close();
		}
		const second = await planTeamBootstrap(
			{
				name: "Existing",
				root,
				pms: [],
				engineerOnly: true,
				engineers: [{ name: "bob", pm: "core", repo: "api" }],
			},
			{ dbPath: existingDb },
		);
		expect(second.preflight.ok).toBe(true);
		const result = await apply(second, existingDb);
		expect(result.run.status).toBe("done");
		expect(result.steps.map(step => step.kind)).toEqual(["add-engineer"]);
		const verify = new TeamDb(existingDb);
		try {
			expect(verify.getTeam("existing")).not.toBeNull();
			expect(verify.getEngineer("existing", "core", "bob")).not.toBeNull();
		} finally {
			verify.close();
		}
	}, 120_000);

	test("failed apply leaves a resumable run; resume creates the missing repo", async () => {
		const lateRepo = path.join(scratch, "late-repo");
		const cloneUrl = pathToFileURL(lateRepo).href;
		const root = path.join(scratch, "resume-team");
		const resumeDb = path.join(scratch, "resume.db");
		const plan = await planTeamBootstrap(
			{
				name: "Resume",
				root,
				pms: [{ name: "core" }],
				repos: [{ name: "api", clone: cloneUrl }],
				engineers: [{ name: "alice", pm: "core", repo: "api" }],
			},
			{ dbPath: resumeDb },
		);
		expect(plan.preflight.ok).toBe(true);
		let failedRunId = "";
		try {
			await apply(plan, resumeDb, { rollbackOnFailure: false });
		} catch (error) {
			expect(error).toBeInstanceOf(TeamError);
		}
		const failed = new TeamDb(resumeDb);
		try {
			const runs = failed.listBootstrapRuns(root);
			expect(runs).toHaveLength(1);
			expect(runs[0].status).toBe("failed");
			failedRunId = runs[0].runId;
			const failedStep = failed.listBootstrapSteps(failedRunId).find(step => step.status === "failed");
			expect(failedStep?.kind).toBe("add-repo-clone");
		} finally {
			failed.close();
		}

		makeFixtureRepo(scratch, "late-repo");
		const resumed = await resumeTeamBootstrap(failedRunId, { dbPath: resumeDb });
		expect(resumed.run.status).toBe("done");
		expect(resumed.doctor?.ok).toBe(true);
		const verify = new TeamDb(resumeDb);
		try {
			expect(verify.getRepo("resume", "api")).not.toBeNull();
			expect(verify.getEngineer("resume", "core", "alice")).not.toBeNull();
		} finally {
			verify.close();
		}
	}, 120_000);

	test("resume adopts a step whose execute succeeded before the journal done write", async () => {
		const root = path.join(scratch, "crash-team");
		const crashDb = path.join(scratch, "crash.db");
		const plan = await planTeamBootstrap(
			input(scratch, {
				name: "Crash",
				root,
				repos: [{ name: "api", link: fixtureRepo }],
				engineers: [{ name: "alice", pm: "core", repo: "api" }],
			}),
			{ dbPath: crashDb },
		);
		const result = await apply(plan, crashDb);
		expect(result.run.status).toBe("done");

		const db = new TeamDb(crashDb);
		let engineerStepId = "";
		try {
			const engineerStep = db.listBootstrapSteps(result.run.runId).find(step => step.kind === "add-engineer");
			expect(engineerStep).toBeDefined();
			engineerStepId = engineerStep!.stepId;
			db.updateBootstrapStep(result.run.runId, engineerStepId, {
				status: "running",
				payload: plan.steps.find(step => step.stepId === engineerStepId)?.payload,
			});
			db.updateBootstrapRun(result.run.runId, { status: "running" });
		} finally {
			db.close();
		}

		const resumed = await resumeTeamBootstrap(result.run.runId, { dbPath: crashDb });
		expect(resumed.run.status).toBe("done");
		const verify = new TeamDb(crashDb);
		try {
			const step = verify
				.listBootstrapSteps(result.run.runId)
				.find(candidate => candidate.stepId === engineerStepId);
			expect(step?.status).toBe("done");
			expect(verify.listEngineers("crash").filter(row => row.name === "alice")).toHaveLength(1);
			expect((await diagnoseTeam({ teamRoot: root, dbPath: crashDb })).ok).toBe(true);
		} finally {
			verify.close();
		}
	}, 120_000);

	test("rollback preserves a dirty worktree and its DB rows", async () => {
		const root = path.join(scratch, "dirty-team");
		const dirtyDb = path.join(scratch, "dirty.db");
		const plan = await planTeamBootstrap(
			input(scratch, {
				name: "Dirty",
				root,
				repos: [{ name: "api", link: fixtureRepo }],
				engineers: [{ name: "alice", pm: "core", repo: "api" }],
			}),
			{ dbPath: dirtyDb },
		);
		const result = await apply(plan, dirtyDb);
		const home = engineerHomePath(root, "api", "core", "alice");
		fs.writeFileSync(path.join(home, "user-change.txt"), "keep me\n");

		const rolled = await rollbackBootstrapRun(result.run.runId, { dbPath: dirtyDb });
		expect(rolled.errors.length).toBeGreaterThan(0);
		expect(rolled.run.status).toBe("failed");
		expect(fs.existsSync(home)).toBe(true);
		const db = new TeamDb(dirtyDb);
		try {
			expect(db.getEngineer("dirty", "core", "alice")).not.toBeNull();
			expect(db.listWorktrees("dirty").some(row => row.kind === "home")).toBe(true);
		} finally {
			db.close();
		}

		fs.rmSync(path.join(home, "user-change.txt"), { force: true });
		const retried = await rollbackBootstrapRun(result.run.runId, { dbPath: dirtyDb });
		expect(retried.errors).toEqual([]);
		expect(retried.run.status).toBe("compensated");
		expect(fs.existsSync(home)).toBe(false);
	}, 120_000);

	test("rollback preserves a clone that gained files, then succeeds after cleanup", async () => {
		const root = path.join(scratch, "clone-team");
		const cloneDb = path.join(scratch, "clone.db");
		const cloneUrl = pathToFileURL(fixtureRepo).href;
		const plan = await planTeamBootstrap(
			{
				name: "Clone",
				root,
				pms: [{ name: "core" }],
				repos: [{ name: "api", clone: cloneUrl }],
			},
			{ dbPath: cloneDb },
		);
		const result = await apply(plan, cloneDb);
		const clonePath = path.join(root, "repos", "api");
		fs.writeFileSync(path.join(clonePath, "user-change.txt"), "keep me\n");

		const rolled = await rollbackBootstrapRun(result.run.runId, { dbPath: cloneDb });
		expect(rolled.errors.length).toBeGreaterThan(0);
		expect(rolled.run.status).toBe("failed");
		expect(fs.existsSync(clonePath)).toBe(true);
		const db = new TeamDb(cloneDb);
		try {
			expect(db.getRepo("clone", "api")).not.toBeNull();
			expect(db.getTeam("clone")).not.toBeNull();
		} finally {
			db.close();
		}

		fs.rmSync(path.join(clonePath, "user-change.txt"), { force: true });
		const retried = await rollbackBootstrapRun(result.run.runId, { dbPath: cloneDb });
		expect(retried.errors).toEqual([]);
		expect(retried.run.status).toBe("compensated");
		expect(fs.existsSync(clonePath)).toBe(false);
		const verify = new TeamDb(cloneDb);
		try {
			expect(verify.getTeam("clone")).toBeNull();
		} finally {
			verify.close();
		}
	}, 120_000);
});
