/**
 * Room operations: creation, membership, the ordered log, delivery rounds, and
 * the log-only proposal/ack ledger.
 *
 * No method here loads a repository's tracking, taste, memory, or another
 * room's events. Delivery context is assembled by `context.ts` from the room
 * log alone; this service only decides who a user message targets.
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { RoomLog, resolveRoomsDbPath, type AppendEventInput, type CreateRoomRecord } from "./db";
import { RoomError } from "./errors";
import {
	ROOM_DELIVERY_MODES,
	ROOM_KINDS,
	ROOM_ROLES,
	type Room,
	type RoomActor,
	type RoomContact,
	type RoomDeliveryMode,
	type RoomEvent,
	type RoomMember,
	type RoomMemberRole,
	type RoomProposal,
	type RoomRound,
	type RoomSummary,
} from "./types";

const MENTION_RE = /(?:^|[^\w@])@([A-Za-z0-9][A-Za-z0-9._:-]*)/g;

export function extractRoomMentions(body: string): string[] {
	const found = new Set<string>();
	for (const match of body.matchAll(MENTION_RE)) {
		const token = match[1];
		if (!token) continue;
		found.add(token.replace(/[.:-]+$/, ""));
	}
	return [...found];
}

function canonicalRepoRoot(repoRoot: string | undefined): string | undefined {
	if (!repoRoot?.trim()) return undefined;
	const resolved = path.resolve(repoRoot);
	try {
		return fs.realpathSync.native(resolved);
	} catch {
		return resolved;
	}
}

function roomSlug(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

export interface CreateRoomOptions {
	kind: string;
	name: string;
	repoRoot?: string;
}

export interface AddMemberOptions {
	roomId: string;
	memberId: string;
	role: string;
	displayName?: string;
	repoRoot?: string;
	homeSessionId?: string;
}

export interface PostMessageOptions {
	roomId: string;
	body: string;
	actor?: RoomActor;
	mode?: string;
	mentions?: readonly string[];
	replyTo?: number;
}

export interface PostMessageResult {
	event: RoomEvent;
	round?: RoomRound;
	targets: readonly RoomMember[];
}

export interface ReplyResult {
	event: RoomEvent;
	round?: RoomRound;
	nextTargets: readonly RoomMember[];
}

export interface RoomSnapshot {
	room: Room;
	members: readonly RoomMember[];
	events: readonly RoomEvent[];
	lastSeq: number;
	unreadBy: Readonly<Record<string, number>>;
}

export class RoomService {
	static #global: RoomService | undefined;

	static global(): RoomService {
		if (!RoomService.#global) RoomService.#global = new RoomService();
		return RoomService.#global;
	}

	/** Test-only reset. */
	static resetGlobalForTests(): void {
		RoomService.#global?.close();
		RoomService.#global = undefined;
	}

	readonly log: RoomLog;

	constructor(dbPath: string = resolveRoomsDbPath()) {
		this.log = new RoomLog(dbPath);
	}

	close(): void {
		this.log.close();
	}

	createRoom(options: CreateRoomOptions): Room {
		if (!(ROOM_KINDS as readonly string[]).includes(options.kind)) {
			throw new RoomError(`Unknown room kind "${options.kind}". Expected: ${ROOM_KINDS.join(", ")}`);
		}
		const kind = options.kind as Room["kind"];
		const name = roomSlug(options.name);
		if (!name) throw new RoomError("A room name must contain a letter or digit");
		const repoRoot = canonicalRepoRoot(options.repoRoot);
		if (kind === "repo" && repoRoot === undefined) {
			throw new RoomError("A repo room needs a repository root");
		}
		if (this.log.findRoom(kind, name, repoRoot ?? null)) {
			throw new RoomError(`Room "${name}" already exists in this ${kind} scope`);
		}
		const record: CreateRoomRecord = { id: `rm_${randomUUID()}`, kind, name, ...(repoRoot ? { repoRoot } : {}) };
		return this.log.insertRoom(record);
	}

	getRoom(roomId: string): Room {
		const room = this.log.getRoom(roomId);
		if (!room) throw new RoomError(`Unknown room "${roomId}"`);
		return room;
	}

	listRooms(): Room[] {
		return this.log.listRooms();
	}

	addMember(options: AddMemberOptions): RoomMember {
		const room = this.getRoom(options.roomId);
		if (!(ROOM_ROLES as readonly string[]).includes(options.role)) {
			throw new RoomError(`Unknown room role "${options.role}". Expected: ${ROOM_ROLES.join(", ")}`);
		}
		const memberId = options.memberId.trim();
		if (!memberId) throw new RoomError("A room member needs an id");
		if (memberId === "user") throw new RoomError("The operator is implicit; do not add `user` as a room member");
		if (room.kind === "main" && options.role !== "main" && options.role !== "resident") {
			throw new RoomError("A main room holds a main agent and explicit residents");
		}
		if (
			room.kind === "main" &&
			options.role === "main" &&
			this.log.listMembers(room.id).some(member => member.role === "main")
		) {
			throw new RoomError("A main room already holds its main agent");
		}
		if (this.log.getMember(room.id, memberId)) {
			throw new RoomError(`Member "${memberId}" already belongs to room "${room.name}"`);
		}
		const repoRoot = canonicalRepoRoot(options.repoRoot ?? room.repoRoot);
		return this.log.insertMember({
			roomId: room.id,
			memberId,
			role: options.role as RoomMemberRole,
			displayName: options.displayName?.trim() || memberId,
			...(repoRoot ? { repoRoot } : {}),
			...(options.homeSessionId ? { homeSessionId: options.homeSessionId } : {}),
		});
	}

	removeMember(roomId: string, memberId: string): void {
		const room = this.getRoom(roomId);
		this.log.deleteMember(room.id, memberId);
	}

	listMembers(roomId: string): RoomMember[] {
		return this.log.listMembers(this.getRoom(roomId).id);
	}

	/** Mention matching accepts an exact member id, a display name, or a role. */
	#mentionedMembers(roomId: string, mentions: readonly string[]): RoomMember[] {
		const members = this.log.listMembers(roomId);
		if (mentions.length === 0) return [];
		const wanted = new Set(mentions.map(token => token.toLowerCase()));
		return members.filter(member => {
			return (
				wanted.has(member.memberId.toLowerCase()) ||
				wanted.has(member.displayName.toLowerCase()) ||
				wanted.has(member.role.toLowerCase())
			);
		});
	}

	#roundTargets(room: Room, event: RoomEvent, mode: RoomDeliveryMode): RoomMember[] {
		const members = this.log.listMembers(room.id).filter(member => member.memberId !== event.actor.id);
		if (mode === "mention")
			return this.#mentionedMembers(room.id, event.mentions).filter(member => member.memberId !== event.actor.id);
		return members;
	}

	postMessage(options: PostMessageOptions): PostMessageResult {
		const room = this.getRoom(options.roomId);
		const body = options.body.trim();
		if (!body) throw new RoomError("A room message must not be empty");
		if (options.mode !== undefined && !(ROOM_DELIVERY_MODES as readonly string[]).includes(options.mode)) {
			throw new RoomError(`Unknown delivery mode "${options.mode}". Expected: ${ROOM_DELIVERY_MODES.join(", ")}`);
		}
		const actor = options.actor ?? { kind: "user" as const, id: "user", name: "User" };
		if (options.replyTo !== undefined) {
			const target = this.log.getEvent(room.id, options.replyTo);
			if (!target) throw new RoomError(`Reply target #${options.replyTo} is not an event in this room`);
		}
		const mentions = options.mentions ? [...options.mentions] : extractRoomMentions(body);
		const input: AppendEventInput = {
			roomId: room.id,
			kind: actor.kind === "user" ? "user" : "agent",
			actor,
			body,
			...(options.replyTo === undefined ? {} : { replyTo: options.replyTo }),
			mentions,
		};
		let event = this.log.appendEvent(input);

		if (actor.kind !== "user") {
			return { event, targets: [] };
		}
		const mode = (options.mode as RoomDeliveryMode | undefined) ?? "parallel";
		const targets = this.#roundTargets(room, event, mode);
		if (targets.length > 0) {
			const round = this.log.createRound(
				room.id,
				event.seq,
				mode,
				targets.map(member => member.memberId),
			);
			this.log.attachEventRound(room.id, event.seq, round.roundId);
			event = { ...event, roundId: round.roundId };
			for (const member of targets) this.log.getCursor(room.id, member.memberId);
			return { event, round, targets };
		}
		return { event, targets: [] };
	}

	/**
	 * Append one agent reply. A reply marks its round target and, for a serial
	 * round, returns the next target(s) the caller may inject. It never schedules
	 * a task: the caller uses the existing session/IrcBus queue.
	 */
	postAgentReply(options: {
		roomId: string;
		actor: RoomActor;
		body: string;
		replyTo?: number;
		roundId?: string;
	}): ReplyResult {
		const room = this.getRoom(options.roomId);
		const member = this.log.getMember(room.id, options.actor.id);
		if (!member) throw new RoomError(`Agent "${options.actor.id}" is not a member of room "${room.name}"`);
		const body = options.body.trim();
		if (!body) throw new RoomError("A room reply must not be empty");
		if (options.roundId !== undefined) {
			const target = this.log.getRoundTarget(options.roundId, options.actor.id);
			if (!target) throw new RoomError(`Agent "${options.actor.id}" is not a target of round "${options.roundId}"`);
			if (target.status === "replied") throw new RoomError("This round target already replied");
		}
		if (options.replyTo !== undefined) {
			const target = this.log.getEvent(room.id, options.replyTo);
			if (!target) throw new RoomError(`Reply target #${options.replyTo} is not an event in this room`);
		}
		const event = this.log.appendEvent({
			roomId: room.id,
			kind: "agent",
			actor: options.actor,
			body,
			...(options.replyTo === undefined ? {} : { replyTo: options.replyTo }),
			mentions: extractRoomMentions(body),
			...(options.roundId === undefined ? {} : { roundId: options.roundId }),
		});
		this.log.advanceCursor(room.id, options.actor.id, "seen_through_seq", event.seq);
		if (options.roundId === undefined) return { event, nextTargets: [] };

		const round = this.log.getRound(options.roundId);
		if (!round || round.roomId !== room.id) return { event, nextTargets: [] };
		this.log.setTargetStatus(round.roundId, options.actor.id, "replied", { repliedSeq: event.seq });
		const targets = this.log.listRoundTargets(round.roundId);
		if (targets.every(target => target.status === "replied" || target.status === "passed")) {
			this.log.setRoundStatus(round.roundId, "done");
			return { event, round: { ...round, status: "done" }, nextTargets: [] };
		}
		if (round.mode !== "serial") return { event, round, nextTargets: [] };

		const next = targets.find(target => target.status === "pending" || target.status === "delivered");
		if (!next) return { event, round, nextTargets: [] };
		const memberRecord = this.log.getMember(room.id, next.memberId);
		return { event, round, nextTargets: memberRecord ? [memberRecord] : [] };
	}

	markPass(roomId: string, memberId: string, roundId: string): RoomRound | null {
		const room = this.getRoom(roomId);
		const round = this.log.getRound(roundId);
		if (!round || round.roomId !== room.id) throw new RoomError(`Unknown round "${roundId}"`);
		this.log.setTargetStatus(roundId, memberId, "passed");
		const targets = this.log.listRoundTargets(roundId);
		if (targets.every(target => target.status === "replied" || target.status === "passed")) {
			this.log.setRoundStatus(roundId, "done");
			return { ...round, status: "done" };
		}
		return round;
	}

	stopRound(roomId: string, roundId: string, actor: RoomActor): RoomEvent {
		const room = this.getRoom(roomId);
		const round = this.log.getRound(roundId);
		if (!round || round.roomId !== room.id) throw new RoomError(`Unknown round "${roundId}"`);
		for (const target of this.log.listRoundTargets(roundId)) {
			if (target.status === "pending" || target.status === "delivered") {
				this.log.setTargetStatus(roundId, target.memberId, "failed");
			}
		}
		this.log.setRoundStatus(roundId, "stopped");
		return this.log.appendEvent({
			roomId,
			kind: "stop",
			actor,
			body: "Stopped the current room round.",
			roundId,
			status: "failed",
		});
	}

	markSeen(roomId: string, memberId: string, seq: number): void {
		const room = this.getRoom(roomId);
		const last = this.log.lastEvent(room.id)?.seq ?? 0;
		if (seq < 0 || seq > last) throw new RoomError(`Sequence ${seq} is outside room "${room.name}"`);
		this.log.advanceCursor(room.id, memberId, "seen_through_seq", seq);
		this.log.advanceCursor(room.id, memberId, "read_through_seq", seq);
	}

	markDelivered(roomId: string, memberId: string, seq: number): boolean {
		return this.log.advanceCursor(roomId, memberId, "delivered_through_seq", seq);
	}

	unread(roomId: string, memberId: string): number {
		const room = this.getRoom(roomId);
		const last = this.log.lastEvent(room.id)?.seq ?? 0;
		const cursor = this.log.getCursor(room.id, memberId);
		return Math.max(0, last - cursor.readThroughSeq);
	}

	contacts(roomId: string, statusOf: (memberId: string) => RoomContact["status"]): RoomContact[] {
		const room = this.getRoom(roomId);
		return this.log.listMembers(room.id).map(member => ({
			memberId: member.memberId,
			displayName: member.displayName,
			role: member.role,
			...(member.repoRoot === undefined ? {} : { repoRoot: member.repoRoot }),
			status: statusOf(member.memberId),
			unread: this.unread(room.id, member.memberId),
		}));
	}

	summary(roomId: string, viewerId = "user"): RoomSummary {
		const room = this.getRoom(roomId);
		const last = this.log.lastEvent(room.id);
		return {
			room,
			members: this.log.listMembers(room.id),
			lastSeq: last?.seq ?? 0,
			...(last === null ? {} : { lastEventAt: last.sentAt }),
			unreadByMe: this.unread(room.id, viewerId),
		};
	}

	snapshot(roomId: string, options: { afterSeq?: number; limit?: number; viewerId?: string } = {}): RoomSnapshot {
		const room = this.getRoom(roomId);
		const events = this.log.listEvents(room.id, options);
		const last = this.log.lastEvent(room.id)?.seq ?? 0;
		const unread: Record<string, number> = {};
		for (const member of this.log.listMembers(room.id)) {
			unread[member.memberId] = this.unread(room.id, member.memberId);
		}
		return {
			room,
			members: this.log.listMembers(room.id),
			events,
			lastSeq: last,
			unreadBy: unread,
		};
	}

	createProposal(options: {
		roomId: string;
		actor: RoomActor;
		targetRepo: string;
		targetMemberId?: string;
		decisionId?: string;
		body: string;
	}): { event: RoomEvent; proposal: RoomProposal } {
		const room = this.getRoom(options.roomId);
		const targetRepo = canonicalRepoRoot(options.targetRepo);
		if (!targetRepo) throw new RoomError("A proposal needs a target repository");
		const event = this.log.appendEvent({
			roomId: room.id,
			kind: "proposal",
			actor: options.actor,
			body: options.body.trim(),
			mentions: extractRoomMentions(options.body),
		});
		const proposal = this.log.insertProposal({
			proposalId: `pr_${randomUUID()}`,
			roomId: room.id,
			seq: event.seq,
			targetRepo,
			...(options.targetMemberId === undefined ? {} : { targetMemberId: options.targetMemberId }),
			...(options.decisionId === undefined ? {} : { decisionId: options.decisionId }),
		});
		return { event, proposal };
	}

	/**
	 * Record acceptance. The caller (target agent or user) remains responsible
	 * for writing the target repository's tracking through its existing tool;
	 * this method never edits another repository.
	 */
	respondProposal(options: {
		roomId: string;
		proposalId: string;
		actor: RoomActor;
		accept: boolean;
		decisionId?: string;
		body?: string;
	}): { event: RoomEvent; proposal: RoomProposal } {
		const room = this.getRoom(options.roomId);
		const proposal = this.log.getProposal(options.proposalId);
		if (!proposal || proposal.roomId !== room.id) throw new RoomError(`Unknown proposal "${options.proposalId}"`);
		if (options.actor.id !== "user" && !this.log.getMember(room.id, options.actor.id)) {
			throw new RoomError(`Agent "${options.actor.id}" is not a member of room "${room.name}"`);
		}
		if (
			proposal.targetMemberId !== undefined &&
			options.actor.id !== "user" &&
			options.actor.id !== proposal.targetMemberId
		) {
			throw new RoomError(`Only "${proposal.targetMemberId}" or the user can answer this proposal`);
		}
		const event = this.log.appendEvent({
			roomId: room.id,
			kind: "ack",
			actor: options.actor,
			body: options.body?.trim() || (options.accept ? "Accepted proposal." : "Rejected proposal."),
			replyTo: proposal.seq,
		});
		const resolved = this.log.resolveProposal(
			proposal.proposalId,
			options.accept ? "accepted" : "rejected",
			options.decisionId,
		);
		if (!resolved) throw new RoomError(`Proposal "${options.proposalId}" could not be resolved`);
		return { event, proposal: resolved };
	}
}
