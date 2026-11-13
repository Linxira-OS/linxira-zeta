/**
 * `ask` adapter for analysis-MCP precedence.
 *
 * This is the existing tool-approval prompt, not a new MCP security gate: an
 * `ask` descriptor becomes one `requestApproval` call. A host with no usable UI
 * must not mount the server, so callers pass `undefined` for the adapter and
 * the hook keeps the server unmounted. Approval mode (including YOLO) is not
 * consulted here; only the host's normal explicit approval answer mounts.
 */
import type { ExtensionUIContext } from "../extensibility/extensions/types";
import { requestApproval } from "../tools/approval";
import type { AnalysisMcpApprovalRequest } from "./analysis-precedence";

export type AnalysisMcpApprovalUI = Pick<ExtensionUIContext, "select" | "approve">;

/**
 * Build an approval adapter from a host UI context. Returns `undefined` when no
 * UI can answer, which leaves every `ask` server unmounted.
 */
export function createAnalysisMcpApprovalAdapter(
	ui: AnalysisMcpApprovalUI | undefined,
): ((request: AnalysisMcpApprovalRequest) => Promise<boolean>) | undefined {
	if (!ui) return undefined;
	return async request => {
		const subject: Parameters<typeof requestApproval>[1] = {
			name: `mcp__${request.serverName}`,
		};
		const answer = await requestApproval(ui, subject, undefined, {
			reason: request.prompt,
			appendix: [
				`MCP server: ${request.serverName}`,
				`Native equivalent: ${request.nativeTools.join(", ")}`,
				"Approval mounts the MCP server for this session instead of the native tool.",
			],
		});
		return answer !== "deny";
	};
}
