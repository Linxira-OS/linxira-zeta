import type { AgentProfileToolPolicy } from "./types";

/**
 * Admission decisions for one agent-profile runtime.
 *
 * Without a profile every check is `true` (today's behavior). With a profile
 * every list is authoritative: a missing optional list means "none", not
 * "inherit". Keeping this in one object is what makes late `registerTool`
 * calls and MCP refreshes obey the same rules as startup.
 */
export interface AgentToolAdmission {
	readonly hasPolicy: boolean;
	allowsBuiltin(name: string): boolean;
	allowsExtension(identity: string): boolean;
	allowsCustomTool(name: string): boolean;
	allowsMcpServer(name: string): boolean;
	allowsMcpTool(name: string, serverName?: string): boolean;
	allowsSkill(name: string): boolean;
	allowsCommand(name: string): boolean;
}

function nameSet(values: readonly string[] | undefined): Set<string> {
	return new Set((values ?? []).map(value => value.trim()).filter(Boolean));
}

export function createAgentToolAdmission(policy?: AgentProfileToolPolicy): AgentToolAdmission {
	if (!policy) {
		return {
			hasPolicy: false,
			allowsBuiltin: () => true,
			allowsExtension: () => true,
			allowsCustomTool: () => true,
			allowsMcpServer: () => true,
			allowsMcpTool: () => true,
			allowsSkill: () => true,
			allowsCommand: () => true,
		};
	}
	const builtins = nameSet(policy.builtin);
	const extensions = nameSet(policy.extensions);
	const customTools = nameSet(policy.customTools);
	const mcpServers = nameSet(policy.mcpServers);
	const mcpTools = policy.mcpTools === undefined ? undefined : nameSet(policy.mcpTools);
	const skills = nameSet(policy.skills);
	const commands = nameSet(policy.commands);
	return {
		hasPolicy: true,
		allowsBuiltin: name => builtins.has(name),
		allowsExtension: identity => extensions.has(identity),
		allowsCustomTool: name => customTools.has(name),
		allowsMcpServer: name => mcpServers.has(name),
		allowsMcpTool: (name, serverName) => {
			// A profile must never admit an MCP tool whose origin is unknown: a
			// preloaded tool or a lost origin is exactly how an unlisted server
			// would slip in after a reconnect. Unknown origin ⇒ deny.
			if (serverName === undefined || !mcpServers.has(serverName)) return false;
			return mcpTools === undefined ? true : mcpTools.has(name);
		},
		allowsSkill: name => skills.has(name),
		allowsCommand: name => commands.has(name),
	};
}
