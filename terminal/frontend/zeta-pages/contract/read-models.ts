/**
 * Local read-model subset for the zeta-owned Team/Rooms pages.
 *
 * Copied from the Host contract (`packages/coding-agent/src/server/studio-host/contract/read-models.ts`)
 * so this standalone entry has no dependency on web-app or packages/* source.
 * Shapes are type-only and must stay byte-compatible with the Host.
 */
import type { AgentId, SessionId, WorkspaceId } from "./ids";

/** Active graph emits registry mains, actual Vibe workers and mesh room rows. */
export type TeamNodeKind =
	| "pm-workspace"
	| "git-repo"
	| "db-room"
	| "linked-worktree"
	| "engineer"
	| "agent"
	| "subagent";

/** Owner/worker are active Team roles. The other role names belong to legacy Super Team. */
export type TeamAgentRole = "owner" | "worker" | "pm" | "engineer" | "secretary" | "unknown";

/** Live mode only. Detached source owners have unknown mode. */
export type TeamExecutionMode = "team" | "vibe" | "normal" | "unknown";

/** Vibe lifecycle class determines worker lifetime, independent of transcript retention. */
export type TeamNodeLifetime = "persistent" | "ephemeral";

/** Offline means there is no registry session matching this source conversation. */
export type TeamNodeStatus = "running" | "idle" | "parked" | "aborted" | "offline";

/** Active graph emits source-scoped spawn and mesh membership edges. */
export type TeamEdgeKind = "spawn" | "assignment" | "room" | "contains" | "binding" | "worktree-of";

interface TeamGraphNodeBase {
	/** Stable id unique across the graph. Never a filesystem path. */
	readonly nodeId: string;
	readonly kind: TeamNodeKind;
	readonly displayName: string;
	/** Container this object is displayed in; `team` or `unassigned`. */
	readonly clusterId: string;
	/** Structural parent, when the producer knows one. */
	readonly parentNodeId?: string;
	/** Hashed Studio workspace id; never a path. */
	readonly workspaceId?: WorkspaceId;
	/** Workspace basename from the Host inventory; never a path. */
	readonly workspaceName?: string;
	readonly createdAt: string;
	readonly lastActivityAt: string;
}

/** Live agent or subagent. Subagents own no folder, branch or worktree. */
export interface TeamAgentNode extends TeamGraphNodeBase {
	readonly kind: "agent" | "subagent";
	readonly agentId: AgentId;
	/** Root session id for an agent; child transcript scope for a subagent. */
	readonly sessionId?: SessionId;
	/** Present on `agent`; also names a PM-owned Secretary subagent. */
	readonly role?: TeamAgentRole;
	readonly status: TeamNodeStatus;
	readonly executionMode: TeamExecutionMode;
	readonly lifetime: TeamNodeLifetime;
	/** Spawn brief shown as the edge/node label, truncated for display. */
	readonly assignment?: string;
	readonly activity?: string;
	/** Actual Vibe worker identity; never inferred from a generic task agent. */
	readonly worker?: {
		readonly role?: string;
		readonly generation?: number;
		readonly lifecycle?: "resident" | "ephemeral";
		readonly cli?: "fast" | "good";
		readonly model?: string;
		readonly queued?: number;
	};
}

/**
 * A Team DB ownership object (PM workspace, repo, room, worktree). A PM
 * workspace may also carry the live PM main agent facts; a linked worktree
 * names its branch. Paths are never serialized.
 */
export interface TeamPathNode extends TeamGraphNodeBase {
	readonly kind: "pm-workspace" | "git-repo" | "db-room" | "linked-worktree";
	/** Opaque producer id (team/pm/repo/room/worktree id), never a path. */
	readonly objectId?: string;
	/** For `linked-worktree`: the engineer's `home` or a task worktree. */
	readonly worktreeKind?: "home" | "task";
	/** Worktree branch as recorded by the Team DB, never a path. */
	readonly branch?: string;
	/** Live PM main agent attached to a `pm-workspace`, when one exists. */
	readonly agentId?: AgentId;
	readonly sessionId?: SessionId;
	readonly status?: TeamNodeStatus;
	readonly executionMode?: TeamExecutionMode;
	readonly lifetime?: TeamNodeLifetime;
	/** Active Team mesh room; legacy TeamDb rooms never enter team.graph.get. */
	readonly roomKind?: "team" | "mains";
	readonly memberCount?: number;
	readonly lastSeq?: number;
	readonly events?: ReadonlyArray<{
		readonly seq: number;
		readonly sentAt: string;
		readonly senderId: string;
		readonly senderName: string;
		readonly body: string;
	}>;
}

/**
 * A Team DB engineer record. `executionMode` is the recorded Team Vibe/normal
 * mode, and `offline` means no live main session is attached in this process.
 */
export interface TeamEngineerNode extends TeamGraphNodeBase {
	readonly kind: "engineer";
	readonly objectId?: string;
	readonly agentId?: AgentId;
	readonly sessionId?: SessionId;
	readonly status: TeamNodeStatus;
	readonly executionMode: TeamExecutionMode;
	readonly lifetime: TeamNodeLifetime;
}

export type TeamGraphNode = TeamAgentNode | TeamPathNode | TeamEngineerNode;

/** One relationship between two Team graph nodes. */
export interface TeamGraphEdge {
	readonly edgeId: string;
	readonly kind: TeamEdgeKind;
	readonly from: string;
	readonly to: string;
	readonly label?: string;
}

/**
 * A display container. A `team` cluster is the dashed ownerless boundary; it is
 * never an agent node. `unassigned` groups live agents while no team record
 * exists, and must not be presented as a Team.
 */
export interface TeamGraphCluster {
	readonly clusterId: string;
	readonly kind: "team" | "unassigned";
	/** Stable Team owner/source key; absent for unassigned registry roots. */
	readonly teamId?: string;
	/** Team name; absent for `unassigned` (the renderer localizes its label). */
	readonly label?: string;
	/** Nodes displayed inside the boundary. */
	readonly memberCount: number;
}

/** A producer the graph needs but this host does not have yet. */
export interface TeamGraphGap {
	readonly id:
		| "team-root"
		| "pm-workspaces"
		| "git-repos"
		| "db-rooms"
		| "worktrees"
		| "roles"
		| "assignments"
		| "secretary";
	readonly detail: string;
}

/**
 * Team topology read model. Empty or partial data is first-class: the arrays may
 * be empty and `gaps` names the missing producers instead of fabricating rows.
 */
export interface TeamGraphReadModel {
	readonly generatedAt: string;
	readonly nodes: ReadonlyArray<TeamGraphNode>;
	readonly edges: ReadonlyArray<TeamGraphEdge>;
	readonly clusters: ReadonlyArray<TeamGraphCluster>;
	readonly gaps: ReadonlyArray<TeamGraphGap>;
	/** True when the node cap dropped rows. */
	readonly truncated?: boolean;
	/** Mains whose subagent roster could not be read; their spawn tree is missing. */
	readonly incompleteMainIds?: ReadonlyArray<string>;
}

/**
 * Local Super/Repo/Main room read models.
 *
 * These rooms are the contacts-style layer from `document/super-agent-rooms.md`,
 * not the Team database `rooms` table. Paths never appear: a member's home repo
 * is reduced to a display basename and the room log stores no tracking/memory.
 */
export type LocalRoomKind = "super" | "repo" | "main";
export type LocalRoomMemberRole = "super" | "repo" | "main" | "resident";
export type LocalRoomDeliveryMode = "parallel" | "serial" | "mention";
export type LocalRoomEventKind = "user" | "agent" | "system" | "tool" | "pass" | "stop" | "proposal" | "ack";
export type LocalRoomMemberStatus = "running" | "idle" | "parked" | "aborted" | "offline";

export interface LocalRoomReadModel {
	readonly roomId: string;
	readonly kind: LocalRoomKind;
	readonly name: string;
	/** Display basename of the home repository, never a path. */
	readonly repoName?: string;
	readonly createdAt: string;
	readonly updatedAt: string;
}

export interface LocalRoomMemberReadModel {
	readonly memberId: string;
	readonly displayName: string;
	readonly role: LocalRoomMemberRole;
	/** Display basename of the home repository, never a path. */
	readonly repoName?: string;
	readonly status: LocalRoomMemberStatus;
	readonly unread: number;
}

export interface LocalRoomActorReadModel {
	readonly kind: "user" | "agent" | "system";
	readonly id: string;
	readonly name: string;
}

export interface LocalRoomEventReadModel {
	readonly roomId: string;
	readonly seq: number;
	readonly eventId: string;
	readonly kind: LocalRoomEventKind;
	readonly actor: LocalRoomActorReadModel;
	readonly sentAt: string;
	readonly body: string;
	readonly replyTo?: number;
	readonly mentions: ReadonlyArray<string>;
	readonly roundId?: string;
}

export interface LocalRoomRoundReadModel {
	readonly roundId: string;
	readonly mode: LocalRoomDeliveryMode;
	readonly status: "open" | "done" | "stopped";
	readonly triggerSeq: number;
	readonly createdAt: string;
	readonly completedAt?: string;
}

export interface LocalRoomSummaryReadModel {
	readonly room: LocalRoomReadModel;
	readonly memberCount: number;
	readonly lastSeq: number;
	readonly lastEventAt?: string;
	readonly unread: number;
}

export interface LocalRoomSnapshotReadModel {
	readonly room: LocalRoomReadModel;
	readonly members: ReadonlyArray<LocalRoomMemberReadModel>;
	readonly events: ReadonlyArray<LocalRoomEventReadModel>;
	readonly rounds: ReadonlyArray<LocalRoomRoundReadModel>;
	readonly lastSeq: number;
}

export interface LocalRoomContactsReadModel {
	readonly roomId: string;
	readonly contacts: ReadonlyArray<LocalRoomMemberReadModel>;
	readonly generatedAt: string;
}

export interface LocalRoomPostReadModel {
	readonly event: LocalRoomEventReadModel;
	readonly roundId?: string;
	readonly targetMemberIds: ReadonlyArray<string>;
}

export interface LocalRoomReplyReadModel {
	readonly event: LocalRoomEventReadModel;
	readonly nextMemberIds: ReadonlyArray<string>;
}

export interface LocalRoomResidentReadModel {
	readonly agentId: string;
	readonly status: LocalRoomMemberStatus;
}

export interface LocalRoomProposalReadModel {
	readonly proposalId: string;
	readonly roomId: string;
	readonly seq: number;
	readonly targetRepo: string;
	readonly targetMemberId?: string;
	readonly decisionId?: string;
	readonly status: "open" | "accepted" | "rejected" | "stale";
	readonly createdAt: string;
	readonly resolvedAt?: string;
}
