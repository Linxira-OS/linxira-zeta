/**
 * Studio operations — the versioned plugin page host.
 *
 * Owned operations: `plugins.pages`, `plugins.callTool`.
 *
 * `plugins.pages` reads the gateway's manifest inventory: installed/promoted
 * plugin packages that declare `ui.panels` entries of kind `html`, with the
 * gateway asset URL for each entry. Package paths never cross this boundary.
 *
 * `plugins.callTool` is deliberately narrower than "run any tool": the caller
 * names a plugin id, a tool, and a live session. The operation answers only
 * when that session is alive, the tool is in its active set, the tool is
 * registered by an extension whose source resolves inside that plugin's
 * package root, and the plugin id still resolves to that root. The call then
 * goes through the session's own tool wrapper
 * (`session.getToolByName(tool).execute`), so the approval and `tool_call`
 * paths run exactly as they would for a model turn; this file never reaches
 * an underlying tool directly.
 */
import type { AgentToolContext } from "@linxiraos/pi-agent-core";
import type {
	CommandInput,
	PluginCallToolResult,
	PluginCallToolTextContent,
	PluginPagesReadModel,
	QueryInput,
} from "../contract/index.js";
import { gatewayJson, invalid, optionalString, requiredString, segment, unavailable } from "../gateway.js";
import type { StudioFamily } from "../registry.js";
import { getRpcSession, type AgentSessionWrapper } from "../../web-gateway/agents.js";
import { isPathInsidePluginRoot, resolvePluginRoot } from "../../web-gateway/assets.js";

const PAGES_ROUTE = "/api/plugin-pages";
/** Per-block text cap; keeps one tool result from becoming an unbounded frame. */
const MAX_TEXT = 64 * 1024;
/** Detail traversal bounds: a producer cannot hand over an arbitrary object graph. */
const MAX_DETAIL_DEPTH = 8;
const MAX_DETAIL_ITEMS = 200;
const MAX_DETAIL_STRING = 8 * 1024;

/** JSON-safe, depth/length-bounded copy of a tool's `details`. */
function boundDetails(value: unknown, depth = 0, seen = new Set<object>()): unknown {
	if (value === null) return null;
	if (typeof value === "string") {
		return value.length > MAX_DETAIL_STRING ? value.slice(0, MAX_DETAIL_STRING) : value;
	}
	if (typeof value === "number" || typeof value === "boolean") return value;
	if (typeof value === "bigint") return value.toString();
	if (typeof value !== "object") return undefined;
	if (depth >= MAX_DETAIL_DEPTH) return "[truncated]";
	if (seen.has(value)) return "[circular]";
	seen.add(value);
	try {
		if (Array.isArray(value)) {
			const items = value.slice(0, MAX_DETAIL_ITEMS).map(item => boundDetails(item, depth + 1, seen));
			if (value.length > MAX_DETAIL_ITEMS) items.push("[truncated]");
			return items;
		}
		const out: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value).slice(0, MAX_DETAIL_ITEMS)) {
			const entry = boundDetails(item, depth + 1, seen);
			if (entry !== undefined) out[key] = entry;
		}
		return out;
	} finally {
		seen.delete(value);
	}
}

/** Text blocks from a tool result; non-text blocks never cross the contract. */
function textContent(result: unknown): PluginCallToolTextContent[] {
	if (result === null || typeof result !== "object" || !("content" in result)) return [];
	const content = result.content;
	if (!Array.isArray(content)) return [];
	const blocks: PluginCallToolTextContent[] = [];
	let remaining = MAX_TEXT;
	for (const block of content) {
		if (remaining === 0) break;
		if (block === null || typeof block !== "object") continue;
		const record = block as { type?: unknown; text?: unknown };
		if (record.type !== "text" || typeof record.text !== "string") continue;
		const text = record.text.slice(0, remaining);
		if (text === "") continue;
		blocks.push({ type: "text", text });
		remaining -= text.length;
	}
	return blocks;
}

/** Session lookup seam; production passes the gateway's live-session registry. */
export type PluginSessionLookup = (sessionId: string) => AgentSessionWrapper | undefined;

/**
 * Run one plugin tool call against a live session.
 *
 * `lookup` is injectable so a test can supply a fake wrapper without a live
 * Runtime; production always uses `getRpcSession`.
 */
export async function callPluginTool(
	input: CommandInput<"plugins.callTool">,
	lookup: PluginSessionLookup = getRpcSession,
): Promise<PluginCallToolResult> {
	const plugin = requiredString(input, "plugin");
	const toolName = requiredString(input, "tool");
	const sessionId = optionalString(input, "sessionId");
	if (!sessionId) throw unavailable("plugins.callTool requires a live sessionId");

	const wrapper = lookup(sessionId);
	if (wrapper === undefined || !wrapper.isAlive()) {
		throw unavailable(`session ${sessionId} is not live`);
	}
	const session = wrapper.getSession();
	if (!session.getActiveToolNames().includes(toolName)) {
		throw unavailable(`tool ${toolName} is not active in session ${sessionId}`);
	}

	const runner = session.extensionRunner;
	if (runner === undefined) throw unavailable(`session ${sessionId} has no extension runner`);
	const registered = runner.getRegisteredTool(toolName);
	if (registered === undefined) throw invalid(`unknown tool: ${toolName}`);

	const cwd = session.sessionManager.getCwd();
	const pluginRoot = await resolvePluginRoot(cwd, plugin);
	if (pluginRoot === undefined || pluginRoot.id !== plugin) throw invalid(`unknown plugin: ${plugin}`);
	if (!pluginBelongsToRoot(registered, pluginRoot.root)) {
		throw invalid(`tool ${toolName} is not registered by plugin ${plugin}`);
	}

	const tool = session.getToolByName(toolName);
	if (tool === undefined) throw invalid(`unknown tool: ${toolName}`);

	// Only fields this session already owns; nothing here fabricates an
	// approval, UI, or workspace. The wrapper's own gate consumes `settings`.
	const context = {
		sessionManager: session.sessionManager,
		modelRegistry: session.modelRegistry,
		model: session.model,
		isIdle: () => !session.isStreaming,
		hasQueuedMessages: () => session.queuedMessageCount > 0,
		abort: () => {
			session.agent.abort();
		},
		settings: session.settings,
		cwd,
	} as unknown as AgentToolContext;

	const args: unknown = input.arguments ?? {};
	const result = await tool.execute(
		`plugin-${plugin}-${toolName}-${Date.now()}`,
		args as never,
		undefined,
		undefined,
		context,
	);
	const details =
		result !== null && typeof result === "object" && "details" in result ? boundDetails(result.details) : undefined;
	return { content: textContent(result), ...(details === undefined ? {} : { details }) };
}

/**
 * Whether a registered tool's provenance resolves inside the plugin package.
 *
 * A definition may name its own file (`sourcePath`); extension registrations
 * also carry the extension entry (`extensionPath`, `sourceInfo.path`). Every
 * present candidate must agree with the root, and at least one must resolve
 * there, so a tool cannot opt out of the check by omitting `sourcePath` alone.
 */
function pluginBelongsToRoot(
	registered: {
		readonly definition: { readonly sourcePath?: string };
		readonly extensionPath?: string;
		readonly sourceInfo?: { readonly path?: string };
	},
	root: string,
): boolean {
	const declared = registered.definition.sourcePath;
	if (declared !== undefined && !isPathInsidePluginRoot(declared, root)) return false;
	const provenance = declared ?? registered.extensionPath ?? registered.sourceInfo?.path;
	return provenance !== undefined && isPathInsidePluginRoot(provenance, root);
}

/** `plugins.pages` → the gateway's manifest inventory. */
async function getPluginPages(input: QueryInput<"plugins.pages">): Promise<PluginPagesReadModel> {
	const cwd = input?.cwd?.trim();
	const options = cwd ? { query: `cwd=${segment(cwd)}` } : {};
	return gatewayJson<PluginPagesReadModel>(PAGES_ROUTE, options);
}

export const pluginHostOps: StudioFamily = {
	id: "plugins",
	queries: {
		"plugins.pages": getPluginPages,
	},
	commands: {
		"plugins.callTool": input => callPluginTool(input),
	},
};
