/**
 * Delivery semantics for local rooms: parallel/serial/mention message
 * delivery, exactly-once cursors, serial context includes the previous reply,
 * room isolation, and stop.
 *
 * The port records the exact context strings it was asked to inject. This is a
 * transport seam, not a mock LLM: the durable log and round bookkeeping are the
 * real implementation.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { RoomDeliveryCoordinator, type RoomDeliveryPort } from "../../src/rooms/delivery";
import { RoomService } from "../../src/rooms/service";

class RecordingPort implements RoomDeliveryPort {
	readonly deliveries: Array<{ memberId: string; context: string }> = [];
	readonly aborted: string[] = [];
	async deliver(member: { memberId: string }, context: string): Promise<"injected"> {
		this.deliveries.push({ memberId: member.memberId, context });
		return "injected";
	}
	async abort(member: { memberId: string }): Promise<void> {
		this.aborted.push(member.memberId);
	}
}

describe("local room delivery", () => {
	let scratch: string;
	let dbPath: string;
	let rooms: RoomService;
	let port: RecordingPort;
	let coordinator: RoomDeliveryCoordinator;

	beforeEach(() => {
		scratch = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-rooms-delivery-"));
		dbPath = path.join(scratch, "rooms.db");
		rooms = new RoomService(dbPath);
		port = new RecordingPort();
		coordinator = new RoomDeliveryCoordinator(rooms, port);
	});

	afterEach(() => {
		rooms.close();
		fs.rmSync(scratch, { recursive: true, force: true });
	});

	function commandRoom(): string {
		const room = rooms.createRoom({ kind: "main", name: "command" });
		rooms.addMember({ roomId: room.id, memberId: "Main", role: "main" });
		rooms.addMember({ roomId: room.id, memberId: "Alpha", role: "resident" });
		rooms.addMember({ roomId: room.id, memberId: "Beta", role: "resident" });
		return room.id;
	}

	test("parallel delivers every member once and skips an already-delivered cursor", async () => {
		const roomId = commandRoom();
		const posted = rooms.postMessage({ roomId, body: "@Alpha @Beta go", mode: "parallel" });
		expect(posted.targets.map(member => member.memberId).sort()).toEqual(["Alpha", "Beta", "Main"]);
		const first = await coordinator.deliverRound(posted.round!.roundId);
		expect(first.deliveries.map(item => item.accepted)).toEqual([true, true, true]);
		const second = await coordinator.deliverRound(posted.round!.roundId);
		expect(second.deliveries.every(item => item.accepted === false)).toBe(true);
		expect(port.deliveries).toHaveLength(3);
	});

	test("serial delivers the next member only after the previous reply and includes that reply", async () => {
		const roomId = commandRoom();
		const posted = rooms.postMessage({ roomId, body: "review this", mode: "serial" });
		expect(posted.targets.map(member => member.memberId).sort()).toEqual(["Alpha", "Beta", "Main"]);
		const first = await coordinator.deliverRound(posted.round!.roundId);
		expect(first.deliveries).toHaveLength(1);
		const firstMember = first.deliveries[0].memberId;

		const reply = rooms.postAgentReply({
			roomId,
			actor: { kind: "agent", id: firstMember, name: firstMember },
			body: "my review: looks good",
			replyTo: posted.event.seq,
			roundId: posted.round!.roundId,
		});
		expect(reply.nextTargets).toHaveLength(1);
		const next = await coordinator.advance(posted.round!.roundId);
		expect(next.deliveries).toHaveLength(1);
		const context = port.deliveries.at(-1)!.context;
		expect(context).toContain("my review: looks good");
		expect(context).toContain(`#${reply.event.seq}`);
	});

	test("mention targets only mentioned members and never all members", () => {
		const roomId = commandRoom();
		const posted = rooms.postMessage({ roomId, body: "@Alpha only you", mode: "mention" });
		expect(posted.targets.map(member => member.memberId)).toEqual(["Alpha"]);
		const none = rooms.postMessage({ roomId, body: "nobody mentioned", mode: "mention" });
		expect(none.targets).toEqual([]);
	});

	test("contexts stay inside one room and never read another repo's tracking", async () => {
		const alphaRepo = path.join(scratch, "repo", "temp", "alpha");
		const betaRepo = path.join(scratch, "repo", "temp", "beta");
		fs.mkdirSync(path.join(alphaRepo, ".zeta"), { recursive: true });
		fs.mkdirSync(path.join(betaRepo, ".zeta"), { recursive: true });
		fs.writeFileSync(path.join(alphaRepo, ".zeta", "tracking.md"), "ALPHA-TRACKING-SECRET");
		fs.writeFileSync(path.join(betaRepo, ".zeta", "tracking.md"), "BETA-TRACKING-SECRET");

		const alpha = rooms.createRoom({ kind: "repo", name: "alpha", repoRoot: alphaRepo });
		const beta = rooms.createRoom({ kind: "repo", name: "beta", repoRoot: betaRepo });
		rooms.addMember({ roomId: alpha.id, memberId: "AlphaMain", role: "main", repoRoot: alphaRepo });
		rooms.addMember({ roomId: alpha.id, memberId: "AlphaResident", role: "resident", repoRoot: alphaRepo });
		rooms.addMember({ roomId: beta.id, memberId: "BetaMain", role: "main", repoRoot: betaRepo });

		rooms.postMessage({ roomId: beta.id, body: "BETA-ROOM-SECRET" });
		const posted = rooms.postMessage({ roomId: alpha.id, body: "alpha work", mode: "parallel" });
		await coordinator.deliverRound(posted.round!.roundId);

		const alphaContext = port.deliveries.find(item => item.memberId === "AlphaMain")!.context;
		expect(alphaContext).not.toContain("BETA-TRACKING-SECRET");
		expect(alphaContext).not.toContain("BETA-ROOM-SECRET");
		expect(alphaContext).not.toContain("ALPHA-TRACKING-SECRET");
		expect(alphaContext).toContain("repo");
	});

	test("stop records a stop event, fails pending targets, and aborts delivered turns", async () => {
		const roomId = commandRoom();
		const posted = rooms.postMessage({ roomId, body: "long round", mode: "parallel" });
		await coordinator.deliverRound(posted.round!.roundId);
		const stopped = await coordinator.stop(posted.round!.roundId, { kind: "user", id: "user", name: "User" });
		expect(stopped.kind).toBe("stop");
		expect(rooms.log.getRound(posted.round!.roundId)?.status).toBe("stopped");
		expect(port.aborted.sort()).toEqual(["Alpha", "Beta", "Main"]);
	});

	test("restart preserves the round target state and a later serial advance has the prior reply", async () => {
		const roomId = commandRoom();
		const posted = rooms.postMessage({ roomId, body: "serial restart", mode: "serial" });
		await coordinator.deliverRound(posted.round!.roundId);
		const first = port.deliveries[0].memberId;
		rooms.postAgentReply({
			roomId,
			actor: { kind: "agent", id: first, name: first },
			body: "first reply before restart",
			roundId: posted.round!.roundId,
		});

		rooms.close();
		rooms = new RoomService(dbPath);
		coordinator = new RoomDeliveryCoordinator(rooms, port);
		const next = await coordinator.advance(posted.round!.roundId);
		expect(next.deliveries).toHaveLength(1);
		expect(port.deliveries.at(-1)!.context).toContain("first reply before restart");
	});
});
