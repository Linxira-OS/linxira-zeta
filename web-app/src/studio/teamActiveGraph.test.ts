import { describe, expect, test } from "bun:test";
import type { TeamGraphReadModel } from "@linxiraos/studio-contract";
import { buildTeamLanes, filterTeamGraph, nodeRole } from "./teamGraph";

const base = { clusterId: "team:a", createdAt: "2026-11-14T12:00:00Z", lastActivityAt: "2026-11-14T12:00:00Z" };
const graph: TeamGraphReadModel = {
	generatedAt: base.createdAt,
	clusters: [{ clusterId: "team:a", kind: "team", label: "Owner", teamId: "a", memberCount: 3 }], gaps: [],
	nodes: [
		{ ...base, nodeId: "owner", kind: "agent", agentId: "Main" as never, displayName: "Owner", role: "owner", status: "idle", executionMode: "vibe", lifetime: "persistent" },
		{ ...base, nodeId: "worker", parentNodeId: "owner", kind: "subagent", agentId: "ui-1" as never, displayName: "UI", role: "worker", worker: { role: "ui", generation: 1, lifecycle: "resident" }, status: "parked", executionMode: "vibe", lifetime: "persistent" },
		{ ...base, nodeId: "room", kind: "db-room", displayName: "#Team", roomKind: "team", memberCount: 2, lastSeq: 1, events: [{ seq: 1, sentAt: base.createdAt, senderId: "Main", senderName: "Owner", body: "durable message" }] },
	],
	edges: [{ edgeId: "s", kind: "spawn", from: "owner", to: "worker" }, { edgeId: "r1", kind: "room", from: "owner", to: "room" }, { edgeId: "r2", kind: "room", from: "worker", to: "room" }],
};

describe("active Team graph consumer", () => {
	test("room focus follows actual membership and retains worker identity/status", () => {
		const focused = filterTeamGraph(graph, { roomId: "room" });
		expect(focused.nodes.map(node => node.nodeId)).toEqual(["owner", "worker", "room"]);
		expect(nodeRole(focused.nodes[1]!)).toBe("worker");
		expect(focused.nodes[1]).toMatchObject({ status: "parked", worker: { role: "ui", generation: 1 } });
		expect(buildTeamLanes(focused)[0]?.nodes[0]?.nodeId).toBe("owner");
		expect(focused.nodes[2]).toMatchObject({ events: [{ body: "durable message" }] });
	});
});
