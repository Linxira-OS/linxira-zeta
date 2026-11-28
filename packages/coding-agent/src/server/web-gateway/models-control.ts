/**
 * Web Gateway — read-only model-control snapshot.
 *
 * `GET /api/models/control` is the single projection the `/pages/models` page
 * renders. It combines the live model catalog (the only place a provider's
 * models and kinds come from), the settings that select roles/agents/fallback
 * chains, and the credential *presence* boolean — never a credential value.
 *
 * The snapshot is deliberately not a settings editor: the page has no write
 * path, so this module never reads a raw settings file and never writes one.
 * Fallback chains are normalized by `config/fallback-normalize.ts` (trimmed,
 * de-duplicated by canonical identity, order preserved) before leaving the
 * gateway; the page does not re-normalize or invent a second copy.
 *
 * ADR-0102 keeps the layers separate: providers/kinds come from the catalog,
 * roles and target identities come from the existing resolver, and the
 * Blueprint is a renderer-side projection of this same JSON.
 */

import * as path from "node:path";
import { type Model } from "@linxiraos/pi-ai";
import { getProviderDefinition } from "@linxiraos/pi-ai/registry";
import { type ModelKind, modelKind } from "@linxiraos/pi-catalog/types";
import {
	type FallbackModelResolver,
	FALLBACK_SCOPES,
	type FallbackScope,
	type KindFallbackScope,
	isKindFallbackScope,
	type NormalizedFallbackChain,
	normalizeFallbackChain,
	normalizeScopedFallbackChains,
} from "../../config/fallback-normalize";
import { getModelMatchPreferences, resolveModelRoleValue } from "../../config/model-resolver";
import {
	cfgDisabledProviders,
	cfgFallbackScopes,
	cfgModelAgents,
	cfgModelScenarios,
	type ModelDataBoundary,
} from "../../config/model-settings";
import { isPausedCapability, isProductCapability } from "../../config/provider-capabilities";
import { Settings } from "../../config/settings";
import { cfgRetryFallbackChains } from "../../session/settings";
import {
	enforceScenarioBoundary,
	type ModelScenarioMatch,
	modelDataBoundary,
	type ResolvedModelTarget,
	type ScenarioBoundaryOutcome,
	resolveModelTargetIdentity,
	resolveTeamModelTarget,
	resolveVibeModelTarget,
	TEAM_MODEL_TARGET_IDS,
} from "../../session/model-controls";
import { getSharedAuthStorage, getSharedModelRegistry } from "./auth";

/** Exact path the gateway dispatches; the standalone page repeats it by contract. */
export const MODELS_CONTROL_PATH = "/api/models/control";

/** Typed kinds the control page exposes, in section order. */
export const CONTROL_MODEL_KINDS = [
	"chat",
	"image",
	"tts",
	"stt",
	"decision",
	"embedding",
	"search",
	"rerank",
	"video",
] as const;

/** Catalog kind translated to the control surface's vocabulary (`judge` → `decision`). */
export type ControlModelKind = (typeof CONTROL_MODEL_KINDS)[number];

const CONTROL_KIND_BY_CATALOG_KIND: Readonly<Record<ModelKind, ControlModelKind>> = {
	chat: "chat",
	tiny: "chat",
	image: "image",
	tts: "tts",
	stt: "stt",
	search: "search",
	judge: "decision",
	embedding: "embedding",
	rerank: "rerank",
	video: "video",
};

/** Minimal credential view: existence only, never the credential detail. */
export interface ModelsControlCredentials {
	has(provider: string): boolean;
}

/** Minimal catalog view used by the snapshot builder (ModelRegistry satisfies it). */
export interface ModelsControlRegistry {
	getAll(kind?: "all"): Model[];
	find(provider: string, id: string): Model | undefined;
	hasConcreteAuth(provider: string): boolean;
	getError(): { message: string } | undefined;
}

export interface ModelsControlSources {
	readonly settings: Settings;
	readonly registry: ModelsControlRegistry;
	readonly credentials: ModelsControlCredentials;
}

export interface ModelControlProvider {
	readonly id: string;
	readonly name: string;
	readonly state: "visible" | "disabled";
	readonly enabled: boolean;
	/** A credential source exists. The value itself never enters the snapshot. */
	readonly configured: boolean;
	readonly modelCount: number;
	/** Product-visible capabilities (`judge` is reported as `decision`). */
	readonly capabilities: readonly ControlModelKind[];
	/** Catalog capabilities this release suppresses. */
	readonly paused: readonly ControlModelKind[];
}

export interface ModelControlModelRef {
	readonly provider: string;
	readonly id: string;
	readonly name: string;
	readonly kind: ControlModelKind;
	/** Unmapped catalog spelling, preserved so `decision` can be traced to `judge`. */
	readonly catalogKind: ModelKind;
}

export interface ModelControlSectionModel extends ModelControlModelRef {
	/** Provider is enabled and has a concrete credential source. */
	readonly available: boolean;
	/** Egress boundary implied by the provider endpoint (`local`, `private`, `public`). */
	readonly boundary: ModelDataBoundary;
}

export interface ModelControlKindSection {
	readonly kind: ControlModelKind;
	/** True for tts/stt/video: reported, not advertised as available. */
	readonly paused: boolean;
	readonly models: readonly ModelControlSectionModel[];
	/** This kind's own chain map (`fallbackScopes.<kind>`); never borrowed from retry/default. */
	readonly fallback: readonly ModelControlChain[];
}

export interface ModelControlDuplicate {
	readonly removed: string;
	readonly kept: string;
}

export interface ModelControlChain {
	readonly key: string;
	readonly chain: readonly string[];
	readonly duplicates: readonly ModelControlDuplicate[];
	readonly sameModelDifferentEffort: readonly {
		readonly modelKey: string;
		readonly thinkingLevels: readonly string[];
	}[];
}

export interface ModelControlScopeChains {
	readonly scope: FallbackScope;
	readonly chains: readonly ModelControlChain[];
}

export interface ModelControlRole {
	readonly role: string;
	/** Configured selector, or null when the role has no assignment. */
	readonly selector: string | null;
	readonly source: "agent" | "role" | "default";
	readonly resolved?: ModelControlModelRef;
	readonly thinkingLevel?: string;
	readonly warning?: string;
	readonly fallback: readonly string[];
	readonly fallbackSource?: string;
	readonly duplicates: readonly ModelControlDuplicate[];
}

export interface ModelControlTarget {
	readonly target: string;
	readonly kind: "agent" | "team";
	readonly role: string;
	readonly selector: string;
	readonly source: "agent" | "role" | "default";
	readonly resolved?: ModelControlModelRef;
	readonly thinkingLevel?: string;
	readonly warning?: string;
	readonly fallback: readonly string[];
	readonly fallbackSource?: string;
	readonly duplicates: readonly ModelControlDuplicate[];
}

export interface ModelControlScenarioSkipped {
	readonly selector: string;
	readonly boundary?: ModelDataBoundary;
	readonly reason: "boundary" | "unresolved";
}

export interface ModelControlScenarioTarget {
	readonly target: string;
	readonly selector: string;
	readonly fallback: readonly string[];
	readonly fallbackSource?: string;
	/** Boundary decision for the ordered primary + fallback candidates. */
	readonly outcome: ScenarioBoundaryOutcome;
	readonly selected?: ModelControlModelRef;
	readonly selectedBoundary?: ModelDataBoundary;
	readonly skipped: readonly ModelControlScenarioSkipped[];
	readonly reason?: string;
}

export interface ModelControlScenario {
	readonly name: string;
	readonly boundary: ModelDataBoundary;
	/** Defaults to true when the scenario does not set it. */
	readonly failClosed: boolean;
	readonly allowedAgents: readonly string[];
	/** An empty allowlist constrains every agent; `targets` stays empty. */
	readonly appliesToAll: boolean;
	readonly targets: readonly ModelControlScenarioTarget[];
}

export interface ModelsControlSnapshot {
	readonly schema: "models-control/1";
	/** This API is a projection only; no settings/write endpoint is exposed here. */
	readonly readOnly: true;
	readonly providers: readonly ModelControlProvider[];
	readonly roles: readonly ModelControlRole[];
	readonly fallbackScopes: readonly ModelControlScopeChains[];
	/** Legacy `retry.fallbackChains`, normalized; scoped retry chains stay separate. */
	readonly legacyRetry: readonly ModelControlChain[];
	readonly agents: readonly ModelControlTarget[];
	readonly teamTargets: readonly ModelControlTarget[];
	readonly vibeTargets: readonly ModelControlTarget[];
	readonly kinds: readonly ModelControlKindSection[];
	/** Deployment scenarios with their per-agent boundary decisions. */
	readonly scenarios: readonly ModelControlScenario[];
	/** Every catalog kind seen, including kinds folded into a control section (`tiny`). */
	readonly catalogKinds: readonly ModelKind[];
	readonly modelError?: string;
	readonly totals: {
		readonly providers: number;
		readonly models: number;
		readonly roles: number;
		readonly agents: number;
		readonly targets: number;
		readonly fallbackChains: number;
		readonly scenarios: number;
	};
}

function json(data: unknown, status = 200): Response {
	return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

function controlKindFor(kind: ModelKind): ControlModelKind {
	return CONTROL_KIND_BY_CATALOG_KIND[kind];
}

/** Product-visible kind for provider capabilities; `tiny` rides with chat. */
function productControlKind(kind: ModelKind): ControlModelKind | undefined {
	if (kind === "tiny") return "chat";
	if (!isProductCapability(kind)) return undefined;
	return controlKindFor(kind);
}

function modelRef(model: Model): ModelControlModelRef {
	const catalogKind = modelKind(model);
	return {
		provider: model.provider,
		id: model.id,
		name: model.name || model.id,
		kind: controlKindFor(catalogKind),
		catalogKind,
	};
}

function chainList(chains: Readonly<Record<string, NormalizedFallbackChain>>): ModelControlChain[] {
	return Object.entries(chains).map(([key, normalized]) => ({
		key,
		chain: [...normalized.chain],
		duplicates: normalized.duplicates.map(duplicate => ({ removed: duplicate.removed, kept: duplicate.kept })),
		sameModelDifferentEffort: normalized.sameModelDifferentEffort.map(entry => ({
			modelKey: entry.modelKey,
			thinkingLevels: [...entry.thinkingLevels],
		})),
	}));
}

/**
 * Catalog resolver shared by every scope: collapse aliases onto the model the
 * registry would actually load, but keep `provider/*` wildcard entries literal.
 */
function catalogResolver(registry: ModelsControlRegistry): FallbackModelResolver {
	return entry => {
		if (entry.modelKey.includes("*")) return undefined;
		const slash = entry.modelKey.indexOf("/");
		if (slash <= 0) return undefined;
		const model = registry.find(entry.modelKey.slice(0, slash), entry.modelKey.slice(slash + 1));
		return model === undefined ? undefined : { provider: model.provider, id: model.id };
	};
}

function resolveSelector(
	selector: string,
	settings: Settings,
	catalog: Model[],
): {
	resolved?: ModelControlModelRef;
	thinkingLevel?: string;
	warning?: string;
} {
	if (selector.trim() === "") return {};
	const resolved = resolveModelRoleValue(selector, catalog, {
		settings,
		matchPreferences: getModelMatchPreferences(settings),
	});
	return {
		...(resolved.model === undefined ? {} : { resolved: modelRef(resolved.model) }),
		...(resolved.thinkingLevel === undefined ? {} : { thinkingLevel: resolved.thinkingLevel }),
		...(resolved.warning === undefined ? {} : { warning: resolved.warning }),
	};
}

function modelForSelector(selector: string, settings: Settings, catalog: Model[]): Model | undefined {
	if (selector.trim() === "") return undefined;
	return resolveModelRoleValue(selector, catalog, {
		settings,
		matchPreferences: getModelMatchPreferences(settings),
	}).model;
}

function scenarioTargetDto(
	scenario: ModelScenarioMatch,
	target: string,
	settings: Settings,
	catalog: Model[],
	resolveModel: FallbackModelResolver,
): ModelControlScenarioTarget {
	const identity = resolveModelTargetIdentity(settings, target, { resolveModel });
	const selectors = [identity.selector, ...identity.fallback];
	const decision = enforceScenarioBoundary(
		scenario,
		selectors.map(selector => ({ selector, model: modelForSelector(selector, settings, catalog) })),
	);
	const selected = decision.chosen?.model;
	return {
		target,
		selector: identity.selector,
		fallback: [...identity.fallback],
		...(identity.fallbackSource === undefined ? {} : { fallbackSource: identity.fallbackSource }),
		outcome: decision.outcome,
		...(selected === undefined ? {} : { selected: modelRef(selected) }),
		...(decision.modelBoundary === undefined ? {} : { selectedBoundary: decision.modelBoundary }),
		skipped: decision.skipped.map(entry => ({ ...entry })),
		...(decision.reason === undefined ? {} : { reason: decision.reason }),
	};
}

function targetDto(target: ResolvedModelTarget, settings: Settings, catalog: Model[]): ModelControlTarget {
	const resolved = resolveSelector(target.selector, settings, catalog);
	return {
		target: target.target,
		kind: target.kind,
		role: target.role,
		selector: target.selector,
		source: target.source,
		...(resolved.resolved === undefined ? {} : { resolved: resolved.resolved }),
		...(target.thinkingLevel === undefined
			? resolved.thinkingLevel === undefined
				? {}
				: { thinkingLevel: resolved.thinkingLevel }
			: { thinkingLevel: target.thinkingLevel }),
		...(resolved.warning === undefined ? {} : { warning: resolved.warning }),
		fallback: [...target.fallback],
		...(target.fallbackSource === undefined ? {} : { fallbackSource: target.fallbackSource }),
		duplicates: target.duplicates.map(duplicate => ({ removed: duplicate.removed, kept: duplicate.kept })),
	};
}

function roleDto(
	role: string,
	settings: Settings,
	catalog: Model[],
	resolveModel: FallbackModelResolver,
): ModelControlRole {
	const target = resolveModelTargetIdentity(settings, role, { kind: "agent", role, resolveModel });
	const resolved = resolveSelector(target.selector, settings, catalog);
	const configured = settings.getModelRoles()[role];
	return {
		role,
		selector: configured ?? null,
		source: target.source,
		...(resolved.resolved === undefined ? {} : { resolved: resolved.resolved }),
		...(target.thinkingLevel === undefined
			? resolved.thinkingLevel === undefined
				? {}
				: { thinkingLevel: resolved.thinkingLevel }
			: { thinkingLevel: target.thinkingLevel }),
		...(resolved.warning === undefined ? {} : { warning: resolved.warning }),
		fallback: [...target.fallback],
		...(target.fallbackSource === undefined ? {} : { fallbackSource: target.fallbackSource }),
		duplicates: target.duplicates.map(duplicate => ({ removed: duplicate.removed, kept: duplicate.kept })),
	};
}

/**
 * Build the secret-free snapshot. `credentials` is consulted only through
 * `has(provider)`; no caller may pass a raw credential store dereference here.
 */
export function buildModelsControlSnapshot({
	settings,
	registry,
	credentials,
}: ModelsControlSources): ModelsControlSnapshot {
	const catalog = registry.getAll("all");
	const disabled = new Set(cfgDisabledProviders.get(settings));
	const resolveModel = catalogResolver(registry);
	const catalogKinds = new Set<ModelKind>();
	const modelsByKind = new Map<ControlModelKind, Model[]>();
	const byProvider = new Map<
		string,
		{
			count: number;
			capabilities: Set<ControlModelKind>;
			paused: Set<ControlModelKind>;
		}
	>();
	for (const model of catalog) {
		const kind = modelKind(model);
		catalogKinds.add(kind);
		const controlKind = controlKindFor(kind);
		const bucket = modelsByKind.get(controlKind) ?? [];
		bucket.push(model);
		modelsByKind.set(controlKind, bucket);
		const state = byProvider.get(model.provider) ?? {
			count: 0,
			capabilities: new Set<ControlModelKind>(),
			paused: new Set<ControlModelKind>(),
		};
		state.count += 1;
		if (isPausedCapability(kind)) state.paused.add(controlKindFor(kind));
		else {
			const productKind = productControlKind(kind);
			if (productKind !== undefined) state.capabilities.add(productKind);
		}
		byProvider.set(model.provider, state);
	}
	for (const provider of disabled) {
		if (!byProvider.has(provider)) byProvider.set(provider, { count: 0, capabilities: new Set(), paused: new Set() });
	}
	// Credential checks resolve once per provider, not once per catalog row.
	const configuredProviders = new Map<string, boolean>();
	for (const provider of byProvider.keys()) {
		configuredProviders.set(provider, registry.hasConcreteAuth(provider) || credentials.has(provider));
	}

	const providers: ModelControlProvider[] = [...byProvider.entries()]
		.map(([id, state]) => {
			const enabled = !disabled.has(id);
			return {
				id,
				name: getProviderDefinition(id)?.name ?? id,
				state: enabled ? ("visible" as const) : ("disabled" as const),
				enabled,
				configured: configuredProviders.get(id) === true,
				modelCount: state.count,
				capabilities: CONTROL_MODEL_KINDS.filter(kind => state.capabilities.has(kind)),
				paused: CONTROL_MODEL_KINDS.filter(kind => state.paused.has(kind)),
			};
		})
		.sort((left, right) => left.id.localeCompare(right.id));

	const scoped = normalizeScopedFallbackChains(cfgFallbackScopes.get(settings), { resolveModel });
	const fallbackScopes: ModelControlScopeChains[] = FALLBACK_SCOPES.map(scope => ({
		scope,
		chains: chainList(scoped[scope]),
	}));
	const legacyChains = cfgRetryFallbackChains.get(settings) ?? {};
	const legacyRetry = chainList(
		Object.fromEntries(
			Object.entries(legacyChains)
				.filter((entry): entry is [string, string[]] => Array.isArray(entry[1]))
				.map(([key, chain]) => [key, normalizeFallbackChain(chain, { resolveModel })]),
		),
	);

	const roles = Object.keys(settings.getModelRoles()).map(role => roleDto(role, settings, catalog, resolveModel));
	const agentNames = Object.keys(cfgModelAgents.get(settings));
	const agents = agentNames.map(target =>
		targetDto(resolveModelTargetIdentity(settings, target, { resolveModel }), settings, catalog),
	);
	const teamTargets = TEAM_MODEL_TARGET_IDS.map(target =>
		targetDto(resolveTeamModelTarget(settings, target, { resolveModel }), settings, catalog),
	);
	const vibeTargets = TEAM_MODEL_TARGET_IDS.map(target =>
		targetDto(resolveVibeModelTarget(settings, target, { resolveModel }), settings, catalog),
	);

	const scenarios: ModelControlScenario[] = Object.entries(cfgModelScenarios.get(settings)).map(
		([name, configured]) => {
			const allowedAgents = (configured.allowedAgents ?? [])
				.map(agent => agent.trim())
				.filter(agent => agent !== "");
			const match: ModelScenarioMatch = {
				name,
				boundary: configured.boundary,
				failClosed: configured.failClosed !== false,
				allowedAgents,
			};
			return {
				name,
				boundary: match.boundary,
				failClosed: match.failClosed,
				allowedAgents,
				appliesToAll: allowedAgents.length === 0,
				targets: allowedAgents.map(target => scenarioTargetDto(match, target, settings, catalog, resolveModel)),
			};
		},
	);

	const kinds: ModelControlKindSection[] = CONTROL_MODEL_KINDS.map(kind => {
		const fallbackScope: KindFallbackScope | undefined = isKindFallbackScope(kind) ? kind : undefined;
		return {
			kind,
			paused: isPausedCapability(kind),
			models: (modelsByKind.get(kind) ?? []).map(model => ({
				...modelRef(model),
				available: !disabled.has(model.provider) && configuredProviders.get(model.provider) === true,
				boundary: modelDataBoundary(model),
			})),
			fallback: fallbackScope === undefined ? [] : chainList(scoped[fallbackScope]),
		};
	}).filter(section => section.models.length > 0);

	const modelError = registry.getError()?.message;
	const fallbackChainCount =
		fallbackScopes.reduce((count, scope) => count + scope.chains.length, 0) + legacyRetry.length;
	return {
		schema: "models-control/1",
		readOnly: true,
		providers,
		roles,
		fallbackScopes,
		legacyRetry,
		agents,
		teamTargets,
		vibeTargets,
		kinds,
		scenarios,
		catalogKinds: [...catalogKinds].sort(),
		...(modelError === undefined ? {} : { modelError }),
		totals: {
			providers: providers.length,
			models: catalog.length,
			roles: roles.length,
			agents: agents.length,
			targets: teamTargets.length + vibeTargets.length,
			fallbackChains: fallbackChainCount,
			scenarios: scenarios.length,
		},
	};
}

/**
 * Handle `GET /api/models/control` (auth/CSRF/scope are enforced by the
 * gateway dispatcher before this function runs). `sources` exists for focused
 * tests so they do not have to boot the process-wide registry.
 */
export async function handleModelsControl(req?: Request, sources?: ModelsControlSources): Promise<Response> {
	try {
		if (sources !== undefined) return json(buildModelsControlSnapshot(sources));
		const cwd = path.resolve((req ? new URL(req.url).searchParams.get("cwd") : null) ?? process.cwd());
		const [settings, registry, authStorage] = await Promise.all([
			Settings.init({ cwd }),
			getSharedModelRegistry(),
			getSharedAuthStorage(),
		]);
		return json(
			buildModelsControlSnapshot({
				settings,
				registry,
				credentials: authStorage.credentials,
			}),
		);
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, 500);
	}
}
