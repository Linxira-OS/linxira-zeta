/**
 * Pure Team graph helpers shared by the page and its unit test.
 *
 * The read model is already filtered by the Host; this module only turns the
 * flat node/edge/cluster arrays into display containers and derives facts. It
 * never invents a container, node or edge.
 */
import type {
  TeamAgentNode,
  TeamEdgeKind,
  TeamExecutionMode,
  TeamGraphEdge,
  TeamGraphNode,
  TeamGraphReadModel,
  TeamNodeLifetime,
} from "@linxiraos/studio-contract";

/** Agent/subagent nodes carry lifecycle facts; path objects do not. */
export function isAgentNode(node: TeamGraphNode): node is TeamAgentNode {
  return node.kind === "agent" || node.kind === "subagent";
}

export interface TeamLane {
  readonly clusterId: string;
  readonly kind: "team" | "unassigned";
  /** Team name from `.zeta/team.json`; absent for the unassigned boundary. */
  readonly label?: string;
  /** Agent nodes first, then subagents by creation time. */
  readonly nodes: readonly TeamGraphNode[];
  readonly edges: readonly TeamGraphEdge[];
  /** The container's agent execution mode, when one agent anchors it. */
  readonly executionMode: TeamExecutionMode;
}

export interface TeamProjectOption {
  readonly workspaceId: string;
  /** Host workspace basename; absent when the inventory did not name it. */
  readonly name?: string;
  readonly nodes: number;
}

/** Group nodes and edges under their container, preserving the Host's order. */
export function buildTeamLanes(graph: TeamGraphReadModel): TeamLane[] {
  const byCluster = new Map<string, TeamGraphNode[]>();
  for (const node of graph.nodes) {
    const list = byCluster.get(node.clusterId);
    if (list === undefined) byCluster.set(node.clusterId, [node]);
    else list.push(node);
  }
  const clusterOfNode = new Map(graph.nodes.map(node => [node.nodeId, node.clusterId]));
  const edgesByCluster = new Map<string, TeamGraphEdge[]>();
  for (const edge of graph.edges) {
    const clusterId = clusterOfNode.get(edge.from) ?? clusterOfNode.get(edge.to);
    if (clusterId === undefined) continue;
    const list = edgesByCluster.get(clusterId);
    if (list === undefined) edgesByCluster.set(clusterId, [edge]);
    else list.push(edge);
  }

  return graph.clusters.map(cluster => {
    const nodes = [...(byCluster.get(cluster.clusterId) ?? [])].sort((a, b) => {
      const aAgent = isAgentNode(a) && a.kind === "agent";
      const bAgent = isAgentNode(b) && b.kind === "agent";
      return (
        Number(bAgent) - Number(aAgent) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.displayName.localeCompare(b.displayName) ||
        a.nodeId.localeCompare(b.nodeId)
      );
    });
    const anchor = nodes.find(node => isAgentNode(node) && node.kind === "agent");
    return {
      clusterId: cluster.clusterId,
      kind: cluster.kind,
      ...(cluster.label === undefined ? {} : { label: cluster.label }),
      nodes,
      edges: edgesByCluster.get(cluster.clusterId) ?? [],
      executionMode: anchor !== undefined && isAgentNode(anchor) ? anchor.executionMode : "unknown",
    };
  });
}

/** One option per workspace owning a node, labelled without a path. */
export function teamProjectOptions(graph: TeamGraphReadModel): TeamProjectOption[] {
  const options = new Map<string, TeamProjectOption>();
  for (const node of graph.nodes) {
    if (node.workspaceId === undefined) continue;
    const existing = options.get(node.workspaceId);
    if (existing === undefined) {
      options.set(node.workspaceId, {
        workspaceId: node.workspaceId,
        ...(node.workspaceName === undefined ? {} : { name: node.workspaceName }),
        nodes: 1,
      });
    } else {
      options.set(node.workspaceId, { ...existing, nodes: existing.nodes + 1 });
    }
  }
  return [...options.values()].sort((a, b) => (a.name ?? a.workspaceId).localeCompare(b.name ?? b.workspaceId));
}

/** Edge totals per kind; non-spawn kinds stay at zero until producers ship. */
export function teamEdgeCounts(edges: readonly TeamGraphEdge[]): Record<TeamEdgeKind, number> {
  const counts: Record<TeamEdgeKind, number> = {
    spawn: 0,
    assignment: 0,
    room: 0,
    contains: 0,
    binding: 0,
    "worktree-of": 0,
  };
  for (const edge of edges) counts[edge.kind] += 1;
  return counts;
}

/** Lifetime totals over agent nodes only (path objects have no lifetime). */
export function teamLifetimeCounts(nodes: readonly TeamGraphNode[]): Record<TeamNodeLifetime, number> {
  const counts: Record<TeamNodeLifetime, number> = { persistent: 0, ephemeral: 0 };
  for (const node of nodes) if (isAgentNode(node)) counts[node.lifetime] += 1;
  return counts;
}

/** Object-kind totals used by the ownership legend. */
export function teamKindCounts(nodes: readonly TeamGraphNode[]): Record<TeamGraphNode["kind"], number> {
  const counts: Record<TeamGraphNode["kind"], number> = {
    agent: 0,
    subagent: 0,
    "pm-workspace": 0,
    "git-repo": 0,
    "db-room": 0,
    "linked-worktree": 0,
  };
  for (const node of nodes) counts[node.kind] += 1;
  return counts;
}
