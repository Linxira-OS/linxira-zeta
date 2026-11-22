/**
 * Team profile: the Team-owned defaults that are neither repository guidance
 * nor a persona pack. Stored at `<team>/.zeta/team-profile.json`.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";

export const TEAM_PROFILE_SCHEMA_VERSION = 1;
export const TEAM_PROFILE_FILE = path.join(".zeta", "team-profile.json");

export interface TeamExternalLiaison {
	readonly agentId: string;
	readonly channels: readonly string[];
	/** Listen silently; an @ must still wake the liaison. */
	readonly listen: boolean;
}

export interface TeamProfile {
	readonly schemaVersion: typeof TEAM_PROFILE_SCHEMA_VERSION;
	readonly teamId: string;
	readonly defaultPersonaId?: string;
	readonly externalLiaison?: TeamExternalLiaison;
	readonly updatedAt: number;
}

export interface TeamProfileParseResult {
	readonly ok: boolean;
	readonly profile?: TeamProfile;
	readonly problems: readonly string[];
}

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function nonEmpty(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

export function parseTeamProfile(value: unknown): TeamProfileParseResult {
	const input = record(value);
	if (!input) return { ok: false, problems: ["Team profile must be an object"] };
	const problems: string[] = [];
	if (input.schemaVersion !== TEAM_PROFILE_SCHEMA_VERSION) {
		problems.push(`schemaVersion must be ${TEAM_PROFILE_SCHEMA_VERSION}`);
	}
	if (!nonEmpty(input.teamId)) problems.push("teamId is required");
	if (!Number.isFinite(input.updatedAt)) problems.push("updatedAt must be a timestamp");
	if (input.defaultPersonaId !== undefined && !nonEmpty(input.defaultPersonaId)) {
		problems.push("defaultPersonaId must be a non-empty string when set");
	}
	let liaison: TeamExternalLiaison | undefined;
	if (input.externalLiaison !== undefined) {
		const raw = record(input.externalLiaison);
		if (!raw) problems.push("externalLiaison must be an object");
		else if (!nonEmpty(raw.agentId)) problems.push("externalLiaison.agentId is required");
		else if (raw.listen !== undefined && typeof raw.listen !== "boolean") {
			problems.push("externalLiaison.listen must be a boolean");
		} else {
			const channels = raw.channels === undefined ? [] : raw.channels;
			if (!Array.isArray(channels) || channels.some(channel => !nonEmpty(channel))) {
				problems.push("externalLiaison.channels must be non-empty strings");
			} else {
				liaison = {
					agentId: raw.agentId.trim(),
					channels: [...new Set(channels.map(channel => (channel as string).trim()))],
					listen: raw.listen !== false,
				};
			}
		}
	}
	if (problems.length > 0) return { ok: false, problems };
	return {
		ok: true,
		problems: [],
		profile: {
			schemaVersion: TEAM_PROFILE_SCHEMA_VERSION,
			teamId: (input.teamId as string).trim(),
			...(nonEmpty(input.defaultPersonaId) ? { defaultPersonaId: input.defaultPersonaId.trim() } : {}),
			...(liaison ? { externalLiaison: liaison } : {}),
			updatedAt: input.updatedAt as number,
		},
	};
}

export function teamProfilePath(teamRoot: string): string {
	return path.join(teamRoot, TEAM_PROFILE_FILE);
}

export async function readTeamProfile(teamRoot: string, teamId: string): Promise<TeamProfile> {
	try {
		const parsed = parseTeamProfile(JSON.parse(await fs.readFile(teamProfilePath(teamRoot), "utf8")));
		if (parsed.ok && parsed.profile) return parsed.profile;
	} catch {
		// Missing or invalid: fall through to the Team's empty profile.
	}
	return { schemaVersion: TEAM_PROFILE_SCHEMA_VERSION, teamId, updatedAt: 0 };
}

export async function writeTeamProfile(teamRoot: string, value: unknown): Promise<TeamProfile> {
	const parsed = parseTeamProfile(value);
	if (!parsed.ok || !parsed.profile) throw new Error(`Invalid Team profile: ${parsed.problems.join("; ")}`);
	const file = teamProfilePath(teamRoot);
	await fs.mkdir(path.dirname(file), { recursive: true });
	const temp = `${file}.${process.pid}.tmp`;
	await fs.writeFile(temp, `${JSON.stringify(parsed.profile, null, 2)}\n`, { mode: 0o600 });
	await fs.rename(temp, file);
	return parsed.profile;
}
