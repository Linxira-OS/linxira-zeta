import type { AgentTool } from "@linxiraos/pi-agent-core";

export const BUILTIN_TOOL_NAMES = [
	"read",
	"bash",
	"edit",
	"ast_grep",
	"ast_edit",
	"ask",
	"debug",
	"ida",
	"eval",
	"github",
	"tea",
	"glob",
	"grep",
	"find",
	"lsp",
	"checkpoint",
	"rewind",
	"context_notes",
	"canvas",
	"new_context",
	"security_scan",
	"task",
	"wait",
	"todo",
	"board",
	"room_read",
	"local_room_read",
	"local_room_post",
	"local_room_reply",
	"mode",
	"web_search",
	"time",
	"calendar",
	"write",
	"memory_edit",
	"retain",
	"recall",
	"reflect",
	"learn",
	"super_memory",
	"manage_skill",
	"plugin_manager",
	"plugin_inspect",
	"channel_send",
	"workspace_run",
	"im_control",
	"tracking_update",
	"ssh_exec",
] as const;

export type BuiltinToolName = (typeof BUILTIN_TOOL_NAMES)[number];

/**
 * CLI help entry for a built-in: its summary and whether default settings activate it. A
 * `detected` tool needs no setting change but appears only when `detectedWhen` holds.
 */
export type BuiltinToolHelp =
	| { summary: string; defaultState: "on" | "off" }
	| { summary: string; defaultState: "detected"; detectedWhen: string };

/**
 * Keyed by name so a new tool cannot ship without help; `test/tools/builtin-defaults.test.ts` checks
 * `defaultState`. Entry order is CLI help order: most-used tools first, specialized ones last.
 */
export const BUILTIN_TOOL_HELP: Record<BuiltinToolName, BuiltinToolHelp> = {
	read: { summary: "Read files, directories, URLs, archives, and databases", defaultState: "on" },
	edit: { summary: "Edit files in place", defaultState: "on" },
	write: { summary: "Create or overwrite files", defaultState: "on" },
	bash: { summary: "Execute shell commands", defaultState: "on" },
	grep: { summary: "Search file contents by regex", defaultState: "on" },
	glob: { summary: "Find files by glob pattern", defaultState: "on" },
	find: {
		summary: "Find code by describing what it does",
		defaultState: "detected",
		detectedWhen: "a native judge model is available",
	},
	eval: { summary: "Run Python/JS cells; hosts the browser and computer-use helpers", defaultState: "on" },
	task: { summary: "Launch subagents for parallel work", defaultState: "on" },
	wait: { summary: "Wait for background jobs", defaultState: "on" },
	todo: { summary: "Track a todo list", defaultState: "on" },
	ask: { summary: "Ask the user questions (interactive mode only)", defaultState: "on" },
	web_search: { summary: "Search the web", defaultState: "on" },
	lsp: { summary: "Language server queries (code intelligence)", defaultState: "on" },
	ast_edit: { summary: "Rewrite code with AST patterns", defaultState: "on" },
	debug: { summary: "Debug a running process over DAP", defaultState: "on" },
	ida: {
		summary: "Open, edit, and script IDA Pro databases",
		defaultState: "detected",
		detectedWhen: "IDA Pro is installed",
	},
	ast_grep: { summary: "Search code with AST patterns", defaultState: "off" },
	github: { summary: "Query and act on GitHub repositories, issues, and PRs", defaultState: "off" },
	checkpoint: { summary: "Save a git-based checkpoint of session state", defaultState: "off" },
	rewind: { summary: "Rewind to a saved checkpoint", defaultState: "off" },
	context_notes: { summary: "Read or replace the session's persistent context notes", defaultState: "off" },
	new_context: { summary: "Request a fresh context window after the current turn", defaultState: "off" },
	retain: { summary: "Store facts in long-term memory", defaultState: "off" },
	recall: { summary: "Search long-term memory", defaultState: "off" },
	reflect: { summary: "Synthesize an answer from long-term memory", defaultState: "off" },
	memory_edit: { summary: "Edit or forget long-term memories", defaultState: "off" },
	learn: { summary: "Capture reusable lessons in long-term memory", defaultState: "off" },
	manage_skill: { summary: "Create, update, or delete managed skills", defaultState: "off" },
	security_scan: { summary: "Run security scans", defaultState: "off" },
	board: { summary: "Manage the project board", defaultState: "on" },
	calendar: { summary: "Manage project calendar events", defaultState: "on" },
	canvas: { summary: "Create and update canvases", defaultState: "off" },
	channel_send: {
		summary: "Send through configured IM channel bindings",
		defaultState: "detected",
		detectedWhen: "channel delivery is enabled and a host sink is attached",
	},
	workspace_run: {
		summary: "Run work in a configured workspace",
		defaultState: "detected",
		detectedWhen: "workspace execution is enabled and a host sink is attached",
	},
	im_control: {
		summary: "Inspect and control IM bindings",
		defaultState: "detected",
		detectedWhen: "IM control is enabled and a host sink is attached",
	},
	local_room_read: { summary: "Read local room messages", defaultState: "on" },
	local_room_post: { summary: "Post a message to a local room", defaultState: "on" },
	local_room_reply: { summary: "Reply in a local room", defaultState: "on" },
	room_read: { summary: "Read a Super Team room", defaultState: "off" },
	mode: { summary: "Enter or leave a session mode", defaultState: "on" },
	plugin_manager: { summary: "Manage installed plugins", defaultState: "on" },
	plugin_inspect: { summary: "Inspect installed plugins", defaultState: "on" },
	ssh_exec: {
		summary: "Execute commands on a configured SSH host",
		defaultState: "detected",
		detectedWhen: "an SSH host is configured",
	},
	super_memory: { summary: "Manage shared project memory", defaultState: "on" },
	tea: { summary: "Query and act on Gitea repositories", defaultState: "off" },
	time: { summary: "Inspect and control time context", defaultState: "on" },
	tracking_update: { summary: "Update project tracking documents", defaultState: "off" },
};

export const HIDDEN_TOOL_NAMES = ["yield", "goal", "think"] as const;

export type HiddenToolName = (typeof HIDDEN_TOOL_NAMES)[number];

const LEGACY_BUILTIN_TOOL_NAME_ALIASES: ReadonlyMap<string, BuiltinToolName> = new Map([["search", "grep"]]);

const CANONICAL_TOOL_NAMES: Record<string, true> = Object.fromEntries(
	[...BUILTIN_TOOL_NAMES, ...HIDDEN_TOOL_NAMES].map(name => [name, true]),
);

/** Whether `name` is a built-in or hidden built-in tool name (case-insensitive). */
export function isBuiltinToolName(name: string): boolean {
	return Object.hasOwn(CANONICAL_TOOL_NAMES, name.toLowerCase());
}

/**
 * Canonicalize built-in IDs and legacy aliases. Leave plugin names unchanged.
 */

export function normalizeToolName(name: string): string {
	const lower = name.toLowerCase();
	return LEGACY_BUILTIN_TOOL_NAME_ALIASES.get(lower) ?? (Object.hasOwn(CANONICAL_TOOL_NAMES, lower) ? lower : name);
}

/** Normalize and deduplicate tool names while preserving first-seen order. */
export function normalizeToolNames(names: Iterable<string>): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const name of names) {
		const normalized = normalizeToolName(name);
		if (seen.has(normalized)) continue;
		seen.add(normalized);
		out.push(normalized);
	}
	return out;
}

/** The name the model calls tool `name` by (its custom wire name when it declares one), for prompts that reference it. */
export function toolWireName(registry: ReadonlyMap<string, AgentTool>, name: string): string {
	const tool = registry.get(name);
	return typeof tool?.customWireName === "string" ? tool.customWireName : name;
}

/** MCP tool names carry the `mcp__<server>_<tool>` prefix minted by `createMCPToolName`. */
export function isMCPToolName(name: string): boolean {
	return name.startsWith("mcp__");
}
