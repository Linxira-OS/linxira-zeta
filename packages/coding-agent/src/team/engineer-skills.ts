/**
 * PM → engineer skill assignment (Team).
 *
 * A PM may assign skills to engineers it owns. An assignment is a database row
 * that references a discovered skill by name and source — never a filesystem
 * path — so the Lead tool cannot inject arbitrary files or hidden skills.
 *
 * Injection is a session-start concern: an engineer session (its home or task
 * worktree) reads the rows and autoloads the matching discovered skills. A live
 * engineer does not hot-reload assignments; `/reload-skills` or a restart is
 * required (see `session/engineer-skills.ts`).
 *
 * High-risk skills (plugin and registry sources, which can ship hooks, tools,
 * and other code) require an operator-approved allowlist entry
 * (`team.skillAllowlist`). Authored/official/read-only skills are allowed by
 * default. Every row records `assigned_by` and `created_at` for audit.
 */

import * as fs from "node:fs";
import { OFFICIAL_SKILLS_PROVIDER_ID } from "../capability/skill";
import type { TeamSessionOrigin } from "../session/session-origin";
import { type AgentSkillRecord, type EngineerRecord, resolveTeamDbPath, TeamDb } from "./db";
import { TeamError } from "./errors";
import { pathWithin } from "./paths";
import { resolveTeamSessionOrigin } from "./session-origin";

/** Structural skill shape: the loader's `Skill` satisfies it. */
export interface SkillLike {
	name: string;
	/** `<provider>:<level>` as produced by the skill loader. */
	source: string;
	/** Hidden/manual-only skills are not assignable (no hidden injection). */
	hide?: boolean;
	_source?: { provider?: string };
}

/**
 * Providers whose skills can arrive with executable companions (plugin hooks,
 * tools, extension packages) or from an external registry. Everything else is
 * authored/official content that a PM may assign without an operator allowlist.
 */
export const HIGH_RISK_SKILL_PROVIDERS: Readonly<Record<string, true>> = {
	skillshare: true,
	"zeta-plugins": true,
	"claude-plugins": true,
	"agent-plugins": true,
};

/** Provider ids that are safe by default (documentation for the UI). */
export const DEFAULT_ALLOWED_SKILL_PROVIDERS: Readonly<Record<string, true>> = {
	[OFFICIAL_SKILLS_PROVIDER_ID]: true,
	native: true,
	custom: true,
	claude: true,
	codex: true,
	agents: true,
	opencode: true,
	github: true,
	"zeta-managed": true,
};

export type SkillRisk = "low" | "high";

/** Provider id for a loaded skill (`_source.provider`, else the `source` prefix). */
export function skillProvider(skill: SkillLike): string {
	const explicit = skill._source?.provider?.trim();
	if (explicit) return explicit;
	const prefix = skill.source.split(":")[0]?.trim();
	return prefix || "unknown";
}

/** Stable assignment identity: `<provider>:<skill name>`. */
export function skillQualifiedName(skill: SkillLike): string {
	return `${skillProvider(skill)}:${skill.name}`;
}

/** Plugin/registry skills are high risk; everything else is low risk. */
export function skillRisk(skill: SkillLike): SkillRisk {
	return HIGH_RISK_SKILL_PROVIDERS[skillProvider(skill)] === true ? "high" : "low";
}

function globMatches(pattern: string, value: string): boolean {
	try {
		return new Bun.Glob(pattern).match(value);
	} catch {
		return false;
	}
}

/**
 * Whether the operator allowlisted a high-risk skill.
 *
 * Entries match the bare skill name, the qualified `<provider>:<name>`, the
 * provider id, `provider:*`, `*`, or a glob over the name/qualified form.
 */
export function isSkillOperatorApproved(allowlist: readonly string[], skill: SkillLike): boolean {
	const provider = skillProvider(skill);
	const qualified = skillQualifiedName(skill);
	for (const raw of allowlist) {
		const entry = raw.trim();
		if (!entry) continue;
		if (entry === "*" || entry === provider || entry === skill.name || entry === qualified) return true;
		if (entry.endsWith(":*") && entry.slice(0, -2) === provider) return true;
		if (entry.includes("*") && (globMatches(entry, skill.name) || globMatches(entry, qualified))) return true;
	}
	return false;
}

/** The Team identity of an engineer session, when its cwd is a registered worktree. */
export interface EngineerSkillContext {
	teamId: string;
	pmId: string;
	pmName: string;
	engineerId: string;
	engineerName: string;
	/** The registered worktree containing the session cwd. */
	worktreePath: string;
}

/**
 * Resolve the engineer whose worktree contains `cwd`. Returns `null` outside a
 * Team, in a PM workspace/base repository, or when the layout names an engineer
 * the database does not register for that worktree.
 */
export function resolveEngineerSkillContext(
	cwd: string,
	options: { dbPath?: string } = {},
): EngineerSkillContext | null {
	let origin: TeamSessionOrigin | undefined;
	try {
		origin = resolveTeamSessionOrigin(cwd, options);
	} catch {
		return null;
	}
	if (!origin?.engineerId) return null;
	const dbPath = options.dbPath ?? resolveTeamDbPath();
	if (!fs.existsSync(dbPath)) return null;
	let db: TeamDb;
	try {
		db = new TeamDb(dbPath);
	} catch {
		return null;
	}
	try {
		const engineer = db.getEngineerById(origin.engineerId);
		if (!engineer || engineer.teamId !== origin.teamId) return null;
		const worktree = db
			.listWorktrees(origin.teamId)
			.filter(record => record.engineerId === engineer.id && pathWithin(record.path, cwd))
			.sort((a, b) => b.path.length - a.path.length)[0];
		if (!worktree) return null;
		const pm = db.getPmById(engineer.pmId);
		if (!pm) return null;
		return {
			teamId: origin.teamId,
			pmId: engineer.pmId,
			pmName: pm.name,
			engineerId: engineer.id,
			engineerName: engineer.name,
			worktreePath: worktree.path,
		};
	} finally {
		db.close();
	}
}

/** Rows assigned to one engineer (no PM check; used by session injection). */
export function loadEngineerAssignments(engineerId: string, options: { dbPath?: string } = {}): AgentSkillRecord[] {
	const db = new TeamDb(options.dbPath ?? resolveTeamDbPath());
	try {
		return db.listAgentSkills(engineerId);
	} finally {
		db.close();
	}
}

/**
 * Discovery root for a PM assigning skills to an engineer: the engineer's
 * home worktree (the tree a normal engineer session opens), else the PM
 * workspace. Returns `null` when the engineer has no registered worktree.
 */
export function engineerSkillRoot(
	teamId: string,
	engineerId: string,
	options: { dbPath?: string } = {},
): string | null {
	const db = new TeamDb(options.dbPath ?? resolveTeamDbPath());
	try {
		const worktrees = db.listWorktrees(teamId).filter(record => record.engineerId === engineerId);
		const home = worktrees.find(record => record.kind === "home");
		return home?.path ?? worktrees[0]?.path ?? null;
	} finally {
		db.close();
	}
}

/**
 * Resolve an engineer token to a row owned by `pmId`.
 *
 * Accepts the engineer name, `<pm>/<engineer>`, or the full row id. A PM name
 * (including the caller's own) is rejected: a PM cannot assign skills to itself
 * or to another PM. An engineer under another PM is rejected explicitly.
 */
export function resolveOwnedEngineer(db: TeamDb, teamId: string, pmId: string, token: string): EngineerRecord {
	const pm = db.getPmById(pmId);
	if (!pm || pm.teamId !== teamId) {
		throw new TeamError(`PM "${pmId}" is not registered in team "${teamId}"`);
	}
	const trimmed = token.trim();
	if (!trimmed) throw new TeamError("Missing engineer name");

	const byId = db.getEngineerById(trimmed);
	if (byId) {
		if (byId.teamId !== teamId) throw new TeamError(`Engineer "${trimmed}" is not registered in team "${teamId}"`);
		if (byId.pmId !== pm.id) {
			throw new TeamError(
				`Engineer "${byId.name}" belongs to another PM; a PM can only assign skills to its own engineers.`,
			);
		}
		return byId;
	}

	const parts = trimmed.split("/");
	if (parts.length > 2) {
		throw new TeamError(`Invalid engineer "${trimmed}"; use an engineer name or <pm>/<engineer>`);
	}
	const [ownerName, engineerName] = parts.length === 2 ? parts : [undefined, trimmed];
	if (ownerName !== undefined && ownerName !== pm.name) {
		throw new TeamError(
			`Engineer "${engineerName}" is addressed under PM "${ownerName}", not the current PM "${pm.name}".`,
		);
	}
	if (engineerName === pm.name || trimmed === pm.id) {
		throw new TeamError(`"${engineerName}" is a PM, not an engineer; a PM cannot assign skills to itself.`);
	}

	const own = db.getEngineer(teamId, pm.name, engineerName);
	if (own) return own;

	const otherEngineer = db.listEngineers(teamId).find(record => record.name === engineerName);
	if (otherEngineer) {
		throw new TeamError(
			`Engineer "${engineerName}" belongs to another PM; a PM can only assign skills to its own engineers.`,
		);
	}
	const otherPm = db.listPms(teamId).find(record => record.name === engineerName);
	if (otherPm) {
		throw new TeamError(`"${engineerName}" is a PM, not an engineer; a PM cannot assign skills to another PM.`);
	}
	throw new TeamError(`Unknown engineer "${engineerName}" for PM "${pm.name}".`);
}

/** One PM-visible assignment row plus the engineer it belongs to. */
export interface PmSkillAssignment {
	engineer: EngineerRecord;
	assignment: AgentSkillRecord;
}

/** Every assignment made by one PM, resolved to its engineer rows. */
export function listPmAssignments(
	teamId: string,
	pmId: string,
	options: { dbPath?: string } = {},
): PmSkillAssignment[] {
	const db = new TeamDb(options.dbPath ?? resolveTeamDbPath());
	try {
		const engineers = new Map(db.listEngineers(teamId).map(engineer => [engineer.id, engineer]));
		return db
			.listAgentSkillsForPm(pmId)
			.map(assignment => {
				const engineer = engineers.get(assignment.engineerId);
				return engineer ? { engineer, assignment } : undefined;
			})
			.filter((row): row is PmSkillAssignment => row !== undefined);
	} finally {
		db.close();
	}
}

export interface AssignEngineerSkillOptions {
	teamId: string;
	pmId: string;
	engineer: string;
	skill: SkillLike;
	/** Operator-approved high-risk skills (`team.skillAllowlist`). */
	allowlist?: readonly string[];
	dbPath?: string;
}

/**
 * Assign one discovered skill to an owned engineer. The skill is referenced by
 * name/source only; there is no path parameter. High-risk skills must be on the
 * operator allowlist.
 */
export function assignEngineerSkill(options: AssignEngineerSkillOptions): AgentSkillRecord {
	const db = new TeamDb(options.dbPath ?? resolveTeamDbPath());
	try {
		const engineer = resolveOwnedEngineer(db, options.teamId, options.pmId, options.engineer);
		const skill = options.skill;
		const name = skill?.name?.trim();
		if (!name) throw new TeamError("Missing skill name");
		if (skill.hide === true) {
			throw new TeamError(
				`Skill "${name}" is hidden or manual-only and cannot be assigned; use a skill the engineer's model can see.`,
			);
		}
		const qualifiedName = skillQualifiedName(skill);
		const risk = skillRisk(skill);
		if (risk === "high" && !isSkillOperatorApproved(options.allowlist ?? [], skill)) {
			throw new TeamError(
				`Skill "${name}" comes from high-risk source "${skillProvider(skill)}" (plugins/registry can ship hooks or tools). Ask the operator to allowlist "${qualifiedName}" in team.skillAllowlist.`,
			);
		}
		if (db.getAgentSkill(engineer.id, qualifiedName)) {
			throw new TeamError(`Skill "${name}" is already assigned to engineer "${engineer.name}".`);
		}
		const existingName = db.listAgentSkills(engineer.id).find(record => record.skillName === name);
		if (existingName) {
			throw new TeamError(
				`Skill "${name}" is already assigned to engineer "${engineer.name}" from source "${existingName.source}".`,
			);
		}
		const record: AgentSkillRecord = {
			teamId: options.teamId,
			pmId: options.pmId,
			engineerId: engineer.id,
			skillName: name,
			source: skill.source,
			qualifiedName,
			assignedBy: options.pmId,
			createdAt: Math.floor(Date.now() / 1000),
		};
		db.insertAgentSkill(record);
		return record;
	} finally {
		db.close();
	}
}

export interface RemoveEngineerSkillOptions {
	teamId: string;
	pmId: string;
	engineer: string;
	/** Skill name or `<provider>:<name>`; never a path. */
	skill: string;
	dbPath?: string;
}

/** Remove an assignment from an owned engineer. */
export function removeEngineerSkill(options: RemoveEngineerSkillOptions): AgentSkillRecord | null {
	const db = new TeamDb(options.dbPath ?? resolveTeamDbPath());
	try {
		const engineer = resolveOwnedEngineer(db, options.teamId, options.pmId, options.engineer);
		const token = options.skill.trim();
		if (!token) throw new TeamError("Missing skill name");
		const match = db
			.listAgentSkills(engineer.id)
			.find(record => record.qualifiedName === token || record.skillName === token);
		if (!match) return null;
		db.deleteAgentSkill(engineer.id, match.qualifiedName);
		return match;
	} finally {
		db.close();
	}
}
