/**
 * Resident membership and park/revive on the real registry + lifecycle.
 *
 * The session objects are small recording handles (no model call, no echo):
 * they exist so the real AgentRegistry and AgentLifecycleManager transitions
 * are exercised rather than a room-local stub lifecycle.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AgentLifecycleManager } from "../../src/registry/agent-lifecycle";
import { AgentRegistry } from "../../src/registry/agent-registry";
import type { AgentSessionHandle } from "../../src/session/agent-session-handle";
import { RoomError } from "../../src/rooms/errors";
import { parkResident, promoteResident, reviveResident } from "../../src/rooms/resident";
import { RoomService } from "../../src/rooms/service";

function fakeSession(): AgentSessionHandle {
	return {
		sessionManager: { getUsageStatistics: () => ({ cost: 0, subagentCost: 0 }) },
		dispose: async () => {},
	} as unknown as AgentSessionHandle;
}

describe("room residents", () => {
	let scratch: string;
	let rooms: RoomService;
	let roomId: string;

	beforeEach(() => {
		scratch = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-rooms-resident-"));
		AgentRegistry.resetGlobalForTests();
		AgentLifecycleManager.resetGlobalForTests();
		rooms = new RoomService(path.join(scratch, "rooms.db"));
		const room = rooms.createRoom({ kind: "main", name: "main-room" });
		roomId = room.id;
		rooms.addMember({ roomId, memberId: "Main", role: "main", repoRoot: path.join(scratch, "repo") });
		AgentRegistry.global().register({
			id: "Main",
			displayName: "Main",
			kind: "main",
			status: "idle",
			session: fakeSession(),
		});
		AgentRegistry.global().register({
			id: "Child",
			displayName: "Child",
			kind: "sub",
			parentId: "Main",
			status: "idle",
			session: fakeSession(),
			sessionFile: path.join(scratch, "child.jsonl"),
		});
		AgentRegistry.global().register({
			id: "Orphan",
			displayName: "Orphan",
			kind: "sub",
			parentId: "Stranger",
			status: "idle",
			session: fakeSession(),
		});
	});

	afterEach(() => {
		rooms.close();
		AgentLifecycleManager.resetGlobalForTests();
		AgentRegistry.resetGlobalForTests();
		fs.rmSync(scratch, { recursive: true, force: true });
	});

	test("only a main member's own direct child can be promoted", () => {
		const member = promoteResident(rooms, { roomId, agentId: "Child" });
		expect(member.role).toBe("resident");
		expect(member.repoRoot).toBe(path.join(scratch, "repo"));

		expect(() => promoteResident(rooms, { roomId, agentId: "Orphan" })).toThrow(/not a main member/);
		expect(() => promoteResident(rooms, { roomId, agentId: "Child", ownerMemberId: "Other" })).toThrow(/own parent/);
		expect(() => promoteResident(rooms, { roomId, agentId: "Main" })).toThrow(RoomError);
	});

	test("park and revive use the real lifecycle and return to a live idle ref", async () => {
		promoteResident(rooms, { roomId, agentId: "Child" });
		const registry = AgentRegistry.global();
		const child = registry.get("Child")!;
		AgentLifecycleManager.global().adopt(
			"Child",
			{
				idleTtlMs: 0,
				revive: async () => fakeSession(),
			},
			child,
		);

		const parked = await parkResident(rooms, roomId, "Child");
		expect(parked.status).toBe("parked");
		expect(registry.get("Child")?.session).toBeNull();

		const revived = await reviveResident(rooms, roomId, "Child");
		expect(revived.status).toBe("idle");
		expect(registry.get("Child")?.session).not.toBeNull();
	});

	test("a non-resident cannot use the resident controls", async () => {
		await expect(parkResident(rooms, roomId, "Main")).rejects.toThrow(/not a resident/);
		await expect(reviveResident(rooms, roomId, "Child")).rejects.toThrow(/not a resident/);
	});
});
