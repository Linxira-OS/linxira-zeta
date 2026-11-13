/**
 * Local Super/Repo/Main room contract.
 *
 * These rooms are the contacts-style collaboration layer described in
 * `document/super-agent-rooms.md`. They are deliberately independent of the
 * Team database rooms: a room owns a durable, room-scoped event log here and
 * never writes a session transcript, a Team row, or another repository's
 * tracking.
 */

/** A room's audience. Rooms do not nest implicitly and never forward events. */
export type RoomKind = "super" | "repo" | "main";

/** Local single-user roles. `resident` is an explicitly promoted child agent. */
export type RoomMemberRole = "super" | "repo" | "main" | "resident";

/** How one user message is offered to the room. This is message delivery, not a task scheduler. */
export type RoomDeliveryMode = "parallel" | "serial" | "mention";

export type RoomEventKind = "user" | "agent" | "system" | "tool" | "pass" | "stop" | "proposal" | "ack";

export type RoomActorKind = "user" | "agent" | "system";

export type RoomRoundStatus = "open" | "done" | "stopped";

export type RoomTargetStatus = "pending" | "delivered" | "replied" | "passed" | "failed";

export type RoomProposalStatus = "open" | "accepted" | "rejected" | "stale";

export interface RoomActor {
	readonly kind: RoomActorKind;
	/** `user` for the operator, otherwise the registry/local agent id. */
	readonly id: string;
	readonly name: string;
}

export interface Room {
	readonly id: string;
	readonly kind: RoomKind;
	readonly name: string;
	/** Home repository for a `repo` room; absent for a cross-repo `super` room. */
	readonly repoRoot?: string;
	readonly createdAt: string;
	readonly updatedAt: string;
}

export interface RoomMember {
	readonly roomId: string;
	/** Local agent id or the literal `user` for the operator. */
	readonly memberId: string;
	readonly role: RoomMemberRole;
	readonly displayName: string;
	/** Home repository of this member. Never used to read another repo's tracking. */
	readonly repoRoot?: string;
	/** Registered main/child session id when known; stable across park/revive. */
	readonly homeSessionId?: string;
	readonly createdAt: string;
}

export interface RoomEvent {
	readonly roomId: string;
	/** Room-scoped, host-assigned, strictly increasing. The only authoritative order. */
	readonly seq: number;
	readonly eventId: string;
	readonly kind: RoomEventKind;
	readonly actor: RoomActor;
	readonly sentAt: string;
	readonly body: string;
	readonly replyTo?: number;
	readonly mentions: readonly string[];
	readonly roundId?: string;
	readonly status?: RoomTargetStatus;
}

export interface RoomRound {
	readonly roundId: string;
	readonly roomId: string;
	readonly triggerSeq: number;
	readonly mode: RoomDeliveryMode;
	readonly status: RoomRoundStatus;
	readonly createdAt: string;
	readonly completedAt?: string;
}

export interface RoomRoundTarget {
	readonly roundId: string;
	readonly roomId: string;
	readonly memberId: string;
	readonly status: RoomTargetStatus;
	readonly deliveredSeq?: number;
	readonly repliedSeq?: number;
}

export interface RoomCursor {
	readonly roomId: string;
	readonly memberId: string;
	readonly seenThroughSeq: number;
	readonly deliveredThroughSeq: number;
	readonly readThroughSeq: number;
}

export interface RoomProposal {
	readonly proposalId: string;
	readonly roomId: string;
	readonly seq: number;
	readonly targetRepo: string;
	readonly targetMemberId?: string;
	readonly decisionId?: string;
	readonly status: RoomProposalStatus;
	readonly createdAt: string;
	readonly resolvedAt?: string;
}

/** Compact contact-row projection for the Studio contacts list. */
export interface RoomContact {
	readonly memberId: string;
	readonly displayName: string;
	readonly role: RoomMemberRole;
	readonly repoRoot?: string;
	readonly status: "running" | "idle" | "parked" | "aborted" | "offline";
	readonly unread: number;
}

export interface RoomSummary {
	readonly room: Room;
	readonly members: readonly RoomMember[];
	readonly lastSeq: number;
	readonly lastEventAt?: string;
	readonly unreadByMe: number;
}

export const ROOM_KINDS: readonly RoomKind[] = ["super", "repo", "main"];
export const ROOM_ROLES: readonly RoomMemberRole[] = ["super", "repo", "main", "resident"];
export const ROOM_DELIVERY_MODES: readonly RoomDeliveryMode[] = ["parallel", "serial", "mention"];
