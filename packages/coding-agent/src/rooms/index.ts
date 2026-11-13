/**
 * Local Super/Repo/Main rooms and resident contacts.
 *
 * Independent of Team DB rooms: the durable log, membership, delivery rounds,
 * and proposal ledger in this directory never read the Team database or a
 * session transcript.
 */
export { RoomLog, resolveRoomsDbPath } from "./db";
export type { AppendEventInput, CreateRoomRecord } from "./db";
export { RoomError, formatRoomError } from "./errors";
export { RoomService } from "./service";
export type {
	AddMemberOptions,
	CreateRoomOptions,
	PostMessageOptions,
	PostMessageResult,
	ReplyResult,
	RoomSnapshot,
} from "./service";
export { buildRoomContext } from "./context";
export type { RoomContextInput } from "./context";
export { RoomDeliveryCoordinator, targetsForDelivery } from "./delivery";
export type { RoomDeliveryOutcome, RoomDeliveryPort, RoomRoundDelivery, RoomTargetDelivery } from "./delivery";
export { createAgentRoomDeliveryPort, recordRoomReply, resetRoomRuntimeForTests, roomRuntime } from "./transport";
export { parkResident, promoteResident, reviveResident } from "./resident";
export type { PromoteResidentOptions, ResidentActionResult } from "./resident";
export type * from "./types";
