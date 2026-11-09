/**
 * Pure Team graph helpers shared by the page and its unit test.
 *
 * The read model is already filtered by the Host for workspace/lifetime; this
 * module turns the flat node/edge/cluster arrays into display containers,
 * derives facts, and applies the optional PM/room/repo focus filters without
 * inventing a container, node or edge.
 */
import type {
  TeamAgentNode,
  TeamEdgeKind,
  TeamEngineerNode,
  TeamExecutionMode,
  TeamGraphEdge,
  TeamGraphNode,
  TeamGraphReadModel,
  TeamNodeLifetime,
  TeamNodeStatus,
} from "@linxiraos/studio-contract";

/** Agent/subagent nodes carry an AgentId; path objects do not. */
export function isAgentNode(node: TeamGraphNode): node is TeamAgentNode {
  return node.kind === "agent" || node.kind === "subagent";
}

export interface TeamNodeLifecycle {
  readonly status: TeamNodeStatus;
  readonly executionMode: TeamExecutionMode;
  readonly lifetime: TeamNodeLifetime;
}

/**
 * Lifecycle facts are required on agent/subagent/engineer nodes and optional on
 * a PM workspace, which carries its PM main agent when that session is attached.
 */
export function nodeLifecycle(node: TeamGraphNode): TeamNodeLifecycle | undefined {
  if (node.kind === "agent" || node.kind === "subagent" || node.kind === "engineer") {
    const agent: TeamAgentNode | TeamEngineerNode = node;
    return {
      status: agent.status,
      executionMode: agent.executionMode,
      lifetime: agent.lifetime,
    };
  }
  if (node.kind === "pm-workspace" && node.status !== undefined && node.executionMode !== undefined && node.lifetime !== undefined) {
    return { status: node.status, executionMode: node.executionMode, lifetime: node.lifetime };
  }
  return undefined;
}

/** Role badge: a PM workspace is its PM, an engineer record is an engineer. */
export function nodeRole(node: TeamGraphNode): "pm" | "engineer" | "secretary" | "unknown" | undefined {
  if (node.kind === "pm-workspace") return "pm";
  if (node.kind === "engineer") return "engineer";
  if (node.kind === "agent") return node.role ?? "unknown";
  if (node.kind === "subagent") return node.role === "secretary" ? "secretary" : undefined;
  return undefined;
}

export interface TeamLane {
  readonly clusterId: string;
  readonly kind: "team" | "unassigned";
  /** Team name from the Team DB; absent for the unassigned boundary. */
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

/** One selectable PM/room/repo object; `id` is the node id, never a path. */
export interface TeamObjectOption {
  readonly id: string;
  readonly label: string;
  readonly relations: number;
}

export interface TeamFilterOptions {
  readonly pms: readonly TeamObjectOption[];
  readonly rooms: readonly TeamObjectOption[];
  readonly repos: readonly TeamObjectOption[];
}

export interface TeamFocusFilter {
  readonly pmId?: string;
  readonly roomId?: string;
  readonly repoId?: string;
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

function objectOptions(graph: TeamGraphReadModel, kind: TeamGraphNode["kind"]): TeamObjectOption[] {
  const options: TeamObjectOption[] = [];
  for (const node of graph.nodes) {
    if (node.kind !== kind) continue;
    options.push({
      id: node.nodeId,
      label: node.displayName,
      relations: graph.edges.filter(edge => edge.from === node.nodeId || edge.to === node.nodeId).length,
    });
  }
  return options.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

/** PM workspace, DB room and base repo options for the focus filters. */
export function teamFilterOptions(graph: TeamGraphReadModel): TeamFilterOptions {
  return {
    pms: objectOptions(graph, "pm-workspace"),
    rooms: objectOptions(graph, "db-room"),
    repos: objectOptions(graph, "git-repo"),
  };
}

/**
 * Focus the graph on one PM, room or repo. Selected nodes are the object plus
 * the rows reachable through real edges: PM → bindings/engineers/secretary/
 * rooms; repo → bindings/worktrees/engineers; room → members. Edges survive
 * only when both endpoints survive, and containers keep their real labels.
 */
export function filterTeamGraph(graph: TeamGraphReadModel, filter: TeamFocusFilter): TeamGraphReadModel {
  const nodeById = new Map(graph.nodes.map(node => [node.nodeId, node]));
  const keep = new Set<string>();

  const addEdges = (kind: TeamEdgeKind, direction: "outgoing" | "incoming") => {
    let added = true;
    while (added) {
      added = false;
      for (const edge of graph.edges) {
        if (edge.kind !== kind) continue;
        const source = direction === "outgoing" ? edge.from : edge.to;
        const target = direction === "outgoing" ? edge.to : edge.from;
        if (!keep.has(source) || keep.has(target) || !nodeById.has(source) || !nodeById.has(target)) continue;
        keep.add(target);
        added = true;
      }
    }
  };

  if (filter.pmId !== undefined && nodeById.has(filter.pmId)) {
    keep.add(filter.pmId);
    addEdges("binding", "outgoing");
    addEdges("assignment", "outgoing");
    addEdges("spawn", "outgoing");
    // A PM's rooms include the PM and their Secretary (membership edges point
    // at the room), so add the room itself without pulling in peer members.
    for (const edge of graph.edges) {
      if (edge.kind === "room" && keep.has(edge.from) && nodeById.has(edge.to)) keep.add(edge.to);
    }
    // Engineer home/task worktrees point at their engineer; the worktree then
    // points at its base repo.
    for (const edge of graph.edges) {
      if (edge.kind === "contains" && keep.has(edge.to)) keep.add(edge.from);
    }
    addEdges("worktree-of", "incoming");
    addEdges("spawn", "outgoing");
  }

  if (filter.roomId !== undefined && nodeById.has(filter.roomId)) {
    keep.add(filter.roomId);
    addEdges("room", "incoming");
  }

  if (filter.repoId !== undefined && nodeById.has(filter.repoId)) {
    keep.add(filter.repoId);
    addEdges("binding", "incoming");
    addEdges("worktree-of", "outgoing");
    for (const edge of graph.edges) {
      if (edge.kind === "contains" && keep.has(edge.from) && nodeById.has(edge.to)) keep.add(edge.to);
    }
  }

  if (keep.size === 0) return graph;

  const nodes = graph.nodes.filter(node => keep.has(node.nodeId));
  const ids = new Set(nodes.map(node => node.nodeId));
  const edges = graph.edges.filter(edge => ids.has(edge.from) && ids.has(edge.to));
  const counts = new Map<string, number>();
  for (const node of nodes) counts.set(node.clusterId, (counts.get(node.clusterId) ?? 0) + 1);
  const clusters = graph.clusters
    .filter(cluster => (counts.get(cluster.clusterId) ?? 0) > 0)
    .map(cluster => ({ ...cluster, memberCount: counts.get(cluster.clusterId) ?? 0 }));

  return {
    ...graph,
    nodes,
    edges,
    clusters,
  };
}

/** Edge totals per kind; a zero count means no producer emitted that relation. */
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

/** Lifetime totals over nodes that carry agent lifecycle facts. */
export function teamLifetimeCounts(nodes: readonly TeamGraphNode[]): Record<TeamNodeLifetime, number> {
  const counts: Record<TeamNodeLifetime, number> = { persistent: 0, ephemeral: 0 };
  for (const node of nodes) {
    const lifecycle = nodeLifecycle(node);
    if (lifecycle !== undefined) counts[lifecycle.lifetime] += 1;
  }
  return counts;
}

/** Object-kind totals used by the ownership legend. */
export function teamKindCounts(nodes: readonly TeamGraphNode[]): Record<TeamGraphNode["kind"], number> {
  const counts: Record<TeamGraphNode["kind"], number> = {
    agent: 0,
    subagent: 0,
    engineer: 0,
    "pm-workspace": 0,
    "git-repo": 0,
    "db-room": 0,
    "linked-worktree": 0,
  };
  for (const node of nodes) counts[node.kind] += 1;
  return counts;
}
