/**
 * Agent profile: the per-runtime tool/persona/memory contract.
 *
 * A profile is a *configuration template*; a runtime is one conversation's
 * materialization. Two chats that reuse the same profile still get distinct
 * runtime ids, memory namespaces, plugin storage, and approval caches. The
 * binding id is part of the runtime identity for exactly that reason.
 *
 * The SDK treats a present `AgentProfileOptions` as an admission policy:
 *   - `builtin` is the whole built-in tool set (`[]` = none);
 *   - `extensions`/`mcpServers` are allowlists (`[]` = none);
 *   - omitted `customTools`/`skills`/`commands` mean none, never "ambient".
 * There is no capability object: the allowlist is the only policy.
 */

export type AgentProfileApprovalMode = "always-ask" | "write" | "yolo";

export type AgentProfileMemoryBackend = "off" | "local" | "hindsight" | "mnemopi" | "sharpshooter";

export interface AgentProfileToolPolicy {
	/** Built-in tool allowlist; `[]` constructs no built-in tools. */
	builtin: readonly string[];
	/** Extension/plugin allowlist; `[]` loads no extension module. */
	extensions: readonly string[];
	/** Custom-tool allowlist; omitted or `[]` loads none in profile mode. */
	customTools?: readonly string[];
	/** MCP server allowlist; `[]` connects no server. */
	mcpServers: readonly string[];
	/** Optional exact MCP tool names within the allowed servers. */
	mcpTools?: readonly string[];
	/** Skill allowlist; omitted or `[]` exposes none in profile mode. */
	skills?: readonly string[];
	/** Extension command allowlist; omitted or `[]` exposes none in profile mode. */
	commands?: readonly string[];
	/** Approval mode for this runtime; omitted keeps the product default (yolo). */
	approvalMode?: AgentProfileApprovalMode;
}

export interface AgentProfilePersona {
	/** Replaces the rendered system prompt. */
	systemPrompt?: string;
	/** Appended to the rendered system prompt. */
	appendSystemPrompt?: string;
}

/** Options accepted by `createAgentSession` / `startRpcSession`. */
export interface AgentProfileOptions {
	profileId: string;
	/** `im:<instanceId>:<profileId>:<bindingId>` for IM; any stable id otherwise. */
	agentRuntimeId: string;
	toolPolicy: AgentProfileToolPolicy;
	persona?: AgentProfilePersona;
	/** Keys local memory roots, Mnemopi/hindsight banks, and taste scopes. */
	memoryNamespace?: string;
	/** Selects the memory backend for this session, overriding the settings layer. */
	memoryBackend?: AgentProfileMemoryBackend;
	/** Per-runtime plugins root for host-managed plugin storage. */
	pluginHome?: string;
	/** Per-runtime approval cache directory. */
	approvalCacheDir?: string;
	/** Exact model selector (`provider/model`). */
	model?: string;
	/** Thinking selector (e.g. `high`). */
	thinkingLevel?: string;
	/** Inherit workspace AGENTS.md/PERSONA.md. Profile sessions default to false. */
	workspaceContext?: boolean;
}

/** Profile file shape consumed by {@link resolveImAgentProfileRuntime}. */
export interface ImAgentProfileConfig {
	id: string;
	label?: string;
	persona?: { mode: "file" | "inline" | "workspace"; file?: string; text?: string };
	model?: { provider: string; model: string };
	tools: {
		builtin: readonly string[];
		extensions: readonly string[];
		customTools?: readonly string[];
		mcpServers: readonly string[];
		mcpTools?: readonly string[];
		skills?: readonly string[];
		commands?: readonly string[];
		approvalMode?: AgentProfileApprovalMode;
	};
	memory?: {
		backend?: AgentProfileMemoryBackend;
		namespace?: string;
		workspaceContext?: boolean;
	};
}

export interface ImAgentProfileRuntimeContext {
	instanceId: string;
	profileId: string;
	/** Stable per conversation key; two chats never share runtime state. */
	bindingId: string;
	agentDir: string;
	cwd: string;
	/** Already-loaded persona text for `mode: "file"` / `"inline"`. */
	personaText?: string;
}

export interface ImAgentProfileRuntimeOptions extends AgentProfileOptions {
	agentHome: string;
	pluginHome: string;
	approvalCacheDir: string;
	memoryNamespace: string;
	cwd: string;
	model?: string;
}
