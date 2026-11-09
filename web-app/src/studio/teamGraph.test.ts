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
  filterTeamGraph,
  isAgentNode,
  nodeLifecycle,
  nodeRole,
  teamEdgeCounts,
  teamFilterOptions,
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

  test("engineer and PM workspace expose lifecycle and role badges", () => {
    const engineer: TeamGraphNode = {
      nodeId: "engineer:acme:core:alice",
      kind: "engineer",
      objectId: "acme:core:alice",
      displayName: "alice",
      clusterId: "team:acme",
      status: "offline",
      executionMode: "vibe",
      lifetime: "persistent",
      createdAt: "2023-11-14T22:10:00.000Z",
      lastActivityAt: "2023-11-14T22:10:00.000Z",
    };
    expect(nodeLifecycle(engineer)).toEqual({ status: "offline", executionMode: "vibe", lifetime: "persistent" });
    expect(nodeRole(engineer)).toBe("engineer");

    const pm: TeamGraphNode = {
      nodeId: "pm:acme:core",
      kind: "pm-workspace",
      objectId: "acme:core",
      displayName: "core",
      clusterId: "team:acme",
      status: "running",
      executionMode: "normal",
      lifetime: "persistent",
      createdAt: "2023-11-14T22:10:00.000Z",
      lastActivityAt: "2023-11-14T22:10:00.000Z",
    };
    expect(nodeRole(pm)).toBe("pm");
    expect(nodeLifecycle(pm)).toEqual({ status: "running", executionMode: "normal", lifetime: "persistent" });
    expect(nodeLifecycle(graph.nodes[2]!)).toBeUndefined();
  });

  test("counts cover ownership kinds and agent lifetimes only", () => {
    expect(teamKindCounts(graph.nodes)).toEqual({
      agent: 1,
      subagent: 1,
      engineer: 0,
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

const T = "2023-11-14T22:10:00.000Z";

function objectNode(
  nodeId: string,
  kind: "git-repo" | "db-room" | "linked-worktree",
  displayName: string,
): TeamGraphNode {
  return {
    nodeId,
    kind,
    objectId: nodeId,
    displayName,
    clusterId: "team:acme",
    createdAt: T,
    lastActivityAt: T,
    ...(kind === "linked-worktree" ? { worktreeKind: "home" as const, branch: "team/acme/core/alice/integration" } : {}),
  };
}

const ownerGraph: TeamGraphReadModel = {
  generatedAt: T,
  gaps: [],
  clusters: [{ clusterId: "team:acme", kind: "team", teamId: "acme", label: "Acme", memberCount: 8 }],
  nodes: [
    {
      nodeId: "pm:acme:core",
      kind: "pm-workspace",
      objectId: "acme:core",
      displayName: "core",
      clusterId: "team:acme",
      status: "running",
      executionMode: "normal",
      lifetime: "persistent",
      createdAt: T,
      lastActivityAt: T,
    },
    {
      nodeId: "pm:acme:growth",
      kind: "pm-workspace",
      objectId: "acme:growth",
      displayName: "growth",
      clusterId: "team:acme",
      status: "offline",
      executionMode: "unknown",
      lifetime: "persistent",
      createdAt: T,
      lastActivityAt: T,
    },
    {
      nodeId: "engineer:acme:core:alice",
      kind: "engineer",
      objectId: "acme:core:alice",
      displayName: "alice",
      clusterId: "team:acme",
      status: "offline",
      executionMode: "vibe",
      lifetime: "persistent",
      createdAt: T,
      lastActivityAt: T,
    },
    objectNode("repo:acme:api", "git-repo", "api"),
    objectNode("repo:acme:other", "git-repo", "other"),
    objectNode("worktree:home", "linked-worktree", "home"),
    objectNode("room:acme:core", "db-room", "#core"),
    {
      nodeId: "secretary-core",
      kind: "subagent",
      agentId: "secretary-core" as never,
      role: "secretary",
      displayName: "Secretary",
      clusterId: "team:acme",
      parentNodeId: "pm:acme:core",
      status: "idle",
      executionMode: "normal",
      lifetime: "persistent",
      createdAt: T,
      lastActivityAt: T,
    },
  ],
  edges: [
    { edgeId: "binding", kind: "binding", from: "pm:acme:core", to: "repo:acme:api" },
    { edgeId: "binding-other", kind: "binding", from: "pm:acme:growth", to: "repo:acme:other" },
    { edgeId: "assignment", kind: "assignment", from: "pm:acme:core", to: "engineer:acme:core:alice" },
    { edgeId: "worktree-of", kind: "worktree-of", from: "repo:acme:api", to: "worktree:home" },
    { edgeId: "contains", kind: "contains", from: "worktree:home", to: "engineer:acme:core:alice" },
    { edgeId: "room-pm", kind: "room", from: "pm:acme:core", to: "room:acme:core" },
    { edgeId: "room-engineer", kind: "room", from: "engineer:acme:core:alice", to: "room:acme:core" },
    { edgeId: "room-secretary", kind: "room", from: "secretary-core", to: "room:acme:core" },
    { edgeId: "spawn-secretary", kind: "spawn", from: "pm:acme:core", to: "secretary-core" },
  ],
};

describe("filterTeamGraph", () => {
  test("offers PM, room and repo options from real nodes", () => {
    const options = teamFilterOptions(ownerGraph);
    expect(options.pms.map(option => option.label)).toEqual(["core", "growth"]);
    expect(options.rooms.map(option => option.label)).toEqual(["#core"]);
    expect(options.repos.map(option => option.label)).toEqual(["api", "other"]);
  });

  test("a PM focus keeps its repo, engineer, worktree, room and secretary", () => {
    const focused = filterTeamGraph(ownerGraph, { pmId: "pm:acme:core" });
    expect(new Set(focused.nodes.map(node => node.nodeId))).toEqual(
      new Set([
        "pm:acme:core",
        "engineer:acme:core:alice",
        "repo:acme:api",
        "worktree:home",
        "room:acme:core",
        "secretary-core",
      ]),
    );
    expect(focused.clusters).toEqual([
      { clusterId: "team:acme", kind: "team", teamId: "acme", label: "Acme", memberCount: 6 },
    ]);
    expect(focused.edges.every(edge => focused.nodes.some(node => node.nodeId === edge.from))).toBe(true);
    expect(focused.gaps).toEqual([]);
  });

  test("a room focus keeps the room and its members only", () => {
    const focused = filterTeamGraph(ownerGraph, { roomId: "room:acme:core" });
    expect(new Set(focused.nodes.map(node => node.nodeId))).toEqual(
      new Set(["room:acme:core", "pm:acme:core", "engineer:acme:core:alice", "secretary-core"]),
    );
    expect(focused.edges.map(edge => edge.kind)).toEqual(["assignment", "room", "room", "room", "spawn"]);
  });

  test("a repo focus follows bindings, worktrees and their engineers", () => {
    const focused = filterTeamGraph(ownerGraph, { repoId: "repo:acme:api" });
    expect(new Set(focused.nodes.map(node => node.nodeId))).toEqual(
      new Set(["repo:acme:api", "pm:acme:core", "worktree:home", "engineer:acme:core:alice"]),
    );
    expect(focused.nodes.some(node => node.nodeId === "room:acme:core")).toBe(false);
    expect(focused.nodes.some(node => node.nodeId === "secretary-core")).toBe(false);
  });

  test("no focus returns the graph unchanged", () => {
    expect(filterTeamGraph(ownerGraph, {})).toBe(ownerGraph);
  });
});
