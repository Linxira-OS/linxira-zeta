/**
 * Engineer-session skill injection.
 *
 * When a session opens inside an engineer worktree, the PM's assignments are
 * resolved against that session's discovered skills and each assigned skill is
 * injected as a hidden autoload prompt (the same mechanic subagents use for
 * `autoloadSkills`). Sessions created before the assignment only see it after
 * `/reload-skills` or a restart: there is no hot reload.
 *
 * Injection is idempotent per transcript: a skill whose autoload prompt is
 * already present is not injected again on resume. Removal stops future
 * injections; it cannot retract content already in the transcript.
 */

import { cfgTeamSkillAllowlist } from "../team/settings";
import {
	isSkillOperatorApproved,
	loadEngineerAssignments,
	resolveEngineerSkillContext,
	skillProvider,
	skillQualifiedName,
	skillRisk,
} from "../team/engineer-skills";
import { buildSkillPromptMessage, type Skill } from "../extensibility/skills";
import type { Settings } from "../config/settings";
import type { SessionEntry } from "./session-entries";
import { type CustomMessagePayload, SKILL_PROMPT_MESSAGE_TYPE } from "./messages";

/** The session surface injection needs; `AgentSession` satisfies it. */
export interface EngineerSkillInjectionSession {
	sessionManager: {
		getCwd(): string;
		getEntries(): readonly SessionEntry[];
	};
	skills: readonly Skill[];
	settings: Settings;
	sendCustomMessage(message: CustomMessagePayload, options?: { triggerTurn?: boolean }): Promise<boolean>;
}

export interface EngineerSkillInjectionResult {
	/** Engineer whose assignments were considered; absent outside a worktree. */
	engineerId?: string;
	/** Skills injected by this call. */
	applied: string[];
	/** Assigned skills already present in the transcript. */
	alreadyLoaded: string[];
	/** Assigned skills the session's discovery no longer exposes. */
	missing: string[];
	/** High-risk assignments the operator allowlist does not cover. */
	blocked: string[];
}

function emptyResult(): EngineerSkillInjectionResult {
	return { applied: [], alreadyLoaded: [], missing: [], blocked: [] };
}

/** Skills already injected into this transcript, by their skill name. */
function injectedSkillNames(session: EngineerSkillInjectionSession): Set<string> {
	const names = new Set<string>();
	for (const entry of session.sessionManager.getEntries()) {
		if (entry.type !== "custom_message" || entry.customType !== SKILL_PROMPT_MESSAGE_TYPE) continue;
		const details = entry.details;
		if (details === null || typeof details !== "object" || !("name" in details)) continue;
		const name = details.name;
		if (typeof name === "string" && name) names.add(name);
	}
	return names;
}

/**
 * Inject the engineer's assigned skills into this session.
 *
 * Safe to call at session creation and after `/reload-skills`; repeated calls
 * only add skills that are not already in the transcript.
 */
export async function applyEngineerSkillAssignments(
	session: EngineerSkillInjectionSession,
	options: { dbPath?: string; allowlist?: readonly string[] } = {},
): Promise<EngineerSkillInjectionResult> {
	const context = resolveEngineerSkillContext(session.sessionManager.getCwd(), { dbPath: options.dbPath });
	if (!context) return emptyResult();
	const assignments = loadEngineerAssignments(context.engineerId, { dbPath: options.dbPath });
	if (assignments.length === 0) return { ...emptyResult(), engineerId: context.engineerId };

	const allowlist = options.allowlist ?? cfgTeamSkillAllowlist.get(session.settings);
	const discovered = new Map<string, Skill>();
	for (const skill of session.skills) discovered.set(skillQualifiedName(skill), skill);
	const injected = injectedSkillNames(session);

	const result: EngineerSkillInjectionResult = { ...emptyResult(), engineerId: context.engineerId };
	for (const assignment of assignments) {
		const skill = discovered.get(assignment.qualifiedName);
		if (!skill) {
			result.missing.push(assignment.skillName);
			continue;
		}
		if (skill.hide === true) {
			result.blocked.push(`${skill.name} (hidden)`);
			continue;
		}
		if (skillRisk(skill) === "high" && !isSkillOperatorApproved(allowlist, skill)) {
			result.blocked.push(`${skillProvider(skill)}:${skill.name}`);
			continue;
		}
		if (injected.has(skill.name)) {
			result.alreadyLoaded.push(skill.name);
			continue;
		}
		const { message, details } = await buildSkillPromptMessage(skill, { args: "" }, "autoload");
		await session.sendCustomMessage(
			{
				customType: SKILL_PROMPT_MESSAGE_TYPE,
				content: message,
				display: false,
				details: { name: details.name, path: details.path },
				attribution: "agent",
			},
			{ triggerTurn: false },
		);
		injected.add(skill.name);
		result.applied.push(skill.name);
	}
	return result;
}
