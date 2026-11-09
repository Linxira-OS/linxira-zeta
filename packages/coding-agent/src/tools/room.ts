/**
 * Lead mode room tools — the PM's coordination surface.
 *
 * Both tools are backed by the real Team database room service: `room_read`
 * lists the team's rooms or shows one room's members and newest events, and
 * `room_post` appends one event as the resolved PM agent. They never write a
 * session transcript; room events live only in `room_events`.
 */

import type { AgentTool, AgentToolResult } from "@linxiraos/pi-agent-core";
import { ToolError } from "@linxiraos/pi-tui/tools/tool-errors";
import { type } from "@linxiraos/zeta-schema";
import roomPostDescription from "../prompts/tools/room-post.md" with { type: "text" };
import roomReadDescription from "../prompts/tools/room-read.md" with { type: "text" };
import { type RoomEventRecord, type RoomMemberRecord, type RoomRecord, type RoomSummaryRecord } from "../team/db";
import { type LeadWorkspace, resolveLeadWorkspace } from "../team/lead";
import { listRooms, normalizeRoomName, postRoomEvent, showRoom } from "../team/rooms";
import type { Tool, ToolSession } from "./index";

export const ROOM_TOOL_NAMES = ["room_read", "room_post"] as const;

const roomReadSchema = type({
	"room?": type("string").describe("room name, with or without the leading #; omit to list rooms"),
	"afterSeq?": type("number > 0").describe("return only events newer than this sequence number"),
	"limit?": type("number > 0").describe("keep only the newest N events (default 50)"),
});

const roomPostSchema = type({
	room: type("string").describe("room name, with or without the leading #"),
	body: type("string > 0").describe("message body; @name mentions are recorded"),
	"replyTo?": type("number > 0").describe("sequence number of an earlier event in the same room"),
});

export type RoomReadParams = typeof roomReadSchema.infer;
export type RoomPostParams = typeof roomPostSchema.infer;

export interface RoomReadDetails {
	action: "list" | "show";
	teamId: string;
	pmId: string;
	rooms?: RoomSummaryRecord[];
	room?: RoomRecord;
	members?: RoomMemberRecord[];
	events?: RoomEventRecord[];
}

export interface RoomPostDetails {
	teamId: string;
	pmId: string;
	room: RoomRecord;
	event: RoomEventRecord;
}

async function workspaceFor(session: ToolSession): Promise<LeadWorkspace> {
	try {
		return await resolveLeadWorkspace(session.cwd);
	} catch (error) {
		throw new ToolError(error instanceof Error ? error.message : String(error));
	}
}

export class RoomReadTool implements AgentTool<typeof roomReadSchema, RoomReadDetails> {
	readonly name = "room_read";
	readonly label = "Room Read";
	readonly description = roomReadDescription;
	readonly parameters = roomReadSchema;
	readonly strict = true;
	readonly summary = "List Team rooms or read one room's members and recent events";
	readonly approval = "read" as const;

	constructor(private readonly session: ToolSession) {}

	async execute(_id: string, params: RoomReadParams): Promise<AgentToolResult<RoomReadDetails>> {
		const workspace = await workspaceFor(this.session);
		const cwd = this.session.cwd;
		const requested = params.room?.trim();
		try {
			if (!requested) {
				const rooms = await listRooms({ cwd });
				const text =
					rooms.length === 0
						? `No rooms exist in team "${workspace.teamId}".`
						: [
								`Rooms in team "${workspace.teamId}":`,
								...rooms.map(room => {
									const owner = room.pmId ? ` pm=${room.pmId}` : "";
									const last = room.lastSeq === null ? "no events" : `last #${room.lastSeq}`;
									return `- #${room.name} (${room.kind}${owner}, ${room.memberCount} member${
										room.memberCount === 1 ? "" : "s"
									}, ${last})`;
								}),
							].join("\n");
				return {
					content: [{ type: "text", text }],
					details: { action: "list", teamId: workspace.teamId, pmId: workspace.pmId, rooms },
				};
			}

			const view = await showRoom({ cwd, room: normalizeRoomName(requested), limit: params.limit });
			const afterSeq = params.afterSeq;
			const events = afterSeq === undefined ? view.events : view.events.filter(event => event.seq > afterSeq);
			const lines = [
				`#${view.room.name} (${view.room.kind}${view.room.pmId ? `, pm=${view.room.pmId}` : ""})`,
				`Members: ${
					view.members.length === 0
						? "(none)"
						: view.members.map(member => `${member.agentId} (${member.role})`).join(", ")
				}`,
				`Events: ${events.length === 0 ? "(none)" : ""}`,
				...events.map(
					event =>
						`#${event.seq} ${new Date(event.sentAt * 1000).toISOString()} ${event.senderAgentId} ${event.kind}: ${event.body}`,
				),
			];
			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: {
					action: "show",
					teamId: workspace.teamId,
					pmId: workspace.pmId,
					room: view.room,
					members: view.members,
					events,
				},
			};
		} catch (error) {
			throw new ToolError(error instanceof Error ? error.message : String(error));
		}
	}
}

export class RoomPostTool implements AgentTool<typeof roomPostSchema, RoomPostDetails> {
	readonly name = "room_post";
	readonly label = "Room Post";
	readonly description = roomPostDescription;
	readonly parameters = roomPostSchema;
	readonly strict = true;
	readonly summary = "Post a message to a Team room as the current PM";
	readonly approval = "write" as const;

	constructor(private readonly session: ToolSession) {}

	async execute(_id: string, params: RoomPostParams): Promise<AgentToolResult<RoomPostDetails>> {
		const workspace = await workspaceFor(this.session);
		try {
			const result = await postRoomEvent({
				cwd: this.session.cwd,
				room: normalizeRoomName(params.room),
				body: params.body,
				sender: workspace.pmId,
				replyTo: params.replyTo,
			});
			return {
				content: [
					{
						type: "text",
						text: `Posted #${result.event.seq} to #${result.room.name} as ${result.event.senderAgentId}.`,
					},
				],
				details: {
					teamId: workspace.teamId,
					pmId: workspace.pmId,
					room: result.room,
					event: result.event,
				},
			};
		} catch (error) {
			throw new ToolError(error instanceof Error ? error.message : String(error));
		}
	}
}

/** Ephemeral Lead mode tools, installed only while the mode is active. */
export function createRoomTools(session: ToolSession): Tool[] {
	return [new RoomReadTool(session), new RoomPostTool(session)];
}
