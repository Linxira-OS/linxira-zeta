/**
 * Durable Team room delivery.
 *
 * Room events stay in SQLite; this module adds per-subscriber cursors and
 * pushes events to a member's existing live session through `IrcBus` (which
 * uses the process mesh for cross-process peers) or, when the recipient is the
 * host itself, through its `AgentSessionHandle`. There is no watcher, daemon,
 * or second scheduler.
 *
 * Cursor semantics:
 * - `acceptedThrough`: highest seq a real transport/host accepted. A transport
 *   `queued` receipt is not accepted here: the local IrcBus mailbox is
 *   in-memory, so accepting it would lose events on process restart. The mesh's
 *   durable mailbox is retried by the session-start drain.
 * - `readThrough`: the consumer's explicit ack. Delivery never claims the user
 *   read anything.
 * Events drain oldest-first and stop at the first failure, so a later success
 * can never skip an earlier undelivered seq. The CAS advance makes a concurrent
 * drain harmless (duplicate delivery, never a rewind or a gap).
 */

import type { IrcMessage } from "@linxiraos/pi-tui/tools/irc";
import type { AgentRef } from "../registry/agent-registry";
import { AgentRegistry } from "../registry/agent-registry";
import { IrcBus } from "../irc/bus";
import { resolveTeamDbPath, TeamDb, type RoomEventRecord, type RoomRecord, type RoomSubscriptionRecord } from "./db";
import { TeamError } from "./errors";
import { canonicalPath, pathWithin, resolveTeamLocation } from "./paths";
import { resolveTeamSessionOrigin } from "./session-origin";
import { loadContext, type TeamContext, type TeamContextOptions } from "./service";

export type RoomDeliveryOutcome = "injected" | "woken" | "revived" | "queued" | "failed";

export interface RoomDeliveryResult {
	roomId: string;
	agentId: string;
	seq: number;
	outcome: RoomDeliveryOutcome;
	/** True only when a real session/host accepted the event (not `queued`). */
	accepted: boolean;
	error?: string;
}

export interface SubscribeRoomOptions extends TeamContextOptions {
	room: string;
	agent: string;
	/** First unread sequence; defaults to the room's latest event (no backlog). */
	fromSeq?: number;
}

export interface AckRoomOptions extends TeamContextOptions {
	room: string;
	agent: string;
	throughSeq: number;
}

export interface PendingRoomOptions extends TeamContextOptions {
	room: string;
	agent: string;
	limit?: number;
}

function registryRefs(): AgentRef[] {
	return AgentRegistry.global()
		.list()
		.filter(ref => ref.kind !== "advisor" && ref.status !== "aborted");
}

function refCwd(ref: AgentRef): string | undefined {
	return ref.session?.settings?.getCwd();
}

/** Choose the most specific live ref under `dir` (exact cwd wins, then newest). */
function findRefByPath(dir: string): AgentRef | undefined {
	const canonicalDir = canonicalPath(dir);
	const candidates = registryRefs().filter(ref => {
		const cwd = refCwd(ref);
		return cwd !== undefined && pathWithin(canonicalDir, cwd);
	});
	if (candidates.length === 0) return undefined;
	candidates.sort((left, right) => {
		const leftCwd = refCwd(left) ?? "";
		const rightCwd = refCwd(right) ?? "";
		const exact = Number(rightCwd === canonicalDir) - Number(leftCwd === canonicalDir);
		if (exact !== 0) return exact;
		const depth = rightCwd.split(/[\\/]/).length - leftCwd.split(/[\\/]/).length;
		if (depth !== 0) return depth;
		return right.lastActivity - left.lastActivity;
	});
	return candidates[0];
}

/**
 * Resolve a DB member (PM/engineer/Secretary) or an explicitly registered main
 * / relay id to a live session. A Team row id is never sent over IRC itself.
 */
export function resolveRoomDeliveryTarget(db: TeamDb, memberId: string): AgentRef | undefined {
	const direct = AgentRegistry.global().get(memberId);
	if (direct) return direct;
	const pm = db.getPmById(memberId);
	if (pm) return findRefByPath(pm.workspacePath);
	const engineer = db.getEngineerById(memberId);
	if (engineer) {
		const homes = db
			.listWorktrees(engineer.teamId)
			.filter(row => row.engineerId === engineer.id && row.kind === "home");
		const refs = homes
			.map(row => findRefByPath(row.path))
			.filter((ref): ref is AgentRef => ref !== undefined)
			.sort((left, right) => right.lastActivity - left.lastActivity);
		return refs[0];
	}
	const agent = db.getAgentById(memberId);
	return agent ? (AgentRegistry.global().get(agent.id) ?? undefined) : undefined;
}

function eventBody(event: RoomEventRecord, room: RoomRecord, teamId: string): string {
	return `[Team ${teamId} #${room.name} #${event.seq}] ${event.senderAgentId}: ${event.body}`;
}

/** A registered host main is the legal sender; otherwise deliver directly. */
function hostSender(target: AgentRef): AgentRef | undefined {
	const registry = AgentRegistry.global();
	const workspaceMain = registry.workspaceMain(target.workspaceId);
	if (workspaceMain && workspaceMain.id !== target.id) return workspaceMain;
	return registry.list().find(ref => ref.kind === "main" && ref.id !== target.id && ref.status !== "aborted");
}

async function deliverToRef(
	event: RoomEventRecord,
	room: RoomRecord,
	teamId: string,
	ref: AgentRef,
): Promise<RoomDeliveryResult> {
	const body = eventBody(event, room, teamId);
	const host = hostSender(ref);
	if (host) {
		const receipt = await IrcBus.global().send({ from: host.id, to: ref.id, body }, { suppressRelay: true });
		const outcome: RoomDeliveryOutcome = receipt.outcome;
		return {
			roomId: room.id,
			agentId: ref.id,
			seq: event.seq,
			outcome,
			accepted: outcome === "injected" || outcome === "woken" || outcome === "revived",
			...(receipt.error !== undefined && { error: receipt.error }),
		};
	}
	const session = ref.session;
	if (!session) {
		return {
			roomId: room.id,
			agentId: ref.id,
			seq: event.seq,
			outcome: "failed",
			accepted: false,
			error: "No registered host sender and no live session for this agent",
		};
	}
	const message: IrcMessage = {
		id: `team-room-${teamId}-${room.id}-${event.seq}-${Date.now().toString(36)}`,
		from: `team:${teamId}`,
		to: ref.id,
		body,
		ts: Date.now(),
	};
	try {
		const outcome = await session.deliverIrcMessage(message);
		return { roomId: room.id, agentId: ref.id, seq: event.seq, outcome, accepted: true };
	} catch (error) {
		return {
			roomId: room.id,
			agentId: ref.id,
			seq: event.seq,
			outcome: "failed",
			accepted: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Drain one subscription oldest-first. Stops at the first non-accepted event
 * so a failure at N can never advance past N+1.
 */
async function drainSubscription(
	db: TeamDb,
	room: RoomRecord,
	teamId: string,
	subscription: RoomSubscriptionRecord,
	limit?: number,
): Promise<RoomDeliveryResult[]> {
	const results: RoomDeliveryResult[] = [];
	let current = subscription;
	for (;;) {
		const events = db.listRoomEventsAfter(room.id, current.acceptedThrough);
		if (events.length === 0) break;
		const pending = limit === undefined ? events : events.slice(0, limit - results.length);
		if (pending.length === 0) break;
		let advanced = false;
		for (const event of pending) {
			const target = resolveRoomDeliveryTarget(db, current.agentId);
			if (!target) {
				results.push({
					roomId: room.id,
					agentId: current.agentId,
					seq: event.seq,
					outcome: "failed",
					accepted: false,
					error: "No live session for this Team member",
				});
				return results;
			}
			const result = await deliverToRef(event, room, teamId, target);
			results.push(result);
			if (!result.accepted) return results;
			if (db.advanceRoomAccepted(room.id, current.agentId, event.seq)) {
				advanced = true;
			} else {
				const refreshed = db.getRoomSubscription(room.id, current.agentId);
				if (!refreshed || refreshed.acceptedThrough < event.seq) return results;
				current = refreshed;
			}
		}
		const refreshed = db.getRoomSubscription(room.id, current.agentId);
		if (!refreshed) break;
		current = refreshed;
		if (!advanced) break;
		if (limit !== undefined && results.length >= limit) break;
	}
	return results;
}

/**
 * Deliver every pending event to every subscribed member, oldest-first. Called
 * after a room post; a failed/offline member keeps the event for next start.
 */
export async function deliverRoomEvent(event: RoomEventRecord, dbPath?: string): Promise<RoomDeliveryResult[]> {
	const db = new TeamDb(dbPath ?? resolveTeamDbPath());
	try {
		const room = db.getRoomById(event.roomId);
		if (!room) return [];
		const team = db.getTeam(room.teamId);
		if (!team) return [];
		const results: RoomDeliveryResult[] = [];
		for (const subscription of db.listRoomSubscriptions(room.id)) {
			if (event.seq <= subscription.acceptedThrough) continue;
			results.push(...(await drainSubscription(db, room, team.id, subscription)));
		}
		return results;
	} finally {
		db.close();
	}
}

function requireRoom(ctx: TeamContext, name: string): RoomRecord {
	const room = ctx.db.getRoom(ctx.team.id, name);
	if (!room) throw new TeamError(`Unknown room "${name}" in team "${ctx.team.id}"`);
	return room;
}

function requireDeliveryAgent(ctx: TeamContext, room: RoomRecord, agent: string): string {
	const normalized = agent.trim();
	if (!normalized) throw new TeamError("Missing delivery agent");
	const member = ctx.db.getRoomMember(room.id, normalized);
	if (member) return member.agentId;
	if (AgentRegistry.global().get(normalized)) return normalized;
	throw new TeamError(`Agent "${agent}" is not a member of room "${room.name}" and has no live registry entry`);
}

export async function subscribeRoom(options: SubscribeRoomOptions): Promise<RoomSubscriptionRecord> {
	const ctx = await loadContext(options);
	try {
		const room = requireRoom(ctx, options.room);
		const agentId = requireDeliveryAgent(ctx, room, options.agent);
		const latest = ctx.db.getLastRoomEvent(room.id)?.seq ?? 0;
		const fromSeq = options.fromSeq ?? latest;
		if (!Number.isInteger(fromSeq) || fromSeq < 0) throw new TeamError("fromSeq must be a non-negative integer");
		const now = Math.floor(Date.now() / 1000);
		const record: RoomSubscriptionRecord = {
			roomId: room.id,
			agentId,
			acceptedThrough: fromSeq,
			readThrough: fromSeq,
			subscribedAt: now,
			updatedAt: now,
		};
		ctx.db.upsertRoomSubscription(record);
		return ctx.db.getRoomSubscription(room.id, agentId) ?? record;
	} finally {
		ctx.db.close();
	}
}

export async function ackRoom(options: AckRoomOptions): Promise<RoomSubscriptionRecord> {
	const ctx = await loadContext(options);
	try {
		const room = requireRoom(ctx, options.room);
		const agentId = requireDeliveryAgent(ctx, room, options.agent);
		if (!Number.isInteger(options.throughSeq) || options.throughSeq < 0) {
			throw new TeamError("throughSeq must be a non-negative integer");
		}
		const existing = ctx.db.getRoomSubscription(room.id, agentId);
		if (!existing) throw new TeamError(`Agent "${agentId}" is not subscribed to room "${room.name}"`);
		if (options.throughSeq > existing.acceptedThrough) {
			throw new TeamError(
				`Cannot ack #${options.throughSeq}: only #${existing.acceptedThrough} was accepted for delivery`,
			);
		}
		if (!ctx.db.advanceRoomRead(room.id, agentId, options.throughSeq)) {
			const current = ctx.db.getRoomSubscription(room.id, agentId);
			if (!current || current.readThrough < options.throughSeq) {
				throw new TeamError(`Could not ack room "${room.name}" at #${options.throughSeq}`);
			}
			return current;
		}
		return ctx.db.getRoomSubscription(room.id, agentId) ?? existing;
	} finally {
		ctx.db.close();
	}
}

export async function pendingRoomEvents(options: PendingRoomOptions): Promise<RoomEventRecord[]> {
	const ctx = await loadContext(options);
	try {
		const room = requireRoom(ctx, options.room);
		const agentId = requireDeliveryAgent(ctx, room, options.agent);
		const subscription = ctx.db.getRoomSubscription(room.id, agentId);
		if (!subscription) throw new TeamError(`Agent "${agentId}" is not subscribed to room "${room.name}"`);
		const events = ctx.db.listRoomEventsAfter(room.id, subscription.acceptedThrough);
		return options.limit === undefined ? events : events.slice(0, options.limit);
	} finally {
		ctx.db.close();
	}
}

export interface DeliverPendingRoomOptions extends TeamContextOptions {
	/** Live registry id of the starting session. */
	agentId: string;
	/** Session cwd, used to also drain PM/engineer row subscriptions. */
	cwd?: string;
	limit?: number;
}

/**
 * Session-start hook: drain every subscription relevant to `agentId`/`cwd`.
 * Safe to call repeatedly; only accepted receipts advance the cursor, and a
 * failure leaves that subscription's later events pending.
 */
export async function deliverPendingRoomEvents(options: DeliverPendingRoomOptions): Promise<RoomDeliveryResult[]> {
	const dbPath = options.dbPath ?? resolveTeamDbPath();
	const location = options.cwd ? await resolveTeamLocation(options.cwd) : null;
	const teamRoot = options.teamRoot ?? location?.teamRoot;
	if (!teamRoot) return [];
	const ctx = await loadContext({ teamRoot, cwd: options.cwd, dbPath });
	let subscriptions: RoomSubscriptionRecord[];
	try {
		const ids = new Set<string>([options.agentId]);
		if (options.cwd) {
			const origin = resolveTeamSessionOrigin(options.cwd);
			if (origin?.pmId) ids.add(origin.pmId);
			if (origin?.engineerId) ids.add(origin.engineerId);
		}
		const seen = new Set<string>();
		subscriptions = [...ids]
			.flatMap(agentId => ctx.db.listRoomSubscriptionsForAgent(ctx.team.id, agentId))
			.filter(subscription => {
				if (seen.has(subscription.roomId)) return false;
				seen.add(subscription.roomId);
				return true;
			});
	} finally {
		ctx.db.close();
	}
	const results: RoomDeliveryResult[] = [];
	for (const subscription of subscriptions) {
		const db = new TeamDb(dbPath);
		try {
			const room = db.getRoomById(subscription.roomId);
			const team = room ? db.getTeam(room.teamId) : null;
			if (!room || !team) continue;
			results.push(...(await drainSubscription(db, room, team.id, subscription, options.limit)));
		} finally {
			db.close();
		}
	}
	return results;
}

export function listRoomSubscriptions(roomId: string, dbPath?: string): RoomSubscriptionRecord[] {
	const db = new TeamDb(dbPath ?? resolveTeamDbPath());
	try {
		return db.listRoomSubscriptions(roomId);
	} finally {
		db.close();
	}
}
