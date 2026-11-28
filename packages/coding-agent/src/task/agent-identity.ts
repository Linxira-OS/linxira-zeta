/**
 * Task-boundary model identity resolution.
 *
 * A subagent gets its model from `modelAgents` when that setting names it,
 * with an optional effort and fallback chain. Absent entries keep the legacy
 * source order (`task.agentModelOverrides`, the agent definition, the parent)
 * so existing role/`@task` configuration keeps working. Vibe/Team target names
 * (`worker`, `reviewer`, `secretary`, `pm`) use the same surface.
 */

import { formatModelRoleAlias } from "../config/model-roles";
import type { Settings } from "../config/settings";
import { resolveModelTargetIdentity } from "../session/model-controls";
import type { ToolSession } from "../tools";
import type { ConfiguredThinkingLevel } from "../utils/render-utils";

/** Machine-readable task refusal raised when a deployment scenario cannot be satisfied. */
export const SCENARIO_BOUNDARY_ERROR = "scenario_boundary";

/** A scenario boundary refusal with the details a task result should surface. */
export class TaskScenarioBoundaryError extends Error {
	readonly code = SCENARIO_BOUNDARY_ERROR;

	constructor(
		agentName: string,
		refusal: { readonly scenario: string; readonly boundary: string; readonly reason?: string },
	) {
		const reason = refusal.reason ?? "no candidate model fits the boundary";
		super(
			`${SCENARIO_BOUNDARY_ERROR}: agent "${agentName}" has no model within the "${refusal.boundary}" data boundary required by scenario "${refusal.scenario}" (${reason}). Configure an in-boundary model, remove the agent from modelScenarios.${refusal.scenario}.allowedAgents, or set failClosed: false.`,
		);
		this.name = "TaskScenarioBoundaryError";
	}
}

export interface TaskAgentIdentity {
	/** Explicit `modelAgents` model; absent keeps the legacy source. */
	readonly model?: string;
	/** Mapped role selector for a Vibe/Team target, used only when no legacy override exists. */
	readonly teamModel?: string;
	/** Explicit effort from `modelAgents`; absent keeps the agent/default effort. */
	readonly thinkingLevel?: ConfiguredThinkingLevel;
	/** Presence replaces inherited role/default fallbacks; an empty array disables them. */
	readonly fallback?: readonly string[];
}

/** Resolve the config-plane identity overlay for one task/Vibe spawn. */
export function resolveTaskAgentIdentity(
	settings: Settings,
	agentName: string,
	mode?: string,
	options: { useTeamRole?: boolean } = {},
): TaskAgentIdentity {
	const target = resolveModelTargetIdentity(settings, agentName, mode === undefined ? {} : { mode });
	// Only a virtual Vibe/Team target borrows its mapped role. A real agent
	// definition (reviewer/secretary/worker) keeps its own model source, so
	// adding these targets never reinterprets an existing agent.
	const model = target.source === "agent" ? target.selector : undefined;
	// Resolve through the alias so the child's fallback chain is keyed off the
	// role, even when `modelRoles` assigned that role a concrete selector.
	const teamModel = options.useTeamRole === true ? formatModelRoleAlias(target.role) : undefined;
	// The legacy retry chain stays with the executor's existing inheritance path;
	// every explicitly scoped chain here replaces it for this agent.
	const fallback =
		target.fallbackSource === undefined || target.fallbackSource === "legacy-retry" ? undefined : target.fallback;
	return {
		...(model === undefined ? {} : { model }),
		...(teamModel === undefined ? {} : { teamModel }),
		...(target.thinkingLevel === undefined ? {} : { thinkingLevel: target.thinkingLevel }),
		...(fallback === undefined ? {} : { fallback }),
	};
}

/** Bundled definition a Vibe/Team target reuses when no agent of that name exists. */
export const TEAM_TARGET_BASE_AGENTS = {
	worker: "task",
	reviewer: "reviewer",
	secretary: "secretary",
	pm: "task",
} as const;

export type TaskTeamTarget = keyof typeof TEAM_TARGET_BASE_AGENTS;

/** Base agent definition for a Vibe/Team target, or undefined for a normal agent name. */
export function teamTargetBaseAgent(agentName: string): string | undefined {
	const lowered = agentName.trim().toLowerCase();
	return Object.hasOwn(TEAM_TARGET_BASE_AGENTS, lowered)
		? TEAM_TARGET_BASE_AGENTS[lowered as TaskTeamTarget]
		: undefined;
}

/** Active Vibe mode from a ToolSession, used for `fallbackScopes.mode`. */
export function taskAgentMode(session: ToolSession): string | undefined {
	const host = session as ToolSession & { getVibeModeState?: () => { enabled?: boolean } | undefined };
	return host.getVibeModeState?.()?.enabled === true ? "vibe" : undefined;
}
