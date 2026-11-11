/**
 * Durable local room log: host-assigned room-scoped seq, restart, unread,
 * duplicate/role rejection, and the log-only proposal/ack ledger.
 *
 * The store is a real temp SQLite file; no session transcript is written.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { RoomService } from "../../src/rooms/service";
import { RoomError } from "../../src/rooms/errors";

describe("local room log", () => {
	let scratch: string;
	let dbPath: string;
	let rooms: RoomService;

	beforeEach(() => {
		scratch = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-rooms-log-"));
		dbPath = path.join(scratch, "rooms.db");
		rooms = new RoomService(dbPath);
	});

	afterEach(() => {
		rooms.close();
		fs.rmSync(scratch, { recursive: true, force: true });
	});

	test("seq is per room, host-assigned, strictly increasing, and survives restart", () => {
		const alpha = rooms.createRoom({ kind: "main", name: "alpha" });
		const beta = rooms.createRoom({ kind: "main", name: "beta" });
		rooms.addMember({ roomId: alpha.id, memberId: "Main", role: "main" });
		rooms.addMember({ roomId: beta.id, memberId: "Main", role: "main" });

		const a1 = rooms.postMessage({ roomId: alpha.id, body: "one" }).event;
		const b1 = rooms.postMessage({ roomId: beta.id, body: "beta one" }).event;
		const a2 = rooms.postMessage({ roomId: alpha.id, body: "two" }).event;

		expect([a1.seq, a2.seq, b1.seq]).toEqual([1, 2, 1]);
		expect(Date.parse(a2.sentAt)).toBeGreaterThan(Date.parse(a1.sentAt));
		expect(typeof b1.sentAt).toBe("string");

		rooms.close();
		rooms = new RoomService(dbPath);
		const a3 = rooms.postMessage({ roomId: alpha.id, body: "three" }).event;
		expect(a3.seq).toBe(3);
		expect(rooms.snapshot(alpha.id).events.map(event => event.seq)).toEqual([1, 2, 3]);
		expect(rooms.snapshot(beta.id).events.map(event => event.seq)).toEqual([1]);
	});

	test("empty bodies, duplicate names, and unknown members are rejected", () => {
		const room = rooms.createRoom({ kind: "main", name: "main-room" });
		expect(() => rooms.createRoom({ kind: "main", name: "main-room" })).toThrow(RoomError);
		expect(() => rooms.postMessage({ roomId: room.id, body: "   " })).toThrow(/must not be empty/);
		expect(() => rooms.addMember({ roomId: room.id, memberId: "user", role: "main" })).toThrow(/implicit/);
		expect(() => rooms.addMember({ roomId: room.id, memberId: "child", role: "repo" })).toThrow(/main room/);
		rooms.addMember({ roomId: room.id, memberId: "Main", role: "main" });
		expect(() => rooms.addMember({ roomId: room.id, memberId: "SecondMain", role: "main" })).toThrow(
			/already holds its main agent/,
		);
		expect(() => rooms.markSeen(room.id, "user", 99)).toThrow(/outside room/);
	});

	test("unread is driven by the member cursor and never by sender claims", () => {
		const room = rooms.createRoom({ kind: "main", name: "unread" });
		rooms.addMember({ roomId: room.id, memberId: "Main", role: "main" });
		rooms.addMember({ roomId: room.id, memberId: "Child", role: "resident" });
		rooms.postMessage({ roomId: room.id, body: "one" });
		rooms.postMessage({ roomId: room.id, body: "two" });
		expect(rooms.unread(room.id, "Child")).toBe(2);
		rooms.markSeen(room.id, "Child", 1);
		expect(rooms.unread(room.id, "Child")).toBe(1);
		rooms.markSeen(room.id, "Child", 2);
		expect(rooms.unread(room.id, "Child")).toBe(0);
	});

	test("proposal/ack is a room event pair and never edits the target repository", () => {
		const repo = path.join(scratch, "repo-a");
		const tracking = path.join(repo, ".zeta", "tracking.md");
		fs.mkdirSync(path.dirname(tracking), { recursive: true });
		fs.writeFileSync(tracking, "target decision: keep\n");
		const room = rooms.createRoom({ kind: "super", name: "super" });
		rooms.addMember({ roomId: room.id, memberId: "Main", role: "main" });

		const { event, proposal } = rooms.createProposal({
			roomId: room.id,
			actor: { kind: "agent", id: "Main", name: "Main" },
			targetRepo: repo,
			targetMemberId: "Main",
			body: "proposal: change the target decision",
		});
		expect(event.kind).toBe("proposal");
		expect(proposal.status).toBe("open");
		expect(fs.readFileSync(tracking, "utf8")).toBe("target decision: keep\n");

		const ack = rooms.respondProposal({
			roomId: room.id,
			proposalId: proposal.proposalId,
			actor: { kind: "agent", id: "Main", name: "Main" },
			accept: true,
			decisionId: "decision-1",
		});
		expect(ack.event.kind).toBe("ack");
		expect(ack.event.replyTo).toBe(event.seq);
		expect(ack.proposal.status).toBe("accepted");
		expect(fs.readFileSync(tracking, "utf8")).toBe("target decision: keep\n");
	});
});
