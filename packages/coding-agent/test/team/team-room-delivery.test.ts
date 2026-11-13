/**
 * Room delivery cursors: oldest-first drain, no seq gaps, monotonic accepted
 * cursor, and ack separated from delivery. Uses a real Team DB/room and a real
 * IrcBus with a fake AgentSession handle (no terminal, no mock echo).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentSessionHandle } from "../../src/session/agent-session-handle";
import { IrcBus } from "../../src/irc/bus";
import { AgentRegistry } from "../../src/registry/agent-registry";
import { pmRowId, TeamDb } from "../../src/team/db";
import { ackRoom, deliverPendingRoomEvents, pendingRoomEvents, subscribeRoom } from "../../src/team/room-delivery";
import { createRoom, postRoomEvent } from "../../src/team/rooms";
import { addPm, initTeam } from "../../src/team/service";

let scratch: string;
let teamRoot: string;
let dbPath: string;
let pmPath: string;

function fakeSession(cwd: string, deliver: (body: string) => "injected" | "failed") {
	const messages: string[] = [];
	const handle = {
		settings: { getCwd: () => cwd },
		sessionFile: undefined,
		deliverIrcMessage: async (message: { body: string }) => {
			messages.push(message.body);
			const outcome = deliver(message.body);
			if (outcome === "failed") throw new Error("delivery failed");
			return outcome;
		},
	} as unknown as AgentSessionHandle;
	return { handle, messages };
}

beforeAll(async () => {
	scratch = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-team-delivery-"));
	teamRoot = path.join(scratch, "acme-team");
	dbPath = path.join(scratch, "team.db");
	pmPath = path.join(teamRoot, "pms", "core");
	await initTeam({ name: "Acme", root: teamRoot, dbPath });
	await addPm({ pm: "core", teamRoot, dbPath });
	await createRoom({ name: "core", pm: "core", teamRoot, dbPath });
}, 120_000);

beforeEach(() => {
	AgentRegistry.installGlobal(new AgentRegistry());
	IrcBus.installGlobal(new IrcBus(AgentRegistry.global()));
});

afterAll(() => {
	IrcBus.resetGlobalForTests();
	AgentRegistry.resetGlobalForTests();
	try {
		fs.rmSync(scratch, { recursive: true, force: true });
	} catch {
		// Windows may hold a SQLite handle; the OS temp dir is disposable.
	}
}, 30_000);

describe("team room delivery", () => {
	test("drains oldest-first and never advances past a failed seq", async () => {
		const first = await postRoomEvent({ room: "core", body: "one", teamRoot, dbPath });
		const second = await postRoomEvent({ room: "core", body: "two", teamRoot, dbPath });
		await subscribeRoom({ room: "core", agent: "core", fromSeq: 0, teamRoot, dbPath });

		let failNext = true;
		const session = fakeSession(pmPath, body => {
			if (failNext && body.includes("#1]")) {
				failNext = false;
				return "failed";
			}
			return "injected";
		});
		AgentRegistry.global().register({
			id: "main",
			displayName: "Main",
			kind: "main",
			session: session.handle,
			status: "idle",
		});

		const firstDrain = await deliverPendingRoomEvents({ agentId: "main", cwd: pmPath, teamRoot, dbPath });
		expect(firstDrain).toHaveLength(1);
		expect(firstDrain[0]).toMatchObject({ seq: first.event.seq, accepted: false });
		expect(session.messages).toHaveLength(1);
		expect(session.messages[0]).toContain("#1]");

		const db = new TeamDb(dbPath);
		try {
			expect(db.getRoomSubscription("acme:core", pmRowId("acme", "core"))?.acceptedThrough).toBe(0);
		} finally {
			db.close();
		}

		const secondDrain = await deliverPendingRoomEvents({ agentId: "main", cwd: pmPath, teamRoot, dbPath });
		expect(secondDrain.map(result => result.seq)).toEqual([first.event.seq, second.event.seq]);
		expect(secondDrain.every(result => result.accepted)).toBe(true);
		expect(session.messages).toHaveLength(3);
		expect(session.messages[1]).toContain("#1]");
		expect(session.messages[2]).toContain("#2]");

		const verify = new TeamDb(dbPath);
		try {
			const subscription = verify.getRoomSubscription("acme:core", pmRowId("acme", "core"));
			expect(subscription?.acceptedThrough).toBe(second.event.seq);
			expect(subscription?.readThrough).toBe(0);
		} finally {
			verify.close();
		}

		const acked = await ackRoom({ room: "core", agent: "core", throughSeq: first.event.seq, teamRoot, dbPath });
		expect(acked.readThrough).toBe(first.event.seq);
		expect(acked.acceptedThrough).toBe(second.event.seq);
		await expect(
			ackRoom({ room: "core", agent: "core", throughSeq: second.event.seq + 1, teamRoot, dbPath }),
		).rejects.toThrow(/Cannot ack/);

		const pending = await pendingRoomEvents({ room: "core", agent: "core", teamRoot, dbPath });
		expect(pending).toEqual([]);
	}, 30_000);

	test("post fans out to a subscribed live session and advances the cursor", async () => {
		const session = fakeSession(pmPath, () => "injected");
		AgentRegistry.global().register({
			id: "main",
			displayName: "Main",
			kind: "main",
			session: session.handle,
			status: "idle",
		});
		await subscribeRoom({ room: "core", agent: "core", teamRoot, dbPath });
		const posted = await postRoomEvent({ room: "core", body: "live", sender: "core", teamRoot, dbPath });
		expect(session.messages.some(body => body.includes(`#${posted.event.seq}]`))).toBe(true);
		const db = new TeamDb(dbPath);
		try {
			expect(db.getRoomSubscription("acme:core", pmRowId("acme", "core"))?.acceptedThrough).toBe(posted.event.seq);
		} finally {
			db.close();
		}
	}, 30_000);
});
