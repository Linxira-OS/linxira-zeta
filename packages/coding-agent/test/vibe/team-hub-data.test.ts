import { describe, expect, test } from "bun:test";
import { AgentRegistry } from "../../src/registry/agent-registry";
import { projectActiveTeamHub } from "../../src/vibe/team-hub-data";
import type { TeamRoomSnapshot } from "../../src/vibe/team-rooms";
import type { VibeWorkerView } from "../../src/vibe/runtime";

const at = "2026-11-14T12:00:00.000Z";
const scope = { ownerId: "Main", parentSessionId: "source-a", parentSessionFile: "/sessions/a.jsonl" };
const owner = { agentId: "Main", label: "Owner A", role: "owner" as const, createdAt: at };
const member = {
	agentId: "ui-1",
	label: "UI",
	role: "worker" as const,
	moduleRole: "ui",
	generation: 1,
	lifecycle: "resident" as const,
	createdAt: at,
};
const rooms: TeamRoomSnapshot = {
	teamKey: "a",
	ownerScope: scope,
	owner,
	team: {
		room: "team",
		roomId: "team_a",
		name: "Team",
		createdAt: at,
		updatedAt: at,
		members: [owner, member],
		events: [],
		lastSeq: 0,
		unreadBy: {},
	},
	mains: {
		room: "mains",
		roomId: "mains_a",
		name: "Mains",
		createdAt: at,
		updatedAt: at,
		members: [owner],
		events: [],
		lastSeq: 0,
		unreadBy: {},
	},
};
const worker: VibeWorkerView = {
	id: "ui-1",
	sessionFile: "/sessions/a/ui-1.jsonl",
	identity: { role: "ui", generation: 1, lifecycle: "resident" },
	cli: "good",
	state: "running",
	createdAt: Date.parse(at),
	lastActivityAt: Date.parse(at),
	lastActivity: "original source activity",
	turns: 1,
	queued: 0,
};

describe("Team host Hub projection", () => {
	test("a recycled registry id cannot relabel a source-pinned Team worker", () => {
		const registry = new AgentRegistry();
		registry.register({
			id: "ui-1",
			displayName: "Other worker",
			kind: "sub",
			parentId: "Main",
			status: "running",
			sessionFile: "/sessions/b/ui-1.jsonl",
			session: null,
			activity: "unrelated secret activity",
		});
		const result = projectActiveTeamHub(rooms, [worker], registry);
		expect(result.agents[1]).toMatchObject({
			label: "UI",
			status: "offline",
			activity: "original source activity",
			role: "ui",
			generation: 1,
			canObserve: false,
		});
		expect(JSON.stringify(result)).not.toContain("unrelated secret activity");
		expect(JSON.stringify(result)).not.toContain("sessionFile");
		expect(JSON.stringify(result)).not.toContain("parentSessionFile");
	});
	test("parked workers retain membership and history without claiming to run", () => {
		const registry = new AgentRegistry();
		registry.register({
			id: "ui-1",
			displayName: "UI",
			kind: "sub",
			parentId: "Main",
			status: "parked",
			sessionFile: worker.sessionFile,
			session: null,
		});
		const result = projectActiveTeamHub(rooms, [{ ...worker, state: "idle" }], registry);
		expect(result.agents[1]).toMatchObject({ status: "parked", canObserve: true });
		expect(result.rooms[0]?.members.map(member => member.agentId)).toEqual(["Main", "ui-1"]);
	});
});
