/**
 * ADR0038 Team membership over the existing durable RoomLog and IRC/mesh delivery.
 * No TeamDb, executor, or transcript store is introduced here. Wire notifications
 * contain room references only: message bodies remain exclusively in rooms.db.
 */
import { createHash } from "node:crypto";
import * as path from "node:path";
import { isRecord } from "@linxiraos/pi-utils";
import { AgentRegistry, isRootAgentRef } from "../registry/agent-registry";
import { RoomDeliveryCoordinator } from "../rooms/delivery";
import { RoomError } from "../rooms/errors";
import { RoomService, extractRoomMentions } from "../rooms/service";
import { createAgentRoomDeliveryPort, resetRoomRuntimeForTests, roomRuntime } from "../rooms/transport";
import type { Room, RoomEvent, RoomEventKind, RoomMember } from "../rooms/types";
export { isTeamRoomId } from "../rooms/types";
import type { VibeOwnerScope } from "./runtime";

export type TeamRoomName = "team" | "mains";
export type TeamMemberRole = "owner" | "worker";
export type TeamWorkerLifecycle = "resident" | "ephemeral";
export type TeamRoomOwner = Readonly<VibeOwnerScope>;

export interface TeamWorkerInput {
	readonly id: string;
	readonly role?: string;
	readonly label?: string;
	readonly parentId?: string;
	readonly sessionId?: string;
	readonly sessionFile?: string;
	readonly generation?: number;
	readonly lifecycle?: TeamWorkerLifecycle;
}

export interface TeamRoomMemberView {
	readonly agentId: string;
	readonly role: TeamMemberRole;
	readonly label: string;
	readonly moduleRole?: string;
	readonly generation?: number;
	readonly lifecycle?: TeamWorkerLifecycle;
	readonly homeSessionId?: string;
	readonly status?: "running" | "idle" | "parked" | "aborted" | "gone";
	readonly createdAt?: string;
}

export interface TeamRoomEventView {
	readonly seq: number;
	readonly eventId: string;
	readonly kind: RoomEventKind;
	readonly senderId: string;
	readonly senderName: string;
	readonly sentAt: string;
	readonly body: string;
	readonly replyTo?: number;
	readonly mentions: readonly string[];
	readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface TeamRoomView {
	readonly room: TeamRoomName;
	readonly roomId: string;
	readonly name: string;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly members: readonly TeamRoomMemberView[];
	readonly events: readonly TeamRoomEventView[];
	readonly lastSeq: number;
	readonly unreadBy: Readonly<Record<string, number>>;
}

export interface TeamRoomSnapshot {
	readonly teamKey: string;
	readonly ownerScope: TeamRoomOwner;
	readonly owner: TeamRoomMemberView;
	readonly team: TeamRoomView;
	readonly mains: TeamRoomView;
}

export interface TeamRoomHistory {
	readonly teamKey: string;
	readonly room: TeamRoomName;
	readonly roomId: string;
	readonly events: readonly TeamRoomEventView[];
	readonly lastSeq: number;
}

export interface TeamRoomDeliveryView {
	readonly agentId: string;
	readonly seq: number;
	readonly outcome: "injected" | "woken" | "revived" | "queued" | "failed";
	readonly accepted: boolean;
}

export interface TeamRoomPostResult {
	readonly teamKey: string;
	readonly room: TeamRoomName;
	readonly event: TeamRoomEventView;
	readonly deliveries: readonly TeamRoomDeliveryView[];
}

export interface TeamRoomReadOptions {
	readonly afterSeq?: number;
	readonly limit?: number;
}

function normalizeOwner(owner: TeamRoomOwner): TeamRoomOwner {
	if (!owner.ownerId.trim() || !owner.parentSessionId.trim())
		throw new RoomError("A Team needs an owner and source session id");
	return {
		ownerId: owner.ownerId,
		parentSessionId: owner.parentSessionId,
		parentSessionFile: owner.parentSessionFile ? path.resolve(owner.parentSessionFile) : null,
	};
}

function ownerScopeMetadata(value: unknown): TeamRoomOwner | undefined {
	if (
		!isRecord(value) ||
		typeof value.ownerId !== "string" ||
		typeof value.parentSessionId !== "string" ||
		(value.parentSessionFile !== null && typeof value.parentSessionFile !== "string")
	)
		return undefined;
	return normalizeOwner({
		ownerId: value.ownerId,
		parentSessionId: value.parentSessionId,
		parentSessionFile: value.parentSessionFile,
	});
}

/** Stable across process restart and navigation away from the source transcript. */
export function teamKeyForScope(owner: TeamRoomOwner): string {
	const scope = normalizeOwner(owner);
	return createHash("sha256")
		.update(JSON.stringify([scope.ownerId, scope.parentSessionId, scope.parentSessionFile]))
		.digest("hex")
		.slice(0, 16);
}

function roomId(owner: TeamRoomOwner, room: TeamRoomName): string {
	if (room !== "team" && room !== "mains") throw new RoomError(`Unknown Team room "${String(room)}"`);
	return `${room}_${teamKeyForScope(owner)}`;
}

function requireMain(agentId: string): void {
	const ref = AgentRegistry.global().get(agentId);
	if (!ref || !isRootAgentRef(ref)) throw new RoomError(`"${agentId}" is not a registered main agent`);
}

function store(): RoomService {
	return roomRuntime().rooms;
}

function requireActive(owner: TeamRoomOwner, room: TeamRoomName): Room {
	const rooms = store();
	const target = rooms.getRoom(roomId(owner, room));
	const member = rooms.log.getMember(target.id, owner.ownerId);
	if (member?.metadata?.teamKey !== teamKeyForScope(owner) || member.metadata.teamRole !== "owner") {
		throw new RoomError("This Team scope is inactive");
	}
	return target;
}

/** Checks durable scope admission without creating a room or borrowing another source's membership. */
export function isActiveTeamScope(owner: TeamRoomOwner): boolean {
	const member = store().log.getMember(roomId(owner, "team"), owner.ownerId);
	return member?.metadata?.teamKey === teamKeyForScope(owner) && member.metadata.teamRole === "owner";
}

function ownerMetadata(owner: TeamRoomOwner): Record<string, unknown> {
	return { teamKey: teamKeyForScope(owner), teamRole: "owner", ownerScope: normalizeOwner(owner) };
}

function putMember(rooms: RoomService, member: Omit<RoomMember, "createdAt">): void {
	if (rooms.log.getMember(member.roomId, member.memberId)) rooms.log.updateMember(member);
	else rooms.log.insertMember(member);
}

function retireMember(rooms: RoomService, id: string, memberId: string): void {
	for (const round of rooms.log.listRounds(id)) {
		const target = rooms.log.getRoundTarget(round.roundId, memberId);
		if (target?.status === "pending") rooms.log.setTargetStatus(round.roundId, memberId, "failed");
	}
	rooms.log.deleteMember(id, memberId);
}

/** Creates only the two reserved log rooms; re-entry preserves history and cursors. */
export function ensureTeam(owner: TeamRoomOwner): TeamRoomSnapshot {
	owner = normalizeOwner(owner);
	requireMain(owner.ownerId);
	const rooms = store();
	const ref = AgentRegistry.global().get(owner.ownerId)!;
	rooms.log.transaction(() => {
		for (const room of ["team", "mains"] as const) {
			const id = roomId(owner, room);
			if (!rooms.log.getRoom(id)) {
				// Existing local log audiences: main+residents and cross-main contacts.
				rooms.log.insertRoom({
					id,
					kind: room === "team" ? "main" : "super",
					name: `${room}-${teamKeyForScope(owner)}`,
				});
			}
			putMember(rooms, {
				roomId: id,
				memberId: owner.ownerId,
				role: "main",
				displayName: ref.displayName,
				homeSessionId: owner.parentSessionId,
				metadata: ownerMetadata(owner),
			});
		}
	});
	return snapshot(owner);
}

/** Reconciles direct workers, never recursively admitting a worker's descendants. */
export function syncMembers(owner: TeamRoomOwner, workers: readonly TeamWorkerInput[]): TeamRoomSnapshot {
	const rooms = store();
	rooms.log.transaction(() => {
		const target = requireActive(owner, "team");
		const ids = new Set<string>();
		const otherRooms = rooms.listRooms().filter(room => /^team_[0-9a-f]{16}$/.test(room.id) && room.id !== target.id);
		for (const worker of workers) {
			const ref = AgentRegistry.global().get(worker.id);
			if (!worker.id.trim() || worker.id === owner.ownerId || ids.has(worker.id))
				throw new RoomError("Duplicate or invalid Team worker id");
			if (otherRooms.some(room => rooms.log.getMember(room.id, worker.id)))
				throw new RoomError(`"${worker.id}" already belongs to another Team source scope`);
			if (
				(ref && (ref.kind !== "sub" || ref.parentId !== owner.ownerId)) ||
				(!ref && worker.parentId !== owner.ownerId) ||
				(worker.parentId !== undefined && worker.parentId !== owner.ownerId)
			) {
				throw new RoomError(`"${worker.id}" is not a direct worker of "${owner.ownerId}"`);
			}
			ids.add(worker.id);
		}
		for (const member of rooms.log.listMembers(target.id)) {
			if (member.memberId !== owner.ownerId && !ids.has(member.memberId))
				retireMember(rooms, target.id, member.memberId);
		}
		for (const worker of workers) {
			putMember(rooms, {
				roomId: target.id,
				memberId: worker.id,
				role: "resident",
				displayName: worker.label ?? worker.role ?? worker.id,
				...(worker.sessionId ? { homeSessionId: worker.sessionId } : {}),
				metadata: {
					teamKey: teamKeyForScope(owner),
					teamRole: "worker",
					...(worker.sessionFile ? { sourceSessionFile: path.resolve(worker.sessionFile) } : {}),
					...(worker.role ? { moduleRole: worker.role } : {}),
					...(worker.generation === undefined ? {} : { generation: worker.generation }),
					...(worker.lifecycle ? { lifecycle: worker.lifecycle } : {}),
				},
			});
		}
	});
	return snapshot(owner);
}

/** Optional explicit main peers; no worker is ever admitted to the mains room. */
export function syncMains(owner: TeamRoomOwner, mainIds: readonly string[]): TeamRoomSnapshot {
	const rooms = store();
	const target = requireActive(owner, "mains");
	const ids = new Set([owner.ownerId, ...mainIds]);
	for (const id of ids) requireMain(id);
	rooms.log.transaction(() => {
		for (const member of rooms.log.listMembers(target.id)) {
			if (!ids.has(member.memberId)) retireMember(rooms, target.id, member.memberId);
		}
		for (const id of ids) {
			if (id === owner.ownerId) continue;
			putMember(rooms, {
				roomId: target.id,
				memberId: id,
				role: "main",
				displayName: AgentRegistry.global().get(id)!.displayName,
				metadata: { teamKey: teamKeyForScope(owner), teamRole: "owner" },
			});
		}
	});
	return snapshot(owner);
}

/** Revokes room admission; durable events remain readable after exit. */
export function leaveTeam(owner: TeamRoomOwner): void {
	const rooms = store();
	rooms.log.transaction(() => {
		for (const room of ["team", "mains"] as const) {
			const id = roomId(owner, room);
			for (const round of rooms.log.listRounds(id))
				if (round.status === "open") rooms.log.setRoundStatus(round.roundId, "stopped");
			for (const member of rooms.log.listMembers(id)) rooms.log.deleteMember(id, member.memberId);
		}
	});
}

function eventView(event: RoomEvent): TeamRoomEventView {
	return {
		seq: event.seq,
		eventId: event.eventId,
		kind: event.kind,
		senderId: event.actor.id,
		senderName: event.actor.name,
		sentAt: event.sentAt,
		body: event.body,
		mentions: event.mentions,
		...(event.replyTo === undefined ? {} : { replyTo: event.replyTo }),
		...(event.metadata === undefined ? {} : { metadata: event.metadata }),
	};
}

function memberView(member: RoomMember): TeamRoomMemberView {
	const metadata = member.metadata;
	const ref = AgentRegistry.global().get(member.memberId);
	return {
		agentId: member.memberId,
		role: metadata?.teamRole === "worker" ? "worker" : "owner",
		label: member.displayName,
		...(typeof metadata?.moduleRole === "string" ? { moduleRole: metadata.moduleRole } : {}),
		...(typeof metadata?.generation === "number" ? { generation: metadata.generation } : {}),
		...(metadata?.lifecycle === "resident" || metadata?.lifecycle === "ephemeral"
			? { lifecycle: metadata.lifecycle }
			: {}),
		...(member.homeSessionId ? { homeSessionId: member.homeSessionId } : {}),
		createdAt: member.createdAt,
		...(ref ? { status: ref.status } : { status: "gone" as const }),
	};
}

function validateRead(options: TeamRoomReadOptions): void {
	if (options.afterSeq !== undefined && (!Number.isSafeInteger(options.afterSeq) || options.afterSeq < 0))
		throw new RoomError("afterSeq must be a non-negative integer");
	if (options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit <= 0))
		throw new RoomError("limit must be a positive integer");
}

/** Read-only, including after exit; unknown scopes throw rather than creating rooms. */
export function history(
	owner: TeamRoomOwner,
	room: TeamRoomName = "team",
	options: TeamRoomReadOptions = {},
): TeamRoomHistory {
	validateRead(options);
	const rooms = store();
	const target = rooms.getRoom(roomId(owner, room));
	return {
		teamKey: teamKeyForScope(owner),
		room,
		roomId: target.id,
		events: rooms.log.listEvents(target.id, options).map(eventView),
		lastSeq: rooms.log.lastEvent(target.id)?.seq ?? 0,
	};
}

/** Read-only projection of both durable rooms and current registry status. */
export function snapshot(owner: TeamRoomOwner, options: TeamRoomReadOptions = {}): TeamRoomSnapshot {
	validateRead(options);
	const rooms = store();
	const view = (room: TeamRoomName): TeamRoomView => {
		const id = roomId(owner, room);
		const target = rooms.getRoom(id);
		const lastSeq = rooms.log.lastEvent(id)?.seq ?? 0;
		const members = rooms.listMembers(id);
		const unreadBy: Record<string, number> = {};
		for (const member of members)
			unreadBy[member.memberId] = Math.max(
				0,
				lastSeq - (rooms.log.readCursor(id, member.memberId)?.readThroughSeq ?? 0),
			);
		return {
			room,
			roomId: target.id,
			name: room === "team" ? "Team" : "Mains",
			members: members.map(memberView),
			createdAt: target.createdAt,
			updatedAt: target.updatedAt,
			events: rooms.log.listEvents(id, options).map(eventView),
			lastSeq,
			unreadBy,
		};
	};
	const team = view("team");
	const mains = view("mains");
	return {
		teamKey: teamKeyForScope(owner),
		ownerScope: normalizeOwner(owner),
		owner: team.members.find(member => member.agentId === owner.ownerId) ?? {
			agentId: owner.ownerId,
			role: "owner",
			label: owner.ownerId,
		},
		team,
		mains,
	};
}

/** Read-only active Team inventory, including owners currently observing another transcript. */
export function listTeamSnapshots(options: { limit?: number } = {}): readonly TeamRoomSnapshot[] {
	validateRead(options);
	const rooms = store();
	const result: TeamRoomSnapshot[] = [];
	for (const room of rooms.listRooms()) {
		if (!/^team_[0-9a-f]{16}$/.test(room.id)) continue;
		for (const member of rooms.log.listMembers(room.id)) {
			const scope = ownerScopeMetadata(member.metadata?.ownerScope);
			if (
				member.metadata?.teamRole !== "owner" ||
				!scope ||
				scope.ownerId !== member.memberId ||
				roomId(scope, "team") !== room.id
			)
				continue;
			result.push(snapshot(scope, options));
		}
	}
	return result;
}

async function appendAndDeliver(
	owner: TeamRoomOwner,
	senderId: string,
	body: string,
	room: TeamRoomName,
	metadata?: Readonly<Record<string, unknown>>,
	replyTo?: number,
): Promise<TeamRoomPostResult> {
	const rooms = store();
	const text = body.trim();
	if (!text) throw new RoomError("A Team room message must not be empty");
	const appended = rooms.log.transaction(() => {
		const target = requireActive(owner, room);
		const sender = rooms.log.getMember(target.id, senderId);
		if (!sender) throw new RoomError(`"${senderId}" is not a member of this Team room`);
		if (room === "mains") requireMain(senderId);
		if (replyTo !== undefined && !rooms.log.getEvent(target.id, replyTo))
			throw new RoomError("Reply target is not in this Team room");
		const event = rooms.log.appendEvent({
			roomId: target.id,
			kind: "agent",
			actor: { kind: "agent", id: senderId, name: sender.displayName },
			body: text,
			mentions: extractRoomMentions(text),
			...(metadata ? { metadata } : {}),
			...(replyTo === undefined ? {} : { replyTo }),
		});
		const targets = rooms.listMembers(target.id).filter(member => member.memberId !== senderId);
		if (targets.length === 0) return { event };
		const round = rooms.log.createRound(
			target.id,
			event.seq,
			"parallel",
			targets.map(member => member.memberId),
		);
		rooms.log.attachEventRound(target.id, event.seq, round.roundId);
		return { event: { ...event, roundId: round.roundId }, round };
	});
	const deliveries = appended.round ? await deliverPendingTeamRoomEvents(owner, room) : [];
	return { teamKey: teamKeyForScope(owner), room, event: eventView(appended.event), deliveries };
}

export function post(
	owner: TeamRoomOwner,
	senderId: string,
	body: string,
	room: TeamRoomName = "team",
): Promise<TeamRoomPostResult> {
	return appendAndDeliver(owner, senderId, body, room);
}

/** A reply is another governed room event, never an execution directive. */
export function reply(
	owner: TeamRoomOwner,
	senderId: string,
	body: string,
	replyTo?: number,
	room: TeamRoomName = "team",
): Promise<TeamRoomPostResult> {
	return appendAndDeliver(owner, senderId, body, room, undefined, replyTo);
}

const deliveryTails = new Map<string, Promise<unknown>>();

/** Retry durable notifications oldest-first without advancing past a failed member. */
export function deliverPendingTeamRoomEvents(
	owner: TeamRoomOwner,
	room: TeamRoomName = "team",
): Promise<TeamRoomDeliveryView[]> {
	const key = roomId(owner, room);
	const task = (deliveryTails.get(key) ?? Promise.resolve()).catch(() => {}).then(() => drainTeamRoom(owner, room));
	deliveryTails.set(key, task);
	void task
		.finally(() => {
			if (deliveryTails.get(key) === task) deliveryTails.delete(key);
		})
		.catch(() => {});
	return task;
}

async function drainTeamRoom(owner: TeamRoomOwner, room: TeamRoomName): Promise<TeamRoomDeliveryView[]> {
	const rooms = store();
	const target = requireActive(owner, room);
	const transport = createAgentRoomDeliveryPort();
	const blocked = new Set<string>();
	const coordinator = new RoomDeliveryCoordinator(
		rooms,
		{
			deliver(member, context, event, round) {
				if (blocked.has(member.memberId)) return Promise.resolve("failed");
				if (!rooms.log.getMember(target.id, owner.ownerId) || !rooms.log.getMember(target.id, member.memberId))
					return Promise.resolve("failed");
				const ref = AgentRegistry.global().get(member.memberId);
				if (room === "mains" && (!ref || !isRootAgentRef(ref))) return Promise.resolve("failed");
				if (member.metadata?.teamRole === "worker" && ref && (ref.kind !== "sub" || ref.parentId !== owner.ownerId))
					return Promise.resolve("failed");
				const scope = ownerScopeMetadata(member.metadata?.ownerScope);
				const manager = ref?.session?.sessionManager;
				if (
					scope &&
					(!manager ||
						manager.getSessionId() !== scope.parentSessionId ||
						(manager.getSessionFile() ? path.resolve(manager.getSessionFile()!) : null) !==
							scope.parentSessionFile)
				)
					return Promise.resolve("failed");
				if (
					typeof member.metadata?.sourceSessionFile === "string" &&
					(!ref?.sessionFile || path.resolve(ref.sessionFile) !== member.metadata.sourceSessionFile)
				)
					return Promise.resolve("failed");
				return transport.deliver(member, context, event, round);
			},
		},
		true,
	);
	const deliveries: TeamRoomDeliveryView[] = [];
	for (const round of rooms.log.listRounds(target.id).sort((a, b) => a.triggerSeq - b.triggerSeq)) {
		const result = await coordinator.deliverRound(round.roundId);
		for (const item of result.deliveries) {
			if (!item.accepted) blocked.add(item.memberId);
			deliveries.push({ agentId: item.memberId, seq: item.seq, outcome: item.outcome, accepted: item.accepted });
		}
	}
	return deliveries;
}

/** Host-only provenance path; callers supply identity from the bound IM ingress, never tool params. */
export function postForwardedIm(
	owner: TeamRoomOwner,
	body: string,
	provenance: Readonly<Record<string, unknown>>,
	room: TeamRoomName = "team",
): Promise<TeamRoomPostResult> {
	requireMain(owner.ownerId);
	const text = `[IM ${String(provenance.platform)} instance=${String(provenance.instance)} chat=${String(provenance.chatId)} message=${String(provenance.messageId)}]\n${body}`;
	return appendAndDeliver(owner, owner.ownerId, text, room, provenance);
}

/** Resolve a reserved room for an authenticated tool caller; caller identity is host supplied. */
export function teamRoomScopeForMember(
	id: string,
	memberId: string,
	sourceSessionId?: string | null,
): { owner: TeamRoomOwner; room: TeamRoomName } {
	const rooms = store();
	const members = rooms.listMembers(id);
	const owner = ownerScopeMetadata(members.find(member => member.metadata?.ownerScope)?.metadata?.ownerScope);
	if (!owner || !members.some(member => member.memberId === memberId))
		throw new RoomError("Not a member of this active Team room");
	const member = members.find(candidate => candidate.memberId === memberId)!;
	const ref = AgentRegistry.global().get(memberId);
	if (member.metadata?.teamRole === "worker" && ref && (ref.kind !== "sub" || ref.parentId !== owner.ownerId))
		throw new RoomError("Worker identity no longer belongs to this Team owner");
	if (
		typeof member.metadata?.sourceSessionFile === "string" &&
		(!ref?.sessionFile || path.resolve(ref.sessionFile) !== member.metadata.sourceSessionFile)
	)
		throw new RoomError("Worker belongs to another source transcript");
	if (memberId === owner.ownerId && sourceSessionId !== owner.parentSessionId)
		throw new RoomError("This Team belongs to another source transcript");
	const room = id === roomId(owner, "team") ? "team" : "mains";
	if (id !== roomId(owner, room)) throw new RoomError("Invalid Team room scope");
	if (room === "mains") requireMain(memberId);
	return { owner, room };
}

/** Drop process-local transport state; callers own injected test connections. */
export function resetTeamRoomsForTests(): void {
	resetRoomRuntimeForTests();
	deliveryTails.clear();
}
