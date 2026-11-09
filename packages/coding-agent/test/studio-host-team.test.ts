/**
 * Team graph read model: projection from real facts and the host query path.
 *
 * The projection is pure, so these cases pin the topology rules (cluster per
 * main, nested spawn parentage, derived lifetime, mode) without a running
 * session. The query cases pin the contract shape and the honest empty state.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { AgentRegistry } from "../src/registry/agent-registry.js";
import type { StudioAgentSnapshot } from "../src/server/studio-host/protocol/index.js";
import {
	projectTeamGraph,
	type TeamGraphFacts,
	type TeamMainFact,
} from "../src/server/studio-host/ops/team-projection.js";
import { StudioOperations, type StudioHostContext } from "../src/server/studio-host/registry.js";
import { workspaceIdFor } from "../src/server/studio-host/ops/workspace-id.js";
import { handleTeamAgentsGet } from "../src/server/web-gateway/team.js";

const MAIN: TeamMainFact = {
	id: "Main",
	sessionId: "s1",
	displayName: "Main",
	status: "running",
	createdAt: 1_700_000_000_000,
	lastActivity: 1_700_000_500_000,
	live: true,
	hasTranscript: true,
	vibeEnabled: true,
	cwd: "/repo",
};

function subagent(
	overrides: Omit<Partial<StudioAgentSnapshot>, "agentId" | "parentAgentId"> & {
		agentId: string;
		parentAgentId?: string;
	},
): StudioAgentSnapshot {
	return {
		generation: 0,
		kind: "sub",
		displayName: String(overrides.agentId),
		status: "idle",
		updatedAt: "2023-11-14T22:15:00.000Z",
		hasLiveSession: false,
		hasTranscript: true,
		unreadCount: 0,
		activeJobIds: [],
		...overrides,
	} as StudioAgentSnapshot;
}

function facts(overrides: Partial<TeamGraphFacts> = {}): TeamGraphFacts {
	return {
		mains: [MAIN],
		rosters: new Map([
			[
				"s1",
				[
					subagent({ agentId: "Child", assignment: "fix the flaky test", startedAt: "2023-11-14T22:10:00.000Z" }),
					subagent({
						agentId: "Grandchild",
						parentAgentId: "Child",
						hasTranscript: false,
						startedAt: "2023-11-14T22:11:00.000Z",
					}),
					// Observability-only rows are never part of the graph.
					subagent({ agentId: "Advisor", kind: "advisor" }),
				],
			],
		]),
		workspaceNames: new Map([[workspaceIdFor("/repo"), "zeta"]]),
		generatedAt: new Date("2023-11-14T22:16:00.000Z"),
		...overrides,
	};
}

describe("projectTeamGraph", () => {
	test("clusters one main with nested spawn parentage and a real assignment", () => {
		const graph = projectTeamGraph(facts(), {});
		expect(graph.nodes.map(node => node.nodeId)).toEqual(["Main", "Child", "Grandchild"]);
		expect(graph.nodes[0]).toMatchObject({
			kind: "agent",
			role: "unknown",
			executionMode: "vibe",
			lifetime: "persistent",
			clusterId: "unassigned",
			status: "running",
			workspaceId: workspaceIdFor("/repo"),
			workspaceName: "zeta",
		});
		expect(graph.nodes[1]).toMatchObject({
			kind: "subagent",
			executionMode: "normal",
			lifetime: "persistent",
			parentNodeId: "Main",
			assignment: "fix the flaky test",
		});
		expect(graph.nodes[2]).toMatchObject({ kind: "subagent", parentNodeId: "Child", lifetime: "ephemeral" });
		expect(graph.edges.map(edge => [edge.kind, edge.from, edge.to])).toEqual([
			["spawn", "Main", "Child"],
			["spawn", "Child", "Grandchild"],
		]);
		expect(graph.edges[0]?.label).toBe("fix the flaky test");
		expect(graph.clusters).toEqual([{ clusterId: "unassigned", kind: "unassigned", memberCount: 3 }]);
		expect(graph.gaps.map(gap => gap.id)).toEqual([
			"team-root",
			"pm-workspaces",
			"git-repos",
			"db-rooms",
			"worktrees",
			"roles",
			"assignments",
			"secretary",
		]);
		expect(graph.generatedAt).toBe("2023-11-14T22:16:00.000Z");
	});

	test("an empty host returns empty arrays plus the fixed gaps", () => {
		const graph = projectTeamGraph(facts({ mains: [], rosters: new Map() }), {});
		expect(graph.nodes).toEqual([]);
		expect(graph.edges).toEqual([]);
		expect(graph.clusters).toEqual([]);
		expect(graph.gaps).toHaveLength(8);
	});

	test("an unattached main reports unknown mode instead of guessing", () => {
		const graph = projectTeamGraph(facts({ mains: [{ ...MAIN, live: false, vibeEnabled: false }] }), {});
		expect(graph.nodes[0]).toMatchObject({ kind: "agent", executionMode: "unknown" });
	});

	test("lifetime filter keeps mains and never leaves an edge to a dropped node", () => {
		const graph = projectTeamGraph(facts(), { lifetime: "ephemeral" });
		expect(graph.nodes.map(node => node.nodeId)).toEqual(["Main", "Grandchild"]);
		// Child is persistent and filtered out; its edge to Grandchild goes with it.
		expect(graph.edges).toEqual([]);
		expect(graph.clusters[0]?.memberCount).toBe(2);
		expect(graph.nodes[0]?.kind).toBe("agent");
	});

	test("workspace and cluster filters select whole clusters", () => {
		const other: TeamMainFact = { ...MAIN, id: "Second", sessionId: "s2", displayName: "Second", cwd: "/other" };
		const graph = projectTeamGraph(
			facts({ mains: [MAIN, other], rosters: new Map([["s1", facts().rosters.get("s1")!]]) }),
			{ workspaceId: workspaceIdFor("/repo") },
		);
		expect(graph.clusters.map(cluster => cluster.clusterId)).toEqual(["unassigned"]);
		expect(graph.nodes.every(node => node.workspaceId === workspaceIdFor("/repo"))).toBe(true);
		expect(projectTeamGraph(facts(), { clusterId: "other" }).clusters).toEqual([]);
	});
});

const operations = new StudioOperations();

function context(): StudioHostContext {
	return { capabilities: operations.capabilities().manifest };
}

afterEach(() => {
	AgentRegistry.resetGlobalForTests();
});

describe("team.graph.get", () => {
	test("is advertised and answers the empty state from an empty registry", async () => {
		expect(operations.queries).toContain("team.graph.get");
		const response = await operations.query({ queryName: "team.graph.get", input: {} }, context());
		expect(response.ok).toBe(true);
		if (!response.ok) return;
		expect(response.result.nodes).toEqual([]);
		expect(response.result.clusters).toEqual([]);
		expect(response.result.gaps.map(gap => gap.id)).toEqual([
			"team-root",
			"pm-workspaces",
			"git-repos",
			"db-rooms",
			"worktrees",
			"roles",
			"assignments",
			"secretary",
		]);
	});

	test("refuses an unknown lifetime before touching the gateway", async () => {
		const response = await operations.query(
			{ queryName: "team.graph.get", input: { lifetime: "forever" as never } },
			context(),
		);
		expect(response.ok).toBe(false);
		if (!response.ok) expect(response.error.code).toBe("INVALID_ARGUMENT");
	});
});

describe("GET /api/agents facts", () => {
	test("returns roots only, with honest defaults for a detached ref", async () => {
		AgentRegistry.global().register({
			id: "Main",
			displayName: "Coordinator",
			kind: "main",
			status: "idle",
			session: null,
			sessionFile: null,
			createdAt: 10,
			lastActivity: 20,
		});
		AgentRegistry.global().register({
			id: "Child",
			displayName: "Child",
			kind: "sub",
			parentId: "Main",
			status: "idle",
			session: null,
			sessionFile: null,
		});
		const response = await handleTeamAgentsGet();
		expect(response.status).toBe(200);
		const body = (await response.json()) as { agents: Array<Record<string, unknown>> };
		expect(body.agents).toHaveLength(1);
		expect(body.agents[0]).toMatchObject({
			id: "Main",
			displayName: "Coordinator",
			status: "idle",
			live: false,
			hasTranscript: false,
			vibeEnabled: false,
		});
	});
});
