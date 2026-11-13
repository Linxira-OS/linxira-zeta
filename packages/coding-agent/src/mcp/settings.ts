/**
 * Settings declared by this domain (see `config/registry.ts`). Declaration order is the
 * settings-panel order; `config/all-settings.ts` registers every domain.
 */
import { setMcpRenderMarkdownResults } from "@linxiraos/pi-tui/tools/mcp";
import { effect, register } from "../config/registry";

// MCP
export const cfgMcpEnableProjectConfig = register({
	id: "mcp.enableProjectConfig",
	type: "boolean",
	default: true,
	ui: {
		tab: "tools",
		group: "Discovery & MCP",
		label: "MCP Project Config",
		description: "Load .mcp.json/mcp.json from project root",
	},
});

export const cfgMcpPrecedence = register({
	id: "mcp.precedence",
	type: "enum",
	values: ["native", "mcp", "ask"] as const,
	default: "native",
	ui: {
		tab: "tools",
		group: "Discovery & MCP",
		label: "MCP Tool Precedence",
		description:
			"When a native tool and an MCP server provide the same analysis capability, prefer the native tool, prefer the MCP server, or ask through the existing approval path. Disabled native tools never shadow an allowed MCP server.",
		options: [
			{
				value: "native",
				label: "Native first",
				description: "Keep the native tool and mark the same-capability MCP server shadowed.",
			},
			{
				value: "mcp",
				label: "MCP first",
				description: "Mount the MCP server and suppress the overlapping native tools.",
			},
			{
				value: "ask",
				label: "Ask",
				description: "Ask through the existing approval path before mounting the MCP server.",
			},
		],
	},
});

export const cfgMcpStartupTimeoutMs = register({
	id: "mcp.startupTimeoutMs",
	type: "number",
	default: 250,
	ui: {
		tab: "tools",
		group: "Discovery & MCP",
		label: "MCP Startup Window",
		description: "Wait this many milliseconds for initial MCP tool discovery; 0 waits until connections settle",
	},
});

export const cfgMcpRenderMarkdownResults = register({
	id: "mcp.renderMarkdownResults",
	type: "boolean",
	default: true,
	ui: {
		tab: "tools",
		group: "Discovery & MCP",
		label: "MCP Markdown Results",
		description: "Render non-JSON MCP text results as Markdown in the transcript",
	},
});
effect(cfgMcpRenderMarkdownResults, setMcpRenderMarkdownResults);

export const cfgMcpNotifications = register({
	id: "mcp.notifications",
	type: "boolean",
	default: false,
	ui: {
		tab: "tools",
		group: "Discovery & MCP",
		label: "MCP Update Injection",
		description: "Inject MCP resource updates into the agent conversation",
	},
});

export const cfgMcpNotificationDebounceMs = register({
	id: "mcp.notificationDebounceMs",
	type: "number",
	default: 500,
	ui: {
		tab: "tools",
		group: "Discovery & MCP",
		label: "MCP Notification Debounce",
		description:
			"Debounce window in milliseconds for MCP resource updates before injecting them into the conversation",
	},
});
