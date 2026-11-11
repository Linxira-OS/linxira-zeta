/**
 * Studio Team workspace operations against the real Team service and a real
 * temporary SQLite/Git fixture. No mock database, no fake task/room rows.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type {
	CommandInput,
	CommandName,
	CommandRequestId,
	CommandResult,
	IdempotencyKey,
	QueryInput,
	QueryName,
	QueryResult,
} from "../src/server/studio-host/contract/index.js";
import { StudioOperations, type StudioHostContext } from "../src/server/studio-host/registry.js";
import { teamOps } from "../src/server/studio-host/ops/team.js";

const operations = new StudioOperations([teamOps]);

function context(): StudioHostContext {
	return { capabilities: operations.capabilities().manifest };
}

function runQuery<TName extends QueryName>(queryName: TName, input: QueryInput<TName>) {
	return operations.query({ queryName, input }, context());
}

async function queryResult<TName extends QueryName>(
	queryName: TName,
	input: QueryInput<TName>,
): Promise<QueryResult<TName>> {
	const response = await runQuery(queryName, input);
	if (!response.ok) throw new Error(`${queryName} failed: ${response.error.code} ${response.error.message}`);
	return response.result;
}

function runCommand<TName extends CommandName>(commandName: TName, input: CommandInput<TName>) {
	return operations.command(
		{
			commandName,
			input,
			idempotencyKey: `team-test-${commandName}` as IdempotencyKey,
			requestId: `team-test-${commandName}` as CommandRequestId,
		},
		context(),
	).then(reply => reply.result as CommandResult<TName>);
}

function makeFixtureRepo(parent: string, name: string): string {
	const repo = path.join(parent, name);
	fs.mkdirSync(repo, { recursive: true });
	const git = (...args: string[]) => {
		const proc = Bun.spawnSync(["git", ...args], { cwd: repo, stdout: "pipe", stderr: "pipe" });
		if (proc.exitCode !== 0) throw new Error(proc.stderr.toString());
	};
	git("init", "-q", "-b", "main");
	fs.writeFileSync(path.join(repo, "README.md"), "# fixture\n");
	git("add", "README.md");
	git("-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-qm", "init");
	return repo;
}

describe("Studio Team workspace", () => {
	let scratch: string;
	let teamRoot: string;
	let dbPath: string;
	let fixtureRepo: string;
	let bootstrapRunId = "";
	let taskKey = "T-101";
	let rejectKey = "T-102";

	beforeAll(() => {
		scratch = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-studio-team-"));
		teamRoot = path.join(scratch, "team");
		dbPath = path.join(scratch, "team.db");
		fixtureRepo = makeFixtureRepo(scratch, "api");
		process.env.ZETA_TEAM_DB = dbPath;
	});

	afterAll(() => {
		delete process.env.ZETA_TEAM_DB;
		try {
			fs.rmSync(scratch, { recursive: true, force: true });
		} catch {
			// Windows may keep a SQLite/Git handle; the OS temp dir is disposable.
		}
	});

	test("empty database lists no Team", async () => {
		const response = await queryResult("team.list", {});
		expect(response.teams).toEqual([]);
	});

	test("bootstrap plans, preflights, applies, and reports doctor", async () => {
		const input = {
			name: "Acme",
			root: teamRoot,
			displayName: "Acme",
			pms: [{ name: "core" }],
			repos: [{ name: "api", link: fixtureRepo, bindPms: ["core"] }],
			engineers: [{ name: "alice", pm: "core", repo: "api" }],
			rooms: [{ name: "shared", shared: true }],
		};
		const planned = await queryResult("team.bootstrap.plan", input);
		expect(planned.preflight.ok).toBe(true);
		expect(planned.plan.steps.map(step => step.kind)).toEqual([
			"init-team",
			"add-pm",
			"add-repo-link",
			"bind-repo",
			"add-engineer",
			"create-room",
			"create-room",
			"create-room",
		]);
		expect(
			planned.plan.steps
				.filter(step => step.kind === "create-room")
				.map(step => step.description),
		).toEqual(["create room shared", "create room coordination", "create room core"]);
		const result = (await runCommand("team.bootstrap.apply", input)) as {
			run: { runId: string; status: string; teamId: string | null };
			doctor: { ok: boolean };
		};
		expect(result.run.status).toBe("done");
		expect(result.run.teamId).toBe("acme");
		expect(result.doctor.ok).toBe(true);
		bootstrapRunId = result.run.runId;

		const list = await queryResult("team.list", {});
		expect(list.teams).toEqual([expect.objectContaining({ id: "acme", name: "Acme" })]);

		const read = await queryResult("team.read", { teamId: "acme" });
		expect(read.pms.map(pm => pm.name)).toEqual(["core"]);
		expect(read.engineers.map(engineer => engineer.name)).toEqual(["alice"]);
		expect(read.repos.map(repo => repo.name)).toEqual(["api"]);
		expect(read.bindings).toHaveLength(1);
		expect(read.worktrees.map(worktree => worktree.kind)).toEqual(["home"]);
		expect(read.rooms.map(room => room.name).sort()).toEqual(["coordination", "core", "shared"]);
		const coordination = read.rooms.find(room => room.name === "coordination");
		expect(read.roomMembers[coordination?.id ?? ""]?.map(member => member.role).sort()).toEqual([
			"engineer",
			"pm",
		]);
		// The Host must never serialize a Team path to the renderer.
		expect(JSON.stringify(read)).not.toContain(scratch);
	});

	test("task queue runs through claim, lease, submit, approve", async () => {
		const created = await runCommand("team.task.create", {
			teamId: "acme",
			taskKey,
			title: "Ship the API",
			body: "REQ-016",
			pm: "core",
		});
		expect(created.task.status).toBe("pending");

		const assigned = await runCommand("team.task.assign", {
			teamId: "acme",
			task: taskKey,
			pm: "core",
			assignee: "alice",
		});
		expect(assigned.task.assigneeAgentId).toBe("acme:core:alice");

		const claimed = await runCommand("team.task.claim", {
			teamId: "acme",
			task: taskKey,
			agent: "acme:core:alice",
			leaseSeconds: 60,
		});
		expect(claimed.task.status).toBe("claimed");
		expect(claimed.task.leaseExpiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000) - 5);

		const renewed = await runCommand("team.task.renew", {
			teamId: "acme",
			task: taskKey,
			agent: "acme:core:alice",
			leaseSeconds: 120,
		});
		expect(renewed.task.leaseExpiresAt).toBeGreaterThan(claimed.task.leaseExpiresAt ?? 0);

		const submitted = await runCommand("team.task.submit", {
			teamId: "acme",
			task: taskKey,
			agent: "acme:core:alice",
			body: "done",
		});
		expect(submitted.task.status).toBe("review");
		expect(submitted.events.at(-1)?.kind).toBe("submitted");

		const approved = await runCommand("team.task.complete", {
			teamId: "acme",
			task: taskKey,
			pm: "core",
		});
		expect(approved.task.status).toBe("done");
		expect(approved.task.reqIds).toContain("REQ-016");
	});

	test("review rejection returns the task to pending with an event", async () => {
		await runCommand("team.task.create", {
			teamId: "acme",
			taskKey: rejectKey,
			title: "Needs another pass",
			pm: "core",
		});
		await runCommand("team.task.claim", {
			teamId: "acme",
			task: rejectKey,
			agent: "alice",
		});
		await runCommand("team.task.submit", {
			teamId: "acme",
			task: rejectKey,
			agent: "alice",
		});
		const rejected = await runCommand("team.task.reject", {
			teamId: "acme",
			task: rejectKey,
			pm: "core",
			body: "missing tests",
		});
		expect(rejected.task.status).toBe("pending");
		expect(rejected.task.ownerAgentId).toBeNull();
		expect(rejected.events.at(-1)?.body).toBe("missing tests");
	});

	test("wrong PM cannot approve a task", async () => {
		await runCommand("team.task.create", {
			teamId: "acme",
			taskKey: "T-103",
			title: "Owner check",
			pm: "core",
		});
		await expect(
			runCommand("team.task.complete", {
				teamId: "acme",
				task: "T-103",
				pm: "other",
			}),
		).rejects.toThrow(/Unknown PM|does not own task/);
	});

	test("rooms create, add/remove member, change kind, post, read incrementally, subscribe and ack", async () => {
		const created = await runCommand("team.room.create", {
			teamId: "acme",
			room: "standup",
			kind: "room",
			members: ["acme:core"],
		});
		const room = created.rooms.find(row => row.name === "standup");
		expect(room?.kind).toBe("room");
		expect(created.roomMembers[room?.id ?? ""]?.length).toBe(1);

		await runCommand("team.room.member.add", {
			teamId: "acme",
			room: "standup",
			member: "acme:core:alice",
		});
		await runCommand("team.room.member.remove", {
			teamId: "acme",
			room: "standup",
			member: "acme:core:alice",
		});
		const kindChanged = await runCommand("team.room.kind.set", {
			teamId: "acme",
			room: "standup",
			kind: "coordination",
		});
		expect(kindChanged.rooms.find(row => row.name === "standup")?.kind).toBe("coordination");

		const first = await runCommand("team.room.post", {
			teamId: "acme",
			room: "standup",
			body: "hello @alice",
			sender: "acme:core",
		});
		expect(first.seq).toBeGreaterThan(0);
		expect(first.mentions).toContain("alice");

		const page = await queryResult("team.room.events", {
			teamId: "acme",
			room: "standup",
			afterSeq: 0,
		});
		expect(page.events.map(event => event.seq)).toEqual([first.seq]);

		const subscribed = await runCommand("team.room.subscribe", {
			teamId: "acme",
			room: "standup",
			agent: "acme:core",
			fromSeq: first.seq,
		});
		expect(subscribed.acceptedThrough).toBe(first.seq);

		const second = await runCommand("team.room.post", {
			teamId: "acme",
			room: "standup",
			body: "second",
			sender: "acme:core",
		});
		const incremental = await queryResult("team.room.events", {
			teamId: "acme",
			room: "standup",
			afterSeq: first.seq,
			agent: "acme:core",
		});
		expect(incremental.events.map(event => event.seq)).toEqual([second.seq]);

		// Delivery to an offline member leaves the durable cursor for next start.
		const acked = await runCommand("team.room.ack", {
			teamId: "acme",
			room: "standup",
			agent: "acme:core",
			throughSeq: subscribed.acceptedThrough,
		});
		expect(acked.readThrough).toBe(first.seq);
	});

	test("unknown Team is rejected without touching a path", async () => {
		const response = await runQuery("team.read", { teamId: "../outside" });
		expect(response.ok).toBe(false);
		if (!response.ok) expect(response.error.code).toBe("INVALID_ARGUMENT");
	});

	test("bootstrap resume on a done run returns the same Team", async () => {
		const resumed = (await runCommand("team.bootstrap.resume", {
			runId: bootstrapRunId,
			rollbackOnFailure: false,
		})) as { run: { status: string; teamId: string | null }; doctor: { ok: boolean } };
		expect(resumed.run.status).toBe("done");
		expect(resumed.run.teamId).toBe("acme");
		expect(resumed.doctor.ok).toBe(true);
	});

	test("bootstrap rollback compensates only this run", async () => {
		const rolled = (await runCommand("team.bootstrap.rollback", { runId: bootstrapRunId })) as {
			run: { status: string };
			errors: string[];
		};
		expect(rolled.run.status).toBe("compensated");
		expect(rolled.errors).toEqual([]);
	});
});
