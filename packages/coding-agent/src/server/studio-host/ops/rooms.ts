/**
 * Studio operations — local Super/Repo/Main rooms (contacts layer).
 *
 * Every query reads the durable local room log (`rooms/db.ts`). No row, event,
 * member, unread count or capability is synthesized: a room with no events is
 * empty, and a member with no live ref is `offline`. Delivery uses the existing
 * IrcBus/session queue; this family never starts a task scheduler.
 *
 * Paths never leave the Host: a member home repo is reduced to its basename.
 */
import * as path from "node:path";
import { logger } from "@linxiraos/pi-utils";
import { AgentRegistry } from "../../../registry/agent-registry.js";
import { RoomError } from "../../../rooms/errors.js";
import { parkResident, promoteResident, reviveResident } from "../../../rooms/resident.js";
import { RoomService } from "../../../rooms/service.js";
import { recordRoomReply, roomRuntime } from "../../../rooms/transport.js";
import type { Room, RoomEvent, RoomMember } from "../../../rooms/types.js";
import type {
	LocalRoomContactsReadModel,
	LocalRoomEventReadModel,
	LocalRoomMemberReadModel,
	LocalRoomMemberStatus,
	LocalRoomPostReadModel,
	LocalRoomProposalReadModel,
	LocalRoomReplyReadModel,
	LocalRoomResidentReadModel,
	LocalRoomRoundReadModel,
	LocalRoomSnapshotReadModel,
	LocalRoomSummaryReadModel,
} from "../contract/index.js";
import { StudioOpError, invalid, requiredString } from "../gateway.js";
import type { StudioFamily } from "../registry.js";

const service = (): RoomService => roomRuntime().rooms;

function repoName(repoRoot: string | undefined): string | undefined {
	return repoRoot ? path.basename(repoRoot) : undefined;
}

function memberStatus(memberId: string): LocalRoomMemberStatus {
	const ref = AgentRegistry.global().get(memberId);
	if (!ref) return "offline";
	return ref.status;
}

function toRoom(room: Room) {
	return {
		roomId: room.id,
		kind: room.kind,
		name: room.name,
		...(room.repoRoot === undefined ? {} : { repoName: repoName(room.repoRoot) }),
		createdAt: room.createdAt,
		updatedAt: room.updatedAt,
	};
}

function toMember(rooms: RoomService, member: RoomMember): LocalRoomMemberReadModel {
	return {
		memberId: member.memberId,
		displayName: member.displayName,
		role: member.role,
		...(member.repoRoot === undefined ? {} : { repoName: repoName(member.repoRoot) }),
		status: memberStatus(member.memberId),
		unread: rooms.unread(member.roomId, member.memberId),
	};
}

function toEvent(event: RoomEvent): LocalRoomEventReadModel {
	return {
		roomId: event.roomId,
		seq: event.seq,
		eventId: event.eventId,
		kind: event.kind,
		actor: event.actor,
		sentAt: event.sentAt,
		body: event.body,
		...(event.replyTo === undefined ? {} : { replyTo: event.replyTo }),
		mentions: event.mentions,
		...(event.roundId === undefined ? {} : { roundId: event.roundId }),
	};
}

function toRound(round: {
	roundId: string;
	mode: "parallel" | "serial" | "mention";
	status: "open" | "done" | "stopped";
	triggerSeq: number;
	createdAt: string;
	completedAt?: string;
}): LocalRoomRoundReadModel {
	return {
		roundId: round.roundId,
		mode: round.mode,
		status: round.status,
		triggerSeq: round.triggerSeq,
		createdAt: round.createdAt,
		...(round.completedAt === undefined ? {} : { completedAt: round.completedAt }),
	};
}

function summary(rooms: RoomService, roomId: string, viewerId: string): LocalRoomSummaryReadModel {
	const value = rooms.summary(roomId, viewerId);
	return {
		room: toRoom(value.room),
		memberCount: value.members.length,
		lastSeq: value.lastSeq,
		...(value.lastEventAt === undefined ? {} : { lastEventAt: value.lastEventAt }),
		unread: value.unreadByMe,
	};
}

function withRoomErrors<T>(operation: string, run: () => T): T {
	try {
		return run();
	} catch (error) {
		if (error instanceof RoomError) throw invalid(`${operation}: ${error.message}`);
		throw error;
	}
}

async function withRoomErrorsAsync<T>(operation: string, run: () => Promise<T>): Promise<T> {
	try {
		return await run();
	} catch (error) {
		if (error instanceof RoomError) throw invalid(`${operation}: ${error.message}`);
		throw error;
	}
}

function numberField(input: Record<string, unknown>, key: string, optional = false): number | undefined {
	const value = input[key];
	if (value === undefined) {
		if (optional) return undefined;
		throw invalid(`${key} must be a number`);
	}
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
		throw invalid(`${key} must be a non-negative integer`);
	}
	return value;
}

function stringArray(value: unknown, field: string): string[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) throw invalid(`${field} must be an array`);
	return value.map(item => {
		if (typeof item !== "string" || item === "") throw invalid(`${field} must contain non-empty strings`);
		return item;
	});
}

function queryInput(input: unknown): Record<string, unknown> {
	return typeof input === "object" && input !== null && !Array.isArray(input)
		? (input as Record<string, unknown>)
		: {};
}

export const roomsOps: StudioFamily = {
	id: "rooms",
	queries: {
		"rooms.list": async input => {
			const value = queryInput(input);
			const viewerId = typeof value.viewerId === "string" && value.viewerId !== "" ? value.viewerId : "user";
			const rooms = service();
			return {
				rooms: rooms.listRooms().map(room => summary(rooms, room.id, viewerId)),
			};
		},
		"room.get": async input => {
			const value = queryInput(input);
			const roomId = requiredString(value, "roomId");
			const rooms = service();
			return withRoomErrors("room.get", (): LocalRoomSnapshotReadModel => {
				const snapshot = rooms.snapshot(roomId, { viewerId: "user" });
				return {
					room: toRoom(snapshot.room),
					members: snapshot.members.map(member => toMember(rooms, member)),
					events: snapshot.events.map(toEvent),
					rounds: rooms.log.listRounds(snapshot.room.id).map(toRound),
					lastSeq: snapshot.lastSeq,
				};
			});
		},
		"room.log.read": async input => {
			const value = queryInput(input);
			const roomId = requiredString(value, "roomId");
			const afterSeq = numberField(value, "afterSeq", true);
			const limit = numberField(value, "limit", true);
			const rooms = service();
			return withRoomErrors("room.log.read", () => {
				const room = rooms.getRoom(roomId);
				return {
					roomId: room.id,
					events: rooms.log
						.listEvents(room.id, {
							...(afterSeq === undefined ? {} : { afterSeq }),
							...(limit === undefined || limit === 0 ? {} : { limit }),
						})
						.map(toEvent),
					lastSeq: rooms.log.lastEvent(room.id)?.seq ?? 0,
				};
			});
		},
		"room.contacts.list": async input => {
			const value = queryInput(input);
			const roomId = requiredString(value, "roomId");
			const rooms = service();
			return withRoomErrors("room.contacts.list", (): LocalRoomContactsReadModel => {
				const room = rooms.getRoom(roomId);
				return {
					roomId: room.id,
					contacts: rooms.log.listMembers(room.id).map(member => toMember(rooms, member)),
					generatedAt: new Date().toISOString(),
				};
			});
		},
	},
	commands: {
		"room.create": async input => {
			const value = queryInput(input);
			const roomKind = requiredString(value, "roomKind");
			const name = requiredString(value, "name");
			const repoRoot = typeof value.repoRoot === "string" && value.repoRoot !== "" ? value.repoRoot : undefined;
			const rooms = service();
			const room = withRoomErrors("room.create", () =>
				rooms.createRoom({ kind: roomKind, name, ...(repoRoot ? { repoRoot } : {}) }),
			);
			return summary(rooms, room.id, "user");
		},
		"room.member.add": async input => {
			const value = queryInput(input);
			const roomId = requiredString(value, "roomId");
			const memberId = requiredString(value, "memberId");
			const role = requiredString(value, "role");
			const rooms = service();
			return withRoomErrors("room.member.add", () =>
				toMember(
					rooms,
					rooms.addMember({
						roomId,
						memberId,
						role,
						...(typeof value.displayName === "string" ? { displayName: value.displayName } : {}),
						...(typeof value.repoRoot === "string" ? { repoRoot: value.repoRoot } : {}),
						...(typeof value.homeSessionId === "string" ? { homeSessionId: value.homeSessionId } : {}),
					}),
				),
			);
		},
		"room.member.remove": async input => {
			const value = queryInput(input);
			const roomId = requiredString(value, "roomId");
			const memberId = requiredString(value, "memberId");
			withRoomErrors("room.member.remove", () => service().removeMember(roomId, memberId));
			return { removed: true as const };
		},
		"room.post": async input => {
			const value = queryInput(input);
			const roomId = requiredString(value, "roomId");
			const body = requiredString(value, "body");
			const mode = typeof value.mode === "string" ? value.mode : undefined;
			const mentions = stringArray(value.mentions, "mentions");
			const replyTo = numberField(value, "replyTo", true);
			const { rooms, coordinator } = roomRuntime();
			const posted = withRoomErrors("room.post", () =>
				rooms.postMessage({
					roomId,
					body,
					...(mode === undefined ? {} : { mode }),
					...(mentions === undefined ? {} : { mentions }),
					...(replyTo === undefined ? {} : { replyTo }),
				}),
			);
			if (posted.round) {
				void coordinator.deliverRound(posted.round.roundId).catch(error => {
					logger.warn("studio-host: room delivery failed", { round: posted.round?.roundId, error: String(error) });
				});
			}
			return {
				event: toEvent(posted.event),
				...(posted.round === undefined ? {} : { roundId: posted.round.roundId }),
				targetMemberIds: posted.targets.map(member => member.memberId),
			} satisfies LocalRoomPostReadModel;
		},
		"room.reply": async input => {
			const value = queryInput(input);
			const roomId = requiredString(value, "roomId");
			const memberId = requiredString(value, "memberId");
			const body = requiredString(value, "body");
			const replyTo = numberField(value, "replyTo", true);
			const roundId = typeof value.roundId === "string" && value.roundId !== "" ? value.roundId : undefined;
			const reply = await withRoomErrorsAsync("room.reply", () =>
				recordRoomReply({
					roomId,
					memberId,
					body,
					...(replyTo === undefined ? {} : { replyTo }),
					...(roundId === undefined ? {} : { roundId }),
				}),
			);
			const event = service().log.getEvent(roomId, reply.seq);
			if (!event) throw new StudioOpError("INTERNAL_ERROR", "room reply was not persisted");
			return {
				event: toEvent(event),
				nextMemberIds: reply.next,
			} satisfies LocalRoomReplyReadModel;
		},
		"room.markRead": async input => {
			const value = queryInput(input);
			const roomId = requiredString(value, "roomId");
			const memberId = typeof value.memberId === "string" && value.memberId !== "" ? value.memberId : "user";
			const seq = numberField(value, "seq");
			if (seq === undefined) throw invalid("seq is required");
			withRoomErrors("room.markRead", () => service().markSeen(roomId, memberId, seq));
			return { roomId, seq };
		},
		"room.round.stop": async input => {
			const value = queryInput(input);
			const roomId = requiredString(value, "roomId");
			const roundId = requiredString(value, "roundId");
			const { coordinator, rooms } = roomRuntime();
			const round = rooms.log.getRound(roundId);
			if (!round || round.roomId !== roomId) throw invalid("round does not belong to this room");
			const event = await withRoomErrorsAsync("room.round.stop", () =>
				coordinator.stop(roundId, { kind: "user", id: "user", name: "User" }),
			);
			return toEvent(event);
		},
		"room.resident.promote": async input => {
			const value = queryInput(input);
			const roomId = requiredString(value, "roomId");
			const agentId = requiredString(value, "agentId");
			const ownerMemberId = typeof value.ownerMemberId === "string" ? value.ownerMemberId : undefined;
			const rooms = service();
			const member = withRoomErrors("room.resident.promote", () =>
				promoteResident(rooms, { roomId, agentId, ...(ownerMemberId ? { ownerMemberId } : {}) }),
			);
			return toMember(rooms, member);
		},
		"room.resident.park": async input => {
			const value = queryInput(input);
			const roomId = requiredString(value, "roomId");
			const agentId = requiredString(value, "agentId");
			const result = await withRoomErrorsAsync("room.resident.park", () => parkResident(service(), roomId, agentId));
			return { agentId: result.agentId, status: memberStatus(result.agentId) } satisfies LocalRoomResidentReadModel;
		},
		"room.resident.revive": async input => {
			const value = queryInput(input);
			const roomId = requiredString(value, "roomId");
			const agentId = requiredString(value, "agentId");
			const result = await withRoomErrorsAsync("room.resident.revive", () =>
				reviveResident(service(), roomId, agentId),
			);
			return { agentId: result.agentId, status: memberStatus(result.agentId) } satisfies LocalRoomResidentReadModel;
		},
		"room.proposal.create": async input => {
			const value = queryInput(input);
			const roomId = requiredString(value, "roomId");
			const targetRepo = requiredString(value, "targetRepo");
			const body = requiredString(value, "body");
			const result = withRoomErrors("room.proposal.create", () =>
				service().createProposal({
					roomId,
					actor: { kind: "user", id: "user", name: "User" },
					targetRepo,
					body,
					...(typeof value.targetMemberId === "string" ? { targetMemberId: value.targetMemberId } : {}),
					...(typeof value.decisionId === "string" ? { decisionId: value.decisionId } : {}),
				}),
			);
			return toProposal(result.proposal);
		},
		"room.proposal.respond": async input => {
			const value = queryInput(input);
			const roomId = requiredString(value, "roomId");
			const proposalId = requiredString(value, "proposalId");
			if (typeof value.accept !== "boolean") throw invalid("accept must be a boolean");
			const result = withRoomErrors("room.proposal.respond", () =>
				service().respondProposal({
					roomId,
					proposalId,
					actor: { kind: "user", id: "user", name: "User" },
					accept: value.accept as boolean,
					...(typeof value.decisionId === "string" ? { decisionId: value.decisionId } : {}),
					...(typeof value.body === "string" ? { body: value.body } : {}),
				}),
			);
			return toProposal(result.proposal);
		},
	},
};

function toProposal(proposal: {
	proposalId: string;
	roomId: string;
	seq: number;
	targetRepo: string;
	targetMemberId?: string;
	decisionId?: string;
	status: "open" | "accepted" | "rejected" | "stale";
	createdAt: string;
	resolvedAt?: string;
}): LocalRoomProposalReadModel {
	return {
		proposalId: proposal.proposalId,
		roomId: proposal.roomId,
		seq: proposal.seq,
		targetRepo: path.basename(proposal.targetRepo),
		...(proposal.targetMemberId === undefined ? {} : { targetMemberId: proposal.targetMemberId }),
		...(proposal.decisionId === undefined ? {} : { decisionId: proposal.decisionId }),
		status: proposal.status,
		createdAt: proposal.createdAt,
		...(proposal.resolvedAt === undefined ? {} : { resolvedAt: proposal.resolvedAt }),
	};
}
