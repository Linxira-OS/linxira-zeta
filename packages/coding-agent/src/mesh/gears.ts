/**
 * Per-workspace messaging gears.
 *
 * A workspace's *outbound* gear says which other workspaces its main agent may
 * call; its *inbound* gear says which other workspaces may call its main agent.
 * Both are read from the project settings layer (`.zeta/settings.json` and
 * `.zeta/config.yml`), so a gear belongs to the workspace that owns the
 * repository rather than to the user's global config. The default workspace
 * (`~/.zeta/workspace`) always runs `open` in both directions.
 *
 * The engine is conservative in one place on purpose: the default workspace's
 * main agent is treated as a *main peer* from `repo-main-agents` upward. That
 * is what lets the user's home workspace call a repository that only accepts
 * repo-main-agents, while a `closed` repository stays unreachable.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { JSONC, YAML } from "bun";
import { isDefaultWorkspace } from "../default-workspace";
import type { MeshAgentRole } from "./types";

/** Closed to open, in the order the settings UI lists them. */
export const MESH_GEAR_VALUES = [
	"closed",
	"repo-main-agents",
	"repo-all",
	"cross-repo-except-default",
	"open",
] as const;

export type MeshGear = (typeof MESH_GEAR_VALUES)[number];

/** The two independent directions a workspace configures. */
export interface MeshGears {
	inbound: MeshGear;
	outbound: MeshGear;
}

/** Default for a repository: nobody may call in or out across workspaces. */
export const CLOSED_MESH_GEARS: MeshGears = { inbound: "closed", outbound: "closed" };

/** The default workspace's rule: it may call everyone and everyone may call it. */
export const OPEN_MESH_GEARS: MeshGears = { inbound: "open", outbound: "open" };

/** Project settings keys carrying the two gears. */
export const MESH_INBOUND_GEAR_SETTING = "mesh.inboundGear";
export const MESH_OUTBOUND_GEAR_SETTING = "mesh.outboundGear";

/** Narrow structural view of the settings object a session exposes. */
export interface GearSettingsSource {
	getProjectSettings?: () => Record<string, unknown>;
	getCwd?: () => string;
}

/** One side of a call, as the gear engine needs to see it. */
export interface GearParty {
	workspaceId: string;
	/** `true` for the user's default workspace. */
	isDefaultWorkspace: boolean;
	role: MeshAgentRole;
	/** Workspace-qualified address, used in error messages. */
	address: string;
}

/** Everything the two gears are evaluated against. */
export interface GearCall {
	sender: GearParty;
	target: GearParty;
	senderOutbound: MeshGear;
	targetInbound: MeshGear;
}

export type GearDecision =
	| { allowed: true }
	| {
			allowed: false;
			/** `outbound` when the sender's gear refused, `inbound` when the target's did. */
			direction: "outbound" | "inbound";
			error: string;
	  };

/** True when `value` is one of {@link MESH_GEAR_VALUES}. */
export function isMeshGear(value: unknown): value is MeshGear {
	return typeof value === "string" && (MESH_GEAR_VALUES as readonly string[]).includes(value);
}

/** Read one gear, falling back to `closed` for anything unrecognized. */
export function normalizeGear(value: unknown): MeshGear {
	return isMeshGear(value) ? value : "closed";
}

/** Defaults for a workspace root: open for the default workspace, closed otherwise. */
export function defaultGearsForRoot(workspaceRoot: string | undefined): MeshGears {
	return workspaceRoot !== undefined && isDefaultWorkspace(workspaceRoot) ? OPEN_MESH_GEARS : CLOSED_MESH_GEARS;
}

function mergeRecords(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
	const merged: Record<string, unknown> = { ...base };
	for (const [key, value] of Object.entries(override)) {
		const current = merged[key];
		merged[key] =
			value !== null &&
			typeof value === "object" &&
			!Array.isArray(value) &&
			current !== null &&
			typeof current === "object" &&
			!Array.isArray(current)
				? mergeRecords(current as Record<string, unknown>, value as Record<string, unknown>)
				: value;
	}
	return merged;
}

/** Read `mesh.inboundGear` / `mesh.outboundGear` from one merged project layer. */
export function gearsFromProjectLayer(layer: Record<string, unknown>, workspaceRoot?: string): MeshGears {
	if (workspaceRoot !== undefined && isDefaultWorkspace(workspaceRoot)) return OPEN_MESH_GEARS;
	const mesh = layer.mesh;
	const record =
		mesh !== null && typeof mesh === "object" && !Array.isArray(mesh) ? (mesh as Record<string, unknown>) : {};
	return {
		inbound: normalizeGear(record.inboundGear),
		outbound: normalizeGear(record.outboundGear),
	};
}

/**
 * Gears from a session's settings. Only the project layer participates, so a
 * global `mesh.inboundGear` cannot silently reopen every repository. Returns
 * `undefined` when the source cannot supply a project layer (tests and
 * extension-provided sessions that do not use `Settings`).
 */
export function gearsFromSettings(source: GearSettingsSource | undefined): MeshGears | undefined {
	if (!source?.getProjectSettings) return undefined;
	let project: Record<string, unknown>;
	try {
		project = source.getProjectSettings();
	} catch {
		return undefined;
	}
	const cwd = source.getCwd?.();
	return gearsFromProjectLayer(project, cwd);
}

async function readJsonSettings(file: string): Promise<Record<string, unknown> | undefined> {
	try {
		const parsed = JSONC.parse(await fs.readFile(file, "utf8"));
		return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

async function readYamlSettings(file: string): Promise<Record<string, unknown> | undefined> {
	try {
		const parsed = YAML.parse(await fs.readFile(file, "utf8"));
		return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

/**
 * Read the gears a workspace root configures. Mirrors the built-in settings
 * provider's project order (`settings.json`, then `config.yml`), touching only
 * the `.zeta` config root.
 */
export async function readWorkspaceGears(workspaceRoot: string): Promise<MeshGears> {
	if (isDefaultWorkspace(workspaceRoot)) return OPEN_MESH_GEARS;
	const configDir = path.join(workspaceRoot, ".zeta");
	const json = await readJsonSettings(path.join(configDir, "settings.json"));
	const yml =
		(await readYamlSettings(path.join(configDir, "config.yml"))) ??
		(await readYamlSettings(path.join(configDir, "config.yaml")));
	const layer = json && yml ? mergeRecords(json, yml) : (yml ?? json);
	return gearsFromProjectLayer(layer ?? {}, workspaceRoot);
}

/**
 * Whether one gear permits a call.
 *
 * `sameWorkspace` means the two agents belong to the same workspace: a `closed`
 * gear still allows a main agent to reach its own subagents (and a subagent to
 * reach its spawning main, which the delivery path enforces separately).
 *
 * Across workspaces:
 * - `repo-main-agents` accepts the default workspace's main agent — a main
 *   peer — but nothing else outside the workspace;
 * - `repo-all` accepts every main agent;
 * - `cross-repo-except-default` accepts every agent of a non-default
 *   workspace;
 * - `open` accepts everyone, the default workspace's subagents included.
 */
export function gearAllows(
	gear: MeshGear,
	relation: { sameWorkspace: boolean; otherRole: MeshAgentRole; otherIsDefaultWorkspace: boolean },
): boolean {
	if (relation.sameWorkspace) return gear !== "closed" || relation.otherRole !== "main";
	switch (gear) {
		case "closed":
			return false;
		case "repo-main-agents":
			return relation.otherRole === "main" && relation.otherIsDefaultWorkspace;
		case "repo-all":
			return relation.otherRole === "main";
		case "cross-repo-except-default":
			return relation.otherRole === "main" || !relation.otherIsDefaultWorkspace;
		case "open":
			return true;
	}
}

/**
 * Evaluate both directions. The sender's outbound gear and the target's
 * inbound gear must *both* permit the call; a closed target can never be
 * bypassed by a permissive sender.
 */
export function evaluateGearCall(call: GearCall): GearDecision {
	const sameWorkspace = call.sender.workspaceId === call.target.workspaceId;
	const outboundAllowed = gearAllows(call.senderOutbound, {
		sameWorkspace,
		otherRole: call.target.role,
		otherIsDefaultWorkspace: call.target.isDefaultWorkspace,
	});
	if (!outboundAllowed) {
		return {
			allowed: false,
			direction: "outbound",
			error:
				`Workspace ${call.sender.workspaceId}'s outbound messaging gear "${call.senderOutbound}" does not permit ` +
				`calling ${call.target.address} (${call.target.role}, workspace ${call.target.workspaceId}). ` +
				`Raise ${MESH_OUTBOUND_GEAR_SETTING} in that workspace's project settings.`,
		};
	}
	const inboundAllowed = gearAllows(call.targetInbound, {
		sameWorkspace,
		otherRole: call.sender.role,
		otherIsDefaultWorkspace: call.sender.isDefaultWorkspace,
	});
	if (!inboundAllowed) {
		return {
			allowed: false,
			direction: "inbound",
			error:
				`Workspace ${call.target.workspaceId}'s inbound messaging gear "${call.targetInbound}" refuses calls from ` +
				`${call.sender.address} (${call.sender.role}, workspace ${call.sender.workspaceId}). ` +
				`Raise ${MESH_INBOUND_GEAR_SETTING} in the target workspace's project settings.`,
		};
	}
	return { allowed: true };
}
