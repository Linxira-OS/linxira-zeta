import type { SourceMeta } from "../../../capability/types";
import type { ScopeLike } from "../../../config/registry";
import {
	buildAnalysisMcpRefreshInputFromRuntime,
	type AnalysisMcpAdmission,
	type AnalysisMcpConfigSource,
	type AnalysisMcpRefreshInput,
} from "../../../mcp/analysis-precedence-hook";
import type { CustomTool } from "../../../extensibility/custom-tools/types";
import { type LoadMCPConfigsOptions, loadAllMCPConfigs } from "../../../mcp/config";
import type { MCPLoadResult } from "../../../mcp/manager";
import type { McpConnectionStatusEvent } from "../../../mcp/startup-events";
import type { MCPServerConfig } from "../../../mcp/types";

/** Manager methods `/extensions` needs to match `/mcp enable` / `/mcp disable`. */
export interface MCPToggleManager extends AnalysisMcpConfigSource {
	getConnectionStatus(name: string): "connected" | "connecting" | "disconnected";
	getTools(): CustomTool[];
	disconnectServer(name: string): Promise<void>;
	connectServers(
		configs: Record<string, MCPServerConfig>,
		sources: Record<string, SourceMeta>,
		onStatus?: (event: McpConnectionStatusEvent) => void,
	): Promise<Pick<MCPLoadResult, "errors"> | MCPLoadResult>;
}

export interface MCPToggleSession {
	refreshMCPTools(tools: CustomTool[], analysis?: AnalysisMcpRefreshInput): Promise<void> | void;
}

export interface ApplyMcpToggleRuntimeOptions {
	name: string;
	enabled: boolean;
	cwd: string;
	manager?: MCPToggleManager;
	session?: MCPToggleSession;
	settings?: ScopeLike;
	activeNativeTools?: () => readonly string[];
	admission?: AnalysisMcpAdmission;
	/** Same discovery filters as session startup (`sdk.ts` / `/mcp reload`). */
	discovery?: LoadMCPConfigsOptions;
	loadConfigs?: typeof loadAllMCPConfigs;
	onStatus?: (event: McpConnectionStatusEvent) => void;
}

/**
 * After `/extensions` persists an MCP enable/disable, apply the same live
 * connect/disconnect + session tool refresh that `/mcp enable` / `/mcp disable`
 * already do. Config persistence stays in `setMcpServerEnabled`.
 */
export async function applyMcpToggleRuntime(options: ApplyMcpToggleRuntimeOptions): Promise<void> {
	const { name, enabled, cwd, manager, session, discovery, loadConfigs = loadAllMCPConfigs, onStatus } = options;
	if (!manager) return;
	const refresh = async (): Promise<void> => {
		if (!session) return;
		// Pin one snapshot for the precedence decision and the bind.
		const tools = manager.getTools();
		const analysis = options.settings
			? await buildAnalysisMcpRefreshInputFromRuntime({
					manager,
					tools,
					settings: options.settings,
					cwd,
					activeNativeTools: options.activeNativeTools?.() ?? [],
					admission: options.admission,
				})
			: undefined;
		await session.refreshMCPTools(tools, analysis);
	};

	if (!enabled) {
		await manager.disconnectServer(name);
		await refresh();
		return;
	}

	if (manager.getConnectionStatus(name) !== "disconnected") {
		await refresh();
		return;
	}

	const { configs, sources } = await loadConfigs(cwd, discovery);
	const config = configs[name];
	if (!config) {
		await refresh();
		return;
	}
	const source = sources[name];
	await manager.connectServers({ [name]: config }, source ? { [name]: source } : {}, onStatus);
	await refresh();
}
