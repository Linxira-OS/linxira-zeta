import { describe, expect, test } from "bun:test";
import type { ActiveTeamHubSnapshot } from "@linxiraos/pi-tui/overlays/active-team-hub";
import { projectTeamGraph, type TeamGraphFacts } from "../src/server/studio-host/ops/team-projection";
import { workspaceIdFor } from "../src/server/studio-host/ops/workspace-id";

const at = "2026-11-14T12:00:00.000Z";
const team: ActiveTeamHubSnapshot = {
	teamKey: "source-a",
	label: "Main A",
	ownerId: "Main",
	agents: [
		{ id: "Main", label: "Main A", kind: "main", status: "offline", createdAt: Date.parse(at), canObserve: false },
		{
			id: "ui-2",
			label: "UI",
			kind: "worker",
			status: "running",
			role: "ui",
			generation: 2,
			lifecycle: "resident",
			cli: "good",
			createdAt: Date.parse(at),
			lastActivityAt: Date.parse(at),
			activity: "Rendering room history",
			canObserve: true,
		},
		{
			id: "tests-1",
			label: "Tests",
			kind: "worker",
			status: "aborted",
			role: "tests",
			generation: 1,
			lifecycle: "ephemeral",
			createdAt: Date.parse(at),
			canObserve: false,
		},
	],
	rooms: [
		{
			id: "team_source-a",
			room: "team",
			name: "Team",
			createdAt: at,
			updatedAt: at,
			members: [
				{ agentId: "Main", label: "Main A" },
				{ agentId: "ui-2", label: "UI" },
				{ agentId: "tests-1", label: "Tests" },
			],
			lastSeq: 1,
			events: [{ seq: 1, sentAt: at, senderId: "ui-2", senderName: "UI", body: "History retained" }],
		},
		{
			id: "mains_source-a",
			room: "mains",
			name: "Mains",
			createdAt: at,
			updatedAt: at,
			members: [{ agentId: "Main", label: "Main A" }],
			events: [],
			lastSeq: 0,
		},
	],
};
function facts(): TeamGraphFacts {
	return {
		mains: [
			{
				id: "Main",
				sessionId: "source-b",
				displayName: "Current B",
				status: "running",
				live: true,
				hasTranscript: true,
				vibeEnabled: false,
				createdAt: Date.parse(at),
				lastActivity: Date.parse(at),
				cwd: "/other",
			},
		],
		teams: [{ snapshot: team, sourceSessionId: "source-a", cwd: "/project" }],
		workspaceNames: new Map([[workspaceIdFor("/project"), "project"]]),
		generatedAt: new Date(at),
	};
}

describe("active Team graph projection", () => {
	test("uses Vibe worker identity and mesh membership, keeps source-bound owner separate after resume", () => {
		const graph = projectTeamGraph(facts(), {});
		expect(graph.nodes.filter(node => node.kind === "agent").map(node => [node.displayName, node.status])).toEqual([
			["Main A", "offline"],
			["Current B", "running"],
		]);
		const worker = graph.nodes.find(node => node.kind === "subagent" && node.agentId === "ui-2");
		expect(worker).toMatchObject({
			role: "worker",
			activity: "Rendering room history",
			worker: { role: "ui", generation: 2, lifecycle: "resident", cli: "good" },
			workspaceName: "project",
		});
		expect(graph.edges.filter(edge => edge.kind === "spawn")).toHaveLength(2);
		expect(graph.edges.filter(edge => edge.kind === "room")).toHaveLength(4);
		expect(graph.nodes.find(node => node.kind === "db-room" && node.roomKind === "team")).toMatchObject({
			lastSeq: 1,
			memberCount: 3,
			events: [{ body: "History retained" }],
		});
		expect(JSON.stringify(graph)).not.toContain("parentSessionFile");
		expect(graph.nodes.some(node => node.kind === "pm-workspace" || node.kind === "engineer")).toBe(false);
	});
	test("live main mode is authoritative while detached room members remain offline", () => {
		const input = facts();
		const main = input.mains[0]!;
		for (const mode of ["team", "vibe", "normal"] as const) {
			const graph = projectTeamGraph(
				{
					...input,
					teams: [],
					mains: [{ ...main, modeKnown: true, teamEnabled: mode === "team", vibeEnabled: mode === "vibe" }],
				},
				{},
			);
			expect(graph.nodes[0]).toMatchObject({ executionMode: mode, status: "running" });
		}
		expect(projectTeamGraph({ ...input, teams: [] }, {}).nodes[0]).toMatchObject({ executionMode: "unknown" });
		const withOfflinePeer = {
			...team,
			rooms: team.rooms.map(room =>
				room.room === "mains"
					? { ...room, members: [...room.members, { agentId: "gone-main", label: "Retained main" }] }
					: room,
			),
		};
		const graph = projectTeamGraph({ ...input, teams: [{ ...input.teams[0]!, snapshot: withOfflinePeer }] }, {});
		expect(graph.nodes.find(node => node.kind === "agent" && node.agentId === "gone-main")).toMatchObject({
			status: "offline",
			executionMode: "unknown",
		});
	});
	test("lifetime filters workers without inventing dangling room or spawn edges", () => {
		const graph = projectTeamGraph(facts(), { lifetime: "ephemeral" });
		expect(graph.nodes.filter(node => node.kind === "subagent").map(node => String(node.agentId))).toEqual([
			"tests-1",
		]);
		const persistent = projectTeamGraph(facts(), { lifetime: "persistent" });
		expect(persistent.nodes.some(node => node.kind === "subagent" && node.agentId === "tests-1")).toBe(false);
		const ids = new Set(persistent.nodes.map(node => node.nodeId));
		expect(persistent.edges.every(edge => ids.has(edge.from) && ids.has(edge.to))).toBe(true);
	});
	test("source workspace and cluster filters preserve real rooms and exclude unrelated current main", () => {
		const graph = projectTeamGraph(facts(), { workspaceId: workspaceIdFor("/project") });
		expect(graph.clusters.map(cluster => cluster.clusterId)).toEqual(["team:source-a"]);
		expect(graph.nodes.every(node => node.workspaceId === workspaceIdFor("/project"))).toBe(true);
		expect(projectTeamGraph(facts(), { clusterId: "missing" }).nodes).toEqual([]);
	});
	test("an empty registry and room inventory remain empty", () => {
		expect(projectTeamGraph({ ...facts(), mains: [], teams: [] }, {})).toMatchObject({
			nodes: [],
			edges: [],
			clusters: [],
			gaps: [],
		});
	});
});
