import type { TeamWorkspaceSnapshot, TeamWorkspaceSource } from "@linxiraos/pi-tui/overlays/team-workspace";
import { TeamDb } from "../team/db";
import { listTeamMemory } from "../team/memory";
import { listTeamPersonas } from "../team/personas";
import { readTeamProfile } from "../team/profile";
import { listTeamPlans } from "../team/team-plan";

export interface TeamWorkspaceSourceOptions {
	readonly dbPath?: string;
}

/** Full Team directory/detail projection; files stay under each Team root. */
export function createTeamWorkspaceSource(options: TeamWorkspaceSourceOptions = {}): TeamWorkspaceSource {
	return {
		async load(teamId?: string): Promise<TeamWorkspaceSnapshot> {
			const db = new TeamDb(options.dbPath);
			try {
				const teams = db.listTeams().map(team => ({ id: team.id, name: team.name, rootPath: team.rootPath }));
				const selected = teams.find(team => team.id === teamId) ?? teams[0];
				if (!selected) {
					return {
						teams,
						personas: [],
						pms: [],
						engineers: [],
						rooms: [],
						plans: [],
						taskCount: 0,
						memoryKeys: [],
					};
				}
				const [personas, plans, profile, memoryKeys] = await Promise.all([
					listTeamPersonas(selected.rootPath),
					listTeamPlans(selected.rootPath),
					readTeamProfile(selected.rootPath, selected.id),
					listTeamMemory(selected.rootPath),
				]);
				const warnings = [...personas.problems, ...plans.problems];
				return {
					teams,
					activeTeamId: selected.id,
					team: selected,
					...(profile.defaultPersonaId ? { defaultPersonaId: profile.defaultPersonaId } : {}),
					personas: personas.personas.map(persona => ({
						id: persona.id,
						name: persona.name,
						role: persona.role,
						revision: persona.revision,
					})),
					pms: db.listPms(selected.id).map(pm => ({ id: pm.id, name: pm.name, role: "PM" })),
					engineers: db.listEngineers(selected.id).map(engineer => {
						const pm = db.getPmById(engineer.pmId);
						return {
							id: engineer.id,
							name: engineer.name,
							role: "engineer",
							...(pm ? { detail: `PM ${pm.name} · ${engineer.execution}` } : { detail: engineer.execution }),
						};
					}),
					rooms: db.listRoomSummaries(selected.id).map(room => ({
						id: room.id,
						name: room.name,
						kind: room.kind,
						memberCount: room.memberCount,
						lastSeq: room.lastSeq ?? 0,
					})),
					plans: plans.plans.map(plan => ({
						id: plan.id,
						title: plan.title,
						status: plan.status,
						revision: plan.revision,
						itemCount: plan.items.length,
					})),
					taskCount: db.listTasks(selected.id).length,
					memoryKeys,
					...(warnings.length > 0 ? { warning: warnings.join("; ") } : {}),
				};
			} finally {
				db.close();
			}
		},
	};
}
