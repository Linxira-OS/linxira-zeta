/**
 * Settings declared by this domain (see `config/registry.ts`). Declaration order is the
 * settings-panel order; `config/all-settings.ts` registers every domain.
 */
import { register } from "../config/registry";

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

export const cfgMcpShared = register({
	id: "mcp.shared",
	type: "boolean",
	default: true,
	ui: {
		tab: "tools",
		group: "Discovery & MCP",
		label: "Shared MCP Servers",
		description:
			"Run MCP servers through the daemon so every zetacode instance shares one process per server and a cached tool catalog. Servers that hold a session keep one process per instance (falls back to private servers when unavailable)",
	},
});

export const cfgMcpIdleStopMinutes = register({
	id: "mcp.idleStopMinutes",
	type: "number",
	default: 5,
	ui: {
		tab: "tools",
		group: "Discovery & MCP",
		label: "MCP Idle Stop",
		description: "Stop a shared MCP server after this many minutes without use; it restarts on the next request",
	},
});

export const cfgMcpEvalNamespaces = register({
	id: "mcp.evalNamespaces",
	type: "boolean",
	default: false,
	ui: {
		tab: "tools",
		group: "Discovery & MCP",
		label: "MCP Eval Namespaces",
		description:
			"Expose each MCP server as an eval global (github.create_issue(...)) instead of top-level tools or tool commands",
	},
});

export const cfgMcpBuiltinTransforms = register({
	id: "mcp.builtinTransforms",
	type: "boolean",
	default: true,
	ui: {
		tab: "tools",
		group: "Discovery & MCP",
		label: "MCP Built-in Transforms",
		description:
			"Skip recognized MCP servers that omp's own tools replace (Codex's node_repl while eval runs JavaScript)",
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
