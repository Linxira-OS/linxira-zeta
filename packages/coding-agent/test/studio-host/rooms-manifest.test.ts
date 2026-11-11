/**
 * Host manifest guard: the rooms family and the four real agent controls are
 * advertised only because their handlers are registered; `agent.spawn` stays
 * absent because no spawn handler exists.
 */
import { describe, expect, test } from "bun:test";
import { StudioOperations } from "../../src/server/studio-host/registry";

describe("rooms capability manifest", () => {
	test("room operations and agent controls are registered", () => {
		const operations = new StudioOperations();
		expect(operations.queries).toContain("rooms.list");
		expect(operations.queries).toContain("room.get");
		expect(operations.queries).toContain("room.log.read");
		expect(operations.queries).toContain("room.contacts.list");
		for (const command of [
			"room.create",
			"room.member.add",
			"room.member.remove",
			"room.post",
			"room.reply",
			"room.markRead",
			"room.round.stop",
			"room.resident.promote",
			"room.resident.park",
			"room.resident.revive",
			"room.proposal.create",
			"room.proposal.respond",
			"agent.send",
			"agent.kill",
			"agent.revive",
			"agent.release",
		] as const) {
			expect(operations.commands).toContain(command);
		}
		expect(operations.commands).not.toContain("agent.spawn");
	});

	test("manifest ids are stable and unique", () => {
		const operations = new StudioOperations();
		const ids = [...operations.queries, ...operations.commands];
		expect(new Set(ids).size).toBe(ids.length);
	});
});
