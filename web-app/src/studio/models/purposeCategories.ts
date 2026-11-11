/**
 * Pure helpers for the model-settings "purpose category" cards.
 *
 * A category is an existing custom/builtin model role (`modelRoles.<id>`),
 * tagged by `modelTags[name/color/hidden]`, with one optional ordered fallback
 * chain (`retry.fallbackChains.<id>`). No second data model is introduced.
 */
import type { AvailableModelRecord, ModelRoleRecord } from "@linxiraos/studio-contract";

/** Default visible cards; custom roles are appended by the page. */
export const PURPOSE_CATEGORY_IDS = ["default", "task", "research"] as const;
export type PurposeCategoryId = (typeof PURPOSE_CATEGORY_IDS)[number];

/** Role alias tokens that may name a category in an agent definition/override. */
export function roleAliasTokens(roleId: string): string[] {
	return [`@${roleId}`, `pi/${roleId}`];
}

/** Whether `selector` names the role exactly (`@role` or `pi/role`, optional thinking suffix). */
export function selectorNamesRole(selector: string | undefined, roleId: string): boolean {
	const value = selector?.trim();
	if (!value) return false;
	for (const token of roleAliasTokens(roleId)) {
		if (value === token) return true;
		if (value.startsWith(`${token}:`)) return true;
	}
	return false;
}

export type CategoryChainSource = "explicit" | "inherited-default" | "none";

/**
 * The chain a category would walk.
 *
 * `default` owns its chain. A chat role without its own key inherits the
 * runtime's default chain, which the card must surface as a warning instead of
 * pretending it has no fallback.
 */
export function categoryChain(
	chains: Readonly<Record<string, ReadonlyArray<string>>>,
	roleId: string,
): { chain: string[]; source: CategoryChainSource } {
	if (Object.hasOwn(chains, roleId)) return { chain: [...(chains[roleId] ?? [])], source: "explicit" };
	if (roleId !== "default" && Object.hasOwn(chains, "default")) {
		return { chain: [...(chains.default ?? [])], source: "inherited-default" };
	}
	return { chain: [], source: "none" };
}


/** Canonical role display alias; tolerates a leading `@` or legacy `pi/` once. */
export function formatRoleAlias(roleId: string): string {
	const raw = roleId.trim();
	const bare = raw.startsWith("@") ? raw.slice(1) : raw.startsWith("pi/") ? raw.slice(3) : raw;
	return `@${bare}`;
}


/** Resolve with the promise, or `undefined` once `timeoutMs` elapses. */
export function awaitWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
	return Promise.race([
		promise,
		new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), timeoutMs)),
	]);
}

export interface PurposeCategoryCard {
	readonly key: string;
	readonly id: string;
	readonly role?: ModelRoleRecord;
	readonly missingPreset?: "research";
}

/**
 * Cards for the default presets plus every custom role. Exactly one Research
 * placeholder (only when that preset has no role); deduplicated keys ensure
 * React never receives repeated nodes.
 */
export function purposeCategoryCards(
	roles: ReadonlyArray<ModelRoleRecord>,
	presetIds: ReadonlyArray<string>,
): PurposeCategoryCard[] {
	const presetCards = presetIds.map(id => {
		const role = roles.find(item => item.id === id);
		return role
			? { key: `purpose-${id}`, id, role }
			: id === "research"
				? { key: "purpose-research-missing", id, missingPreset: "research" as const }
				: undefined;
	});
	const customCards = roles
		.filter(role => !presetIds.includes(role.id) && !role.builtin)
		.map(role => ({ key: `purpose-${role.id}`, id: role.id, role }));
	const seen = new Set<string>();
	return [...presetCards, ...customCards].flatMap(card => {
		if (!card || seen.has(card.key)) return [];
		seen.add(card.key);
		return [card];
	});
}

/** Category names whose agent definitions or per-agent overrides still reference `roleId`. */
export function agentRoleReferences(
	agents: ReadonlyArray<{
		name: string;
		model?: ReadonlyArray<string> | undefined;
		overrideModel?: string | undefined;
	}>,
	roleId: string,
): string[] {
	const names: string[] = [];
	for (const agent of agents) {
		const referencesRole =
			selectorNamesRole(agent.overrideModel, roleId) ||
			(agent.model ?? []).some(selector => selectorNamesRole(selector, roleId));
		if (referencesRole) names.push(agent.name);
	}
	return names.sort((left, right) => left.localeCompare(right));
}

/** A model is eligible for a purpose category only when its catalog kind is chat. */
export function isChatCategoryModel(model: Pick<AvailableModelRecord, "kind">): boolean {
	return model.kind === undefined || model.kind === "chat";
}

export type AgentModelMode = "inherit" | "category" | "exact";

/** Split a persisted `task.agentModelOverrides` value into the three-state UI model. */
export function classifyAgentModelOverride(
	override: string | undefined,
	definitionModels: ReadonlyArray<string> = [],
): { mode: AgentModelMode; roleId: string; exact: string; selector: string } {
	const value = override?.trim() ?? "";
	if (value === "") {
		return { mode: "inherit", roleId: "", exact: "", selector: definitionModels[0] ?? "" };
	}
	if (value.startsWith("@") || value.startsWith("pi/")) {
		return { mode: "category", roleId: value.slice(value.startsWith("pi/") ? 3 : 1), exact: "", selector: value };
	}
	return { mode: "exact", roleId: "", exact: value, selector: value };
}

/** Canonical persisted override for a UI draft (empty = inherit the definition). */
export function agentModelOverrideFor(draft: { mode: AgentModelMode; roleId: string; exact: string }): string {
	if (draft.mode === "inherit") return "";
	if (draft.mode === "category") return draft.roleId.trim() ? `@${draft.roleId.trim()}` : "";
	return draft.exact.trim();
}

export interface ResolvedAgentModel {
	readonly source: "inherit" | "category" | "exact" | "unresolved";
	readonly selector: string;
	readonly roleId?: string;
	readonly model?: AvailableModelRecord;
}

/**
 * Resolve the model an agent would actually run for a given override/selection,
 * for the explicit readout in the per-agent dropdown. Never invents a model:
 * an unset definition or unknown selector returns `unresolved`.
 */
export function resolveAgentModel(
	override: string | undefined,
	definitionModels: ReadonlyArray<string>,
	roles: ReadonlyArray<ModelRoleRecord>,
	available: ReadonlyArray<AvailableModelRecord>,
): ResolvedAgentModel {
	const classified = classifyAgentModelOverride(override, definitionModels);
	if (classified.mode === "inherit") {
		if (classified.selector === "") return { source: "unresolved", selector: "" };
		return resolveSelector(classified.selector, roles, available, "inherit");
	}
	if (classified.mode === "category") {
		const role = roles.find(item => item.id === classified.roleId);
		if (!role?.primary) return { source: "unresolved", selector: classified.selector, roleId: classified.roleId };
		return resolveSelector(role.primary, roles, available, "category", role.id);
	}
	return resolveSelector(classified.selector, roles, available, "exact");
}

function resolveSelector(
	selector: string,
	roles: ReadonlyArray<ModelRoleRecord>,
	available: ReadonlyArray<AvailableModelRecord>,
	source: ResolvedAgentModel["source"],
	roleId?: string,
): ResolvedAgentModel {
	const role = roles.find(item => selectorNamesRole(selector, item.id));
	if (role?.primary) {
		const model = available.find(item => item.selector === role.primary);
		return { source, selector: role.primary, roleId: role.id, ...(model === undefined ? {} : { model }) };
	}
	const model = available.find(item => item.selector === selector);
	if (!model) return { source: "unresolved", selector, ...(roleId === undefined ? {} : { roleId }) };
	return { source, selector, ...(roleId === undefined ? {} : { roleId }), model };
}

/** Context/cost facts without guessing: unknown values stay `undefined`. */
export function categoryModelFacts(model: AvailableModelRecord | undefined): {
	contextWindow: number | undefined;
	costLabel: string | undefined;
} {
	if (!model) return { contextWindow: undefined, costLabel: undefined };
	const cost = model.cost;
	const hasCost =
		cost !== undefined &&
		[cost.input, cost.output, cost.cacheRead, cost.cacheWrite].some(
			value => typeof value === "number" && Number.isFinite(value),
		);
	const costLabel = hasCost
		? [cost?.input, cost?.output]
				.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
				.join("/")
		: undefined;
	return {
		contextWindow: model.contextWindow,
		costLabel: costLabel === "" ? undefined : costLabel,
	};
}
