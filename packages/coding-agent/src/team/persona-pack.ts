/**
 * Versioned Team persona data. A persona is identity/capability data, not an
 * AGENTS.md file and not a hidden agent. The main agent may create one; the
 * Team surface and prompt assembler consume the parsed pack.
 */
import { isRecord } from "@linxiraos/pi-utils";

export type TeamPersonaMemoryScope = "team" | "global-taste" | "none";
export type TeamPersonaPermission = "allow" | "prompt" | "deny";

export interface TeamPersonaPack {
	readonly schemaVersion: 1;
	readonly id: string;
	readonly revision: number;
	readonly name: string;
	readonly role: string;
	readonly description?: string;
	readonly model?: string;
	readonly thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "max";
	readonly skills?: readonly string[];
	readonly permissions?: Readonly<Record<string, TeamPersonaPermission>>;
	readonly memoryScope?: TeamPersonaMemoryScope;
	readonly workingFolder?: string;
	/** Optional scoped plugin pack, relative to the persona data root. */
	readonly pluginPack?: { readonly root: string; readonly hash?: string };
}

export interface PersonaPackValidation {
	readonly ok: boolean;
	readonly pack?: TeamPersonaPack;
	readonly problems: readonly string[];
}

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PERMISSIONS: Record<TeamPersonaPermission, true> = { allow: true, prompt: true, deny: true };
const MEMORY: Record<TeamPersonaMemoryScope, true> = { team: true, "global-taste": true, none: true };
const THINKING: Record<NonNullable<TeamPersonaPack["thinkingLevel"]>, true> = {
	off: true,
	minimal: true,
	low: true,
	medium: true,
	high: true,
	max: true,
};

function text(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function stringList(value: unknown): string[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) return undefined;
	const out = value.map(text);
	return out.every((entry): entry is string => entry !== undefined) ? out : undefined;
}

/** Parse untrusted persona data at the Team boundary. All errors are reported. */
export function parseTeamPersonaPack(value: unknown): PersonaPackValidation {
	const problems: string[] = [];
	if (!isRecord(value)) return { ok: false, problems: ["persona must be an object"] };
	if (value.schemaVersion !== 1) problems.push("schemaVersion must be 1");
	const id = text(value.id);
	if (!id || !ID.test(id)) problems.push("id must be a lowercase slug (a-z, 0-9, -)");
	const revision = value.revision;
	if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 1) {
		problems.push("revision must be a positive integer");
	}
	const name = text(value.name);
	if (!name) problems.push("name is required");
	const role = text(value.role);
	if (!role) problems.push("role is required");

	const skills = stringList(value.skills);
	if (value.skills !== undefined && !skills) problems.push("skills must be a string array");
	const model = value.model === undefined ? undefined : text(value.model);
	if (value.model !== undefined && !model) problems.push("model must be a non-empty string");
	const thinkingLevel = value.thinkingLevel;
	if (thinkingLevel !== undefined && (typeof thinkingLevel !== "string" || !Object.hasOwn(THINKING, thinkingLevel))) {
		problems.push("thinkingLevel is invalid");
	}
	const memoryScope = value.memoryScope;
	if (memoryScope !== undefined && (typeof memoryScope !== "string" || !Object.hasOwn(MEMORY, memoryScope))) {
		problems.push("memoryScope must be team, global-taste or none");
	}
	const workingFolder = value.workingFolder === undefined ? undefined : text(value.workingFolder);
	if (value.workingFolder !== undefined && !workingFolder) problems.push("workingFolder must be a non-empty path");

	let permissions: Record<string, TeamPersonaPermission> | undefined;
	if (value.permissions !== undefined) {
		if (!isRecord(value.permissions)) problems.push("permissions must be an object");
		else {
			permissions = {};
			for (const [tool, permission] of Object.entries(value.permissions)) {
				if (typeof permission !== "string" || !Object.hasOwn(PERMISSIONS, permission)) {
					problems.push(`permissions.${tool} must be allow, prompt or deny`);
					continue;
				}
				permissions[tool] = permission as TeamPersonaPermission;
			}
		}
	}

	let pluginPack: { root: string; hash?: string } | undefined;
	if (value.pluginPack !== undefined) {
		if (!isRecord(value.pluginPack)) problems.push("pluginPack must be an object");
		else {
			const root = text(value.pluginPack.root);
			if (!root) problems.push("pluginPack.root is required");
			else if (root.startsWith("/") || root.includes("..")) {
				problems.push("pluginPack.root must be relative and contained");
			} else {
				const hash = value.pluginPack.hash === undefined ? undefined : text(value.pluginPack.hash);
				if (value.pluginPack.hash !== undefined && !hash) problems.push("pluginPack.hash must be a string");
				pluginPack = { root, ...(hash ? { hash } : {}) };
			}
		}
	}

	if (problems.length > 0) return { ok: false, problems };
	return {
		ok: true,
		pack: {
			schemaVersion: 1,
			id: id!,
			revision: revision as number,
			name: name!,
			role: role!,
			...(text(value.description) ? { description: text(value.description) } : {}),
			...(model ? { model } : {}),
			...(thinkingLevel ? { thinkingLevel: thinkingLevel as TeamPersonaPack["thinkingLevel"] } : {}),
			...(skills ? { skills } : {}),
			...(permissions ? { permissions } : {}),
			...(memoryScope ? { memoryScope: memoryScope as TeamPersonaMemoryScope } : {}),
			...(workingFolder ? { workingFolder } : {}),
			...(pluginPack ? { pluginPack } : {}),
		},
		problems: [],
	};
}
