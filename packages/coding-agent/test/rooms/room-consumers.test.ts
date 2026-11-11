/**
 * Two consumer repositories under one workspace.
 *
 * The room log is the only shared state: each member receives its own home
 * repo identity, and no file under the other repository's `.zeta/` is read.
 * Delivery is the real coordinator; the port records the injected text.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { RoomDeliveryCoordinator, type RoomDeliveryPort } from "../../src/rooms/delivery";
import { RoomService } from "../../src/rooms/service";

class ConsumerPort implements RoomDeliveryPort {
	readonly contexts = new Map<string, string>();
	async deliver(member: { memberId: string }, context: string): Promise<"injected"> {
		this.contexts.set(member.memberId, context);
		return "injected";
	}
}

describe("two isolated consumer repos", () => {
	let scratch: string;
	let rooms: RoomService;
	let port: ConsumerPort;
	let coordinator: RoomDeliveryCoordinator;

	beforeEach(() => {
		scratch = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-rooms-consumers-"));
		rooms = new RoomService(path.join(scratch, "rooms.db"));
		port = new ConsumerPort();
		coordinator = new RoomDeliveryCoordinator(rooms, port);
	});

	afterEach(() => {
		rooms.close();
		fs.rmSync(scratch, { recursive: true, force: true });
	});

	function repo(name: string): string {
		const root = path.join(scratch, "workspace", "repo", "temp", name);
		fs.mkdirSync(path.join(root, ".zeta"), { recursive: true });
		fs.writeFileSync(path.join(root, ".zeta", "tracking.md"), `${name.toUpperCase()}-TRACKING`);
		return root;
	}

	test("parallel contexts are isolated; serial carries only same-room replies", async () => {
		const alpha = repo("alpha");
		const beta = repo("beta");
		const room = rooms.createRoom({ kind: "super", name: "shared" });
		rooms.addMember({ roomId: room.id, memberId: "AlphaMain", role: "main", repoRoot: alpha });
		rooms.addMember({ roomId: room.id, memberId: "BetaMain", role: "main", repoRoot: beta });

		const parallel = rooms.postMessage({ roomId: room.id, body: "hello both", mode: "parallel" });
		await coordinator.deliverRound(parallel.round!.roundId);
		expect(port.contexts.get("AlphaMain")).not.toContain("BETA-TRACKING");
		expect(port.contexts.get("BetaMain")).not.toContain("ALPHA-TRACKING");
		expect(port.contexts.get("AlphaMain")).toContain("hello both");

		const serial = rooms.postMessage({ roomId: room.id, body: "serial topic", mode: "serial" });
		const first = await coordinator.deliverRound(serial.round!.roundId);
		const firstMember = first.deliveries[0].memberId;
		rooms.postAgentReply({
			roomId: room.id,
			actor: { kind: "agent", id: firstMember, name: firstMember },
			body: "first consumer answer",
			roundId: serial.round!.roundId,
		});
		await coordinator.advance(serial.round!.roundId);
		const secondContext = [...port.contexts.entries()].find(([id]) => id !== firstMember)?.[1] ?? "";
		expect(secondContext).toContain("first consumer answer");
		expect(secondContext).not.toContain("TRACKING");
	});

	test("mention targets one consumer, and a restart keeps the room order", async () => {
		const alpha = repo("alpha");
		const beta = repo("beta");
		const room = rooms.createRoom({ kind: "super", name: "mentions" });
		rooms.addMember({ roomId: room.id, memberId: "AlphaMain", role: "main", repoRoot: alpha });
		rooms.addMember({ roomId: room.id, memberId: "BetaMain", role: "main", repoRoot: beta });
		const mentioned = rooms.postMessage({ roomId: room.id, body: "@BetaMain please answer", mode: "mention" });
		expect(mentioned.targets.map(member => member.memberId)).toEqual(["BetaMain"]);
		const delivered = await coordinator.deliverRound(mentioned.round!.roundId);
		expect(delivered.deliveries.map(item => item.memberId)).toEqual(["BetaMain"]);
		expect(port.contexts.get("BetaMain")).not.toContain("ALPHA-TRACKING");

		rooms.close();
		rooms = new RoomService(path.join(scratch, "rooms.db"));
		expect(rooms.snapshot(room.id).events.map(event => event.seq)).toEqual([1]);
	});
});
