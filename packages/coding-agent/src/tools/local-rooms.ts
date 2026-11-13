/**
 * Local room tools — the agent SDK side of the contacts rooms.
 *
 * These are the real read/post/reply path used by an agent that was delivered a
 * room event: `local_room_reply` calls the same service the host uses, so the
 * reply lands in the durable room log and advances a serial round. They are not
 * dead callbacks or a second transcript.
 */

import type { AgentTool, AgentToolResult } from "@linxiraos/pi-agent-core";
import { ToolError } from "@linxiraos/pi-tui/tools/tool-errors";
import { type } from "@linxiraos/zeta-schema";
import localRoomPostDescription from "../prompts/tools/local-room-post.md" with { type: "text" };
import localRoomReadDescription from "../prompts/tools/local-room-read.md" with { type: "text" };
import localRoomReplyDescription from "../prompts/tools/local-room-reply.md" with { type: "text" };
import { RoomError } from "../rooms/errors";
import { recordRoomReply, roomRuntime } from "../rooms/transport";
import type { RoomEvent } from "../rooms/types";
import type { Tool, ToolSession } from "./index";

export const LOCAL_ROOM_TOOL_NAMES = ["local_room_read", "local_room_post", "local_room_reply"] as const;

const readSchema = type({
	"roomId?": type("string").describe("room id; omit to list rooms"),
	"afterSeq?": type("number >= 0").describe("return only events newer than this sequence"),
	"limit?": type("number > 0").describe("keep only the newest N events"),
});

const postSchema = type({
	roomId: type("string").describe("room id"),
	body: type("string > 0").describe("message body"),
	"mode?": type("'parallel' | 'serial' | 'mention'").describe("delivery mode for a user-triggered round"),
	"mentions?": type("string[]").describe("explicit mention ids; parsed from body when omitted"),
});

const replySchema = type({
	roomId: type("string").describe("room id"),
	body: type("string > 0").describe("reply body"),
	"replyTo?": type("number > 0").describe("seq of the event being answered"),
	"roundId?": type("string").describe("round delivered with the event"),
});

function sender(session: ToolSession): string {
	const id = session.getAgentId?.();
	if (!id) throw new ToolError("This session has no agent identity; a room reply needs one.");
	return id;
}

export class LocalRoomReadTool implements AgentTool<typeof readSchema, { rooms?: unknown[]; events?: RoomEvent[] }> {
	readonly name = "local_room_read";
	readonly label = "Local Room Read";
	readonly description = localRoomReadDescription;
	readonly parameters = readSchema;
	readonly strict = true;
	readonly summary = "List local Super/Repo/Main rooms or read one room's ordered events";
	readonly approval = "read" as const;

	constructor(private readonly session: ToolSession) {}

	async execute(
		_id: string,
		params: typeof readSchema.infer,
	): Promise<AgentToolResult<{ rooms?: unknown[]; events?: RoomEvent[] }>> {
		try {
			const { rooms } = roomRuntime();
			if (!params.roomId) {
				const list = rooms.listRooms();
				return {
					content: [
						{
							type: "text",
							text:
								list.length === 0
									? "No local rooms."
									: list.map(room => `- ${room.id} · ${room.kind} · ${room.name}`).join("\n"),
						},
					],
					details: { rooms: list },
				};
			}
			const snapshot = rooms.snapshot(params.roomId, {
				...(params.afterSeq === undefined ? {} : { afterSeq: params.afterSeq }),
				...(params.limit === undefined ? {} : { limit: params.limit }),
			});
			const lines = [
				`${snapshot.room.kind} room ${snapshot.room.name} (${snapshot.room.id})`,
				`members: ${
					snapshot.members.length === 0
						? "(none)"
						: snapshot.members
								.map(member => `${member.displayName} (${member.memberId}, ${member.role})`)
								.join(", ")
				}`,
				...snapshot.events.map(
					event =>
						`#${event.seq} ${event.sentAt} ${event.actor.name}: ${event.body}${
							event.replyTo === undefined ? "" : ` (reply to #${event.replyTo})`
						}`,
				),
			];
			return { content: [{ type: "text", text: lines.join("\n") }], details: { events: [...snapshot.events] } };
		} catch (error) {
			throw new ToolError(error instanceof RoomError ? error.message : String(error));
		}
	}
}

export class LocalRoomPostTool implements AgentTool<typeof postSchema, { event?: RoomEvent }> {
	readonly name = "local_room_post";
	readonly label = "Local Room Post";
	readonly description = localRoomPostDescription;
	readonly parameters = postSchema;
	readonly strict = true;
	readonly summary = "Post one message to a local room as the current agent";
	readonly approval = "write" as const;

	constructor(private readonly session: ToolSession) {}

	async execute(_id: string, params: typeof postSchema.infer): Promise<AgentToolResult<{ event?: RoomEvent }>> {
		try {
			const memberId = sender(this.session);
			const { rooms } = roomRuntime();
			const member = rooms.log.getMember(params.roomId, memberId);
			if (!member) throw new RoomError(`Agent "${memberId}" is not a member of this room`);
			const posted = rooms.postMessage({
				roomId: params.roomId,
				body: params.body,
				actor: { kind: "agent", id: member.memberId, name: member.displayName },
				...(params.mode === undefined ? {} : { mode: params.mode }),
				...(params.mentions === undefined ? {} : { mentions: params.mentions }),
			});
			return {
				content: [{ type: "text", text: `Posted #${posted.event.seq} to room ${params.roomId}.` }],
				details: { event: posted.event },
			};
		} catch (error) {
			throw new ToolError(error instanceof RoomError ? error.message : String(error));
		}
	}
}

export class LocalRoomReplyTool implements AgentTool<typeof replySchema, { seq: number; next: string[] }> {
	readonly name = "local_room_reply";
	readonly label = "Local Room Reply";
	readonly description = localRoomReplyDescription;
	readonly parameters = replySchema;
	readonly strict = true;
	readonly summary = "Reply into the durable local room log as the current agent";
	readonly approval = "write" as const;

	constructor(private readonly session: ToolSession) {}

	async execute(
		_id: string,
		params: typeof replySchema.infer,
	): Promise<AgentToolResult<{ seq: number; next: string[] }>> {
		try {
			const memberId = sender(this.session);
			const result = await recordRoomReply({
				roomId: params.roomId,
				memberId,
				body: params.body,
				...(params.replyTo === undefined ? {} : { replyTo: params.replyTo }),
				...(params.roundId === undefined ? {} : { roundId: params.roundId }),
			});
			return {
				content: [
					{
						type: "text",
						text: `Replied as #${result.seq}${result.next.length > 0 ? `; next: ${result.next.join(", ")}` : ""}.`,
					},
				],
				details: result,
			};
		} catch (error) {
			throw new ToolError(error instanceof RoomError ? error.message : String(error));
		}
	}
}

export function createLocalRoomTools(session: ToolSession): Tool[] {
	return [new LocalRoomReadTool(session), new LocalRoomPostTool(session), new LocalRoomReplyTool(session)];
}
