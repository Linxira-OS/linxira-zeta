/**
 * Explicit resident membership on top of the existing registry/lifecycle.
 *
 * Promotion is a membership action, never a spawn: the child must already
 * exist and its parent must be a main member of the same room. A room cannot
 * turn a child into a global peer or let it broadcast past its parent.
 * Park/revive call the existing AgentLifecycleManager; this module keeps no
 * second lifecycle.
 */

import { AgentLifecycleManager } from "../registry/agent-lifecycle";
import { AgentRegistry, type AgentStatus } from "../registry/agent-registry";
import { RoomError } from "./errors";
import type { RoomService } from "./service";
import type { RoomMember } from "./types";

export interface PromoteResidentOptions {
	roomId: string;
	agentId: string;
	ownerMemberId?: string;
	displayName?: string;
}

export interface ResidentActionResult {
	readonly agentId: string;
	readonly status: AgentStatus;
}

function childRef(agentId: string) {
	const ref = AgentRegistry.global().get(agentId);
	if (!ref) throw new RoomError(`Agent "${agentId}" is not registered`);
	return ref;
}

/** A resident must be a direct child of a main member; it never inherits a global peer path. */
export function promoteResident(rooms: RoomService, options: PromoteResidentOptions): RoomMember {
	const room = rooms.getRoom(options.roomId);
	const ref = childRef(options.agentId);
	if (ref.kind === "main")
		throw new RoomError("A main agent joins a room directly; resident promotion is for child agents");
	if (!ref.parentId) throw new RoomError(`Agent "${ref.id}" has no parent; promote only an existing child`);
	const parent = rooms.log.getMember(room.id, ref.parentId);
	if (!parent || parent.role !== "main") {
		throw new RoomError(
			`Agent "${ref.id}" is parented by "${ref.parentId}", which is not a main member of room "${room.name}"`,
		);
	}
	if (options.ownerMemberId && options.ownerMemberId !== parent.memberId) {
		throw new RoomError("Only the child's own parent can promote it into this room");
	}
	return rooms.addMember({
		roomId: room.id,
		memberId: ref.id,
		role: "resident",
		displayName: options.displayName?.trim() || ref.displayName,
		...(parent.repoRoot ? { repoRoot: parent.repoRoot } : {}),
		...(ref.sessionFile ? { homeSessionId: ref.id } : {}),
	});
}

export async function parkResident(rooms: RoomService, roomId: string, agentId: string): Promise<ResidentActionResult> {
	const member = rooms.log.getMember(roomId, agentId);
	if (!member || member.role !== "resident") throw new RoomError(`"${agentId}" is not a resident of this room`);
	await AgentLifecycleManager.global().park(agentId);
	return { agentId, status: "parked" };
}

export async function reviveResident(
	rooms: RoomService,
	roomId: string,
	agentId: string,
): Promise<ResidentActionResult> {
	const member = rooms.log.getMember(roomId, agentId);
	if (!member || member.role !== "resident") throw new RoomError(`"${agentId}" is not a resident of this room`);
	await AgentLifecycleManager.global().ensureLive(agentId, {});
	const ref = AgentRegistry.global().get(agentId);
	return { agentId, status: ref?.status ?? "parked" };
}
