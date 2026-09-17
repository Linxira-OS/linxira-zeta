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
import { type } from "@linxiraos/pi-omptype";
import type { ImControlParams } from "../channels/im-control";
import imControlDescription from "../prompts/tools/im-control.md" with { type: "text" };
import type { ToolSession } from "./index";

const imControlSchema = type({
	operation: type(
		"'list_workspaces' | 'list_sessions' | 'use_session' | 'new_session' | 'rename_session' | 'delete_session' | 'set_language' | 'list_models' | 'set_model' | 'status'",
	).describe("Which IM control intent to execute."),
	"session?": type("string > 0").describe(
		"Session selector for use/rename/delete_session: bare id, {n} list index, or [id].",
	),
	"name?": type("string > 0").describe("Display name for new_session / rename_session."),
	"language?": type("'zh' | 'en'").describe("Reply language for set_language."),
	"provider?": type("string > 0").describe("Provider id from list_models, for set_model."),
	"model?": type("string > 0").describe("Model id from list_models, for set_model."),
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
