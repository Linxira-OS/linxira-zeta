/**
 * `engineer_skills` — Lead mode's PM → engineer skill assignment surface.
 *
 * A PM can list the skills assigned to its own engineers, assign a discovered
 * skill by name, and remove one. There is no path parameter: the tool only
 * accepts names from the engineer's discovered skill list, so it cannot inject
 * an arbitrary file or a hidden skill.
 *
 * High-risk (plugin/registry) skills require the operator allowlist
 * (`team.skillAllowlist`); authored/official skills are allowed by default.
 * Assignments take effect when the engineer session starts or resumes, or after
 * its `/reload-skills`; a live session is never hot-reloaded.
 */

import type { AgentTool, AgentToolResult, ToolApprovalDecision } from "@linxiraos/pi-agent-core";
import { ToolError } from "@linxiraos/pi-tui/tools/tool-errors";
import { type } from "@linxiraos/zeta-schema";
import { cfgDisabledExtensions, cfgSkills } from "../extensibility/settings";
import { loadSkills, type Skill } from "../extensibility/skills";
import engineerSkillsDescription from "../prompts/tools/engineer-skills.md" with { type: "text" };
import { type AgentSkillRecord, type EngineerRecord, resolveTeamDbPath, TeamDb } from "../team/db";
import {
	assignEngineerSkill,
	engineerSkillRoot,
	isSkillOperatorApproved,
	listPmAssignments,
	removeEngineerSkill,
	resolveOwnedEngineer,
	skillQualifiedName,
	skillProvider,
	skillRisk,
} from "../team/engineer-skills";
import { type LeadWorkspace, resolveLeadWorkspace } from "../team/lead";
import { cfgTeamSkillAllowlist } from "../team/settings";
import type { Tool, ToolSession } from "./index";

const engineerSkillsSchema = type({
	action: type("'list' | 'assign' | 'remove'").describe("list assignments, assign a skill, or remove one"),
	"engineer?": type("string > 0").describe("engineer name or <pm>/<engineer>; required for assign/remove"),
	"skill?": type("string > 0").describe("discovered skill name or <provider>:<name>; required for assign/remove"),
});

export type EngineerSkillsParams = typeof engineerSkillsSchema.infer;

export interface EngineerSkillAssignmentView {
	engineer: EngineerRecord;
	assignment: AgentSkillRecord;
}

export interface EngineerSkillsDetails {
	action: EngineerSkillsParams["action"];
	teamId: string;
	pmId: string;
	engineer?: EngineerRecord;
	assignments: EngineerSkillAssignmentView[];
	assigned?: AgentSkillRecord;
	removed?: AgentSkillRecord;
	/** Skills the engineer can be assigned, with risk and allowlist state. */
	available?: Array<{
		name: string;
		qualifiedName: string;
		source: string;
		provider: string;
		risk: "low" | "high";
		approved: boolean;
		assigned?: boolean;
	}>;
}

function workspaceFor(session: ToolSession): Promise<LeadWorkspace> {
	return resolveLeadWorkspace(session.cwd).catch(error => {
		throw new ToolError(error instanceof Error ? error.message : String(error));
	});
}

/** Discover the skills an engineer's session would see (its worktree, else the PM workspace). */
async function discoverForEngineer(
	session: ToolSession,
	teamId: string,
	engineer: EngineerRecord,
	fallbackCwd: string,
): Promise<Skill[]> {
	const cwd = engineerSkillRoot(teamId, engineer.id) ?? fallbackCwd;
	const settings = cfgSkills.get(session.settings);
	const result = await loadSkills({
		...settings,
		cwd,
		disabledExtensions: cfgDisabledExtensions.get(session.settings),
		extensionRoots: session.effectiveExtensionRoots?.(),
	});
	return result.skills;
}

function findSkill(skills: readonly Skill[], token: string): Skill | undefined {
	const trimmed = token.trim();
	return skills.find(
		skill => skill.hide !== true && (skill.name === trimmed || skillQualifiedName(skill) === trimmed),
	);
}

function availableView(
	skills: readonly Skill[],
	assignments: readonly AgentSkillRecord[],
	allowlist: readonly string[],
): NonNullable<EngineerSkillsDetails["available"]> {
	const assigned = new Set(assignments.map(record => record.qualifiedName));
	return skills
		.filter(skill => skill.hide !== true)
		.map(skill => ({
			name: skill.name,
			qualifiedName: skillQualifiedName(skill),
			source: skill.source,
			provider: skillProvider(skill),
			risk: skillRisk(skill),
			approved: skillRisk(skill) === "low" || isSkillOperatorApproved(allowlist, skill),
			...(assigned.has(skillQualifiedName(skill)) ? { assigned: true } : {}),
		}));
}

function resolveEngineer(session: ToolSession, workspace: LeadWorkspace, token: string): EngineerRecord {
	const db = new TeamDb(resolveTeamDbPath());
	try {
		return resolveOwnedEngineer(db, workspace.teamId, workspace.pmId, token);
	} catch (error) {
		throw new ToolError(error instanceof Error ? error.message : String(error));
	} finally {
		db.close();
	}
}

export class EngineerSkillsTool implements AgentTool<typeof engineerSkillsSchema, EngineerSkillsDetails> {
	readonly name = "engineer_skills";
	readonly label = "Engineer Skills";
	readonly description = engineerSkillsDescription;
	readonly parameters = engineerSkillsSchema;
	readonly strict = true;
	readonly summary = "List, assign, or remove skills on the PM's own engineers";
	readonly approval = (args: unknown): ToolApprovalDecision =>
		args !== null && typeof args === "object" && "action" in args && args.action === "list" ? "read" : "exec";

	constructor(private readonly session: ToolSession) {}

	async execute(_id: string, params: EngineerSkillsParams): Promise<AgentToolResult<EngineerSkillsDetails>> {
		const workspace = await workspaceFor(this.session);
		const allowlist = cfgTeamSkillAllowlist.get(this.session.settings);
		const action = params.action;

		try {
			if (action === "list") {
				if (!params.engineer) {
					const rows = listPmAssignments(workspace.teamId, workspace.pmId);
					const db = new TeamDb(resolveTeamDbPath());
					let engineers: EngineerRecord[];
					try {
						engineers = db.listEngineers(workspace.teamId).filter(engineer => engineer.pmId === workspace.pmId);
					} finally {
						db.close();
					}
					const lines =
						engineers.length === 0
							? [`PM "${workspace.pmName}" has no engineers.`]
							: [
									`Engineer skills assigned by PM "${workspace.pmName}":`,
									...engineers.map(engineer => {
										const assigned = rows.filter(row => row.engineer.id === engineer.id);
										return assigned.length === 0
											? `- ${engineer.name}: (none)`
											: `- ${engineer.name}: ${assigned
													.map(row => `${row.assignment.skillName} (${row.assignment.qualifiedName})`)
													.join(", ")}`;
									}),
								];
					return {
						content: [{ type: "text", text: lines.join("\n") }],
						details: {
							action,
							teamId: workspace.teamId,
							pmId: workspace.pmId,
							assignments: rows,
						},
					};
				}

				const engineer = resolveEngineer(this.session, workspace, params.engineer);
				const assignments = listPmAssignments(workspace.teamId, workspace.pmId).filter(
					row => row.engineer.id === engineer.id,
				);
				const skills = await discoverForEngineer(this.session, workspace.teamId, engineer, this.session.cwd);
				const available = availableView(
					skills,
					assignments.map(row => row.assignment),
					allowlist,
				);
				const assignedNames = new Set(assignments.map(row => row.assignment.qualifiedName));
				const lines = [
					`Engineer "${engineer.name}" (${engineer.id}) — ${assignments.length} assigned skill${
						assignments.length === 1 ? "" : "s"
					}:`,
					...assignments.map(
						row => `- ${row.assignment.skillName} (${row.assignment.qualifiedName}, ${row.assignment.source})`,
					),
					"",
					`Available skills: ${available.length}`,
					...available.map(
						skill =>
							`- ${skill.name} [${skill.provider}, ${skill.risk}${skill.approved ? "" : ", not operator-approved"}]${
								assignedNames.has(skill.qualifiedName) ? " (assigned)" : ""
							}`,
					),
				];
				return {
					content: [{ type: "text", text: lines.join("\n") }],
					details: {
						action,
						teamId: workspace.teamId,
						pmId: workspace.pmId,
						engineer,
						assignments,
						available,
					},
				};
			}

			if (!params.engineer) throw new ToolError(`engineer_skills ${action} requires an engineer.`);
			if (!params.skill) throw new ToolError(`engineer_skills ${action} requires a skill.`);
			const engineer = resolveEngineer(this.session, workspace, params.engineer);

			if (action === "assign") {
				const skills = await discoverForEngineer(this.session, workspace.teamId, engineer, this.session.cwd);
				const skill = findSkill(skills, params.skill);
				if (!skill) {
					throw new ToolError(
						`Skill "${params.skill}" is not discovered for engineer "${engineer.name}". Use \`engineer_skills list engineer=${engineer.name}\` to see available names; paths are not accepted.`,
					);
				}
				const assigned = assignEngineerSkill({
					teamId: workspace.teamId,
					pmId: workspace.pmId,
					engineer: engineer.id,
					skill,
					allowlist,
				});
				return {
					content: [
						{
							type: "text",
							text: `Assigned skill "${assigned.skillName}" (${assigned.qualifiedName}) to engineer "${engineer.name}". It loads when that engineer's session next starts, resumes, or runs /reload-skills.`,
						},
					],
					details: {
						action,
						teamId: workspace.teamId,
						pmId: workspace.pmId,
						engineer,
						assignments: listPmAssignments(workspace.teamId, workspace.pmId).filter(
							row => row.engineer.id === engineer.id,
						),
						assigned,
					},
				};
			}

			const removed = removeEngineerSkill({
				teamId: workspace.teamId,
				pmId: workspace.pmId,
				engineer: engineer.id,
				skill: params.skill,
			});
			if (!removed) {
				throw new ToolError(`Skill "${params.skill}" is not assigned to engineer "${engineer.name}".`);
			}
			return {
				content: [
					{
						type: "text",
						text: `Removed skill "${removed.skillName}" (${removed.qualifiedName}) from engineer "${engineer.name}". A live session keeps content it already loaded until /reload-skills or restart.`,
					},
				],
				details: {
					action,
					teamId: workspace.teamId,
					pmId: workspace.pmId,
					engineer,
					assignments: listPmAssignments(workspace.teamId, workspace.pmId).filter(
						row => row.engineer.id === engineer.id,
					),
					removed,
				},
			};
		} catch (error) {
			if (error instanceof ToolError) throw error;
			throw new ToolError(error instanceof Error ? error.message : String(error));
		}
	}
}

/** Lead mode's coordination tools: rooms, Secretary, and engineer skill assignment. */
export function createEngineerSkillTools(session: ToolSession): Tool[] {
	return [new EngineerSkillsTool(session)];
}
