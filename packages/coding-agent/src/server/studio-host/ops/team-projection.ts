/** Active Team graph: source-scoped mesh membership joined with Vibe and registry facts. */
import type { ActiveTeamHubSnapshot } from "@linxiraos/pi-tui/overlays/active-team-hub";
import type { AgentId, SessionId } from "../protocol/index.js";
import type {
	TeamGraphNode,
	TeamGraphEdge,
	TeamGraphReadModel,
	TeamNodeLifetime,
	TeamNodeStatus,
	WorkspaceId,
} from "../contract/index.js";
import { workspaceIdFor } from "./workspace-id.js";

export const TEAM_STATUS: Readonly<Partial<Record<string, TeamNodeStatus>>> = {
	starting: "running",
	reviving: "running",
	running: "running",
	idle: "idle",
	parked: "parked",
	aborted: "aborted",
};
export const LIFETIMES: readonly TeamNodeLifetime[] = ["persistent", "ephemeral"];
export const UNASSIGNED_CLUSTER_ID = "unassigned";

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
	readonly teamEnabled?: boolean;
	readonly modeKnown?: boolean;
	readonly cwd?: string;
	readonly activity?: string;
}
export interface TeamGraphFacts {
	readonly mains: readonly TeamMainFact[];
	readonly teams: readonly {
		readonly snapshot: ActiveTeamHubSnapshot;
		readonly sourceSessionId: string;
		readonly cwd?: string;
	}[];
	readonly workspaceNames: ReadonlyMap<WorkspaceId, string>;
	readonly generatedAt: Date;
}
export interface TeamGraphQuery {
	readonly workspaceId?: WorkspaceId;
	readonly lifetime?: TeamNodeLifetime;
	readonly clusterId?: string;
}

/** A missing proxy mode API is unknown, never an ordinary-mode claim. */
function mainExecutionMode(main: TeamMainFact | undefined): "team" | "vibe" | "normal" | "unknown" {
	if (!main?.live || !main.modeKnown) return "unknown";
	return main.teamEnabled ? "team" : main.vibeEnabled ? "vibe" : "normal";
}

export function projectTeamGraph(facts: TeamGraphFacts, query: TeamGraphQuery): TeamGraphReadModel {
	const nodes: TeamGraphNode[] = [];
	const edges: TeamGraphEdge[] = [];
	const clusters: TeamGraphReadModel["clusters"][number][] = [];
	const claimed = new Set<string>();
	const mainById = new Map(facts.mains.map(main => [main.id, main]));
	for (const team of facts.teams) {
		const snapshot = team.snapshot;
		const clusterId = `team:${snapshot.teamKey}`;
		claimed.add(`${snapshot.ownerId}\0${team.sourceSessionId}`);
		if (query.clusterId !== undefined && query.clusterId !== clusterId) continue;
		const workspaceId = team.cwd ? workspaceIdFor(team.cwd) : undefined;
		if (query.workspaceId !== undefined && workspaceId !== query.workspaceId) continue;
		const workspaceName = workspaceId ? facts.workspaceNames.get(workspaceId) : undefined;
		const base = { clusterId, ...(workspaceId ? { workspaceId } : {}), ...(workspaceName ? { workspaceName } : {}) };
		const start = nodes.length;
		const idFor = (id: string) => `${clusterId}:agent:${id}`;
		const projectedIds = new Set<string>();
		for (const agent of snapshot.agents) {
			claimed.add(`${agent.id}\0${team.sourceSessionId}`);
			const lifetime = agent.lifecycle === "ephemeral" ? "ephemeral" : "persistent";
			if (agent.kind === "worker" && query.lifetime !== undefined && query.lifetime !== lifetime) continue;
			const main = mainById.get(agent.id);
			const root = main?.sessionId === team.sourceSessionId ? main : undefined;
			nodes.push({
				...base,
				nodeId: idFor(agent.id),
				kind: agent.kind === "main" ? "agent" : "subagent",
				agentId: agent.id as AgentId,
				...(agent.kind === "main" ? { sessionId: team.sourceSessionId as SessionId } : {}),
				displayName: agent.label,
				role: agent.kind === "main" ? "owner" : "worker",
				status: agent.status,
				lifetime,
				executionMode:
					agent.kind === "worker" ? "vibe" : agent.status !== "offline" ? mainExecutionMode(root) : "unknown",
				...(agent.kind === "worker"
					? {
							parentNodeId: idFor(snapshot.ownerId),
							worker: {
								role: agent.role,
								generation: agent.generation,
								lifecycle: agent.lifecycle,
								cli: agent.cli,
								model: agent.model,
								queued: agent.queued,
							},
						}
					: {}),
				...(agent.activity ? { activity: agent.activity } : {}),
				...(agent.assignment ? { assignment: agent.assignment } : {}),
				createdAt: agent.createdAt === undefined ? "" : new Date(agent.createdAt).toISOString(),
				lastActivityAt: agent.lastActivityAt === undefined ? "" : new Date(agent.lastActivityAt).toISOString(),
			});
			projectedIds.add(idFor(agent.id));
			if (agent.kind === "worker")
				edges.push({
					edgeId: `spawn:${clusterId}:${agent.id}`,
					kind: "spawn",
					from: idFor(snapshot.ownerId),
					to: idFor(agent.id),
				});
		}
		for (const room of snapshot.rooms) {
			const nodeId = `${clusterId}:room:${room.id}`;
			const createdAt = room.createdAt ?? "";
			nodes.push({
				...base,
				nodeId,
				kind: "db-room",
				objectId: room.id,
				displayName: `#${room.name}`,
				roomKind: room.room,
				memberCount: room.members.length,
				lastSeq: room.lastSeq,
				events: room.events,
				createdAt,
				lastActivityAt: room.updatedAt ?? room.events.at(-1)?.sentAt ?? "",
			});
			for (const member of room.members) {
				// Mains rooms may include a peer whose Team lane is elsewhere. Keep that actual membership edge.
				const memberNodeId = idFor(member.agentId);
				if (!projectedIds.has(memberNodeId)) {
					const peer = mainById.get(member.agentId);
					if (room.room !== "mains") continue;
					nodes.push({
						...base,
						nodeId: memberNodeId,
						kind: "agent",
						agentId: member.agentId as AgentId,
						displayName: peer?.displayName ?? member.label,
						status: peer?.live ? peer.status : "offline",
						executionMode: mainExecutionMode(peer),
						lifetime: "persistent",
						...(peer?.sessionId ? { sessionId: peer.sessionId as SessionId } : {}),
						createdAt: peer ? new Date(peer.createdAt).toISOString() : "",
						lastActivityAt: peer ? new Date(peer.lastActivity).toISOString() : "",
					});
					projectedIds.add(memberNodeId);
				}
				edges.push({ edgeId: `room:${nodeId}:${member.agentId}`, kind: "room", from: memberNodeId, to: nodeId });
			}
		}
		clusters.push({
			clusterId,
			kind: "team",
			teamId: snapshot.teamKey,
			label: snapshot.label,
			memberCount: nodes.length - start,
		});
	}
	if (query.clusterId === undefined || query.clusterId === UNASSIGNED_CLUSTER_ID) {
		const start = nodes.length;
		for (const main of facts.mains) {
			if (claimed.has(`${main.id}\0${main.sessionId ?? ""}`)) continue;
			const workspaceId = main.cwd ? workspaceIdFor(main.cwd) : undefined;
			if (query.workspaceId !== undefined && workspaceId !== query.workspaceId) continue;
			nodes.push({
				nodeId: `main:${main.id}:${main.sessionId ?? ""}`,
				clusterId: UNASSIGNED_CLUSTER_ID,
				kind: "agent",
				agentId: main.id as AgentId,
				displayName: main.displayName,
				role: "unknown",
				status: main.live ? main.status : "offline",
				executionMode: mainExecutionMode(main),
				lifetime: "persistent",
				...(workspaceId ? { workspaceId, workspaceName: facts.workspaceNames.get(workspaceId) } : {}),
				...(main.sessionId ? { sessionId: main.sessionId as SessionId } : {}),
				...(main.activity ? { activity: main.activity } : {}),
				createdAt: new Date(main.createdAt).toISOString(),
				lastActivityAt: new Date(main.lastActivity).toISOString(),
			});
		}
		if (nodes.length > start)
			clusters.push({ clusterId: UNASSIGNED_CLUSTER_ID, kind: "unassigned", memberCount: nodes.length - start });
	}
	const truncated = nodes.length > 2000;
	const kept = truncated ? nodes.slice(0, 2000) : nodes;
	const ids = new Set(kept.map(node => node.nodeId));
	const counts = new Map<string, number>();
	for (const node of kept) counts.set(node.clusterId, (counts.get(node.clusterId) ?? 0) + 1);
	return {
		generatedAt: facts.generatedAt.toISOString(),
		nodes: kept,
		edges: edges.filter(edge => ids.has(edge.from) && ids.has(edge.to)),
		clusters: clusters.map(cluster => ({ ...cluster, memberCount: counts.get(cluster.clusterId) ?? 0 })),
		gaps: [],
		...(truncated ? { truncated: true } : {}),
	};
}
