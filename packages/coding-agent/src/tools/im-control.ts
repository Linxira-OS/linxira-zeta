/**
 * im_control — natural-language IM control tool.
 *
 * The coordinator (and every bot session) calls this when the user asks — in
 * any language — to manage workspaces / default-space sessions / reply
 * language / model. Execution maps onto the existing SessionRouter /
 * WebConfig operations in `channels/im-control.ts` (zero model calls); the
 * returned text is relayed verbatim as the final answer.
 */

import type { AgentTool, AgentToolResult } from "@linxiraos/pi-agent-core";
import { type } from "@linxiraos/zeta-schema";
import type { ImControlParams } from "../channels/im-control";
import imControlDescription from "../prompts/tools/im-control.md" with { type: "text" };
import type { ToolSession } from "./index";
import { AgentRegistry, isRootAgentRef } from "../registry/agent-registry";

const imControlSchema = type({
	operation: type(
		"'list_workspaces' | 'list_sessions' | 'use_session' | 'new_session' | 'rename_session' | 'delete_session' | 'set_language' | 'list_models' | 'set_model' | 'status' | 'route_team_room'",
	).describe("Which IM control intent to execute."),
	"session?": type("string > 0").describe(
		"Session selector for use/rename/delete_session: bare id, {n} list index, or [id].",
	),
	"name?": type("string > 0").describe("Display name for new_session / rename_session."),
	"language?": type("'zh' | 'en'").describe("Reply language for set_language."),
	"provider?": type("string > 0").describe("Provider id from list_models, for set_model."),
	"model?": type("string > 0").describe("Model id from list_models, for set_model."),
	"body?": type("string > 0").describe("Owner-authored text to forward once to a Team room."),
	"messageId?": type("string > 0").describe(
		"Source platform message id from a real inbound IM user entry in this transcript.",
	),
	"sourceEntryId?": type("string > 0").describe(
		"Transcript entry id; required when several IM instances use the same messageId.",
	),
	"room?": type("'team' | 'mains'").describe("Team room target; defaults to team. Does not change normal IM routing."),
});

export type ImControlToolParams = typeof imControlSchema.infer;

export class ImControlTool implements AgentTool<typeof imControlSchema> {
	readonly name = "im_control";
	readonly approval = "exec" as const;
	readonly label = "IM Control";
	readonly summary = "Control workspaces, sessions, language and model via natural language";
	readonly description = imControlDescription;
	readonly parameters = imControlSchema;
	readonly strict = true;
	readonly loadMode = "discoverable";

	constructor(private readonly session: ToolSession) {}

	async execute(_id: string, params: ImControlToolParams): Promise<AgentToolResult> {
		if (params.operation === "route_team_room") {
			const id = this.session.getAgentId?.();
			const ref = id ? AgentRegistry.global().get(id) : undefined;
			if (!ref || !isRootAgentRef(ref))
				return {
					content: [{ type: "text", text: "Only the Team's main owner may forward IM to a room." }],
					isError: true,
				};
		}
		const imControl = this.session.imControl;
		if (!imControl) {
			return {
				content: [
					{
						type: "text",
						text: "im_control is not available in this session (CLI mode or no IM relay).",
					},
				],
				isError: true,
			};
		}
		try {
			const result = await imControl(params as unknown as ImControlParams);
			return { content: [{ type: "text", text: result.text }], ...(result.isError ? { isError: true } : {}) };
		} catch (error: unknown) {
			const msg = error instanceof Error ? error.message : String(error);
			return { content: [{ type: "text", text: `im_control failed: ${msg}` }], isError: true };
		}
	}
}
