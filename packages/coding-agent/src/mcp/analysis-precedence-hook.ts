/**
 * Hook adapter for session-layer integration.
 *
 * The session refresh path calls this after `tools/list` / a
 * `tools/list_changed` refresh and before binding tools to the session. The
 * hook itself has no approval side effect; {@link buildAnalysisMcpRefreshInputFromRuntime}
 * only reads the current runtime snapshot, and the caller's session refresh
 * hands `ask` descriptors to the host's existing `requestApproval` path.
 */
import { getMCPConfigPath } from "@linxiraos/pi-utils";
import type { ScopeLike } from "../config/registry";
import {
	analysisMcpNativeToolsToSuppress,
	analysisMcpReasons,
	filterAnalysisMcpTools,
	inspectProjectAnalysisMcp,
	resolveAnalysisMcp,
	type AnalysisMcpApprovalRequest,
	type AnalysisMcpDecision,
	type AnalysisMcpManifest,
	type AnalysisMcpProjectSignals,
	type AnalysisMcpResolveInput,
	type McpPrecedence,
} from "./analysis-precedence";
import { readDisabledServers } from "./config-writer";
import { cfgMcpPrecedence } from "./settings";
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
	/** Accept a pending ask winner after the host explicitly returns true. */
	approve(serverName: string): void;
}

/** Session-layer input: resolver snapshot plus the optional existing-approval adapter. */
export interface AnalysisMcpRefreshInput extends AnalysisMcpResolveInput {
	/** Existing approval path for `ask`; absent means leave the server unmounted. */
	readonly approve?: (request: AnalysisMcpApprovalRequest) => Promise<boolean>;
}

/**
 * Minimal manager surface needed to snapshot configs for mounted tools.
 * `getAllServerNames` also keeps configured-but-toolless servers in the
 * snapshot; without it only servers that currently expose tools are visible.
 */
export interface AnalysisMcpConfigSource {
	getServerConfig(name: string): MCPServerConfig | undefined;
	getAllServerNames?(): readonly string[];
}

/** Minimal profile-admission surface; mirrors `createAgentToolAdmission`. */
export interface AnalysisMcpAdmission {
	allowsMcpTool(name: string, serverName: string | undefined): boolean;
}

export interface BuildAnalysisMcpRefreshInputOptions {
	readonly manager?: AnalysisMcpConfigSource;
	readonly tools: readonly AnalysisMcpToolLike[];
	readonly precedence: McpPrecedence;
	readonly activeNativeTools: readonly string[];
	readonly admission?: AnalysisMcpAdmission;
	readonly deniedServers?: readonly string[];
	readonly project?: AnalysisMcpProjectSignals;
	readonly manifests?: readonly AnalysisMcpManifest[];
	readonly approve?: (request: AnalysisMcpApprovalRequest) => Promise<boolean>;
}

/**
 * Build the session input from the manager/tools snapshot. Callers should pass
 * the tools they are about to bind, not a separately loaded config list.
 */
export function buildAnalysisMcpRefreshInput(options: BuildAnalysisMcpRefreshInputOptions): AnalysisMcpRefreshInput {
	const configs: Record<string, MCPServerConfig> = {};
	const serverTools: Record<string, string[]> = {};
	// Every configured/discovered server, including one whose tools have not
	// loaded yet, stays configured instead of being misreported as absent.
	for (const serverName of options.manager?.getAllServerNames?.() ?? []) {
		const config = options.manager?.getServerConfig(serverName);
		if (config) configs[serverName] = config;
	}
	for (const tool of options.tools) {
		const serverName = tool.mcpServerName;
		if (!serverName) continue;
		const config = options.manager?.getServerConfig(serverName);
		if (config && !(serverName in configs)) configs[serverName] = config;
		if (tool.mcpToolName) {
			const names = (serverTools[serverName] ??= []);
			if (!names.includes(tool.mcpToolName)) names.push(tool.mcpToolName);
		}
	}
	const allowedServerTools: Record<string, string[]> | undefined = options.admission ? {} : undefined;
	if (options.admission && allowedServerTools) {
		for (const tool of options.tools) {
			if (!tool.mcpServerName || !tool.mcpToolName) continue;
			if (!options.admission.allowsMcpTool(tool.name, tool.mcpServerName)) continue;
			const names = (allowedServerTools[tool.mcpServerName] ??= []);
			if (!names.includes(tool.mcpToolName)) names.push(tool.mcpToolName);
		}
	}
	return {
		configs,
		serverTools,
		precedence: options.precedence,
		activeNativeTools: options.activeNativeTools,
		...(allowedServerTools ? { allowedServerTools } : {}),
		...(options.deniedServers ? { deniedServers: options.deniedServers } : {}),
		...(options.project ? { project: options.project } : {}),
		...(options.manifests ? { manifests: options.manifests } : {}),
		...(options.approve ? { approve: options.approve } : {}),
	};
}

/** The rest of the runtime snapshot the caller owns: manager, settings, cwd. */
export interface AnalysisMcpRuntimeManager extends AnalysisMcpConfigSource {
	getTools(): readonly AnalysisMcpToolLike[];
}

export interface BuildAnalysisMcpRuntimeInputOptions {
	/** Absent when a configuration installs no manager (every server stays unconfigured). */
	readonly manager?: AnalysisMcpRuntimeManager;
	/** Settings scope carrying `mcp.precedence`. */
	readonly settings: ScopeLike;
	readonly cwd: string;
	/** Currently enabled native tools; disabled tools must not shadow an allowed server. */
	readonly activeNativeTools: readonly string[];
	/** Exact tool snapshot the caller will bind after this read. */
	readonly tools?: readonly AnalysisMcpToolLike[];
	readonly admission?: AnalysisMcpAdmission;
	readonly approve?: (request: AnalysisMcpApprovalRequest) => Promise<boolean>;
	readonly deniedServers?: readonly string[];
	readonly project?: AnalysisMcpProjectSignals;
	readonly manifests?: readonly AnalysisMcpManifest[];
	/** Test/host seams; defaults inspect `package.json` + declared markers. */
	readonly inspectProject?: (
		cwd: string,
		manifests?: readonly AnalysisMcpManifest[],
	) => Promise<AnalysisMcpProjectSignals>;
	/** Test/host seams; defaults to the user `disabledServers` list. */
	readonly readDeniedServers?: (cwd: string) => Promise<readonly string[]>;
}

/**
 * Read the real caller snapshot: current tools and configs from the manager,
 * `mcp.precedence` from settings, the enabled native set from the session, the
 * user denylist, and declared project signals. Callers build this immediately
 * before `refreshMCPTools`, so every reconnect / `list_changed` recomputes.
 */
export async function buildAnalysisMcpRefreshInputFromRuntime(
	options: BuildAnalysisMcpRuntimeInputOptions,
): Promise<AnalysisMcpRefreshInput> {
	const precedence = cfgMcpPrecedence.get(options.settings);

	let project = options.project;
	if (!project) {
		try {
			project = await (options.inspectProject ?? inspectProjectAnalysisMcp)(options.cwd, options.manifests);
		} catch {
			// Project metadata is a suggestion only; a read failure still leaves
			// configured servers and their precedence decision intact.
		}
	}

	let deniedServers = options.deniedServers;
	if (!deniedServers) {
		try {
			const read = options.readDeniedServers ?? (cwd => readDisabledServers(getMCPConfigPath("user", cwd)));
			deniedServers = await read(options.cwd);
		} catch {
			// A malformed user config contributes no denylist, matching discovery.
			deniedServers = [];
		}
	}
	const tools = options.tools ?? options.manager?.getTools() ?? [];

	return buildAnalysisMcpRefreshInput({
		...(options.manager ? { manager: options.manager } : {}),
		tools,
		precedence,
		activeNativeTools: options.activeNativeTools,
		...(options.admission ? { admission: options.admission } : {}),
		...(deniedServers ? { deniedServers } : {}),
		...(project ? { project } : {}),
		...(options.manifests ? { manifests: options.manifests } : {}),
		...(options.approve ? { approve: options.approve } : {}),
	});
}

/**
 * Build a stateless hook for one snapshot. Session wiring must recreate it for
 * every tool refresh / reconnect so a denied server cannot be resurrected and a
 * newly disabled native tool stops shadowing an allowed MCP server.
 */
export function createAnalysisMcpPrecedenceHook(input: AnalysisMcpResolveInput): AnalysisMcpPrecedenceHook {
	let decisions = resolveAnalysisMcp(input);
	const approvedServers: string[] = [];
	// Keep this object stable: the session publishes it before awaiting approval.
	const shadowReasons = analysisMcpReasons(decisions);
	return {
		get decisions() {
			return decisions;
		},
		filterTools: <T extends AnalysisMcpToolLike>(tools: readonly T[]): T[] =>
			filterAnalysisMcpTools(tools, decisions),
		shadowReasons,
		get nativeToolsToSuppress() {
			return analysisMcpNativeToolsToSuppress(decisions);
		},
		get approvalRequests() {
			return decisions.flatMap(decision => (decision.approval ? [decision.approval] : []));
		},
		approve(serverName) {
			if (!decisions.some(decision => decision.serverName === serverName && decision.state === "ask")) return;
			approvedServers.push(serverName);
			decisions = resolveAnalysisMcp({ ...input, approvedServers });
			for (const name of Object.keys(shadowReasons)) delete shadowReasons[name];
			Object.assign(shadowReasons, analysisMcpReasons(decisions));
		},
	};
}
