/**
 * Role-reference checks used before deleting/renaming a custom purpose role.
 *
 * A custom role is referenced by an agent definition's `model` list or by the
 * `task.agentModelOverrides` overlay. Deleting the role without clearing those
 * leaves the agent pointing at a missing role; the runtime must surface that
 * explicitly instead of silently falling back to `default`.
 */
export interface AgentRoleReferenceRow {
	readonly name: string;
	/** Agent definition `model` selectors (`@role`, `pi/role`, or exact). */
	readonly model?: ReadonlyArray<string> | undefined;
}

/** Role alias selectors that name `roleId`, with an optional thinking suffix. */
export function roleAliasTokens(roleId: string): string[] {
	return [`@${roleId}`, `pi/${roleId}`];
}

/** Whether a selector is exactly this role alias (an optional `:thinking` suffix is allowed). */
export function selectorNamesRole(selector: string | undefined, roleId: string): boolean {
	const value = selector?.trim();
	if (!value) return false;
	for (const token of roleAliasTokens(roleId)) {
		if (value === token || value.startsWith(`${token}:`)) return true;
	}
	return false;
}

/** Names of agents whose definition or per-agent override references `roleId`. */
export function findAgentRoleReferences(
	agents: ReadonlyArray<AgentRoleReferenceRow>,
	overrides: Readonly<Record<string, unknown>>,
	roleId: string,
): string[] {
	const names: string[] = [];
	for (const agent of agents) {
		const rawOverride = overrides[agent.name];
		const override = typeof rawOverride === "string" ? rawOverride : undefined;
		if (
			selectorNamesRole(override, roleId) ||
			(agent.model ?? []).some(selector => selectorNamesRole(selector, roleId))
		) {
			names.push(agent.name);
		}
	}
	return names.sort((left, right) => left.localeCompare(right));
}

/** Names of `modelRoles` keys whose selector delegates to this role alias. */
export function findRoleAssignmentReferences(roles: Readonly<Record<string, unknown>>, roleId: string): string[] {
	const names: string[] = [];
	for (const [name, value] of Object.entries(roles)) {
		if (typeof value === "string" && selectorNamesRole(value, roleId)) names.push(name);
	}
	return names.sort((left, right) => left.localeCompare(right));
}
