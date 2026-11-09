/**
 * Team Hub data projection and action helpers against a real temporary SQLite
 * Team database and real room service calls. No mocks: rooms/events come from
 * `rooms`/`room_events`; a Team marker without a database row stays empty.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	buildTeamHubEntries,
	filterTeamHubEvents,
	formatTeamHubEvent,
	moveTeamHubSelection,
	nextTeamHubPmRoom,
	selectTeamHubRoom,
	teamHubUnread,
} from "@linxiraos/pi-tui/overlays/team-hub";
import { engineerRowId, pmRowId, TeamDb, worktreeRowId } from "../../src/team/db";
import { createTeamHubDataSource } from "../../src/team/hub-data";
import { createRoom, postRoomEvent } from "../../src/team/rooms";
import { addPm, initTeam } from "../../src/team/service";
import { engineerHomePath, taskWorktreePath } from "../../src/team/paths";

let scratch: string;
let teamRoot: string;
let dbPath: string;

beforeAll(async () => {
	scratch = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-team-hub-"));
	teamRoot = path.join(scratch, "acme-team");
	dbPath = path.join(scratch, "team.db");

	await initTeam({ name: "Acme", root: teamRoot, dbPath });
	await addPm({ pm: "core", displayName: "Core", teamRoot, dbPath });
	await addPm({ pm: "growth", displayName: "Growth", teamRoot, dbPath });

	const db = new TeamDb(dbPath);
	try {
		const teamId = "acme";
		const pmCore = pmRowId(teamId, "core");
		const pmGrowth = pmRowId(teamId, "growth");
		db.insertRepo({
			id: "acme:api",
			teamId,
			name: "api",
			basePath: path.join(teamRoot, "repos", "api"),
			remoteUrl: null,
			defaultBranch: "main",
			createdAt: 1,
		});
		db.insertBinding("acme:api", pmCore);
		db.insertBinding("acme:api", pmGrowth);
		db.insertEngineer({
			id: engineerRowId(teamId, "core", "alice"),
			teamId,
			pmId: pmCore,
			name: "alice",
			execution: "vibe",
			createdAt: 1,
		});
		db.insertEngineer({
			id: engineerRowId(teamId, "growth", "carol"),
			teamId,
			pmId: pmGrowth,
			name: "carol",
			execution: "normal",
			createdAt: 1,
		});
		db.insertWorktree({
			id: worktreeRowId(teamId, "api", "core", "alice", "home", "home"),
			teamId,
			repoId: "acme:api",
			pmId: pmCore,
			engineerId: engineerRowId(teamId, "core", "alice"),
			kind: "home",
			name: "home",
			path: engineerHomePath(teamRoot, "api", "core", "alice"),
			branch: "team/acme/core/alice/integration",
			baseBranch: "main",
			createdAt: 1,
		});
		db.insertWorktree({
			id: worktreeRowId(teamId, "api", "core", "alice", "task", "T-101"),
			teamId,
			repoId: "acme:api",
			pmId: pmCore,
			engineerId: engineerRowId(teamId, "core", "alice"),
			kind: "task",
			name: "T-101",
			path: taskWorktreePath(teamRoot, "api", "core", "alice", "T-101"),
			branch: "team/acme/core/alice/T-101",
			baseBranch: "main",
			createdAt: 1,
		});
	} finally {
		db.close();
	}

	await createRoom({ teamRoot, dbPath, name: "core", pm: "core" });
	await createRoom({
		teamRoot,
		dbPath,
		name: "coordination",
		shared: true,
		members: ["core", "core/alice", "growth", "growth/carol"],
	});
	await createRoom({ teamRoot, dbPath, name: "empty-room" });
	await createRoom({ teamRoot, dbPath, name: "growth-room", pm: "growth" });

	const first = await postRoomEvent({
		teamRoot,
		dbPath,
		room: "core",
		body: "T-101 ready in worktrees/api/core/alice/T-101",
	});
	await postRoomEvent({
		teamRoot,
		dbPath,
		room: "core",
		sender: "core/alice",
		body: "alice: reviewer task done",
		replyTo: first.event.seq,
	});
	await postRoomEvent({
		teamRoot,
		dbPath,
		room: "coordination",
		sender: "growth",
		body: "standup: three blockers, one wait for QA",
	});
});

afterAll(() => {
	fs.rmSync(scratch, { recursive: true, force: true });
});

describe("Team Hub data projection", () => {
	test("rooms come from the database with real last sequence and member counts", async () => {
		const source = createTeamHubDataSource({ teamRoot, teamId: "acme", dbPath });
		const snapshot = await source.load();
		expect(snapshot.dbAvailable).toBe(true);
		expect(snapshot.teamName).toBe("Acme");
		expect(snapshot.warning).toBeUndefined();
		expect(snapshot.rooms.map(room => room.name)).toEqual(["coordination", "core", "growth-room", "empty-room"]);

		const core = snapshot.rooms.find(room => room.name === "core");
		expect(core?.kind).toBe("pm");
		expect(core?.pmName).toBe("core");
		expect(core?.lastSeq).not.toBeNull();
		expect(core?.memberCount).toBe(2); // PM core + alice
		const coordination = snapshot.rooms.find(room => room.name === "coordination");
		expect(coordination?.kind).toBe("coordination");
		expect(coordination?.memberCount).toBe(4);
	});

	test("the selected room carries ordered events, sender labels, and reply links", async () => {
		const source = createTeamHubDataSource({ teamRoot, teamId: "acme", dbPath });
		const snapshot = await source.load({ room: "core" });
		const view = snapshot.selectedRoom;
		expect(view?.room.name).toBe("core");
		expect(view?.members.map(member => member.label).sort()).toEqual(["core", "core/alice"]);
		expect(view?.events.length).toBe(2);
		const [first, second] = view!.events;
		expect(first!.seq).toBeLessThan(second!.seq);
		expect(first!.senderLabel).toBe("core");
		expect(first!.body).toContain("T-101 ready");
		expect(second!.senderLabel).toBe("core/alice");
		expect(second!.replyTo).toBe(first!.seq);
	});

	test("a PM-focused load selects that PM's room, not a fabricated one", async () => {
		const source = createTeamHubDataSource({ teamRoot, teamId: "acme", dbPath });
		const snapshot = await source.load({ preferPmId: pmRowId("acme", "growth") });
		expect(snapshot.selectedRoom?.room.name).toBe("growth-room");
		expect(snapshot.selectedRoom?.room.pmName).toBe("growth");

		const missing = await source.load({ preferPmId: pmRowId("acme", "ghost") });
		expect(missing.warning).toContain("owns no room");
		expect(missing.selectedRoom?.room.name).toBe("coordination");
	});

	test("an empty room is honest: no members, no events", async () => {
		const source = createTeamHubDataSource({ teamRoot, teamId: "acme", dbPath });
		const snapshot = await source.load({ room: "empty-room" });
		expect(snapshot.selectedRoom?.room.memberCount).toBe(0);
		expect(snapshot.selectedRoom?.members).toEqual([]);
		expect(snapshot.selectedRoom?.events).toEqual([]);
	});

	test("a marker without a database row opens the Hub with an honest warning", async () => {
		const source = createTeamHubDataSource({
			teamRoot,
			teamId: "missing-team",
			teamName: "Missing",
			dbPath,
		});
		const snapshot = await source.load();
		expect(snapshot.dbAvailable).toBe(false);
		expect(snapshot.teamName).toBe("Missing");
		expect(snapshot.rooms).toEqual([]);
		expect(snapshot.pms).toEqual([]);
		expect(snapshot.selectedRoom).toBeNull();
		expect(snapshot.warning).toContain("no row");
	});

	test("engineers expose DB execution and their real worktrees", async () => {
		const source = createTeamHubDataSource({ teamRoot, teamId: "acme", dbPath });
		const snapshot = await source.load();
		const alice = snapshot.engineers.find(engineer => engineer.name === "alice");
		expect(alice?.execution).toBe("vibe");
		expect(alice?.pmName).toBe("core");
		expect(alice?.worktrees.map(worktree => worktree.kind).sort()).toEqual(["home", "task"]);
	});
});

describe("Team Hub posting", () => {
	test("a PM room defaults its sender and writes a database event only", async () => {
		const db = new TeamDb(dbPath);
		const before = db.listRoomEvents("acme:core").length;
		db.close();
		const source = createTeamHubDataSource({ teamRoot, teamId: "acme", dbPath });
		const posted = await source.post({ room: "core", body: "hub post", sender: pmRowId("acme", "core") });
		expect(posted.seq).toBeGreaterThan(0);
		const dbAfter = new TeamDb(dbPath);
		const events = dbAfter.listRoomEvents("acme:core");
		dbAfter.close();
		expect(events.length).toBe(before + 1);
		expect(events.at(-1)?.body).toBe("hub post");
	});

	test("a shared room requires a real member sender", async () => {
		const source = createTeamHubDataSource({ teamRoot, teamId: "acme", dbPath });
		await expect(source.post({ room: "coordination", body: "no sender" })).rejects.toThrow(/Missing --sender/);
		const posted = await source.post({
			room: "coordination",
			body: "from alice",
			sender: engineerRowId("acme", "core", "alice"),
		});
		expect(posted.seq).toBeGreaterThan(0);
	});
});

describe("Team Hub layout helpers", () => {
	test("sidebar lists rooms then PMs and engineers, skipping sections while filtering", async () => {
		const source = createTeamHubDataSource({ teamRoot, teamId: "acme", dbPath });
		const snapshot = await source.load({ room: "core" });
		const entries = buildTeamHubEntries(snapshot);
		expect(entries.some(entry => entry.kind === "label" && entry.label === "ROOMS")).toBe(true);
		expect(entries.some(entry => entry.kind === "label" && entry.label === "PMS & ENGINEERS")).toBe(true);
		expect(entries.find(entry => entry.roomName === "core")?.annotation).toContain("PM core");

		const filtered = buildTeamHubEntries(snapshot, "alice");
		expect(filtered.every(entry => entry.kind !== "label")).toBe(true);
		expect(filtered.some(entry => entry.id === "engineer:acme:core:alice")).toBe(true);
	});

	test("selection movement skips labels and wraps", async () => {
		const source = createTeamHubDataSource({ teamRoot, teamId: "acme", dbPath });
		const snapshot = await source.load({ room: "core" });
		const entries = buildTeamHubEntries(snapshot);
		const first = moveTeamHubSelection(entries, undefined, 1);
		expect(first?.startsWith("room:")).toBe(true);
		const selectableCount = entries.filter(entry => entry.kind !== "label" && entry.kind !== "separator").length;
		expect(moveTeamHubSelection(entries, first, selectableCount)).toBe(first);
	});

	test("g/p scope helpers use real room ownership", async () => {
		const source = createTeamHubDataSource({ teamRoot, teamId: "acme", dbPath });
		const snapshot = await source.load({ room: "core" });
		expect(selectTeamHubRoom(snapshot.rooms, "shared")?.name).toBe("coordination");
		expect(nextTeamHubPmRoom(snapshot.rooms, "core", pmRowId("acme", "core"))?.name).toBe("core");
		expect(nextTeamHubPmRoom(snapshot.rooms, "growth-room", pmRowId("acme", "growth"))?.name).toBe("growth-room");
	});

	test("unread is measured against this Hub's baseline, and event filters are literal", async () => {
		const source = createTeamHubDataSource({ teamRoot, teamId: "acme", dbPath });
		const snapshot = await source.load({ room: "core" });
		const core = snapshot.rooms.find(room => room.name === "core")!;
		const baseline = new Map([[core.id, (core.lastSeq ?? 0) - 1]]);
		expect(teamHubUnread(core, baseline)).toBe(1);
		expect(teamHubUnread(core, new Map())).toBe(0);

		const events = snapshot.selectedRoom!.events;
		expect(filterTeamHubEvents(events, "reviewer")).toHaveLength(1);
		expect(filterTeamHubEvents(events, "missing")).toHaveLength(0);
		const rendered = formatTeamHubEvent(events[1]!, 80, new Date(events[1]!.sentAt * 1000));
		expect(rendered.join(" ")).toContain("core/alice");
		expect(rendered.join(" ")).toContain(`↳#${events[0]!.seq}`);
	});
});
