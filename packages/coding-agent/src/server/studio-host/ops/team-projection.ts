/**
 * Pure Team graph projection.
 *
 * This module has no transport or registry imports: it turns already-read
 * facts into the contract read model, which is what the host tests exercise.
 * `ops/team.ts` owns the gateway and Team DB reads and delegates here.
 *
 * Ownership model (see `local://team-path-model.md` §2.5–2.6):
 * - the Team root is an ownerless container, never a node and never an agent;
 * - `pms/<pm>/` is the PM main agent's workspace, not a Git repo;
 * - rooms are DB rows + `room_events`, not folders;
 * - only canonical base repos at `<team>/repos/<repo>` are Git (one clone, PMs
 *   bind through DB `repo_bindings`); worktrees are linked worktrees outside it;
 * - subagents own no folder, branch or worktree.
 *
 * Producers:
 * - the Team DB supplies teams, PMs, repos, bindings, engineers, worktrees,
 *   rooms, room members and PM-owned Secretary rows;
 * - the live registry supplies main agents and their root-scoped subagent
 *   rosters; a live main whose cwd is a PM workspace or an engineer worktree
 *   is that record's agent. An unclaimed main stays an `agent` node.
 *
 * There is no per-PM repo copy: one `git-repo` node per DB repo, and PMs join
 * it through `binding` edges. A DB record without a live session is `offline`,
 * never a fabricated running agent.
 */
import * as path from "node:path";
import type {
	TeamAgentNode,
	TeamAgentRole,
	TeamEngineerNode,
	TeamExecutionMode,
	TeamGraphCluster,
	TeamGraphEdge,
	TeamGraphGap,
	TeamGraphNode,
	TeamGraphReadModel,
	TeamNodeLifetime,
	TeamNodeStatus,
	TeamPathNode,
	WorkspaceId,
} from "../contract/index.js";
import type { AgentId, SessionId, StudioAgentSnapshot } from "../protocol/index.js";
import { workspaceIdFor } from "./workspace-id.js";
import type { TeamDbFacts } from "./team-db.js";

/** Status vocabulary the graph reports (the four authoritative registry states). */
export const TEAM_STATUS: Readonly<Partial<Record<string, TeamNodeStatus>>> = {
	starting: "running",
	reviving: "running",
	running: "running",
	idle: "idle",
	parked: "parked",
	aborted: "aborted",
};

/** Durable Secretary states map onto the same lifecycle vocabulary. */
const SECRETARY_STATUS: Readonly<Record<string, TeamNodeStatus>> = {
	starting: "running",
	idle: "idle",
	parked: "parked",
	dead: "aborted",
	unknown: "offline",
};

/** Statuses a caller may ask for; also used to validate the query input. */
export const LIFETIMES: readonly TeamNodeLifetime[] = ["persistent", "ephemeral"];

/** Container id for live agents while no Team DB record exists. */
export const UNASSIGNED_CLUSTER_ID = "unassigned";

/** Hard cap on projected nodes; the roster is capped too, this bounds the page. */
const MAX_TEAM_NODES = 2000;

/** Assignment text is a spawn brief, not a transcript; keep cards readable. */
const MAX_ASSIGNMENT_CHARS = 180;

/**
 * Producers this host does not have. Every structural fact now has a producer
 * (Team DB rows or the live-agent registry), so the list stays empty unless a
 * future contract slot genuinely has none.
 */
const TEAM_GAPS: readonly TeamGraphGap[] = [];

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
	/** One snapshot of the global Team DB. */
	readonly teamDb: TeamDbFacts;
	readonly generatedAt: Date;
}

/** Query filters, already validated. */
export interface TeamGraphQuery {
	readonly workspaceId?: WorkspaceId;
	readonly lifetime?: TeamNodeLifetime;
	readonly clusterId?: string;
}

interface MainMatch {
	readonly kind: "pm" | "engineer";
	readonly objectId: string;
	readonly nodeId: string;
}

function epochIso(value: number): string | undefined {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** DB timestamps are Unix seconds; the read model reports ISO time. */
function epochIsoSeconds(value: number): string {
	return new Date(value * 1000).toISOString();
}

function truncateAssignment(value: string | undefined): string | undefined {
	const text = value?.trim();
	if (text === undefined || text === "") return undefined;
	return text.length <= MAX_ASSIGNMENT_CHARS ? text : `${text.slice(0, MAX_ASSIGNMENT_CHARS - 1)}…`;
}

function normalizePath(value: string): string {
	const resolved = path.resolve(value);
	return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function pathWithin(root: string, candidate: string): boolean {
	const relative = path.relative(normalizePath(root), normalizePath(candidate));
	if (relative === "") return true;
	return !relative.startsWith("..") && !path.isAbsolute(relative);
}

function pmNodeId(pmId: string): string {
	return `pm:${pmId}`;
}

function repoNodeId(repoId: string): string {
	return `repo:${repoId}`;
}

function engineerNodeId(engineerId: string): string {
	return `engineer:${engineerId}`;
}

function worktreeNodeId(worktreeId: string): string {
	return `worktree:${worktreeId}`;
}

function roomNodeId(roomId: string): string {
	return `room:${roomId}`;
}

function teamClusterId(teamId: string): string {
	return `team:${teamId}`;
}

function pushEdge(edges: TeamGraphEdge[], kind: TeamGraphEdge["kind"], from: string, to: string, label?: string): void {
	edges.push({ edgeId: `${kind}:${from}->${to}`, kind, from, to, ...(label ? { label } : {}) });
}

const NODE_KIND_RANK: Readonly<Record<TeamGraphNode["kind"], number>> = {
	agent: 0,
	engineer: 1,
	"pm-workspace": 2,
	"git-repo": 3,
	"db-room": 4,
	"linked-worktree": 5,
	subagent: 6,
};

/**
 * Build the Team containers and every node/edge with a real producer.
 *
 * A Team DB row is authoritative even when its live session is absent: the
 * record node renders `offline` rather than inventing a running agent. A live
 * main that matches a PM workspace or engineer worktree is attached to that
 * node (no duplicate agent card); an unclaimed main stays an `agent` node in
 * its Team's boundary when its cwd is inside the team root, otherwise in the
 * `unassigned` boundary. `lifetime` filters subagents only; edges survive only
 * when both endpoints survive.
 */
export function projectTeamGraph(facts: TeamGraphFacts, query: TeamGraphQuery): TeamGraphReadModel {
	const nodes: TeamGraphNode[] = [];
	const edges: TeamGraphEdge[] = [];
	let truncated = false;
	const teamDb = facts.teamDb;

	const pmById = new Map(teamDb.pms.map(pm => [pm.id, pm]));
	const reposById = new Map(teamDb.repos.map(repo => [repo.id, repo]));
	const engineersById = new Map(teamDb.engineers.map(engineer => [engineer.id, engineer]));
	const roomsById = new Map(teamDb.rooms.map(room => [room.id, room]));

	const worktreesByEngineer = new Map<string, typeof teamDb.worktrees>();
	for (const worktree of teamDb.worktrees) {
		const list = worktreesByEngineer.get(worktree.engineerId) ?? [];
		worktreesByEngineer.set(worktree.engineerId, [...list, worktree]);
	}
	const engineersByPm = new Map<string, typeof teamDb.engineers>();
	for (const engineer of teamDb.engineers) {
		const list = engineersByPm.get(engineer.pmId) ?? [];
		engineersByPm.set(engineer.pmId, [...list, engineer]);
	}
	const pmsByTeam = new Map<string, typeof teamDb.pms>();
	for (const pm of teamDb.pms) {
		const list = pmsByTeam.get(pm.teamId) ?? [];
		pmsByTeam.set(pm.teamId, [...list, pm]);
	}
	const reposByTeam = new Map<string, typeof teamDb.repos>();
	for (const repo of teamDb.repos) {
		const list = reposByTeam.get(repo.teamId) ?? [];
		reposByTeam.set(repo.teamId, [...list, repo]);
	}
	const engineersByTeam = new Map<string, typeof teamDb.engineers>();
	for (const engineer of teamDb.engineers) {
		const list = engineersByTeam.get(engineer.teamId) ?? [];
		engineersByTeam.set(engineer.teamId, [...list, engineer]);
	}
	const worktreesByTeam = new Map<string, typeof teamDb.worktrees>();
	for (const worktree of teamDb.worktrees) {
		const list = worktreesByTeam.get(worktree.teamId) ?? [];
		worktreesByTeam.set(worktree.teamId, [...list, worktree]);
	}
	const roomsByTeam = new Map<string, typeof teamDb.rooms>();
	for (const room of teamDb.rooms) {
		const list = roomsByTeam.get(room.teamId) ?? [];
		roomsByTeam.set(room.teamId, [...list, room]);
	}
	const agentsByTeam = new Map<string, typeof teamDb.agents>();
	for (const agent of teamDb.agents) {
		const list = agentsByTeam.get(agent.teamId) ?? [];
		agentsByTeam.set(agent.teamId, [...list, agent]);
	}

	// Exact cwd → record indexes. A live main in a PM workspace or engineer
	// worktree is attached to that record; no path is serialized.
	const pmByPath = new Map<string, (typeof teamDb.pms)[number]>();
	for (const pm of teamDb.pms) pmByPath.set(normalizePath(pm.workspacePath), pm);
	const worktreeByPath = new Map<string, (typeof teamDb.worktrees)[number]>();
	for (const worktree of teamDb.worktrees) worktreeByPath.set(normalizePath(worktree.path), worktree);

	const pmMain = new Map<string, TeamMainFact>();
	const engineerMain = new Map<string, TeamMainFact>();
	const mainMatch = new Map<string, MainMatch>();
	for (const main of facts.mains) {
		if (main.cwd === undefined) continue;
		const cwd = normalizePath(main.cwd);
		const pm = pmByPath.get(cwd);
		if (pm !== undefined) {
			if (!pmMain.has(pm.id)) pmMain.set(pm.id, main);
			mainMatch.set(main.id, { kind: "pm", objectId: pm.id, nodeId: pmNodeId(pm.id) });
			continue;
		}
		const worktree = worktreeByPath.get(cwd);
		if (worktree !== undefined) {
			const engineer = engineersById.get(worktree.engineerId);
			if (engineer !== undefined && !engineerMain.has(engineer.id)) {
				engineerMain.set(engineer.id, main);
				mainMatch.set(main.id, { kind: "engineer", objectId: engineer.id, nodeId: engineerNodeId(engineer.id) });
			}
		}
	}

	// Team DB objects. One node per row; ids are opaque row ids, never paths.
	for (const team of teamDb.teams) {
		const clusterId = teamClusterId(team.id);
		const created = epochIsoSeconds(team.createdAt);

		for (const pm of pmsByTeam.get(team.id) ?? []) {
			const live = pmMain.get(pm.id);
			const workspaceId = workspaceIdFor(pm.workspacePath);
			const workspaceName = path.basename(pm.workspacePath);
			const node: TeamPathNode = {
				nodeId: pmNodeId(pm.id),
				kind: "pm-workspace",
				objectId: pm.id,
				displayName: pm.name,
				clusterId,
				workspaceId,
				workspaceName,
				status: live?.status ?? "offline",
				executionMode:
					live !== undefined ? (live.live ? (live.vibeEnabled ? "vibe" : "normal") : "unknown") : "unknown",
				lifetime: "persistent",
				...(live !== undefined
					? {
							agentId: live.id as AgentId,
							...(live.sessionId ? { sessionId: live.sessionId as SessionId } : {}),
						}
					: {}),
				createdAt: epochIsoSeconds(pm.createdAt),
				lastActivityAt: live !== undefined ? (epochIso(live.lastActivity) ?? created) : created,
			};
			nodes.push(node);
		}

		for (const repo of reposByTeam.get(team.id) ?? []) {
			nodes.push({
				nodeId: repoNodeId(repo.id),
				kind: "git-repo",
				objectId: repo.id,
				displayName: repo.name,
				clusterId,
				createdAt: epochIsoSeconds(repo.createdAt),
				lastActivityAt: created,
			});
		}

		for (const engineer of engineersByTeam.get(team.id) ?? []) {
			const live = engineerMain.get(engineer.id);
			const home = (worktreesByEngineer.get(engineer.id) ?? []).find(worktree => worktree.kind === "home");
			const workspacePath = live?.cwd ?? home?.path;
			const node: TeamEngineerNode = {
				nodeId: engineerNodeId(engineer.id),
				kind: "engineer",
				objectId: engineer.id,
				displayName: engineer.name,
				clusterId,
				...(workspacePath !== undefined
					? { workspaceId: workspaceIdFor(workspacePath), workspaceName: path.basename(workspacePath) }
					: {}),
				status: live?.status ?? "offline",
				executionMode: engineer.execution === "vibe" ? "vibe" : "normal",
				lifetime: "persistent",
				...(live !== undefined
					? {
							agentId: live.id as AgentId,
							...(live.sessionId ? { sessionId: live.sessionId as SessionId } : {}),
						}
					: {}),
				createdAt: epochIsoSeconds(engineer.createdAt),
				lastActivityAt: live !== undefined ? (epochIso(live.lastActivity) ?? created) : created,
			};
			nodes.push(node);
		}

		for (const worktree of worktreesByTeam.get(team.id) ?? []) {
			nodes.push({
				nodeId: worktreeNodeId(worktree.id),
				kind: "linked-worktree",
				objectId: worktree.id,
				displayName: worktree.kind === "home" ? "home" : worktree.name,
				clusterId,
				worktreeKind: worktree.kind,
				branch: worktree.branch,
				workspaceId: workspaceIdFor(worktree.path),
				workspaceName: path.basename(worktree.path),
				createdAt: epochIsoSeconds(worktree.createdAt),
				lastActivityAt: created,
			});
		}

		for (const room of roomsByTeam.get(team.id) ?? []) {
			nodes.push({
				nodeId: roomNodeId(room.id),
				kind: "db-room",
				objectId: room.id,
				displayName: `#${room.name}`,
				clusterId,
				createdAt: epochIsoSeconds(room.createdAt),
				lastActivityAt: created,
			});
		}

		for (const agent of agentsByTeam.get(team.id) ?? []) {
			if (nodes.length >= MAX_TEAM_NODES) {
				truncated = true;
				break;
			}
			const pm = pmById.get(agent.pmId);
			const status = SECRETARY_STATUS[agent.state] ?? "offline";
			const node: TeamAgentNode = {
				nodeId: agent.id,
				kind: "subagent",
				agentId: agent.id as AgentId,
				role: "secretary" as TeamAgentRole,
				displayName: "Secretary",
				status,
				executionMode: "normal",
				lifetime: "persistent",
				clusterId,
				parentNodeId: pmNodeId(agent.pmId),
				...(agent.sessionId ? { sessionId: agent.sessionId as SessionId } : {}),
				...(pm === undefined ? {} : { activity: `${pm.name} · secretary` }),
				createdAt: epochIsoSeconds(agent.createdAt),
				lastActivityAt: epochIsoSeconds(agent.updatedAt),
			};
			nodes.push(node);
			pushEdge(edges, "spawn", pmNodeId(agent.pmId), agent.id, "secretary");
		}
	}

	// PM → repo bindings, PM → engineer assignments, repo → worktree, worktree →
	// engineer. A row whose endpoints are absent is simply not drawn.
	for (const binding of teamDb.bindings) {
		if (!pmById.has(binding.pmId) || !reposById.has(binding.repoId)) continue;
		pushEdge(edges, "binding", pmNodeId(binding.pmId), repoNodeId(binding.repoId));
	}
	for (const engineer of teamDb.engineers) {
		if (!pmById.has(engineer.pmId)) continue;
		pushEdge(edges, "assignment", pmNodeId(engineer.pmId), engineerNodeId(engineer.id));
	}
	for (const worktree of teamDb.worktrees) {
		if (reposById.has(worktree.repoId)) {
			pushEdge(edges, "worktree-of", repoNodeId(worktree.repoId), worktreeNodeId(worktree.id));
		}
		if (engineersById.has(worktree.engineerId)) {
			pushEdge(edges, "contains", worktreeNodeId(worktree.id), engineerNodeId(worktree.engineerId));
		}
	}
	for (const member of teamDb.roomMembers) {
		if (!roomsById.has(member.roomId)) continue;
		const from = pmById.has(member.agentId)
			? pmNodeId(member.agentId)
			: engineersById.has(member.agentId)
				? engineerNodeId(member.agentId)
				: member.agentId;
		pushEdge(edges, "room", from, roomNodeId(member.roomId), member.role);
	}

	// Live agents and subagent rosters.
	const secretaryIds = new Set(teamDb.agents.map(agent => agent.id));
	const liveAgentNodeIds = new Set<string>();
	const teamRoots = [...teamDb.teams].sort((a, b) => b.rootPath.length - a.rootPath.length);

	for (const main of facts.mains) {
		const match = mainMatch.get(main.id);
		if (match === undefined && nodes.length >= MAX_TEAM_NODES) {
			truncated = true;
			break;
		}
		const workspaceId = main.cwd ? workspaceIdFor(main.cwd) : undefined;
		const workspaceName = workspaceId === undefined ? undefined : facts.workspaceNames.get(workspaceId);
		const mainCreatedAt = epochIso(main.createdAt);
		const mainLastActivity = epochIso(main.lastActivity);
		if (mainCreatedAt === undefined || mainLastActivity === undefined) continue;

		let ownerNodeId = match?.nodeId;
		if (match === undefined) {
			const clusterId = main.cwd
				? (() => {
						const team = teamRoots.find(candidate => pathWithin(candidate.rootPath, main.cwd!));
						return team === undefined ? UNASSIGNED_CLUSTER_ID : teamClusterId(team.id);
					})()
				: UNASSIGNED_CLUSTER_ID;
			const executionMode: TeamExecutionMode = main.live ? (main.vibeEnabled ? "vibe" : "normal") : "unknown";
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
				clusterId,
				...(main.activity ? { activity: main.activity } : {}),
				createdAt: mainCreatedAt,
				lastActivityAt: mainLastActivity,
			};
			nodes.push(mainNode);
			ownerNodeId = main.id;
			liveAgentNodeIds.add(main.id);
		}
		if (ownerNodeId === undefined) continue;
		const ownerTeamId =
			match === undefined
				? undefined
				: match.kind === "pm"
					? pmById.get(match.objectId)?.teamId
					: engineersById.get(match.objectId)?.teamId;
		const ownerClusterId =
			ownerTeamId !== undefined
				? teamClusterId(ownerTeamId)
				: (nodes.find(node => node.nodeId === ownerNodeId)?.clusterId ?? UNASSIGNED_CLUSTER_ID);

		const roster = (main.sessionId ? facts.rosters.get(main.sessionId) : undefined) ?? [];
		const subagents = roster.filter(
			entry =>
				entry.kind === "sub" &&
				TEAM_STATUS[String(entry.status)] !== undefined &&
				!secretaryIds.has(String(entry.agentId)),
		);
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
			const parentNodeId = parentId !== undefined && childIds.has(parentId) ? parentId : ownerNodeId;
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
				clusterId: ownerClusterId,
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

	// Room membership can reference a live main that no Team row names; resolve
	// those only after the live nodes exist.
	for (const member of teamDb.roomMembers) {
		if (pmById.has(member.agentId) || engineersById.has(member.agentId) || secretaryIds.has(member.agentId)) {
			continue;
		}
		if (!roomsById.has(member.roomId) || !liveAgentNodeIds.has(member.agentId)) continue;
		pushEdge(edges, "room", member.agentId, roomNodeId(member.roomId), member.role);
	}

	const keptNodes =
		query.workspaceId === undefined ? nodes : nodes.filter(node => node.workspaceId === query.workspaceId);
	const nodeIds = new Set(keptNodes.map(node => node.nodeId));
	const keptEdges = edges.filter(edge => nodeIds.has(edge.from) && nodeIds.has(edge.to));
	const counts = new Map<string, number>();
	for (const node of keptNodes) counts.set(node.clusterId, (counts.get(node.clusterId) ?? 0) + 1);

	const containers: TeamGraphCluster[] = [];
	for (const team of teamDb.teams) {
		const clusterId = teamClusterId(team.id);
		const memberCount = counts.get(clusterId) ?? 0;
		if (memberCount > 0 || query.workspaceId === undefined) {
			containers.push({ clusterId, kind: "team", teamId: team.id, label: team.name, memberCount });
		}
	}
	const unassignedCount = counts.get(UNASSIGNED_CLUSTER_ID) ?? 0;
	if (unassignedCount > 0) {
		containers.push({ clusterId: UNASSIGNED_CLUSTER_ID, kind: "unassigned", memberCount: unassignedCount });
	}

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
				NODE_KIND_RANK[a.kind] - NODE_KIND_RANK[b.kind] ||
				a.displayName.localeCompare(b.displayName) ||
				a.nodeId.localeCompare(b.nodeId),
		),
		edges: keptEdges.filter(edge => finalIds.has(edge.from) && finalIds.has(edge.to)),
		clusters: keptContainers.sort((a, b) => a.clusterId.localeCompare(b.clusterId)),
		gaps: TEAM_GAPS,
		...(truncated ? { truncated: true } : {}),
	};
}
