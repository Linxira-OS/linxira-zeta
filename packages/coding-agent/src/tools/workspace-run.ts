/**
 * workspace_run — coordinator delegates a subtask to another workspace session.
 *
 * The coordinator agent (default workspace) receives the remote user's
 * messages and uses this tool to fan work out to other repositories' sessions,
 * then summarizes their replies. Only available in web/desktop mode; CLI
 * sessions have no workspace router so isToolAllowed rejects it.
 */

import type { AgentTool, AgentToolResult } from "@linxiraos/pi-agent-core";
import { type } from "@linxiraos/pi-omptype";
import workspaceRunDescription from "../prompts/tools/workspace-run.md" with { type: "text" };
import type { ToolSession } from "./index";

const workspaceRunSchema = type({
	workspace: type("string > 0").describe("Workspace path (absolute) or name registered via @workspace open."),
	task: type("string > 0").describe("Instruction for the sub-agent."),
});

export type WorkspaceRunParams = typeof workspaceRunSchema.infer;

export class WorkspaceRunTool implements AgentTool<typeof workspaceRunSchema> {
	readonly name = "workspace_run";
	readonly approval = "exec" as const;
	readonly label = "Workspace Run";
	readonly summary = "Delegate a subtask to another workspace session";
	readonly description = workspaceRunDescription;
	readonly parameters = workspaceRunSchema;
	readonly strict = true;
	readonly loadMode = "discoverable";

	constructor(private readonly session: ToolSession) {}

	async execute(_id: string, params: WorkspaceRunParams): Promise<AgentToolResult> {
		const run = this.session.workspaceRun;
		if (!run) {
			return {
				content: [
					{
						type: "text",
						text: "workspace_run is not available in this session (CLI mode or no workspace router).",
					},
				],
				isError: true,
			};
		}
		try {
			const { reply } = await run({ workspace: params.workspace, task: params.task });
			return { content: [{ type: "text", text: reply }] };
		} catch (error: unknown) {
			const msg = error instanceof Error ? error.message : String(error);
			return { content: [{ type: "text", text: `workspace_run failed: ${msg}` }], isError: true };
		}
	}
}
