/**
 * Team rooms: database-only collaboration spaces.
 *
 * A room is a `rooms` row plus `room_members` rows and an ordered
 * `room_events` log. It is never a folder, never a Git repository, and never a
 * session: posting to a room never writes a transcript, so room events cannot
 * leak into session JSONL.
 *
 * The host assigns `seq` (AUTOINCREMENT, monotonic) and `sentAt` (non-decreasing
 * wall clock), so every reader can order a room without trusting the sender.
 * PMs and engineers are the only agents this slice can resolve; membership never
 * invents an agent that has no database row.
 */

import {
	roomRowId,
	ROOM_KINDS,
	type RoomEventRecord,
	type RoomKind,
	type RoomMemberRecord,
	type RoomRecord,
	type RoomSummaryRecord,
} from "./db";
import { AgentRegistry } from "../registry/agent-registry";
import { TeamError } from "./errors";
import { deliverRoomEvent } from "./room-delivery";
import { loadContext, validateSegment, type TeamContext, type TeamContextOptions } from "./service";

/** Newest N events are returned by default; pass `limit` to read more or fewer. */
export const DEFAULT_ROOM_EVENT_LIMIT = 50;

/** Event kinds are lowercase tokens so future producers (system, summary) fit. */
const EVENT_KIND_RE = /^[a-z][a-z0-9-]{0,31}$/;
const MENTION_RE = /(?:^|[^\w@])@([A-Za-z0-9][A-Za-z0-9._:-]*)/g;
const ROLE_PM = "pm";
const ROLE_ENGINEER = "engineer";

/** Accept `#core` as well as `core`; room names carry no folder semantics. */
export function normalizeRoomName(name: string): string {
	return name.trim().replace(/^#+/, "");
}

function requireRoomName(name: string): string {
	const normalized = normalizeRoomName(name);
	if (!normalized) throw new TeamError("Missing room name");
	validateSegment("room name", normalized);
	return normalized;
}

/** Split `--members a,b` (or an API array) into unique, non-empty tokens. */
export function parseRoomMemberTokens(value: string | readonly string[] | undefined): string[] {
	const tokens = typeof value === "string" ? value.split(",") : (value ?? []);
	const seen = new Set<string>();
	const result: string[] = [];
	for (const raw of tokens) {
		const token = raw.trim();
		if (!token || seen.has(token)) continue;
		seen.add(token);
		result.push(token);
	}
	return result;
}

interface ResolvedMember {
	agentId: string;
	role: string;
}

/** Resolve a member token to a registered PM or engineer row. */
function resolveMember(ctx: TeamContext, token: string): ResolvedMember {
	const pmById = ctx.db.getPmById(token);
	if (pmById && pmById.teamId === ctx.team.id) return { agentId: pmById.id, role: ROLE_PM };
	const engineerById = ctx.db.getEngineerById(token);
	if (engineerById && engineerById.teamId === ctx.team.id) {
		return { agentId: engineerById.id, role: ROLE_ENGINEER };
	}
	const agentById = ctx.db.getAgentById(token);
	if (agentById && agentById.teamId === ctx.team.id) {
		return { agentId: agentById.id, role: agentById.role };
	}
	const registered = AgentRegistry.global().get(token);
	if (registered) {
		return { agentId: registered.id, role: registered.kind === "main" ? "relay" : "agent" };
	}

	if (token === "secretary") {
		const secretaries = ctx.db.listAgents(ctx.team.id).filter(agent => agent.role === "secretary");
		if (secretaries.length === 1) return { agentId: secretaries[0].id, role: secretaries[0].role };
		if (secretaries.length > 1) {
			throw new TeamError(`Ambiguous room member "secretary"; use <pm>/secretary or the full agent id`);
		}
	}

	const pm = ctx.db.getPm(ctx.team.id, token);
	if (pm) return { agentId: pm.id, role: ROLE_PM };

	if (token.includes("/")) {
		const parts = token.split("/");
		if (parts.length === 2) {
			if (parts[1] === "secretary") {
				const ownerPm = ctx.db.getPm(ctx.team.id, parts[0]);
				if (ownerPm) {
					const secretary = ctx.db.getAgentForPm(ctx.team.id, ownerPm.id, "secretary");
					if (secretary) return { agentId: secretary.id, role: secretary.role };
				}
			}
			const engineer = ctx.db.getEngineer(ctx.team.id, parts[0], parts[1]);
			if (engineer) return { agentId: engineer.id, role: ROLE_ENGINEER };
		}
	}

	const engineers = ctx.db.listEngineers(ctx.team.id).filter(engineer => engineer.name === token);
	if (engineers.length === 1) return { agentId: engineers[0].id, role: ROLE_ENGINEER };
	if (engineers.length > 1) {
		throw new TeamError(`Ambiguous room member "${token}"; use <pm>/<engineer> or the full agent id`);
	}

	throw new TeamError(
		`Unknown room member "${token}". Use a PM name, an engineer name, <pm>/<engineer>, or a registered agent id.`,
	);
}

function readKind(options: { pm?: string; shared?: boolean; kind?: string }): RoomKind {
	if (options.kind !== undefined && !ROOM_KINDS.includes(options.kind as RoomKind)) {
		throw new TeamError(`Unknown room kind "${options.kind}". Expected: ${ROOM_KINDS.join(", ")}`);
	}
	if (options.shared && options.kind !== undefined && options.kind !== "coordination") {
		throw new TeamError(`--shared creates a coordination room, not a "${options.kind}" room`);
	}
	if (options.shared && options.pm) {
		throw new TeamError(
			"A shared coordination room has no owning PM; drop --pm or create a PM room without --shared",
		);
	}
	if (options.kind !== undefined && options.kind !== "pm" && options.pm) {
		throw new TeamError(`--pm only applies to a pm room, not a "${options.kind}" room`);
	}
	return (options.kind as RoomKind | undefined) ?? (options.shared ? "coordination" : options.pm ? "pm" : "room");
}

export interface CreateRoomOptions extends TeamContextOptions {
	name: string;
	/** Owning PM name for a PM room. */
	pm?: string;
	/** Shorthand for `kind: "coordination"`. */
	shared?: boolean;
	kind?: string;
	/** Explicit members: PM name, engineer name, `<pm>/<engineer>`, or agent id. */
	members?: string | readonly string[];
}

export interface CreateRoomResult {
	room: RoomRecord;
	members: RoomMemberRecord[];
}

export interface AddRoomMemberOptions extends TeamContextOptions {
	room: string;
	member: string;
	role?: string;
}

export interface RemoveRoomMemberOptions extends TeamContextOptions {
	room: string;
	member: string;
}

export interface SetRoomKindOptions extends TeamContextOptions {
	room: string;
	kind: RoomKind;
	pm?: string;
}

/**
 * Create a room. Without `members`, a PM room holds its PM and that PM's
 * engineers, and a coordination room holds every PM and engineer in the team.
 * An arbitrary room starts empty. Explicit members replace those defaults,
 * except that a PM room always keeps its owning PM.
 */
export async function createRoom(options: CreateRoomOptions): Promise<CreateRoomResult> {
	const name = requireRoomName(options.name);
	const kind = readKind(options);
	const ctx = await loadContext(options);
	try {
		if (ctx.db.getRoom(ctx.team.id, name)) {
			throw new TeamError(`Room "${name}" already exists in team "${ctx.team.id}"`);
		}
		let ownerPmId: string | null = null;
		if (kind === "pm") {
			if (!options.pm) throw new TeamError(`A PM room needs --pm <pm>`);
			const pm = ctx.db.getPm(ctx.team.id, options.pm);
			if (!pm) throw new TeamError(`Unknown PM "${options.pm}" in team "${ctx.team.id}"`);
			ownerPmId = pm.id;
		}

		const explicitTokens = parseRoomMemberTokens(options.members);
		const resolved = new Map<string, string>();
		if (ownerPmId) resolved.set(ownerPmId, ROLE_PM);
		for (const token of explicitTokens) {
			const member = resolveMember(ctx, token);
			if (!resolved.has(member.agentId)) resolved.set(member.agentId, member.role);
		}
		if (explicitTokens.length === 0) {
			if (kind === "pm" && ownerPmId) {
				for (const engineer of ctx.db.listEngineers(ctx.team.id).filter(row => row.pmId === ownerPmId)) {
					resolved.set(engineer.id, ROLE_ENGINEER);
				}
				const secretary = ctx.db.getAgentForPm(ctx.team.id, ownerPmId, "secretary");
				if (secretary) resolved.set(secretary.id, secretary.role);
			} else if (kind === "coordination") {
				for (const pm of ctx.db.listPms(ctx.team.id)) resolved.set(pm.id, ROLE_PM);
				for (const engineer of ctx.db.listEngineers(ctx.team.id)) resolved.set(engineer.id, ROLE_ENGINEER);
				for (const agent of ctx.db.listAgents(ctx.team.id)) resolved.set(agent.id, agent.role);
			}
		}

		const room: RoomRecord = {
			id: roomRowId(ctx.team.id, name),
			teamId: ctx.team.id,
			pmId: ownerPmId,
			name,
			kind,
			createdAt: Math.floor(Date.now() / 1000),
		};
		ctx.db.insertRoom(room);
		const members: RoomMemberRecord[] = [];
		try {
			for (const [agentId, role] of resolved) {
				const member: RoomMemberRecord = {
					roomId: room.id,
					agentId,
					role,
					createdAt: room.createdAt,
				};
				ctx.db.insertRoomMember(member);
				members.push(member);
			}
		} catch (error) {
			ctx.db.deleteRoom(room.id);
			throw error;
		}
		return { room, members };
	} finally {
		ctx.db.close();
	}
}

/** Add one resolved PM, engineer, Secretary, or live registered main/relay. */
export async function addRoomMember(options: AddRoomMemberOptions): Promise<RoomMemberRecord> {
	const ctx = await loadContext(options);
	try {
		const room = findRoom(ctx, options.room);
		const member = resolveMember(ctx, options.member);
		if (ctx.db.getRoomMember(room.id, member.agentId)) {
			throw new TeamError(`Agent "${member.agentId}" is already a member of room "${room.name}"`);
		}
		const record: RoomMemberRecord = {
			roomId: room.id,
			agentId: member.agentId,
			role: options.role?.trim() || member.role,
			createdAt: Math.floor(Date.now() / 1000),
		};
		ctx.db.insertRoomMember(record);
		return record;
	} finally {
		ctx.db.close();
	}
}

/** Remove a member; a PM room keeps its owning PM. */
export async function removeRoomMember(options: RemoveRoomMemberOptions): Promise<boolean> {
	const ctx = await loadContext(options);
	try {
		const room = findRoom(ctx, options.room);
		const token = options.member.trim();
		const member =
			ctx.db.getRoomMember(room.id, token) ?? ctx.db.getRoomMember(room.id, resolveMember(ctx, token).agentId);
		if (!member) throw new TeamError(`Agent "${token}" is not a member of room "${room.name}"`);
		if (room.kind === "pm" && room.pmId === member.agentId) {
			throw new TeamError("A PM room cannot remove its owning PM");
		}
		ctx.db.deleteRoomMember(room.id, member.agentId);
		return true;
	} finally {
		ctx.db.close();
	}
}

/** Switch room kind; a pm room restores its owner and membership. */
export async function setRoomKind(options: SetRoomKindOptions): Promise<RoomRecord> {
	if (!ROOM_KINDS.includes(options.kind)) throw new TeamError(`Unknown room kind "${options.kind}"`);
	const ctx = await loadContext(options);
	try {
		const room = findRoom(ctx, options.room);
		if (room.kind === options.kind && (options.kind !== "pm" || room.pmId === options.pm)) return room;
		let pmId: string | null = null;
		if (options.kind === "pm") {
			const token = options.pm ?? (room.pmId ? ctx.db.getPmById(room.pmId)?.name : undefined);
			if (!token) throw new TeamError("A pm room needs --pm <pm>");
			const pm = ctx.db.getPm(ctx.team.id, token);
			if (!pm) throw new TeamError(`Unknown PM "${token}" in team "${ctx.team.id}"`);
			pmId = pm.id;
			if (!ctx.db.getRoomMember(room.id, pm.id)) {
				ctx.db.insertRoomMember({
					roomId: room.id,
					agentId: pm.id,
					role: "pm",
					createdAt: Math.floor(Date.now() / 1000),
				});
			}
		}
		ctx.db.updateRoom(room.id, { kind: options.kind, pmId });
		return { ...room, kind: options.kind, pmId };
	} finally {
		ctx.db.close();
	}
}

/** List rooms with member count and latest event markers. */
export async function listRooms(options: TeamContextOptions): Promise<RoomSummaryRecord[]> {
	const ctx = await loadContext(options);
	try {
		return ctx.db.listRoomSummaries(ctx.team.id);
	} finally {
		ctx.db.close();
	}
}

function findRoom(ctx: TeamContext, requested: string): RoomRecord {
	const name = requireRoomName(requested);
	const room = ctx.db.getRoom(ctx.team.id, name);
	if (!room) throw new TeamError(`Unknown room "${name}" in team "${ctx.team.id}"`);
	return room;
}

function positiveInteger(value: number | undefined, label: string): number | undefined {
	if (value === undefined) return undefined;
	if (!Number.isInteger(value) || value < 1) throw new TeamError(`${label} must be a positive integer`);
	return value;
}

export interface ShowRoomOptions extends TeamContextOptions {
	room: string;
	/** Newest N events, still returned oldest-first. Defaults to 50. */
	limit?: number;
}

export interface RoomView {
	room: RoomRecord;
	members: RoomMemberRecord[];
	events: RoomEventRecord[];
}

/** Members plus the newest events in ascending sequence order. */
export async function showRoom(options: ShowRoomOptions): Promise<RoomView> {
	const limit = positiveInteger(options.limit, "--limit") ?? DEFAULT_ROOM_EVENT_LIMIT;
	const ctx = await loadContext(options);
	try {
		const room = findRoom(ctx, options.room);
		return {
			room,
			members: ctx.db.listRoomMembers(room.id),
			events: ctx.db.listRoomEvents(room.id, limit),
		};
	} finally {
		ctx.db.close();
	}
}

export interface ReadRoomEventsOptions extends TeamContextOptions {
	room: string;
	/** Return only events newer than this sequence number. */
	afterSeq?: number;
	/** Keep only the newest N (still ascending). */
	limit?: number;
}

/** Read API for a future TUI/Studio: ordered events, optionally incremental. */
export async function readRoomEvents(options: ReadRoomEventsOptions): Promise<RoomEventRecord[]> {
	if (options.afterSeq !== undefined && (!Number.isInteger(options.afterSeq) || options.afterSeq < 0)) {
		throw new TeamError("--after-seq must be a non-negative integer");
	}
	const afterSeq = options.afterSeq ?? 0;
	const limit = positiveInteger(options.limit, "--limit");
	const ctx = await loadContext(options);
	try {
		const room = findRoom(ctx, options.room);
		const events = afterSeq ? ctx.db.listRoomEventsAfter(room.id, afterSeq) : ctx.db.listRoomEvents(room.id);
		return limit === undefined ? events : events.slice(-limit);
	} finally {
		ctx.db.close();
	}
}

export interface PostRoomEventOptions extends TeamContextOptions {
	room: string;
	body: string;
	/** Agent id, PM name, engineer name, or `<pm>/<engineer>`; must be a member. */
	sender?: string;
	/** Sequence number of an earlier event in the same room. */
	replyTo?: number;
	/** Event kind; defaults to "message". */
	kind?: string;
}

export interface PostRoomEventResult {
	event: RoomEventRecord;
	room: RoomRecord;
}

function extractMentions(body: string): string[] {
	const mentions = new Set<string>();
	for (const match of body.matchAll(MENTION_RE)) {
		if (match[1]) mentions.add(match[1]);
	}
	return [...mentions];
}

/**
 * Append one room event. The body is trimmed and must be non-empty. The sender
 * must already belong to the room; a PM room defaults the sender to its PM.
 */
export async function postRoomEvent(options: PostRoomEventOptions): Promise<PostRoomEventResult> {
	const body = options.body?.trim() ?? "";
	if (!body) throw new TeamError("Room post body must not be empty");
	const kind = options.kind?.trim() || "message";
	if (!EVENT_KIND_RE.test(kind)) {
		throw new TeamError(`Invalid event kind "${kind}"; use lowercase letters, digits, and "-"`);
	}
	const replyTo = options.replyTo === undefined ? null : (positiveInteger(options.replyTo, "--reply-to") ?? null);
	const ctx = await loadContext(options);
	try {
		const room = findRoom(ctx, options.room);
		let senderAgentId: string;
		if (options.sender) {
			senderAgentId = resolveMember(ctx, options.sender).agentId;
			if (!ctx.db.getRoomMember(room.id, senderAgentId)) {
				throw new TeamError(`Agent "${senderAgentId}" is not a member of room "${room.name}"`);
			}
		} else if (room.pmId) {
			senderAgentId = room.pmId;
			if (!ctx.db.getRoomMember(room.id, senderAgentId)) {
				throw new TeamError(`Room "${room.name}" does not list its PM as a member`);
			}
		} else {
			throw new TeamError(`Missing --sender: room "${room.name}" has no owning PM`);
		}

		if (replyTo !== null) {
			const target = ctx.db.getRoomEvent(replyTo);
			if (!target || target.roomId !== room.id) {
				throw new TeamError(`Reply target #${replyTo} is not an event in room "${room.name}"`);
			}
		}

		const last = ctx.db.getLastRoomEvent(room.id);
		const sentAt = Math.max(Math.floor(Date.now() / 1000), last?.sentAt ?? 0);
		const event = ctx.db.insertRoomEvent({
			roomId: room.id,
			sentAt,
			senderAgentId,
			kind,
			body,
			replyTo,
			mentions: extractMentions(body),
		});
		// Delivery is best-effort: the durable event is already committed and
		// offline subscribers keep their cursor for the next session start.
		await deliverRoomEvent(event, options.dbPath).catch(() => []);
		return { event, room };
	} finally {
		ctx.db.close();
	}
}
