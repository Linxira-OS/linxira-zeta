/**
 * Durable Team task queue: PM dispatch, compare-and-set claims, leases,
 * review/done transitions, REQ-* ids, restart persistence, doctor checks, and
 * the CLI verbs. Every fixture is a real temporary directory and SQLite
 * database; the CLI tests run a second OS process.
 */

import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TeamDb } from "../../src/team/db";
import { diagnoseTeam } from "../../src/team/doctor";
import { TeamError } from "../../src/team/errors";
import { addEngineer, addPm, addRepoLink, bindRepo, initTeam } from "../../src/team/service";
import {
	assignTask,
	cancelTask,
	claimTask,
	commentTask,
	completeTask,
	createTask,
	listTasks,
	rejectTask,
	releaseTask,
	renewTaskLease,
	showTask,
	submitTask,
} from "../../src/team/tasks";

const repoRoot = path.resolve(import.meta.dir, "../../../..");
const cliEntry = path.join(repoRoot, "packages/coding-agent/src/cli.ts");

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

describe("team task queue", () => {
	let scratch: string;
	let teamRoot: string;
	let dbPath: string;

	beforeAll(async () => {
		scratch = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-team-tasks-"));
		teamRoot = path.join(scratch, "acme-team");
		dbPath = path.join(scratch, "team.db");

		await initTeam({ name: "Acme", root: teamRoot, dbPath });
		await addPm({ pm: "core", teamRoot, dbPath });
		await addPm({ pm: "platform", teamRoot, dbPath });
		const fixtureRepo = makeFixtureRepo(scratch, "api-base");
		await addRepoLink({ repo: "api", path: fixtureRepo, teamRoot, dbPath });
		await bindRepo({ repo: "api", pm: "core", teamRoot, dbPath });
		await bindRepo({ repo: "api", pm: "platform", teamRoot, dbPath });
		await addEngineer({ name: "alice", pm: "core", repo: "api", execution: "vibe", teamRoot, dbPath });
		await addEngineer({ name: "bob", pm: "core", repo: "api", teamRoot, dbPath });
		await addEngineer({ name: "carol", pm: "platform", repo: "api", teamRoot, dbPath });
	}, 120_000);

	afterAll(() => {
		try {
			fs.rmSync(scratch, { recursive: true, force: true });
		} catch {
			// Windows may still hold a SQLite handle; the OS temp dir is disposable.
		}
	}, 30_000);

	test("PM dispatch creates a durable pending task and extracts REQ ids", async () => {
		const created = await createTask({
			taskKey: "T-101",
			title: "Fix login REQ-42",
			body: "Acceptance: REQ-7 and REQ-42",
			pm: "core",
			assignee: "alice",
			reqIds: "REQ-99",
			teamRoot,
			dbPath,
		});
		expect(created.task).toMatchObject({
			taskKey: "T-101",
			status: "pending",
			assignedPmId: "acme:core",
			assigneeAgentId: "acme:core:alice",
			ownerAgentId: null,
			leaseExpiresAt: null,
			revision: 0,
		});
		expect(created.task.reqIds).toEqual(["REQ-99", "REQ-42", "REQ-7"]);
		expect(created.event).toMatchObject({ kind: "created", fromStatus: null, toStatus: "pending" });

		const tasks = await listTasks({ teamRoot, dbPath });
		expect(tasks.map(task => task.taskKey)).toEqual(["T-101"]);
		expect((await listTasks({ teamRoot, dbPath, status: "pending" })).length).toBe(1);
		expect((await listTasks({ teamRoot, dbPath, status: "done" })).length).toBe(0);

		await expectTeamError(
			createTask({ taskKey: "T-101", title: "duplicate", pm: "core", teamRoot, dbPath }),
			/already exists/,
		);
		await expectTeamError(
			createTask({ taskKey: "T-102", title: "x", pm: "core", assignee: "carol", teamRoot, dbPath }),
			/not owned by PM/,
		);
		await expectTeamError(listTasks({ teamRoot, dbPath, status: "nope" }), /Unknown task status/);
	}, 30_000);

	test("claim is exclusive, lease renewal works, and review gates done", async () => {
		await expectTeamError(claimTask({ task: "T-101", agent: "bob", teamRoot, dbPath }), /assigned to another/);

		const claimed = await claimTask({ task: "T-101", agent: "alice", leaseSeconds: 120, teamRoot, dbPath });
		expect(claimed.task).toMatchObject({
			status: "claimed",
			ownerAgentId: "acme:core:alice",
			ownerRole: "engineer",
		});
		expect(claimed.task.leaseExpiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));

		const renewed = await renewTaskLease({ task: "T-101", agent: "alice", leaseSeconds: 300, teamRoot, dbPath });
		expect(renewed.task.leaseExpiresAt).toBeGreaterThanOrEqual(claimed.task.leaseExpiresAt ?? 0);
		expect(renewed.event.kind).toBe("renewed");

		await expectTeamError(renewTaskLease({ task: "T-101", agent: "bob", teamRoot, dbPath }), /does not own/);

		const second = await createTask({ taskKey: "T-102", title: "Unassigned work", pm: "core", teamRoot, dbPath });
		expect(second.task.status).toBe("pending");
		await claimTask({ task: "T-102", agent: "alice", leaseSeconds: 60, teamRoot, dbPath });
		await expectTeamError(claimTask({ task: "T-102", agent: "bob", teamRoot, dbPath }), /already claimed by/);

		const released = await releaseTask({ task: "T-102", agent: "alice", teamRoot, dbPath });
		expect(released.task).toMatchObject({ status: "pending", ownerAgentId: null, leaseExpiresAt: null });

		await claimTask({ task: "T-102", agent: "alice", leaseSeconds: 60, teamRoot, dbPath });
		const submitted = await submitTask({
			task: "T-102",
			agent: "alice",
			body: "implemented REQ-7",
			teamRoot,
			dbPath,
		});
		expect(submitted.task).toMatchObject({ status: "review", ownerAgentId: "acme:core:alice", leaseExpiresAt: null });
		expect(submitted.task.reqIds).toContain("REQ-7");
		await expectTeamError(claimTask({ task: "T-102", agent: "bob", teamRoot, dbPath }), /in review/);
		await expectTeamError(completeTask({ task: "T-102", pm: "platform", teamRoot, dbPath }), /does not own/);

		const completed = await completeTask({ task: "T-102", pm: "core", body: "reviewed REQ-8", teamRoot, dbPath });
		expect(completed.task.status).toBe("done");
		expect(completed.task.reqIds).toEqual(expect.arrayContaining(["REQ-7", "REQ-8"]));
		await expectTeamError(claimTask({ task: "T-102", agent: "alice", teamRoot, dbPath }), /is done/);

		const view = await showTask({ task: "T-102", teamRoot, dbPath });
		expect(view.events.map(event => event.kind)).toEqual([
			"created",
			"claimed",
			"released",
			"claimed",
			"submitted",
			"completed",
		]);
	}, 30_000);

	test("reject returns work to pending and comments carry REQ ids", async () => {
		await createTask({ taskKey: "T-103", title: "Needs tests", pm: "core", teamRoot, dbPath });
		await claimTask({ task: "T-103", agent: "alice", leaseSeconds: 60, teamRoot, dbPath });
		await submitTask({ task: "T-103", agent: "alice", body: "first pass", teamRoot, dbPath });

		const rejected = await rejectTask({
			task: "T-103",
			pm: "core",
			body: "Cover REQ-55 before review",
			teamRoot,
			dbPath,
		});
		expect(rejected.task).toMatchObject({ status: "pending", ownerAgentId: null, leaseExpiresAt: null });
		expect(rejected.task.reqIds).toContain("REQ-55");

		const comment = await commentTask({
			task: "T-103",
			agent: "alice",
			body: "Added REQ-56 coverage",
			teamRoot,
			dbPath,
		});
		expect(comment.event.kind).toBe("comment");
		expect(comment.task.reqIds).toEqual(expect.arrayContaining(["REQ-55", "REQ-56"]));

		const cancelled = await cancelTask({ task: "T-103", pm: "core", body: "superseded", teamRoot, dbPath });
		expect(cancelled.task.status).toBe("cancelled");
		await expectTeamError(claimTask({ task: "T-103", agent: "alice", teamRoot, dbPath }), /cancelled/);
	}, 30_000);

	test("an expired lease is reclaimable by another engineer of the same PM", async () => {
		await createTask({ taskKey: "T-104", title: "Lease test", pm: "core", teamRoot, dbPath });
		await claimTask({ task: "T-104", agent: "alice", leaseSeconds: 30, teamRoot, dbPath });

		const raw = new Database(dbPath);
		raw.run("UPDATE tasks SET lease_expires_at = 0 WHERE task_key = 'T-104'");
		raw.close();

		const reclaimed = await claimTask({ task: "T-104", agent: "bob", leaseSeconds: 60, teamRoot, dbPath });
		expect(reclaimed.task.ownerAgentId).toBe("acme:core:bob");
		expect(reclaimed.event.body).toContain("lease expired; reclaimed by bob");
	}, 30_000);

	test("claim and lease survive a restart and a second OS process", async () => {
		const restarted = new TeamDb(dbPath);
		try {
			expect(restarted.getTask("acme", "T-101")).toMatchObject({
				status: "claimed",
				ownerAgentId: "acme:core:alice",
			});
			expect(restarted.getTask("acme", "T-104")?.ownerAgentId).toBe("acme:core:bob");
		} finally {
			restarted.close();
		}

		const runCli = (...args: string[]) => {
			const proc = Bun.spawnSync([process.execPath, cliEntry, "team", ...args], {
				cwd: repoRoot,
				env: { ...process.env, ZETA_TEAM_DB: dbPath },
				stdout: "pipe",
				stderr: "pipe",
			});
			return { code: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
		};

		const created = runCli(
			"task",
			"create",
			"T-105",
			"--pm",
			"core",
			"--title",
			"CLI work",
			"--req",
			"REQ-105",
			"--root",
			teamRoot,
		);
		expect(created.stderr).not.toContain("Error:");
		expect(created.code).toBe(0);

		const claimed = runCli("task", "claim", "T-105", "--agent", "alice", "--lease", "90", "--root", teamRoot);
		expect(claimed.stderr).not.toContain("Error:");
		expect(claimed.code).toBe(0);
		expect(claimed.stdout).toContain("until");

		const listed = runCli("task", "list", "--root", teamRoot, "--json");
		expect(listed.code).toBe(0);
		const parsed = JSON.parse(listed.stdout) as Array<{
			taskKey: string;
			status: string;
			ownerAgentId: string | null;
		}>;
		expect(parsed.find(task => task.taskKey === "T-105")).toMatchObject({
			status: "claimed",
			ownerAgentId: "acme:core:alice",
		});

		const view = await showTask({ task: "T-105", teamRoot, dbPath });
		expect(view.task.reqIds).toContain("REQ-105");
		expect(view.events.map(event => event.kind)).toEqual(["created", "claimed"]);
	}, 120_000);

	test("doctor validates task ownership and lease consistency", async () => {
		const healthy = await diagnoseTeam({ teamRoot, dbPath });
		expect(healthy.ok).toBe(true);

		const corrupt = new Database(dbPath);
		corrupt.run("UPDATE tasks SET owner_agent_id = 'ghost:owner' WHERE task_key = 'T-104'");
		corrupt.close();

		const brokenOwner = await diagnoseTeam({ teamRoot, dbPath });
		expect(brokenOwner.ok).toBe(false);
		expect(brokenOwner.checks.find(check => check.id === "task.owner:T-104")?.ok).toBe(false);

		const noLease = new Database(dbPath);
		noLease.run(
			"UPDATE tasks SET owner_agent_id = 'acme:core:bob', lease_expires_at = NULL WHERE task_key = 'T-104'",
		);
		noLease.close();

		const brokenLease = await diagnoseTeam({ teamRoot, dbPath });
		expect(brokenLease.ok).toBe(false);
		expect(brokenLease.checks.find(check => check.id === "task.lease:T-104")?.ok).toBe(false);

		const restore = new Database(dbPath);
		restore.run("UPDATE tasks SET lease_expires_at = ? WHERE task_key = 'T-104'", [
			Math.floor(Date.now() / 1000) + 600,
		]);
		restore.close();
		expect((await diagnoseTeam({ teamRoot, dbPath })).ok).toBe(true);
	}, 30_000);

	test("assigning a pending task rejects another PM's engineer", async () => {
		await createTask({ taskKey: "T-106", title: "Assignment", pm: "core", teamRoot, dbPath });
		await expectTeamError(
			assignTask({ task: "T-106", pm: "core", assignee: "carol", teamRoot, dbPath }),
			/not owned by PM/,
		);
		const assigned = await assignTask({ task: "T-106", pm: "core", assignee: "bob", teamRoot, dbPath });
		expect(assigned.task.assigneeAgentId).toBe("acme:core:bob");
	}, 30_000);
});
