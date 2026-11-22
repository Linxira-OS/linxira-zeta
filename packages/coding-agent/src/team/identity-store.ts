/**
 * File-backed identity layers for a Team worker. These are identity, not
 * repository guidance: AGENTS.md is deliberately never read here.
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	resolveTeamIdentity,
	type TeamIdentityContext,
	type TeamIdentityLayer,
	type TeamIdentityRole,
} from "./identity-context";

export interface TeamIdentityOptions {
	readonly cwd: string;
	readonly teamRoot: string;
	readonly agentId: string;
	readonly personaId?: string;
	readonly assignment: string;
	readonly personaContent?: string;
	readonly homeDir?: string;
}

async function readFileIfPresent(file: string): Promise<string | undefined> {
	try {
		const text = (await fs.readFile(file, "utf8")).trim();
		return text || undefined;
	} catch {
		return undefined;
	}
}

/** Global user identity, project identity, Team identity, persona and assignment. */
export async function readTeamIdentityLayers(options: TeamIdentityOptions): Promise<TeamIdentityLayer[]> {
	const home = options.homeDir ?? os.homedir();
	const [global, project, team] = await Promise.all([
		readFileIfPresent(path.join(home, ".zeta", "identity", "global.md")),
		readFileIfPresent(path.join(options.cwd, ".zeta", "identity.md")),
		readFileIfPresent(path.join(options.teamRoot, ".zeta", "identity.md")),
	]);
	const layers: TeamIdentityLayer[] = [];
	if (global) layers.push({ id: "global", kind: "global", appliesTo: "all", content: global });
	if (project) layers.push({ id: "project", kind: "project", appliesTo: "all", content: project });
	if (team) layers.push({ id: "team", kind: "team", appliesTo: "worker", content: team });
	if (options.personaContent) {
		layers.push({
			id: "persona",
			kind: "persona",
			appliesTo: "worker",
			...(options.personaId ? { personaId: options.personaId } : {}),
			content: options.personaContent,
		});
	}
	layers.push({ id: "assignment", kind: "assignment", appliesTo: "worker", content: options.assignment });
	return layers;
}

export function resolveTeamWorkerIdentity(
	options: TeamIdentityOptions,
	layers: readonly TeamIdentityLayer[],
	role: TeamIdentityRole = "worker",
): TeamIdentityContext {
	return resolveTeamIdentity({
		role,
		agentId: options.agentId,
		...(options.personaId ? { personaId: options.personaId } : {}),
		layers,
	});
}

export function renderTeamIdentityContext(context: TeamIdentityContext): string {
	const lines = [
		"# Team identity",
		`Role: ${context.role}`,
		`Agent: ${context.agentId}`,
		...(context.personaId ? [`Persona: ${context.personaId}`] : []),
		`Digest: ${context.digest.slice(0, 16)}`,
	];
	for (const layer of context.layers) {
		lines.push("", `## ${layer.kind}${layer.revision ? ` · ${layer.revision}` : ""}`, layer.content);
	}
	if (context.excluded.length > 0) lines.push("", `Excluded layers: ${context.excluded.join(", ")}`);
	return lines.join("\n");
}
