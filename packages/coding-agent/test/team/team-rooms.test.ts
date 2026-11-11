/**
 * Team rooms: database-only rooms, membership resolved from real PM/engineer
 * rows, host-ordered events, reply targets, duplicate/empty rejection, the
 * v1 → v3 migration, doctor integrity checks, and the CLI verbs.
 *
 * Every fixture is a real temporary directory, SQLite database, and Git
 * repository; no mocks.
 */

import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TeamDb, type RoomMemberRecord, type RoomRecord } from "../../src/team/db";
import { diagnoseTeam } from "../../src/team/doctor";
import { TeamError } from "../../src/team/errors";
import { createRoom, listRooms, postRoomEvent, readRoomEvents, showRoom } from "../../src/team/rooms";
import { addEngineer, addPm, addRepoLink, bindRepo, initTeam } from "../../src/team/service";

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

function findJsonl(root: string): string[] {
	const found: string[] = [];
	for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
		const child = path.join(root, entry.name);
		if (entry.isDirectory()) found.push(...findJsonl(child));
		else if (entry.name.endsWith(".jsonl")) found.push(child);
	}
	return found;
}

function memberIds(members: RoomMemberRecord[]): string[] {
	return members.map(member => member.agentId).sort();
}

describe("team rooms", () => {
	let scratch: string;
	let teamRoot: string;
	let dbPath: string;
	let pmRoom: RoomRecord;

	beforeAll(async () => {
		scratch = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-team-rooms-"));
		teamRoot = path.join(scratch, "acme-team");
		dbPath = path.join(scratch, "team.db");
		const fixtureRepo = makeFixtureRepo(scratch, "api-base");

		await initTeam({ name: "Acme", root: teamRoot, dbPath });
		await addPm({ pm: "core", teamRoot, dbPath });
		await addPm({ pm: "platform", teamRoot, dbPath });
		await addRepoLink({ repo: "api", path: fixtureRepo, teamRoot, dbPath });
		await bindRepo({ repo: "api", pm: "core", teamRoot, dbPath });
		await bindRepo({ repo: "api", pm: "platform", teamRoot, dbPath });
		await addEngineer({ name: "alice", pm: "core", repo: "api", teamRoot, dbPath });
		await addEngineer({ name: "bob", pm: "platform", repo: "api", teamRoot, dbPath });
	}, 120_000);

	afterAll(() => {
		try {
			fs.rmSync(scratch, { recursive: true, force: true });
		} catch {
			// Windows may still hold a Git handle; the OS temp dir is disposable.
		}
	}, 30_000);

	test("PM room defaults to its PM and that PM's engineers", async () => {
		const result = await createRoom({ name: "core", pm: "core", teamRoot, dbPath });
		pmRoom = result.room;
		expect(result.room).toMatchObject({ teamId: "acme", pmId: "acme:core", name: "core", kind: "pm" });
		expect(memberIds(result.members)).toEqual(["acme:core", "acme:core:alice"]);
		expect(result.members.map(member => member.role).sort()).toEqual(["engineer", "pm"]);

		const db = new TeamDb(dbPath);
		try {
			expect(db.getRoom("acme", "core")?.id).toBe("acme:core");
			expect(db.listRoomsForAgent("acme", "acme:core:alice").map(room => room.name)).toEqual(["core"]);
		} finally {
			db.close();
		}
	}, 30_000);

	test("coordination room is shared and has no owning PM", async () => {
		const explicit = await createRoom({
			name: "shared",
			shared: true,
			members: "core,platform",
			teamRoot,
			dbPath,
		});
		expect(explicit.room).toMatchObject({ pmId: null, kind: "coordination" });
		expect(memberIds(explicit.members)).toEqual(["acme:core", "acme:platform"]);

		const defaults = await createRoom({ name: "all-hands", kind: "coordination", teamRoot, dbPath });
		expect(memberIds(defaults.members)).toEqual([
			"acme:core",
			"acme:core:alice",
			"acme:platform",
			"acme:platform:bob",
		]);
	}, 30_000);

	test("arbitrary room accepts explicit members and starts empty without them", async () => {
		const adhoc = await createRoom({ name: "adhoc", kind: "room", members: "core/alice", teamRoot, dbPath });
		expect(adhoc.room).toMatchObject({ pmId: null, kind: "room" });
		expect(memberIds(adhoc.members)).toEqual(["acme:core:alice"]);

		const empty = await createRoom({ name: "empty", kind: "room", teamRoot, dbPath });
		expect(empty.members).toEqual([]);
	}, 30_000);

	test("duplicate room names are rejected per team, including #-prefixed input", async () => {
		await expectTeamError(createRoom({ name: "core", pm: "core", teamRoot, dbPath }), /already exists/i);
		await expectTeamError(createRoom({ name: "#shared", shared: true, teamRoot, dbPath }), /already exists/i);
	}, 30_000);

	test("unknown members, PMs, kinds, and shared+PM conflicts are rejected", async () => {
		await expectTeamError(
			createRoom({ name: "bad-member", members: "ghost", teamRoot, dbPath }),
			/Unknown room member/,
		);
		await expectTeamError(createRoom({ name: "bad-pm", pm: "ghost", teamRoot, dbPath }), /Unknown PM/);
		await expectTeamError(createRoom({ name: "bad-kind", kind: "channel", teamRoot, dbPath }), /Unknown room kind/);
		await expectTeamError(
			createRoom({ name: "bad-shared", shared: true, pm: "core", teamRoot, dbPath }),
			/no owning PM/,
		);
	}, 30_000);

	test("posts are host-ordered, trimmed, mention-aware, and readable incrementally", async () => {
		const first = await postRoomEvent({ room: "core", body: "  kickoff  ", teamRoot, dbPath });
		expect(first.event).toMatchObject({ roomId: "acme:core", senderAgentId: "acme:core", kind: "message" });
		expect(first.event.body).toBe("kickoff");
		expect(first.event.replyTo).toBeNull();

		const second = await postRoomEvent({
			room: "core",
			body: "alice here",
			sender: "alice",
			teamRoot,
			dbPath,
		});
		const third = await postRoomEvent({
			room: "core",
			body: "@core status please",
			sender: "acme:core:alice",
			teamRoot,
			dbPath,
		});
		expect(second.event.senderAgentId).toBe("acme:core:alice");
		expect(third.event.mentions).toEqual(["core"]);
		expect(first.event.seq).toBeLessThan(second.event.seq);
		expect(second.event.seq).toBeLessThan(third.event.seq);
		expect(second.event.sentAt).toBeGreaterThanOrEqual(first.event.sentAt);
		expect(third.event.sentAt).toBeGreaterThanOrEqual(second.event.sentAt);

		const all = await readRoomEvents({ room: "core", teamRoot, dbPath });
		expect(all.map(event => event.seq)).toEqual([first.event.seq, second.event.seq, third.event.seq]);

		const incremental = await readRoomEvents({
			room: "core",
			afterSeq: first.event.seq,
			teamRoot,
			dbPath,
		});
		expect(incremental.map(event => event.seq)).toEqual([second.event.seq, third.event.seq]);

		const view = await showRoom({ room: "core", limit: 2, teamRoot, dbPath });
		expect(view.events.map(event => event.seq)).toEqual([second.event.seq, third.event.seq]);
		expect(view.members).toHaveLength(2);

		const summaries = await listRooms({ teamRoot, dbPath });
		const summary = summaries.find(room => room.name === "core");
		expect(summary).toMatchObject({ memberCount: 2, lastSeq: third.event.seq });
	}, 30_000);

	test("empty bodies, bad kinds, and foreign sequence numbers are rejected", async () => {
		await expectTeamError(postRoomEvent({ room: "core", body: " \n\t ", teamRoot, dbPath }), /must not be empty/);
		await expectTeamError(
			postRoomEvent({ room: "core", body: "x", kind: "Not A Kind", teamRoot, dbPath }),
			/Invalid event kind/,
		);
		await expectTeamError(
			postRoomEvent({ room: "core", body: "x", replyTo: 99_999, teamRoot, dbPath }),
			/Reply target/,
		);
		const foreign = await postRoomEvent({ room: "adhoc", body: "hello", sender: "alice", teamRoot, dbPath });
		await expectTeamError(
			postRoomEvent({ room: "core", body: "x", replyTo: foreign.event.seq, teamRoot, dbPath }),
			/not an event/,
		);
	}, 30_000);

	test("reply-to records an earlier event in the same room", async () => {
		const events = await readRoomEvents({ room: "core", teamRoot, dbPath });
		const target = events[0];
		const reply = await postRoomEvent({
			room: "core",
			body: "on it",
			sender: "alice",
			replyTo: target.seq,
			teamRoot,
			dbPath,
		});
		expect(reply.event.replyTo).toBe(target.seq);
		expect(reply.event.seq).toBeGreaterThan(target.seq);
	}, 30_000);

	test("sender must be a member and non-PM rooms require an explicit sender", async () => {
		await expectTeamError(
			postRoomEvent({ room: "shared", body: "hi", sender: "alice", teamRoot, dbPath }),
			/not a member/,
		);
		await expectTeamError(postRoomEvent({ room: "shared", body: "hi", teamRoot, dbPath }), /has no owning PM/);
	}, 30_000);

	test("missing rooms are rejected by show, read, and post", async () => {
		await expectTeamError(showRoom({ room: "nope", teamRoot, dbPath }), /Unknown room/);
		await expectTeamError(readRoomEvents({ room: "nope", teamRoot, dbPath }), /Unknown room/);
		await expectTeamError(postRoomEvent({ room: "nope", body: "hi", teamRoot, dbPath }), /Unknown room/);
	}, 30_000);

	test("room events never write a session transcript", () => {
		expect(findJsonl(teamRoot)).toEqual([]);
	});

	test("doctor reports healthy rooms and catches missing members and bad reply links", async () => {
		const healthy = await diagnoseTeam({ teamRoot, dbPath });
		expect(healthy.ok).toBe(true);

		const db = new TeamDb(dbPath);
		const eventCount = db.listRoomEvents(pmRoom.id).length;
		db.close();

		const raw = new Database(dbPath);
		raw.run("PRAGMA foreign_keys = ON");
		raw.run("DELETE FROM room_members WHERE room_id = ? AND agent_id = ?", [pmRoom.id, pmRoom.pmId]);
		raw.close();

		const missing = await diagnoseTeam({ teamRoot, dbPath });
		expect(missing.ok).toBe(false);
		expect(missing.checks.find(check => check.id === "room.owner-member:core")?.ok).toBe(false);

		const restore = new Database(dbPath);
		restore.run("PRAGMA foreign_keys = ON");
		restore.run("INSERT INTO room_members (room_id, agent_id, role, created_at) VALUES (?, ?, ?, ?)", [
			pmRoom.id,
			pmRoom.pmId,
			"pm",
			pmRoom.createdAt,
		]);
		restore.close();

		const repaired = await diagnoseTeam({ teamRoot, dbPath });
		expect(repaired.ok).toBe(true);
		expect(eventCount).toBeGreaterThan(0);

		const corrupt = new Database(dbPath);
		corrupt.run("PRAGMA foreign_keys = ON");
		const inserted = corrupt.run(
			`INSERT INTO room_events (room_id, sent_at, sender_agent_id, kind, body, reply_to, mentions_json)
			 VALUES (?, ?, ?, ?, ?, ?, NULL)`,
			[
				"acme:adhoc",
				Math.floor(Date.now() / 1000),
				"acme:core:alice",
				"message",
				"cross-room reply",
				(await readRoomEvents({ room: "core", teamRoot, dbPath }))[0].seq,
			],
		);
		corrupt.close();

		const broken = await diagnoseTeam({ teamRoot, dbPath });
		expect(broken.ok).toBe(false);
		expect(broken.checks.some(check => check.id.startsWith("room.event.reply:adhoc#") && !check.ok)).toBe(true);

		const cleanup = new Database(dbPath);
		cleanup.run("DELETE FROM room_events WHERE seq = ?", [Number(inserted.lastInsertRowid)]);
		cleanup.close();
		expect((await diagnoseTeam({ teamRoot, dbPath })).ok).toBe(true);
	}, 30_000);

	test("v1 database upgrades to the rooms, agents, and agent-skills schema without losing rows", () => {
		const legacyPath = path.join(scratch, "legacy.db");
		const seed = new TeamDb(legacyPath);
		seed.insertTeam({ id: "legacy", name: "Legacy", rootPath: path.join(scratch, "legacy-team"), createdAt: 1 });
		seed.close();

		const downgrade = new Database(legacyPath);
		downgrade.run("DROP TABLE room_events");
		downgrade.run("DROP TABLE room_members");
		downgrade.run("DROP TABLE rooms");
		downgrade.run("PRAGMA user_version = 1");
		expect(downgrade.query("SELECT name FROM sqlite_master WHERE name = 'rooms'").get()).toBeNull();
		downgrade.close();

		const upgraded = new TeamDb(legacyPath);
		try {
			expect(upgraded.getTeam("legacy")).toMatchObject({ name: "Legacy" });
			upgraded.insertRoom({
				id: "legacy:ops",
				teamId: "legacy",
				pmId: null,
				name: "ops",
				kind: "room",
				createdAt: 2,
			});
			expect(upgraded.getRoom("legacy", "ops")).toMatchObject({ kind: "room" });
		} finally {
			upgraded.close();
		}

		const verify = new Database(legacyPath);
		const version = verify.query<{ user_version: number }, []>("PRAGMA user_version").get();
		const agentsTable = verify.query("SELECT name FROM sqlite_master WHERE name = 'agents'").get();
		const agentSkillsTable = verify.query("SELECT name FROM sqlite_master WHERE name = 'agent_skills'").get();
		const tasksTable = verify.query("SELECT name FROM sqlite_master WHERE name = 'tasks'").get();
		const taskEventsTable = verify.query("SELECT name FROM sqlite_master WHERE name = 'task_events'").get();
		verify.close();
		expect(version?.user_version).toBe(5);
		expect(agentsTable).not.toBeNull();
		expect(agentSkillsTable).not.toBeNull();
		expect(tasksTable).not.toBeNull();
		expect(taskEventsTable).not.toBeNull();
	}, 30_000);

	test("doctor accepts a registered Secretary as a PM-room member", async () => {
		const db = new TeamDb(dbPath);
		try {
			db.insertAgent({
				id: "secretary-acme-core",
				teamId: "acme",
				pmId: "acme:core",
				role: "secretary",
				persistence: "persistent",
				parentAgentId: "acme:core",
				sessionId: null,
				sessionFile: null,
				state: "idle",
				createdAt: 1,
				updatedAt: 1,
			});
		} finally {
			db.close();
		}

		const created = await createRoom({ name: "secretary-room", pm: "core", teamRoot, dbPath });
		expect(created.members.map(member => member.agentId)).toContain("secretary-acme-core");

		const report = await diagnoseTeam({ teamRoot, dbPath });
		const member = report.checks.find(check => check.id === "room.member:secretary-room/secretary-acme-core");
		expect(member).toMatchObject({ ok: true, detail: 'role "secretary"' });
		expect(report.checks.some(check => check.id.startsWith("room.member:") && !check.ok)).toBe(false);
		expect(report.ok).toBe(true);
	}, 30_000);

	test("CLI creates, lists, posts, and shows a room", () => {
		const runCli = (...args: string[]) => {
			const proc = Bun.spawnSync([process.execPath, cliEntry, "team", ...args], {
				cwd: repoRoot,
				env: { ...process.env, ZETA_TEAM_DB: dbPath },
				stdout: "pipe",
				stderr: "pipe",
			});
			return {
				code: proc.exitCode,
				stdout: proc.stdout.toString(),
				stderr: proc.stderr.toString(),
			};
		};

		const created = runCli("room", "create", "ops", "--pm", "core", "--root", teamRoot);
		expect(created.stderr).not.toContain("Error:");
		expect(created.code).toBe(0);
		expect(created.stdout).toContain('Created room "ops" (pm');

		const listed = runCli("room", "list", "--root", teamRoot);
		expect(listed.code).toBe(0);
		expect(listed.stdout).toContain("ops");
		expect(listed.stdout).toContain("core  pm");

		const posted = runCli("room", "post", "ops", "--body", "cli hello @core", "--root", teamRoot);
		expect(posted.stderr).not.toContain("Error:");
		expect(posted.code).toBe(0);
		expect(posted.stdout).toMatch(/Posted #\d+ to room "ops"/);

		const shown = runCli("room", "show", "ops", "--root", teamRoot);
		expect(shown.code).toBe(0);
		expect(shown.stdout).toContain("cli hello @core");
		expect(shown.stdout).toContain("acme:core");

		const json = runCli("room", "list", "--root", teamRoot, "--json");
		expect(json.code).toBe(0);
		const parsed = JSON.parse(json.stdout) as Array<{ name: string }>;
		expect(parsed.some(room => room.name === "ops")).toBe(true);
	}, 120_000);
});
