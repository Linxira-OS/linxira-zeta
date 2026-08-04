import type { AgentTool, AgentToolResult } from "@zeta/pi-agent-core";
import { type } from "@zeta/pi-omptype";
import { M } from "../i18n/messages";
import memoryEditDescription from "../prompts/tools/memory-edit.md" with { type: "text" };
import type { ToolSession } from ".";

const memoryEditSchema = type({
	op: type("'update' | 'forget' | 'invalidate'").describe("memory edit operation"),
	id: type("string").describe("memory id from recall output"),
	"content?": type("string").describe("replacement content for update"),
	"importance?": type("number").describe("replacement importance for update (0–1)"),
	"replacement_id?": type("string").describe("replacement memory id for invalidate"),
});

export type MemoryEditParams = typeof memoryEditSchema.infer;

export class MemoryEditTool implements AgentTool<typeof memoryEditSchema> {
	readonly name = "memory_edit";
	readonly approval = "read" as const;
	readonly label = "Memory Edit";
	readonly description = memoryEditDescription;
	readonly parameters = memoryEditSchema;
	readonly strict = true;
	readonly loadMode = "discoverable";
	readonly summary = "Update, forget, or invalidate Mnemopi memories";

	constructor(private readonly session: ToolSession) {}

	static createIf(session: ToolSession): MemoryEditTool | null {
		const backend = session.settings.get("memory.backend");
		if (backend !== "mnemopi") return null;
		return new MemoryEditTool(session);
	}

	async execute(_id: string, params: MemoryEditParams): Promise<AgentToolResult> {
		const state = this.session.getMnemopiSessionState?.();
		if (!state) {
			throw new Error(M.meErrMnemopiNotInit);
		}
		if (params.op === "update" && params.content === undefined && params.importance === undefined) {
			throw new Error(M.meErrUpdateRequires);
		}

		const importance = params.importance === undefined ? undefined : Math.max(0, Math.min(1, params.importance));
		const result = state.editScopedMemory(params.op, params.id, {
			content: params.content,
			importance,
			replacementId: params.replacement_id,
		});
		const location = result.bank
			? M.meInBankFmt.replace("%s", result.bank) +
				(result.store ? M.meStoreSuffixFmt.replace("%s", result.store) : "")
			: "";
		const text =
			result.status === "not_found"
				? M.meEditNotFoundFmt.replace("%s", params.id).replace("%s", location)
				: result.status === "not_editable"
					? M.meEditReadonlyFmt.replace("%s", params.id).replace("%s", location).replace("%s", params.id)
					: M.meEditStatusFmt.replace("%s", params.id).replace("%s", result.status).replace("%s", location);
		return {
			content: [{ type: "text", text }],
			details: result,
		};
	}
}
