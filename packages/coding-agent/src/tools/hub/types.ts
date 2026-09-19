import { type CoordinationDetails, type HubDetails } from "@linxiraos/pi-tui/tools/hub";
/**
 * Shared types for the hub tool — the merged agent-coordination surface
 * covering peer messaging (IRC bus), background-job control, and supervised
 * long-running processes (launch).
 */

import type { AgentToolResult } from "@linxiraos/pi-agent-core";

export function hubErrorResult(text: string, details: CoordinationDetails): AgentToolResult<HubDetails> {
	return {
		content: [{ type: "text", text }],
		details,
		isError: true,
	};
}
