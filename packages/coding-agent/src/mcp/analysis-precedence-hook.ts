/**
 * Hook adapter for session-layer integration.
 *
 * The session refresh path calls this after `tools/list` / a
 * `tools/list_changed` refresh and before binding tools to the session. This
 * file contains no manager import and no approval side effect, so the manager
 * and profile/allowlist code can land independently.
 */
import {
	analysisMcpNativeToolsToSuppress,
	analysisMcpReasons,
	filterAnalysisMcpTools,
	resolveAnalysisMcp,
	type AnalysisMcpApprovalRequest,
	type AnalysisMcpDecision,
	type AnalysisMcpProjectSignals,
	type AnalysisMcpResolveInput,
	type McpPrecedence,
} from "./analysis-precedence";
import type { MCPServerConfig } from "./types";

export interface AnalysisMcpToolLike {
	readonly name: string;
	readonly mcpServerName?: string;
	readonly mcpToolName?: string;
}

export interface AnalysisMcpPrecedenceHook {
	/** Current decisions; recomputed per call by {@link createAnalysisMcpPrecedenceHook}. */
	readonly decisions: readonly AnalysisMcpDecision[];
	/** Keep only tools the current snapshot allows; shadowed/ask servers disappear. */
	filterTools<T extends AnalysisMcpToolLike>(tools: readonly T[]): T[];
	/** Server name -> reason, for `/mcp list` and diagnostics. */
	readonly shadowReasons: Readonly<Record<string, string>>;
	/** Native tools to hide when `mcp` precedence won a same-capability collision. */
	readonly nativeToolsToSuppress: readonly string[];
	/** Pass each request to the host's existing `requestApproval`; never auto-mount. */
	readonly approvalRequests: readonly AnalysisMcpApprovalRequest[];
}

/** Session-layer input: resolver snapshot plus the optional existing-approval adapter. */
export interface AnalysisMcpRefreshInput extends AnalysisMcpResolveInput {
	/** Existing approval path for `ask`; absent means leave the server unmounted. */
	readonly approve?: (request: AnalysisMcpApprovalRequest) => Promise<boolean>;
}

/** Minimal manager surface needed to snapshot configs for mounted tools. */
export interface AnalysisMcpConfigSource {
	getServerConfig(name: string): MCPServerConfig | undefined;
}

/** Minimal profile-admission surface; mirrors `createAgentToolAdmission`. */
export interface AnalysisMcpAdmission {
	allowsMcpTool(name: string, serverName: string | undefined): boolean;
}

export interface BuildAnalysisMcpRefreshInputOptions {
	readonly manager: AnalysisMcpConfigSource;
	readonly tools: readonly AnalysisMcpToolLike[];
	readonly precedence: McpPrecedence;
	readonly activeNativeTools: readonly string[];
	readonly admission?: AnalysisMcpAdmission;
	readonly deniedServers?: readonly string[];
	readonly project?: AnalysisMcpProjectSignals;
	readonly approve?: (request: AnalysisMcpApprovalRequest) => Promise<boolean>;
}

/**
 * Build the session input from the manager/tools snapshot. Callers should pass
 * the tools they are about to bind, not a separately loaded config list.
 */
export function buildAnalysisMcpRefreshInput(
	options: BuildAnalysisMcpRefreshInputOptions,
): AnalysisMcpRefreshInput {
	const configs: Record<string, MCPServerConfig> = {};
	const serverTools: Record<string, string[]> = {};
	for (const tool of options.tools) {
		const serverName = tool.mcpServerName;
		if (!serverName) continue;
		const config = options.manager.getServerConfig(serverName);
		if (config && !(serverName in configs)) configs[serverName] = config;
		if (tool.mcpToolName) {
			(serverTools[serverName] ??= []).push(tool.mcpToolName);
		}
	}
	const allowedTools = options.admission
		? options.tools
				.filter(tool => options.admission?.allowsMcpTool(tool.name, tool.mcpServerName))
				.map(tool => tool.mcpToolName)
				.filter((name): name is string => typeof name === "string")
		: undefined;
	return {
		configs,
		serverTools,
		precedence: options.precedence,
		activeNativeTools: options.activeNativeTools,
		...(allowedTools ? { allowedTools } : {}),
		...(options.deniedServers ? { deniedServers: options.deniedServers } : {}),
		...(options.project ? { project: options.project } : {}),
		...(options.approve ? { approve: options.approve } : {}),
	};
}

/**
 * Build a stateless hook for one snapshot. Session wiring must recreate it for
 * every tool refresh / reconnect so a denied server cannot be resurrected and a
 * newly disabled native tool stops shadowing an allowed MCP server.
 */
export function createAnalysisMcpPrecedenceHook(input: AnalysisMcpResolveInput): AnalysisMcpPrecedenceHook {
	const decisions = resolveAnalysisMcp(input);
	return {
		decisions,
		filterTools: <T extends AnalysisMcpToolLike>(tools: readonly T[]): T[] =>
			filterAnalysisMcpTools(tools, decisions),
		shadowReasons: analysisMcpReasons(decisions),
		nativeToolsToSuppress: analysisMcpNativeToolsToSuppress(decisions),
		approvalRequests: decisions.flatMap(decision => (decision.approval ? [decision.approval] : [])),
	};
}
