/**
 * Room message delivery.
 *
 * This module decides delivery order and recipients only. It never spawns a
 * task or a scheduler: the caller injects into an existing session/IrcBus
 * queue through {@link RoomDeliveryPort}. Per-member cursors make delivery
 * idempotent, and a serial round advances only after the previous reply/pass.
 */

import { buildRoomContext } from "./context";
import { RoomError } from "./errors";
import type { RoomService } from "./service";
import type { Room, RoomDeliveryMode, RoomEvent, RoomMember, RoomRound, RoomRoundTarget } from "./types";

export type RoomDeliveryOutcome = "injected" | "woken" | "revived" | "queued" | "failed";

export interface RoomDeliveryPort {
	/** Inject one event into the member's existing queue/context; never a task spawn. */
	deliver(member: RoomMember, context: string, event: RoomEvent, round: RoomRound): Promise<RoomDeliveryOutcome>;
	/** Stop the member's current turn, if one is running. */
	abort?(member: RoomMember): Promise<void>;
}

export interface RoomTargetDelivery {
	readonly memberId: string;
	readonly seq: number;
	readonly outcome: RoomDeliveryOutcome;
	readonly accepted: boolean;
	readonly detail?: string;
}

export interface RoomRoundDelivery {
	readonly roundId: string;
	readonly deliveries: readonly RoomTargetDelivery[];
}

/** Ordered targets for a fresh round; parallel/mention deliver all, serial one. */
export function targetsForDelivery(targets: readonly RoomRoundTarget[], mode: RoomDeliveryMode): RoomRoundTarget[] {
	const pending = targets.filter(target => target.status === "pending");
	if (mode === "serial") return pending.slice(0, 1);
	return pending;
}

export class RoomDeliveryCoordinator {
	constructor(
		private readonly rooms: RoomService,
		private readonly port: RoomDeliveryPort,
	) {}

	/**
	 * Deliver the round's eligible targets. A member already at or beyond the
	 * trigger seq is skipped, so duplicate calls cannot double-inject.
	 */
	async deliverRound(roundId: string): Promise<RoomRoundDelivery> {
		const round = this.rooms.log.getRound(roundId);
		if (!round || round.status === "stopped") return { roundId, deliveries: [] };
		const room = this.rooms.getRoom(round.roomId);
		const trigger = this.rooms.log.getEvent(room.id, round.triggerSeq);
		if (!trigger) return { roundId, deliveries: [] };
		const allTargets = this.rooms.log.listRoundTargets(roundId);
		const deliveries: RoomTargetDelivery[] = [];
		for (const target of targetsForDelivery(allTargets, round.mode)) {
			deliveries.push(await this.#deliverOne(room, round, trigger, target));
			if (round.mode === "serial") break;
		}
		return { roundId, deliveries };
	}

	/** Deliver the next serial target after a reply/pass; no-op for other modes. */
	async advance(roundId: string): Promise<RoomRoundDelivery> {
		const round = this.rooms.log.getRound(roundId);
		if (!round || round.mode !== "serial" || round.status !== "open") return { roundId, deliveries: [] };
		return this.deliverRound(roundId);
	}

	async #deliverOne(
		room: Room,
		round: RoomRound,
		trigger: RoomEvent,
		target: RoomRoundTarget,
	): Promise<RoomTargetDelivery> {
		const member = this.rooms.log.getMember(room.id, target.memberId);
		if (!member) {
			return {
				memberId: target.memberId,
				seq: trigger.seq,
				outcome: "failed",
				accepted: false,
				detail: "Member is gone",
			};
		}
		const cursor = this.rooms.log.getCursor(room.id, member.memberId);
		if (cursor.deliveredThroughSeq >= trigger.seq) {
			return {
				memberId: member.memberId,
				seq: trigger.seq,
				outcome: "injected",
				accepted: false,
				detail: "Already delivered",
			};
		}
		const context = buildRoomContext({
			room,
			member,
			events: this.rooms.log.listEvents(room.id, { limit: 40 }),
			trigger,
			round,
		});
		const outcome = await this.port.deliver(member, context, trigger, round);
		const accepted = outcome === "injected" || outcome === "woken" || outcome === "revived";
		if (accepted) {
			this.rooms.markDelivered(room.id, member.memberId, trigger.seq);
			this.rooms.log.setTargetStatus(round.roundId, member.memberId, "delivered", { deliveredSeq: trigger.seq });
		}
		return {
			memberId: member.memberId,
			seq: trigger.seq,
			outcome,
			accepted,
			...(accepted ? {} : { detail: "Transport did not accept the message" }),
		};
	}

	/** Stop a round and abort turns that delivery already started. */
	async stop(roundId: string, actor: RoomEvent["actor"]): Promise<RoomEvent> {
		const round = this.rooms.log.getRound(roundId);
		if (!round) throw new RoomError(`Unknown round "${roundId}"`);
		const delivered = this.rooms.log
			.listRoundTargets(roundId)
			.filter(target => target.status === "delivered")
			.map(target => target.memberId);
		const event = this.rooms.stopRound(round.roomId, roundId, actor);
		if (!this.port.abort) return event;
		const room = this.rooms.getRoom(round.roomId);
		for (const memberId of delivered) {
			const member = this.rooms.log.getMember(room.id, memberId);
			if (member) await this.port.abort(member);
		}
		return event;
	}
}
