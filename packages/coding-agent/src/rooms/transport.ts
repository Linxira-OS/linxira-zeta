/**
 * Room transport adapter.
 *
 * Reuses the process-global IrcBus (and therefore the mesh for cross-process
 * peers) and the existing AgentRegistry/AgentLifecycleManager. No new wire
 * protocol, mailbox, scheduler, or permission model is introduced: delivery is
 * one host-authored message into an existing queue. A child agent is never
 * given a room-wide broadcast path; replies are routed back through the room
 * host explicitly.
 */

import type { IrcMessage } from "@linxiraos/pi-tui/tools/irc";
import { IrcBus } from "../irc/bus";
import { AgentLifecycleManager } from "../registry/agent-lifecycle";
import { AgentRegistry, type AgentRef } from "../registry/agent-registry";
import { RoomDeliveryCoordinator, type RoomDeliveryOutcome, type RoomDeliveryPort } from "./delivery";
import { RoomError } from "./errors";
import { RoomService } from "./service";
import type { RoomEvent, RoomMember, RoomRound } from "./types";

function normalizeOutcome(value: string): RoomDeliveryOutcome {
	return value === "injected" || value === "woken" || value === "revived" || value === "queued" ? value : "failed";
}

function liveRef(member: RoomMember): AgentRef | undefined {
	const registry = AgentRegistry.global();
	return registry.get(member.memberId) ?? (member.homeSessionId ? registry.get(member.homeSessionId) : undefined);
}

function hostSender(target: AgentRef): AgentRef | undefined {
	const registry = AgentRegistry.global();
	const workspaceMain = target.workspaceId ? registry.workspaceMain(target.workspaceId) : undefined;
	if (workspaceMain && workspaceMain.id !== target.id) return workspaceMain;
	return registry.list().find(ref => ref.kind === "main" && ref.id !== target.id && ref.status !== "aborted");
}

function directMessage(member: RoomMember, body: string): IrcMessage {
	return {
		id: `local-room-${member.roomId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
		from: `room-host:${member.roomId}`,
		to: member.memberId,
		body,
		ts: Date.now(),
	};
}

/** Default delivery into the member's existing session/queue. */
export function createAgentRoomDeliveryPort(): RoomDeliveryPort {
	return {
		async deliver(member, context, event, round) {
			const registry = AgentRegistry.global();
			let ref = liveRef(member);
			if (!ref) {
				return "failed";
			}
			let revived = false;
			if (ref.status === "parked" || ref.status === "aborted") {
				try {
					await AgentLifecycleManager.global().ensureLive(ref.id, {});
					revived = true;
					ref = registry.get(ref.id) ?? ref;
				} catch {
					return "failed";
				}
			}
			if (!ref.session) return "failed";
			const body = markerBody(member, event, round, context);
			const sender = hostSender(ref);
			if (sender) {
				try {
					const receipt = await IrcBus.global().send(
						{ from: sender.id, to: ref.id, body, replyTo: event.eventId },
						{ suppressRelay: true },
					);
					const outcome = normalizeOutcome(receipt.outcome);
					return revived && outcome === "injected" ? "revived" : outcome;
				} catch {
					return "failed";
				}
			}
			try {
				await ref.session.deliverIrcMessage(directMessage(member, body));
				return revived ? "revived" : "injected";
			} catch {
				return "failed";
			}
		},
		async abort(member) {
			const ref = liveRef(member);
			if (!ref) return;
			try {
				const live =
					ref.status === "parked" || ref.status === "aborted"
						? await AgentLifecycleManager.global().ensureLive(ref.id, {})
						: ref.session;
				await live?.abort({ reason: "room round stopped by the operator" });
			} catch {
				// A stopped turn must not keep the round open; the log already records it.
			}
		},
	};
}

function markerBody(member: RoomMember, event: RoomEvent, round: RoomRound, context: string): string {
	return `[local-room:${member.roomId}:${round.roundId}:${event.seq}]\n${context}`;
}

/** One process-wide room service + coordinator used by the host and agent tools. */
let runtime: { rooms: RoomService; coordinator: RoomDeliveryCoordinator } | undefined;

export function roomRuntime(create: () => RoomService = () => RoomService.global()): {
	rooms: RoomService;
	coordinator: RoomDeliveryCoordinator;
} {
	if (!runtime) {
		const rooms = create();
		runtime = { rooms, coordinator: new RoomDeliveryCoordinator(rooms, createAgentRoomDeliveryPort()) };
	}
	return runtime;
}

export function resetRoomRuntimeForTests(): void {
	runtime = undefined;
}

/**
 * The real reply hook used by `local_room_reply` and by host commands.
 * It appends the reply to the same room log and advances a serial round.
 */
export async function recordRoomReply(options: {
	roomId: string;
	memberId: string;
	body: string;
	replyTo?: number;
	roundId?: string;
}): Promise<{ seq: number; next: string[] }> {
	const { rooms, coordinator } = roomRuntime();
	const member = rooms.log.getMember(options.roomId, options.memberId);
	if (!member) throw new RoomError(`Agent "${options.memberId}" is not a member of this room`);
	const result = rooms.postAgentReply({
		roomId: options.roomId,
		actor: { kind: "agent", id: member.memberId, name: member.displayName },
		body: options.body,
		...(options.replyTo === undefined ? {} : { replyTo: options.replyTo }),
		...(options.roundId === undefined ? {} : { roundId: options.roundId }),
	});
	let next: string[] = [];
	if (options.roundId) {
		const delivery = await coordinator.advance(options.roundId);
		next = delivery.deliveries.filter(item => item.accepted).map(item => item.memberId);
	}
	return { seq: result.event.seq, next };
}
