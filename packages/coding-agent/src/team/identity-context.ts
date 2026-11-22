/**
 * Team identity assembly. Repository/global AGENTS.md is project convention;
 * it is not a persona. Each layer declares whom it applies to so a first-level
 * worker cannot inherit the main agent's private instructions (ADR-0092).
 */
import { createHash } from "node:crypto";

export type TeamIdentityRole = "main" | "worker";
export type TeamIdentityLayerKind = "global" | "project" | "team" | "persona" | "assignment";

export interface TeamIdentityLayer {
	readonly id: string;
	readonly kind: TeamIdentityLayerKind;
	/** `all`, a role, or an explicit agent id list. */
	readonly appliesTo: "all" | TeamIdentityRole | readonly string[];
	readonly content: string;
	readonly revision?: string;
	/** Required for persona layers to match the instantiated persona. */
	readonly personaId?: string;
	/** Required for assignment layers to match the instantiated agent. */
	readonly agentId?: string;
}

export interface TeamIdentityInput {
	readonly role: TeamIdentityRole;
	readonly agentId: string;
	readonly personaId?: string;
	readonly layers: readonly TeamIdentityLayer[];
}

export interface AppliedIdentityLayer {
	readonly id: string;
	readonly kind: TeamIdentityLayerKind;
	readonly revision?: string;
	readonly content: string;
}

export interface TeamIdentityContext {
	readonly role: TeamIdentityRole;
	readonly agentId: string;
	readonly personaId?: string;
	readonly layers: readonly AppliedIdentityLayer[];
	readonly excluded: readonly string[];
	/** Stable digest of the applied layers and their revisions. */
	readonly digest: string;
}

const KIND_ORDER: readonly TeamIdentityLayerKind[] = ["global", "project", "team", "persona", "assignment"];

function applies(layer: TeamIdentityLayer, input: TeamIdentityInput): boolean {
	if (layer.appliesTo === "all") return true;
	if (layer.appliesTo === input.role) return true;
	return Array.isArray(layer.appliesTo) && layer.appliesTo.includes(input.agentId);
}

function matchesScope(layer: TeamIdentityLayer, input: TeamIdentityInput): boolean {
	if (layer.kind === "persona") return !!input.personaId && layer.personaId === input.personaId;
	if (layer.kind === "assignment") return layer.agentId === undefined || layer.agentId === input.agentId;
	return true;
}

export function resolveTeamIdentity(input: TeamIdentityInput): TeamIdentityContext {
	const included: TeamIdentityLayer[] = [];
	const excluded: string[] = [];
	for (const layer of input.layers) {
		if (!applies(layer, input) || !matchesScope(layer, input)) excluded.push(layer.id);
		else included.push(layer);
	}
	included.sort((a, b) => {
		const rank = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
		return rank !== 0 ? rank : a.id.localeCompare(b.id);
	});
	const layers = included.map(layer => ({
		id: layer.id,
		kind: layer.kind,
		...(layer.revision === undefined ? {} : { revision: layer.revision }),
		content: layer.content,
	}));
	const digest = createHash("sha256")
		.update(
			JSON.stringify({
				role: input.role,
				agentId: input.agentId,
				personaId: input.personaId ?? null,
				layers,
			}),
		)
		.digest("hex");
	return {
		role: input.role,
		agentId: input.agentId,
		...(input.personaId === undefined ? {} : { personaId: input.personaId }),
		layers,
		excluded,
		digest,
	};
}
