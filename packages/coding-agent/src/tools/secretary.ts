/**
 * `secretary` — the Lead mode's one narrow handle on the PM-owned persistent
 * Secretary. It is not a general task spawner: no agent name, tools, isolation,
 * or worker flavor is model-selectable.
 */

import type { AgentTool, AgentToolResult, ToolApprovalDecision } from "@linxiraos/pi-agent-core";
import { ToolError } from "@linxiraos/pi-tui/tools/tool-errors";
import { type } from "@linxiraos/zeta-schema";
import secretaryDescription from "../prompts/tools/secretary.md" with { type: "text" };
import type { AgentRecord } from "../team/db";
import { type LeadWorkspace, resolveLeadWorkspace } from "../team/lead";
import { SECRETARY_LABEL, listSecretary, sendSecretary, spawnSecretary, type SecretaryView } from "../team/secretary";
import type { Tool, ToolSession } from "./index";
import { createEngineerSkillTools } from "./engineer-skills";
import { createRoomTools } from "./room";

const secretarySchema = type({
	action: type("'spawn' | 'send' | 'list'").describe("spawn, message, or inspect the PM's Secretary"),
	"prompt?": type("string > 0").describe("first instruction for spawn"),
	"message?": type("string > 0").describe("follow-up instruction for send"),
});

export type SecretaryParams = typeof secretarySchema.infer;

export interface SecretaryToolDetails {
	action: SecretaryParams["action"];
	teamId: string;
	pmId: string;
	record?: AgentRecord;
	liveStatus?: string;
	created?: boolean;
	output?: string;
}

function viewText(view: SecretaryView | null): string {
	if (!view) return "This PM has no Secretary yet. Use `secretary spawn`.";
	const { record, live } = view;
	const lines = [
		`${SECRETARY_LABEL}: ${record.id}`,
		`owner PM: ${record.pmId}`,
		`role: ${record.role} · persistence: ${record.persistence} · state: ${record.state}`,
		`session: ${record.sessionFile ?? "(not recorded)"}`,
	];
	if (live) lines.push(`runtime: ${live.status}`);
	if (view.output?.trim()) lines.push("", view.output.trim());
	return lines.join("\n");
}

export class SecretaryTool implements AgentTool<typeof secretarySchema, SecretaryToolDetails> {
	readonly name = "secretary";
	readonly label = "Secretary";
	readonly description = secretaryDescription;
	readonly parameters = secretarySchema;
	readonly strict = true;
	readonly summary = "Spawn, message, or inspect the PM's one persistent Secretary";
	readonly approval = (args: unknown): ToolApprovalDecision => {
		if (args !== null && typeof args === "object" && "action" in args && args.action === "list") return "read";
		return "exec";
	};

	constructor(private readonly session: ToolSession) {}

	async execute(_id: string, params: SecretaryParams): Promise<AgentToolResult<SecretaryToolDetails>> {
		let workspace: LeadWorkspace;
		try {
			workspace = await resolveLeadWorkspace(this.session.cwd);
		} catch (error) {
			throw new ToolError(error instanceof Error ? error.message : String(error));
		}
		try {
			let view: SecretaryView | null;
			switch (params.action) {
				case "spawn":
					view = await spawnSecretary(
						this.session,
						workspace,
						params.prompt?.trim() ||
							"Read the team rooms and report what needs the PM's attention. Record anything scheduled for today.",
					);
					break;
				case "send":
					if (!params.message?.trim()) throw new ToolError("secretary send requires a message.");
					view = await sendSecretary(this.session, workspace, params.message.trim());
					break;
				case "list":
					view = listSecretary(this.session, workspace);
					break;
			}
			const details: SecretaryToolDetails = {
				action: params.action,
				teamId: workspace.teamId,
				pmId: workspace.pmId,
				...(view
					? {
							record: view.record,
							...(view.live === undefined ? {} : { liveStatus: view.live.status }),
							...(view.created === undefined ? {} : { created: view.created }),
							...(view.output === undefined ? {} : { output: view.output }),
						}
					: {}),
			};
			return { content: [{ type: "text", text: viewText(view) }], details };
		} catch (error) {
			throw new ToolError(error instanceof Error ? error.message : String(error));
		}
	}
}

/** Lead mode's coordination tools: rooms, the Secretary handle, and engineer skills. */
export function createLeadTools(session: ToolSession): Tool[] {
	return [...createRoomTools(session), new SecretaryTool(session), ...createEngineerSkillTools(session)];
}
