/**
 * Pure Team graph projection.
 *
 * This module has no transport or registry imports: it turns already-read
 * facts into the contract read model, which is what the host tests exercise.
 * `ops/team.ts` owns the gateway reads and delegates here.
 *
 * Ownership model (see `local://team-path-model.md` §2.5–2.6):
 * - the Team root is an ownerless container, never a node and never an agent;
 * - `pms/<pm>/` is the PM main agent's workspace, not a Git repo;
 * - rooms are DB rows + `room_events`, not folders;
 * - only engineer/shared repositories are Git; worktrees are linked worktrees;
 * - subagents own no folder, branch or worktree.
 *
 * Only `agent` and `subagent` nodes have a producer today. PM workspaces,
 * repos, rooms and worktrees remain declared gaps so nothing is fabricated.
 */
import type {
	TeamAgentNode,
	TeamAgentRole,
	TeamExecutionMode,
	TeamGraphCluster,
	TeamGraphEdge,
	TeamGraphGap,
	TeamGraphNode,
	TeamGraphReadModel,
	TeamNodeLifetime,
	TeamNodeStatus,
	WorkspaceId,
} from "../contract/index.js";
import type { AgentId, SessionId, StudioAgentSnapshot } from "../protocol/index.js";
import { workspaceIdFor } from "./workspace-id.js";

/** Status vocabulary the graph reports (the four authoritative registry states). */
export const TEAM_STATUS: Readonly<Partial<Record<string, TeamNodeStatus>>> = {
	starting: "running",
	reviving: "running",
	running: "running",
	idle: "idle",
	parked: "parked",
	aborted: "aborted",
};

/** Statuses a caller may ask for; also used to validate the query input. */
export const LIFETIMES: readonly TeamNodeLifetime[] = ["persistent", "ephemeral"];

/** Container id for live agents while no `.zeta/team.json` record exists. */
export const UNASSIGNED_CLUSTER_ID = "unassigned";

/** Hard cap on projected nodes; the roster is capped too, this bounds the page. */
const MAX_TEAM_NODES = 2000;

/** Assignment text is a spawn brief, not a transcript; keep cards readable. */
const MAX_ASSIGNMENT_CHARS = 180;

/**
 * Producers this host does not have. Static: these are product gaps, not a
 * consequence of the current request, so they are reported even on a full page.
 */
const TEAM_GAPS: readonly TeamGraphGap[] = [
	{
		id: "team-root",
		detail:
			"No `.zeta/team.json` producer exists: the Team root is an ownerless container (no agent, workspace, Git repo, session or AGENTS.md) and cannot be read yet.",
	},
	{
		id: "pm-workspaces",
		detail:
			"No `.zeta/pm.json` producer exists: `pms/<pm>/` PM workspaces cannot be distinguished from other main-agent sessions.",
	},
	{
		id: "git-repos",
		detail:
			"No repository inventory or `repo_bindings` producer exists. Base repos live once at `<team>/repos/<repo>` (no per-PM copies); PM bindings are DB edges and cannot be shown.",
	},
	{
		id: "db-rooms",
		detail:
			"Rooms are DB `rooms` rows + `room_events`, not folders, and no room producer exists; no room or PM↔PM peer node can be shown.",
	},
	{
		id: "worktrees",
		detail:
			"No worktree inventory producer exists. Linked worktrees live at `<team>/worktrees/<repo>/<pm>/<engineer>/{home,<task>}/`, outside the repo.",
	},
	{
		id: "roles",
		detail:
			"PM, engineer and secretary roles are not persisted (docs/agent-modes.md marks PM/Super Agent as planned); live agents stay unclassified.",
	},
	{
		id: "assignments",
		detail:
			"No store links an agent to a PM assignment, so assignment edges cannot be shown; spawn parentage is real.",
	},
	{
		id: "secretary",
		detail: "A secretary is a team-scoped persistent agent that does not exist yet, so it has no node.",
	},
];

/** Root-agent fact as `GET /api/agents` reports it. */
export interface TeamMainFact {
	readonly id: string;
	readonly sessionId?: string;
	readonly displayName: string;
	readonly status: TeamNodeStatus;
	readonly createdAt: number;
	readonly lastActivity: number;
	readonly live: boolean;
	readonly hasTranscript: boolean;
	readonly vibeEnabled: boolean;
	readonly cwd?: string;
	readonly activity?: string;
}

/** Immutable inputs to the pure projection, so it is testable without a host. */
export interface TeamGraphFacts {
	readonly mains: readonly TeamMainFact[];
	/** Root session id → roster rows (agent id keyed by the roster itself). */
	readonly rosters: ReadonlyMap<string, readonly StudioAgentSnapshot[]>;
	readonly workspaceNames: ReadonlyMap<WorkspaceId, string>;
	readonly generatedAt: Date;
}

/** Query filters, already validated. */
export interface TeamGraphQuery {
	readonly workspaceId?: WorkspaceId;
	readonly lifetime?: TeamNodeLifetime;
	readonly clusterId?: string;
}

function epochIso(value: number): string | undefined {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function truncateAssignment(value: string | undefined): string | undefined {
	const text = value?.trim();
	if (text === undefined || text === "") return undefined;
	return text.length <= MAX_ASSIGNMENT_CHARS ? text : `${text.slice(0, MAX_ASSIGNMENT_CHARS - 1)}…`;
}

/**
 * Build the ownerless container, agent/subagent nodes and spawn edges from real
 * facts.
 *
 * There is no team record today, so the single container is `unassigned`: it is
 * rendered as a dashed boundary and labelled as having no Team record, never as
 * a Team or a PM node. `lifetime` filters subagents but keeps agents as anchors;
 * edges survive only when both endpoints survive.
 */
export function projectTeamGraph(facts: TeamGraphFacts, query: TeamGraphQuery): TeamGraphReadModel {
	const nodes: TeamGraphNode[] = [];
	const edges: TeamGraphEdge[] = [];
	let truncated = false;

	for (const main of facts.mains) {
		if (nodes.length >= MAX_TEAM_NODES) {
			truncated = true;
			break;
		}
		const workspaceId = main.cwd ? workspaceIdFor(main.cwd) : undefined;
		const workspaceName = workspaceId === undefined ? undefined : facts.workspaceNames.get(workspaceId);
		const executionMode: TeamExecutionMode = main.live ? (main.vibeEnabled ? "vibe" : "normal") : "unknown";
		const mainCreatedAt = epochIso(main.createdAt);
		const mainLastActivity = epochIso(main.lastActivity);
		if (mainCreatedAt === undefined || mainLastActivity === undefined) continue;

		const mainNode: TeamAgentNode = {
			nodeId: main.id,
			kind: "agent",
			agentId: main.id as AgentId,
			...(main.sessionId ? { sessionId: main.sessionId as SessionId } : {}),
			role: "unknown" as TeamAgentRole,
			displayName: main.displayName,
			status: main.status,
			executionMode,
			lifetime: "persistent",
			...(workspaceId ? { workspaceId } : {}),
			...(workspaceName ? { workspaceName } : {}),
			clusterId: UNASSIGNED_CLUSTER_ID,
			...(main.activity ? { activity: main.activity } : {}),
			createdAt: mainCreatedAt,
			lastActivityAt: mainLastActivity,
		};
		nodes.push(mainNode);

		const roster = (main.sessionId ? facts.rosters.get(main.sessionId) : undefined) ?? [];
		const subagents = roster.filter(entry => entry.kind === "sub" && TEAM_STATUS[String(entry.status)] !== undefined);
		const childIds = new Set(subagents.map(entry => String(entry.agentId)));

		for (const entry of subagents) {
			if (query.lifetime !== undefined && (entry.hasTranscript ? "persistent" : "ephemeral") !== query.lifetime) {
				continue;
			}
			if (nodes.length >= MAX_TEAM_NODES) {
				truncated = true;
				break;
			}
			const agentId = String(entry.agentId);
			const parentId = entry.parentAgentId === undefined ? undefined : String(entry.parentAgentId);
			const parentNodeId = parentId !== undefined && childIds.has(parentId) ? parentId : main.id;
			const createdAt = entry.startedAt ?? mainCreatedAt;
			const assignment = truncateAssignment(entry.assignment);
			nodes.push({
				nodeId: agentId,
				kind: "subagent",
				agentId: agentId as AgentId,
				displayName: entry.displayName,
				status: TEAM_STATUS[String(entry.status)]!,
				executionMode: "normal",
				lifetime: entry.hasTranscript ? "persistent" : "ephemeral",
				...(workspaceId ? { workspaceId } : {}),
				...(workspaceName ? { workspaceName } : {}),
				clusterId: UNASSIGNED_CLUSTER_ID,
				parentNodeId,
				...(assignment ? { assignment } : {}),
				...(entry.summary ? { activity: entry.summary } : {}),
				createdAt,
				lastActivityAt: entry.updatedAt,
			});
			edges.push({
				edgeId: `${parentNodeId}->${agentId}`,
				kind: "spawn",
				from: parentNodeId,
				to: agentId,
				...(assignment ? { label: assignment } : {}),
			});
		}
	}

	const keptNodes =
		query.workspaceId === undefined ? nodes : nodes.filter(node => node.workspaceId === query.workspaceId);
	const nodeIds = new Set(keptNodes.map(node => node.nodeId));
	const keptEdges = edges.filter(edge => nodeIds.has(edge.from) && nodeIds.has(edge.to));
	const counts = new Map<string, number>();
	for (const node of keptNodes) counts.set(node.clusterId, (counts.get(node.clusterId) ?? 0) + 1);

	const containers: TeamGraphCluster[] = [...counts].map(([clusterId, memberCount]) => ({
		clusterId,
		kind: "unassigned",
		memberCount,
	}));
	const keptContainers = containers.filter(
		container => query.clusterId === undefined || container.clusterId === query.clusterId,
	);
	const containerIds = new Set(keptContainers.map(container => container.clusterId));
	const finalNodes =
		keptContainers.length === containers.length
			? keptNodes
			: keptNodes.filter(node => containerIds.has(node.clusterId));
	const finalIds = new Set(finalNodes.map(node => node.nodeId));

	return {
		generatedAt: facts.generatedAt.toISOString(),
		nodes: finalNodes.sort(
			(a, b) =>
				Number(b.kind === "agent") - Number(a.kind === "agent") ||
				a.displayName.localeCompare(b.displayName) ||
				a.nodeId.localeCompare(b.nodeId),
		),
		edges: keptEdges.filter(edge => finalIds.has(edge.from) && finalIds.has(edge.to)),
		clusters: keptContainers.sort((a, b) => a.clusterId.localeCompare(b.clusterId)),
		gaps: TEAM_GAPS,
		...(truncated ? { truncated: true } : {}),
	};
}
