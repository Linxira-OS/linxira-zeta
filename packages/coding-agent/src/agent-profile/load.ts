import * as fs from "node:fs";
import * as path from "node:path";
import { loadImAgentProfilePersona, resolveImAgentProfileRuntime } from "./resolve";
import type { ImAgentProfileConfig, ImAgentProfileRuntimeOptions } from "./types";

interface ProfileFile {
	profiles?: ImAgentProfileConfig[];
}

function readProfileFile(file: string): ImAgentProfileConfig[] {
	let raw: unknown;
	try {
		raw = JSON.parse(fs.readFileSync(file, "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
		throw new Error(`Agent profile file is unreadable: ${file} (${String(error)})`);
	}
	if (Array.isArray(raw)) return raw as ImAgentProfileConfig[];
	if (raw && typeof raw === "object" && Array.isArray((raw as ProfileFile).profiles)) {
		return (raw as ProfileFile).profiles!;
	}
	throw new Error(`Agent profile file must be an array or { profiles: [...] }: ${file}`);
}

/** Profiles from user then project files; project wins on an exact id. */
export function discoverAgentProfiles(options: { cwd: string; agentDir: string }): Map<string, ImAgentProfileConfig> {
	const files = [
		path.join(options.agentDir, "agent-profiles.json"),
		path.join(options.cwd, ".zeta", "agent-profiles.json"),
	];
	const profiles = new Map<string, ImAgentProfileConfig>();
	for (const file of files) {
		for (const profile of readProfileFile(file)) {
			if (typeof profile?.id === "string" && profile.id.trim().length > 0) profiles.set(profile.id, profile);
		}
	}
	return profiles;
}

/** Resolve one profile to the SDK options for a main/front-door session. */
export async function loadMainAgentProfile(
	id: string,
	options: { cwd: string; agentDir: string },
): Promise<ImAgentProfileRuntimeOptions> {
	const profile = discoverAgentProfiles(options).get(id);
	if (!profile) {
		throw new Error(
			`Unknown agent profile "${id}". Available: ${[...discoverAgentProfiles(options).keys()].join(", ") || "none"}`,
		);
	}
	const personaText = await loadImAgentProfilePersona(profile, { cwd: options.cwd });
	return resolveImAgentProfileRuntime(profile, {
		instanceId: "local",
		profileId: profile.id,
		bindingId: "main",
		agentDir: options.agentDir,
		cwd: options.cwd,
		personaText,
	});
}
