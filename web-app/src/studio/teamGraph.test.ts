/**
 * Pure lane/legend helpers for the Team page.
 *
 * `teamGraph.ts` imports types only, so this runs without the renderer's npm
 * dependencies and pins container grouping, project options and counts.
 */
import { describe, expect, test } from "bun:test";
import type { TeamGraphEdge, TeamGraphNode, TeamGraphReadModel, WorkspaceId } from "@linxiraos/studio-contract";
import {
  buildTeamLanes,
  isAgentNode,
  teamEdgeCounts,
  teamKindCounts,
  teamLifetimeCounts,
  teamProjectOptions,
} from "./teamGraph";

function agentNode(
  overrides: Partial<Extract<TeamGraphNode, { kind: "agent" | "subagent" }>> & { nodeId: string; kind: "agent" | "subagent" },
): TeamGraphNode {
  return {
    agentId: overrides.nodeId as never,
    displayName: overrides.nodeId,
    status: "idle",
    executionMode: "normal",
    lifetime: "persistent",
    clusterId: "unassigned",
    createdAt: "2023-11-14T22:10:00.000Z",
    lastActivityAt: "2023-11-14T22:15:00.000Z",
    ...overrides,
  } as TeamGraphNode;
}

const edge: TeamGraphEdge = { edgeId: "Agent->Child", kind: "spawn", from: "Agent", to: "Child" };

const graph: TeamGraphReadModel = {
  generatedAt: "2023-11-14T22:16:00.000Z",
  gaps: [],
  nodes: [
    agentNode({ nodeId: "Child", kind: "subagent", executionMode: "normal" }),
    agentNode({ nodeId: "Agent", kind: "agent", role: "unknown", executionMode: "vibe", workspaceId: "ws-a" as WorkspaceId, workspaceName: "zeta" }),
    {
      nodeId: "pm-core",
      kind: "pm-workspace",
      objectId: "pm_core",
      displayName: "core",
      clusterId: "unassigned",
      workspaceId: "ws-b" as WorkspaceId,
      createdAt: "2023-11-14T22:10:00.000Z",
      lastActivityAt: "2023-11-14T22:15:00.000Z",
    },
  ],
  edges: [edge],
  clusters: [
    { clusterId: "unassigned", kind: "unassigned", memberCount: 3 },
  ],
};

describe("buildTeamLanes", () => {
  test("keeps the ownerless container and puts peer objects in one lane", () => {
    const lanes = buildTeamLanes(graph);
    expect(lanes.length).toBe(1);
    expect(lanes[0]?.kind).toBe("unassigned");
    expect(lanes[0]?.label).toBeUndefined();
    expect(lanes[0]?.nodes[0]?.nodeId).toBe("Agent");
    expect(new Set(lanes[0]?.nodes.map(node => node.nodeId))).toEqual(new Set(["Agent", "pm-core", "Child"]));
    expect(lanes[0]?.edges).toEqual([edge]);
    expect(lanes[0]?.executionMode).toBe("vibe");
  });

  test("a team cluster keeps its team label without becoming an agent node", () => {
    const lanes = buildTeamLanes({
      ...graph,
      clusters: [{ clusterId: "unassigned", kind: "team", teamId: "tm_1", label: "Acme", memberCount: 3 }],
    });
    expect(lanes[0]?.kind).toBe("team");
    expect(lanes[0]?.label).toBe("Acme");
  });

  test("an empty graph yields no lanes", () => {
    expect(buildTeamLanes({ generatedAt: "", gaps: [], nodes: [], edges: [], clusters: [] })).toEqual([]);
  });
});

describe("ownership helpers", () => {
  test("path objects are not agent nodes", () => {
    const path = graph.nodes[2]!;
    expect(isAgentNode(path)).toBe(false);
    expect(isAgentNode(graph.nodes[1]!)).toBe(true);
  });

  test("project options derive from node workspaces", () => {
    const options = teamProjectOptions(graph);
    expect(options).toEqual([
      { workspaceId: "ws-b", nodes: 1 },
      { workspaceId: "ws-a", name: "zeta", nodes: 1 },
    ]);
  });

  test("counts cover ownership kinds and agent lifetimes only", () => {
    expect(teamKindCounts(graph.nodes)).toEqual({
      agent: 1,
      subagent: 1,
      "pm-workspace": 1,
      "git-repo": 0,
      "db-room": 0,
      "linked-worktree": 0,
    });
    expect(teamLifetimeCounts(graph.nodes)).toEqual({ persistent: 2, ephemeral: 0 });
    expect(teamEdgeCounts(graph.edges)).toEqual({
      spawn: 1,
      assignment: 0,
      room: 0,
      contains: 0,
      binding: 0,
      "worktree-of": 0,
    });
  });
});
