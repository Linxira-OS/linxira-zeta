/**
 * File-backed Team persona store. Personas are data under
 * `<team>/.zeta/personas/<id>.json`; they never become an agent cwd and are
 * validated before they can be loaded (ADR-0094).
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseTeamPersonaPack, type TeamPersonaPack } from "./persona-pack";

export const TEAM_PERSONA_DIR = path.join(".zeta", "personas");

export function teamPersonaDir(teamRoot: string): string {
	return path.join(teamRoot, TEAM_PERSONA_DIR);
}

function personaFile(teamRoot: string, id: string): string {
	return path.join(teamPersonaDir(teamRoot), `${id}.json`);
}

function contained(root: string, target: string): boolean {
	const relative = path.relative(path.resolve(root), path.resolve(target));
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export interface TeamPersonaList {
	readonly personas: readonly TeamPersonaPack[];
	/** Invalid files are skipped but named so the Team surface can show drift. */
	readonly problems: readonly string[];
}

export async function listTeamPersonas(teamRoot: string): Promise<TeamPersonaList> {
	const dir = teamPersonaDir(teamRoot);
	let names: string[];
	try {
		names = (await fs.readdir(dir)).filter(name => name.endsWith(".json")).sort();
	} catch {
		return { personas: [], problems: [] };
	}
	const personas: TeamPersonaPack[] = [];
	const problems: string[] = [];
	for (const name of names) {
		const file = path.join(dir, name);
		try {
			const parsed = parseTeamPersonaPack(JSON.parse(await fs.readFile(file, "utf8")));
			if (parsed.ok && parsed.pack) {
				if (`${parsed.pack.id}.json` !== name) problems.push(`${name}: id does not match filename`);
				else personas.push(parsed.pack);
			} else {
				problems.push(`${name}: ${parsed.problems.join("; ")}`);
			}
		} catch (error) {
			problems.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return { personas, problems };
}

export async function readTeamPersona(teamRoot: string, id: string): Promise<TeamPersonaPack | undefined> {
	const file = personaFile(teamRoot, id);
	if (!contained(teamPersonaDir(teamRoot), file)) return undefined;
	try {
		const parsed = parseTeamPersonaPack(JSON.parse(await fs.readFile(file, "utf8")));
		return parsed.ok ? parsed.pack : undefined;
	} catch {
		return undefined;
	}
}

export async function writeTeamPersona(teamRoot: string, value: unknown): Promise<TeamPersonaPack> {
	const parsed = parseTeamPersonaPack(value);
	if (!parsed.ok || !parsed.pack) throw new Error(`Invalid Team persona: ${parsed.problems.join("; ")}`);
	const dir = teamPersonaDir(teamRoot);
	const file = personaFile(teamRoot, parsed.pack.id);
	if (!contained(dir, file)) throw new Error("Team persona path escapes the Team root");
	await fs.mkdir(dir, { recursive: true });
	const temp = `${file}.${process.pid}.tmp`;
	await fs.writeFile(temp, `${JSON.stringify(parsed.pack, null, 2)}\n`, { mode: 0o600 });
	await fs.rename(temp, file);
	return parsed.pack;
}

export async function deleteTeamPersona(teamRoot: string, id: string): Promise<boolean> {
	const file = personaFile(teamRoot, id);
	if (!contained(teamPersonaDir(teamRoot), file)) return false;
	try {
		await fs.unlink(file);
		return true;
	} catch {
		return false;
	}
}
