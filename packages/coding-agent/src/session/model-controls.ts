import { type Agent, ThinkingLevel } from "@linxiraos/pi-agent-core";
import type {
	Model,
	ProviderSessionState,
	ServiceTier,
	ServiceTierByFamily,
	ServiceTierFamily,
} from "@linxiraos/pi-ai";
import {
	Effort,
	realizesPriorityServiceTier,
	resolveModelServiceTier,
	serviceTierFamily,
	shouldSendServiceTier,
} from "@linxiraos/pi-ai";
import {
	clearAnthropicFastModeFallback,
	isAnthropicFastModeFallbackDisabled,
} from "@linxiraos/pi-ai/providers/anthropic-state";
import { isFireworksFastModelId } from "@linxiraos/pi-catalog/fireworks-model-id";
import { THINKING_EFFORTS } from "@linxiraos/pi-catalog/effort";
import { getSupportedEfforts } from "@linxiraos/pi-catalog/model-thinking";
import { modelsAreEqual, routedModelsAreEqual } from "@linxiraos/pi-catalog/models";
import { logger, isRecord } from "@linxiraos/pi-utils";
import { classifyDifficulty } from "../auto-thinking/classifier";
import type { ModelRegistry } from "../config/model-registry";
import {
	filterAvailableModelsByEnabledPatterns,
	findScopedModelIndex,
	formatModelStringWithRouting,
	getModelMatchPreferences,
	type ResolvedModelRoleValue,
	resolveImplicitDefaultRole,
	resolveModelRoleValue,
} from "../config/model-resolver";
import {
	type FallbackDuplicate,
	type FallbackModelResolver,
	findKindFallbackChain,
	findScopedFallbackChain,
	isTargetFallbackScope,
	type KindFallbackScope,
	mergeFallbackChains,
	normalizeFallbackChain,
	normalizeScopedFallbackChains,
	type ScopedFallbackLookup,
	type TargetFallbackScope,
} from "../config/fallback-normalize";
import { formatModelRoleAlias } from "../config/model-roles";
import { buildServiceTierByFamily } from "../config/service-tier";
import type { Settings } from "../config/settings";
import { containsMagicKeyword } from "./magic-keywords";
import type { ModelRoleLookup } from "../modes/view-model/overlays/model-browser";
import type { MagicKeywordId } from "../modes/magic-keywords";
import {
	AUTO_THINKING,
	automaticThinkingLevel,
	clampAutoThinkingEffort,
	clampThinkingLevelToCeiling,
	parseThinkingLevel,
	resolveProvisionalAutoLevel,
	resolveThinkingLevelForModel,
	shouldDisableReasoning,
	toReasoningEffort,
} from "../thinking/levels";
import { type ConfiguredThinkingLevel } from "../utils/render-utils";
import type { EditModeSetting } from "../edit/settings";
import type { AgentSessionEvent } from "./agent-session-events";
import type { ModelCycleResult, ResolvedRoleModel, RoleModelCycle, RoleModelCycleResult } from "./agent-session-types";
import { formatRoleModelValue, resolveRoleModelFull } from "./role-models";
import { EPHEMERAL_MODEL_CHANGE_ROLE, PREWALK_MODEL_CHANGE_ROLE, TEMPORARY_MODEL_CHANGE_ROLE } from "./session-entries";
import type { SessionManager } from "./session-manager";

import {
	cfgDefaultThinkingLevel,
	cfgProvidersFireworksTier,
	cfgTierAnthropic,
	cfgTierGoogle,
	cfgTierOpenai,
} from "./settings";
import { getRetryFallbackChains } from "./retry-fallback-chains";
import {
	cfgDisabledProviders,
	cfgEnabledModels,
	cfgFallbackScopes,
	cfgModelAgents,
	cfgModelScenarios,
	type ModelAgentIdentity,
	type ModelDataBoundary,
} from "../config/model-settings";

/**
 * Whether `model` takes effort per message, so changing it mid-conversation keeps the cached prefix:
 * Anthropic per-message `output_config`, or OpenAI `configuration_update` items (standard reasoning mode only).
 */
function takesPerMessageEffort(model: Model): boolean {
	const { compat } = model;
	if (compat === undefined) return false;
	if ("supportsPerMessageEffort" in compat && compat.supportsPerMessageEffort === true) return true;
	return (
		"supportsConfigurationUpdate" in compat &&
		compat.supportsConfigurationUpdate === true &&
		model.reasoningMode !== "pro"
	);
}

/**
 * Role-model cycle in `roleOrder` for a session running `currentModel` whose
 * newest recorded model change used `lastRole`; see {@link ModelControls.getRoleModelCycle}.
 */
export function resolveRoleModelCycle(
	settings: Settings,
	availableModels: Model[],
	currentModel: Model | undefined,
	lastRole: string | undefined,
	roleOrder: readonly string[],
): RoleModelCycle | undefined {
	if (availableModels.length === 0 || !currentModel) return undefined;
	const matchPreferences = getModelMatchPreferences(settings);
	const models: ResolvedRoleModel[] = [];
	for (const role of roleOrder) {
		const configuredRole = settings.getModelRole(role);
		const resolved =
			role === "default" && !configuredRole
				? resolveImplicitDefaultRole(currentModel, availableModels, matchPreferences)
				: resolveModelRoleValue(configuredRole, availableModels, { settings, matchPreferences });
		if (!resolved.model) continue;
		models.push({
			role,
			model: resolved.model,
			thinkingLevel: resolved.thinkingLevel,
			explicitThinkingLevel: resolved.explicitThinkingLevel,
		});
	}
	if (models.length === 0) return undefined;

	// Trust the recorded role only while its resolved model still IS the
	// active model. A model switch through another surface (alt+m, retry
	// fallback, /model) or a role re-configuration leaves the recorded role
	// pointing at a model the session no longer runs; cycling from that
	// stale slot lands on the wrong neighbor and reads as a skipped entry.
	let currentIndex = lastRole ? models.findIndex(entry => entry.role === lastRole) : -1;
	if (currentIndex !== -1 && !routedModelsAreEqual(models[currentIndex].model, currentModel)) {
		currentIndex = -1;
	}
	if (currentIndex === -1) {
		currentIndex = models.findIndex(entry => routedModelsAreEqual(entry.model, currentModel));
	}
	if (currentIndex === -1) currentIndex = 0;
	return { models, currentIndex };
}

/**
 * Effective wire service tier for a request to `model` under the per-family
 * `tiers`. Fireworks models take the Priority serving path only when the
 * Providers › Fireworks Tier setting is `"priority"` (and never for `-fast`
 * variants, whose Fast serving path is mutually exclusive with Priority).
 */
export function serviceTierForModel(
	settings: Settings,
	model: Model,
	tiers: ServiceTierByFamily,
): ServiceTier | undefined {
	if (model.provider === "fireworks") {
		return cfgProvidersFireworksTier.get(settings) === "priority" && !isFireworksFastModelId(model.id)
			? "priority"
			: undefined;
	}
	return resolveModelServiceTier(tiers, model);
}

/**
 * Vibe/Team role targets share the model-control surface with named agents.
 * The role is the zero-migration default when no `modelAgents` entry exists:
 * `worker` runs the generic `task` selector, `reviewer` the `slow` role, and
 * the PM the `default` role, matching the bundled agent frontmatter.
 */
export const TEAM_MODEL_TARGETS = {
	worker: "task",
	reviewer: "slow",
	secretary: "task",
	pm: "default",
} as const;
export type TeamModelTarget = keyof typeof TEAM_MODEL_TARGETS;
export const TEAM_MODEL_TARGET_IDS: readonly TeamModelTarget[] = Object.keys(TEAM_MODEL_TARGETS) as TeamModelTarget[];

export type ModelTargetKind = "agent" | "team";
export type ModelTargetPrimarySource = "agent" | "role" | "default";
export type ModelTargetFallbackSource = TargetFallbackScope | "legacy-retry";

export interface ModelTargetResolutionOptions {
	/** Defaults to `team` when the target is one of {@link TEAM_MODEL_TARGETS}. */
	kind?: ModelTargetKind;
	/** Model role supplying the primary when the target has no `model`. */
	role?: string;
	/** Vibe/Team mode whose `fallbackScopes.mode` chain may apply. */
	mode?: string;
	/**
	 * Which fallback scope applies. `auto` (default) walks the inheritance
	 * order agent -> mode -> role -> retry, then the legacy retry chains.
	 * Naming a scope reads that scope only; no chain crosses scopes.
	 */
	fallbackScope?: TargetFallbackScope | "auto";
	/** Set false to stop an agent/team target inheriting legacy `retry.fallbackChains`. */
	inheritRetryFallback?: boolean;
	/** Catalog hook used to collapse alias spellings while normalizing chains. */
	resolveModel?: FallbackModelResolver;
}

/** Model identity a named agent or Vibe/Team target resolves to. */
export interface ResolvedModelTarget {
	readonly target: string;
	readonly kind: ModelTargetKind;
	/** Model role that supplied the primary when the target had no override. */
	readonly role: string;
	/** Selector to resolve against the catalog, or a `@role` alias. */
	readonly selector: string;
	readonly source: ModelTargetPrimarySource;
	readonly thinkingLevel?: ConfiguredThinkingLevel;
	/** Ordered fallback selectors with duplicate identities removed. */
	readonly fallback: readonly string[];
	/** Scope that supplied `fallback`; absent when no chain is configured. */
	readonly fallbackSource?: ModelTargetFallbackSource;
	readonly duplicates: readonly FallbackDuplicate[];
}

function readAgentIdentity(value: unknown): ModelAgentIdentity | undefined {
	if (typeof value === "string") {
		const model = value.trim();
		return model === "" ? undefined : { model };
	}
	if (!isRecord(value)) return undefined;
	const model = typeof value.model === "string" && value.model.trim() !== "" ? value.model.trim() : undefined;
	const thinkingLevel =
		typeof value.thinkingLevel === "string"
			? value.thinkingLevel === AUTO_THINKING
				? AUTO_THINKING
				: parseThinkingLevel(value.thinkingLevel)
			: undefined;
	const fallback = Array.isArray(value.fallback)
		? value.fallback
				.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
				.map(entry => entry.trim())
		: undefined;
	if (model === undefined && thinkingLevel === undefined && fallback === undefined) return undefined;
	return {
		...(model === undefined ? {} : { model }),
		...(thinkingLevel === undefined ? {} : { thinkingLevel }),
		...(fallback === undefined ? {} : { fallback }),
	};
}

interface SelectedTargetFallback {
	readonly chain?: readonly string[];
	readonly source?: ModelTargetFallbackSource;
}

function selectTargetFallback(
	settings: Settings,
	target: string,
	role: string,
	identity: ModelAgentIdentity | undefined,
	options: ModelTargetResolutionOptions,
): SelectedTargetFallback {
	const scope = options.fallbackScope ?? "auto";
	if ((scope === "auto" || scope === "agent") && identity?.fallback !== undefined) {
		return { chain: identity.fallback, source: "agent" };
	}
	const normalized = normalizeScopedFallbackChains(
		cfgFallbackScopes.get(settings),
		options.resolveModel ? { resolveModel: options.resolveModel } : {},
	);
	const lookups: ScopedFallbackLookup[] = [];
	switch (scope) {
		case "auto":
			lookups.push({ scope: "agent", key: target });
			if (options.mode !== undefined) lookups.push({ scope: "mode", key: options.mode });
			lookups.push({ scope: "role", key: role });
			lookups.push({ scope: "retry", key: role });
			break;
		case "mode":
			lookups.push({ scope: "mode", key: options.mode ?? target });
			break;
		case "agent":
			lookups.push({ scope: "agent", key: target });
			break;
		case "role":
			lookups.push({ scope: "role", key: role });
			break;
		case "retry":
			lookups.push({ scope: "retry", key: target }, { scope: "retry", key: role });
			break;
		case "resume":
			lookups.push({ scope: "resume", key: target }, { scope: "resume", key: role });
			break;
	}
	const found = findScopedFallbackChain(normalized, lookups);
	if (found) {
		return {
			chain: found.chain.chain,
			...(isTargetFallbackScope(found.scope) ? { source: found.scope } : {}),
		};
	}
	if ((scope === "auto" || scope === "retry") && options.inheritRetryFallback !== false) {
		const legacy = getRetryFallbackChains(settings);
		const chain = legacy[role] ?? legacy.default;
		if (Array.isArray(chain)) return { chain, source: "legacy-retry" };
	}
	return {};
}

function normalizeTargetFallback(
	selector: string,
	chain: readonly string[] | undefined,
	options: ModelTargetResolutionOptions,
): { fallback: readonly string[]; duplicates: readonly FallbackDuplicate[] } {
	const normalizeOptions = options.resolveModel ? { resolveModel: options.resolveModel } : {};
	const normalized = normalizeFallbackChain(chain, normalizeOptions);
	// `mergeFallbackChains` keeps the primary first, so a fallback spelling that
	// resolves to the primary model is dropped instead of counted twice.
	const merged = mergeFallbackChains([selector], normalized.chain, normalizeOptions);
	return { fallback: merged.slice(1), duplicates: normalized.duplicates };
}

/**
 * Resolve a named agent or Vibe/Team role target against the model-control
 * configuration. A target's own `modelAgents` entry wins; a missing `model`
 * falls back to the role's configured selector, then to the role alias.
 */
export function resolveModelTargetIdentity(
	settings: Settings,
	target: string,
	options: ModelTargetResolutionOptions = {},
): ResolvedModelTarget {
	const name = target.trim();
	const lowered = name.toLowerCase();
	const teamRole = Object.hasOwn(TEAM_MODEL_TARGETS, lowered)
		? TEAM_MODEL_TARGETS[lowered as TeamModelTarget]
		: undefined;
	const kind = options.kind ?? (teamRole === undefined ? "agent" : "team");
	const role = options.role ?? teamRole ?? "task";
	const agents = cfgModelAgents.get(settings);
	const configured = Object.hasOwn(agents, name) ? agents[name] : agents[lowered];
	const identity = readAgentIdentity(configured);
	const roleSelector = settings.getModelRole(role)?.trim() || undefined;
	const selector = identity?.model ?? roleSelector ?? formatModelRoleAlias(role);
	const source = identity?.model !== undefined ? "agent" : roleSelector !== undefined ? "role" : "default";
	const selected = selectTargetFallback(settings, name, role, identity, options);
	const normalized = normalizeTargetFallback(selector, selected.chain, options);
	return {
		target: name,
		kind,
		role,
		selector,
		source,
		...(identity?.thinkingLevel === undefined ? {} : { thinkingLevel: identity.thinkingLevel }),
		fallback: normalized.fallback,
		...(selected.source === undefined ? {} : { fallbackSource: selected.source }),
		duplicates: normalized.duplicates,
	};
}

/** Resolve a Vibe/Team target (`worker`, `reviewer`, `secretary`, `pm`). */
export function resolveTeamModelTarget(
	settings: Settings,
	target: TeamModelTarget,
	options: ModelTargetResolutionOptions = {},
): ResolvedModelTarget {
	return resolveModelTargetIdentity(settings, target, {
		...options,
		kind: "team",
		role: options.role ?? TEAM_MODEL_TARGETS[target],
	});
}

/** Resolve a Vibe/Team target with the `vibe` mode fallback scope applied. */
export function resolveVibeModelTarget(
	settings: Settings,
	target: TeamModelTarget,
	options: ModelTargetResolutionOptions = {},
): ResolvedModelTarget {
	return resolveTeamModelTarget(settings, target, { ...options, mode: options.mode ?? "vibe" });
}

/** One model kind's own fallback chain, with no cross-scope inheritance. */
export interface KindFallbackResolution {
	readonly kind: KindFallbackScope;
	readonly chain: readonly string[];
	readonly duplicates: readonly FallbackDuplicate[];
	/** Set only when this kind's scope has a configured key (an empty chain still counts). */
	readonly source?: { readonly scope: KindFallbackScope; readonly key: string };
}

/**
 * Resolve the fallback chain for a model kind. Only `fallbackScopes.<kind>` is
 * read; a missing chain stays empty and never borrows `retry`, `role`, or the
 * legacy `retry.fallbackChains` default. Keys are tried in caller order.
 */
export function resolveKindFallback(
	settings: Settings,
	kind: KindFallbackScope,
	keys: readonly string[],
	options: { resolveModel?: FallbackModelResolver } = {},
): KindFallbackResolution {
	const normalized = normalizeScopedFallbackChains(
		cfgFallbackScopes.get(settings),
		options.resolveModel === undefined ? {} : { resolveModel: options.resolveModel },
	);
	const found = findKindFallbackChain(normalized, kind, keys);
	return {
		kind,
		chain: [...(found?.chain.chain ?? [])],
		duplicates: (found?.chain.duplicates ?? []).map(duplicate => ({ ...duplicate })),
		...(found === undefined ? {} : { source: { scope: found.scope, key: found.key } }),
	};
}

/**
 * Ordered egress boundaries. A scenario allows its own boundary and every
 * more restrictive one (a `private` scenario may use local or private models,
 * but never a public vendor API).
 */
const BOUNDARY_RANK: Readonly<Record<ModelDataBoundary, number>> = { local: 0, private: 1, public: 2 };

/** Providers whose models stay on this machine when no endpoint is recorded. */
const LOCAL_PROVIDER_IDS: Readonly<Record<string, true>> = {
	local: true,
	ollama: true,
	"llama.cpp": true,
	"lm-studio": true,
	vllm: true,
	"apple-foundation-models": true,
};

function isLoopbackHostname(hostname: string): boolean {
	return (
		hostname === "localhost" ||
		hostname === "0.0.0.0" ||
		hostname === "::1" ||
		hostname === "[::1]" ||
		hostname.startsWith("127.")
	);
}

function isPrivateHostname(hostname: string): boolean {
	if (hostname.startsWith("10.")) return true;
	if (hostname.startsWith("192.168.")) return true;
	if (/^172\.(?:1[6-9]|2\d|3[01])\./u.test(hostname)) return true;
	if (hostname.startsWith("169.254.")) return true;
	if (/\.(?:local|internal|lan|corp|home|private)$/u.test(hostname)) return true;
	const bare = hostname.replace(/^\[|\]$/gu, "");
	return /^(?:fc|fd|fe8|fe9|fea|feb)/u.test(bare);
}

/** Data boundary a model's provider endpoint implies. */
export function modelDataBoundary(model: { readonly provider: string; readonly baseUrl?: string }): ModelDataBoundary {
	const baseUrl = model.baseUrl?.trim() ?? "";
	if (baseUrl !== "") {
		if (baseUrl.startsWith("local://")) return "local";
		try {
			const url = new URL(baseUrl);
			if (url.protocol === "local:" || url.protocol === "file:") return "local";
			const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
			if (isLoopbackHostname(hostname)) return "local";
			if (isPrivateHostname(hostname)) return "private";
			// An unparseable or non-loopback endpoint is treated as public: the
			// safe default when a private scenario cannot prove locality.
			return "public";
		} catch {
			return "public";
		}
	}
	return LOCAL_PROVIDER_IDS[model.provider.trim().toLowerCase()] === true ? "local" : "public";
}

/** Whether a model at `actual` fits a scenario limited to `limit`. */
export function boundaryAllows(limit: ModelDataBoundary, actual: ModelDataBoundary): boolean {
	return BOUNDARY_RANK[actual] <= BOUNDARY_RANK[limit];
}

/** Scenario constraint that applies to an agent, with its defaults resolved. */
export interface ModelScenarioMatch {
	readonly name: string;
	readonly boundary: ModelDataBoundary;
	readonly failClosed: boolean;
	/** Empty means the scenario applies to every agent. */
	readonly allowedAgents: readonly string[];
}

/** First scenario whose allowlist contains `agent`; empty allowlists apply to all. */
export function modelScenarioForAgent(settings: Settings, agent: string): ModelScenarioMatch | undefined {
	const wanted = agent.trim();
	for (const [name, scenario] of Object.entries(cfgModelScenarios.get(settings))) {
		const allowedAgents = (scenario.allowedAgents ?? []).map(entry => entry.trim()).filter(entry => entry !== "");
		if (
			allowedAgents.length > 0 &&
			!allowedAgents.some(entry => entry === wanted || entry.toLowerCase() === wanted.toLowerCase())
		) {
			continue;
		}
		return {
			name,
			boundary: scenario.boundary,
			failClosed: scenario.failClosed !== false,
			allowedAgents,
		};
	}
	return undefined;
}

/** Minimal model shape the scenario boundary resolver needs. */
export interface ScenarioBoundaryModel {
	readonly provider: string;
	readonly baseUrl?: string;
}

/** One ordered model candidate (the primary first, then its fallbacks). */
export interface ScenarioBoundaryCandidate<M extends ScenarioBoundaryModel = ScenarioBoundaryModel> {
	readonly selector: string;
	readonly model?: M;
}

export interface ScenarioSkippedCandidate {
	readonly selector: string;
	readonly boundary?: ModelDataBoundary;
	readonly reason: "boundary" | "unresolved";
}

export type ScenarioBoundaryOutcome = "allowed" | "fallback" | "refused" | "advisory" | "unresolved";

export interface ScenarioModelResolution<M extends ScenarioBoundaryModel = ScenarioBoundaryModel> {
	readonly scenario: string;
	readonly boundary: ModelDataBoundary;
	readonly failClosed: boolean;
	readonly outcome: ScenarioBoundaryOutcome;
	/** The candidate the caller may use; absent when the resolver refused. */
	readonly chosen?: ScenarioBoundaryCandidate<M>;
	readonly modelBoundary?: ModelDataBoundary;
	readonly skipped: readonly ScenarioSkippedCandidate[];
	readonly reason?: string;
}

function scenarioRefusalReason(scenario: ModelScenarioMatch, skipped: readonly ScenarioSkippedCandidate[]): string {
	const violations = skipped
		.filter(entry => entry.reason === "boundary")
		.map(entry => `${entry.selector} (${entry.boundary ?? "unknown"})`);
	const unresolved = skipped.filter(entry => entry.reason === "unresolved").map(entry => entry.selector);
	const parts = [
		...(violations.length === 0 ? [] : [`outside ${scenario.boundary}: ${violations.join(", ")}`]),
		...(unresolved.length === 0 ? [] : [`unresolved: ${unresolved.join(", ")}`]),
	];
	return parts.length === 0 ? "no candidate model fits the scenario boundary" : parts.join("; ");
}

/**
 * Enforce a scenario's boundary over ordered candidates. A candidate outside
 * the boundary is skipped, never silently used; a permitted fallback may be
 * chosen. With `failClosed` (the default) and no permitted candidate the
 * resolver refuses (`chosen` absent) instead of using the primary anyway.
 */
export function enforceScenarioBoundary<M extends ScenarioBoundaryModel>(
	scenario: ModelScenarioMatch,
	candidates: readonly ScenarioBoundaryCandidate<M>[],
): ScenarioModelResolution<M> {
	const skipped: ScenarioSkippedCandidate[] = [];
	for (const [index, candidate] of candidates.entries()) {
		if (candidate.model === undefined) {
			skipped.push({ selector: candidate.selector, reason: "unresolved" });
			continue;
		}
		const modelBoundary = modelDataBoundary(candidate.model);
		if (!boundaryAllows(scenario.boundary, modelBoundary)) {
			skipped.push({ selector: candidate.selector, boundary: modelBoundary, reason: "boundary" });
			continue;
		}
		return {
			scenario: scenario.name,
			boundary: scenario.boundary,
			failClosed: scenario.failClosed,
			outcome: index === 0 ? "allowed" : "fallback",
			chosen: candidate,
			modelBoundary,
			skipped,
			...(index === 0 ? {} : { reason: scenarioRefusalReason(scenario, skipped) }),
		};
	}
	const reason = scenarioRefusalReason(scenario, skipped);
	if (scenario.failClosed) {
		return {
			scenario: scenario.name,
			boundary: scenario.boundary,
			failClosed: true,
			outcome: "refused",
			skipped,
			reason,
		};
	}
	const primary = candidates[0];
	if (primary?.model === undefined) {
		return {
			scenario: scenario.name,
			boundary: scenario.boundary,
			failClosed: false,
			outcome: "unresolved",
			skipped,
			...(reason === "" ? {} : { reason }),
		};
	}
	return {
		scenario: scenario.name,
		boundary: scenario.boundary,
		failClosed: false,
		outcome: "advisory",
		chosen: primary,
		modelBoundary: modelDataBoundary(primary.model),
		skipped,
		reason,
	};
}

/**
 * Resolve the scenario that applies to `agent` and enforce its boundary over
 * the ordered candidates. Returns undefined when no scenario constrains the
 * agent, so an existing configuration behaves exactly as before.
 */
export function resolveScenarioModel<M extends ScenarioBoundaryModel>(
	settings: Settings,
	agent: string,
	candidates: readonly ScenarioBoundaryCandidate<M>[],
): ScenarioModelResolution<M> | undefined {
	const scenario = modelScenarioForAgent(settings, agent);
	return scenario === undefined ? undefined : enforceScenarioBoundary(scenario, candidates);
}

/** Capabilities borrowed from the owning AgentSession. */
export interface ModelControlsHost {
	agent: Agent;
	settings: Settings;
	modelRegistry: ModelRegistry;
	sessionManager: SessionManager;
	providerSessionState: Map<string, ProviderSessionState>;
	model(): Model | undefined;
	sessionId(): string;
	promptGeneration(): number;
	resolveActiveEditMode(): EditModeSetting;
	syncAfterModelChange(previousEditMode: EditModeSetting): Promise<void>;
	setModelWithProviderSessionReset(model: Model, selection?: "explicit" | "automatic"): Promise<void>;
	clearActiveRetryFallback(): void;
	clearInheritedProviderPromptCacheKey(): void;
	magicKeywordEnabled(keyword: MagicKeywordId): boolean;
	emit(event: AgentSessionEvent): void;
	emitSessionEvent(event: AgentSessionEvent): Promise<void>;
	emitNotice(level: "info" | "warning" | "error", message: string, source?: string): void;
}

/** Owns model selection, thinking effort, role cycling, and service tiers. */
export class ModelControls {
	/** Thinking level a temporary model should start at, from its configured role. */
	resolveTemporaryModelThinkingLevel(_model: Model): ConfiguredThinkingLevel | undefined {
		return undefined;
	}

	readonly #host: ModelControlsHost;
	#scopedModels: Array<{ model: Model; thinkingLevel?: ThinkingLevel }>;
	#thinkingLevel: ThinkingLevel | undefined;
	/** Hard per-session effort ceiling (e.g. a task spawn's `task.maxEffort` cap); recovery paths re-clamp to it. */
	readonly #thinkingLevelCeiling: Effort | undefined;
	#autoThinking = false;
	#autoResolvedLevel: Effort | undefined;
	#serviceTierByFamily: ServiceTierByFamily;

	constructor(
		host: ModelControlsHost,
		options: {
			scopedModels?: Array<{ model: Model; thinkingLevel?: ThinkingLevel }>;
			thinkingLevel?: ConfiguredThinkingLevel;
			thinkingLevelCeiling?: Effort;
			serviceTierByFamily?: ServiceTierByFamily;
		},
	) {
		this.#host = host;
		this.#scopedModels = options.scopedModels ?? [];
		this.#serviceTierByFamily = options.serviceTierByFamily ?? {};
		this.#thinkingLevelCeiling = options.thinkingLevelCeiling;
		if (options.thinkingLevel === AUTO_THINKING) {
			// Keep auto pending until the first turn while exposing a valid wire effort.
			this.#autoThinking = true;
			this.#thinkingLevel = clampThinkingLevelToCeiling(
				this.#model,
				resolveProvisionalAutoLevel(this.#model),
				this.#thinkingLevelCeiling,
			);
		} else {
			this.#thinkingLevel = clampThinkingLevelToCeiling(
				this.#model,
				options.thinkingLevel,
				this.#thinkingLevelCeiling,
			);
		}
		this.#applyThinkingLevelToAgent(this.#thinkingLevel);
	}

	get #model(): Model | undefined {
		return this.#host.model();
	}

	/** Effective metadata-clamped thinking level applied to the agent. */
	get thinkingLevel(): ThinkingLevel | undefined {
		return this.#thinkingLevel;
	}

	/** Hard per-session effort ceiling every thinking-level change is clamped to. */
	get thinkingLevelCeiling(): Effort | undefined {
		return this.#thinkingLevelCeiling;
	}

	/** Configured selector, preserving `auto` while classification is active. */
	configuredThinkingLevel(): ConfiguredThinkingLevel | undefined {
		return this.#autoThinking ? AUTO_THINKING : this.#thinkingLevel;
	}

	/** Whether per-turn automatic thinking classification is enabled. */
	get isAutoThinking(): boolean {
		return this.#autoThinking;
	}

	/** Last concrete effort selected by automatic classification. */
	get autoResolvedThinkingLevel(): Effort | undefined {
		return this.#autoResolvedLevel;
	}

	/** Models explicitly scoped to the session's cycle command, minus currently disabled providers. */
	get scopedModels(): ReadonlyArray<{ model: Model; thinkingLevel?: ThinkingLevel }> {
		const disabledProviders = cfgDisabledProviders.get(this.#host.settings);
		if (disabledProviders.length === 0) return this.#scopedModels;
		return this.#scopedModels.filter(scoped => !disabledProviders.includes(scoped.model.provider));
	}

	/**
	 * Replace the Ctrl+P cycle scope. Startup resolves the scope before background
	 * provider discovery runs; the CLI re-pushes the fuller list here once discovery
	 * completes so a newly-discovered `enabledModels` model joins the cycle and the
	 * scoped `/models` picker (issue #9220).
	 */
	setScopedModels(scopedModels: Array<{ model: Model; thinkingLevel?: ThinkingLevel }>): void {
		this.#scopedModels = scopedModels;
	}

	/** Live per-provider-family service-tier selection. */
	get serviceTierByFamily(): ServiceTierByFamily {
		return this.#serviceTierByFamily;
	}

	/** Restores thinking state from a transcript without persisting a new entry. */
	restoreThinkingLevel(level: ConfiguredThinkingLevel | undefined): void {
		this.#autoThinking = level === AUTO_THINKING;
		this.#autoResolvedLevel = undefined;
		this.#thinkingLevel =
			level === AUTO_THINKING
				? clampThinkingLevelToCeiling(
						this.#model,
						resolveProvisionalAutoLevel(this.#model),
						this.#thinkingLevelCeiling,
					)
				: resolveThinkingLevelForModel(
						this.#model,
						clampThinkingLevelToCeiling(this.#model, level, this.#thinkingLevelCeiling),
					);
		this.#applyThinkingLevelToAgent(this.#thinkingLevel);
	}

	/** Restores an exact thinking snapshot after a failed session switch. */
	restoreThinkingSnapshot(level: ThinkingLevel | undefined, auto: boolean, resolved: Effort | undefined): void {
		this.#thinkingLevel = level;
		this.#autoThinking = auto;
		this.#autoResolvedLevel = resolved;
		this.#applyThinkingLevelToAgent(level);
	}

	/** Restores service tiers without persisting a duplicate transcript entry. */
	restoreServiceTiers(tiers: ServiceTierByFamily): void {
		this.#serviceTierByFamily = tiers;
	}
	resolveRoleModel(role: string): Model | undefined {
		return resolveRoleModelFull(this.#host.settings, role, this.#host.modelRegistry.getAvailable(), this.#model)
			.model;
	}

	resolveRoleModelWithThinking(role: string): ResolvedModelRoleValue {
		return resolveRoleModelFull(this.#host.settings, role, this.#host.modelRegistry.getAvailable(), this.#model);
	}

	/** Resolve a named agent or Vibe/Team target's configured identity. */
	resolveTargetIdentity(target: string, options?: ModelTargetResolutionOptions): ResolvedModelTarget {
		return resolveModelTargetIdentity(this.#host.settings, target, options);
	}

	/**
	 * Enforce the deployment scenario that applies to `target` over ordered
	 * candidates (primary first, fallbacks after). Undefined when no scenario
	 * constrains the target, so legacy configurations keep their behavior.
	 */
	resolveScenarioTarget<M extends ScenarioBoundaryModel>(
		target: string,
		candidates: readonly ScenarioBoundaryCandidate<M>[],
	): ScenarioModelResolution<M> | undefined {
		return resolveScenarioModel(this.#host.settings, target, candidates);
	}

	async setModel(
		model: Model,
		role: string = "default",
		options?: {
			selector?: string;
			thinkingLevel?: ThinkingLevel;
			persist?: boolean;
		},
	): Promise<{ switched: boolean }> {
		const previousEditMode = this.#host.resolveActiveEditMode();
		if (!this.#host.modelRegistry.hasConfiguredAuth(model)) {
			throw new Error(`No API key for ${model.provider}/${model.id}`);
		}

		const targetModel = await this.#host.modelRegistry.refreshSelectedModelMetadata(model);

		this.#host.modelRegistry.clearSuppressedSelector(formatModelStringWithRouting(targetModel));
		this.#host.clearActiveRetryFallback();
		await this.#host.setModelWithProviderSessionReset(targetModel);
		this.#host.sessionManager.appendModelChange(formatModelStringWithRouting(targetModel), role);
		if (options?.persist) {
			this.#host.settings.setModelRole(
				role,
				formatRoleModelValue(
					this.#host.settings,
					this.#host.modelRegistry,
					role,
					targetModel,
					options.selector,
					options.thinkingLevel,
				),
			);
		}
		this.#host.settings.getStorage()?.recordModelUsage(`${targetModel.provider}/${targetModel.id}`);

		this.#reapplyThinkingLevel(targetModel.thinking?.defaultLevel);
		await this.#host.syncAfterModelChange(previousEditMode);
		return { switched: true };
	}

	/**
	 * Set model temporarily (for this session only).
	 * Validates that a credential source is configured (synchronously, without
	 * refreshing OAuth or running command-backed key programs), saves to session
	 * log but NOT to settings.
	 * @throws Error if no API key available for the model
	 */
	async setModelTemporary(
		model: Model,
		thinkingLevel?: ConfiguredThinkingLevel,
		options?: { ephemeral?: boolean; prewalk?: boolean; metadataResolved?: boolean },
		selection: "explicit" | "automatic" = "explicit",
		isCurrent?: () => boolean,
	): Promise<boolean> {
		const previousEditMode = this.#host.resolveActiveEditMode();
		if (!this.#host.modelRegistry.hasConfiguredAuth(model)) {
			throw new Error(`No API key for ${model.provider}/${model.id}`);
		}

		// A caller that loaded the metadata ahead of time (auto-prewalk, while its judge ran) skips the second probe.
		const targetModel = options?.metadataResolved
			? model
			: await this.#host.modelRegistry.refreshSelectedModelMetadata(model);
		if (isCurrent?.() === false) return false;

		this.#host.modelRegistry.clearSuppressedSelector(formatModelStringWithRouting(targetModel));
		this.#host.clearActiveRetryFallback();
		await this.#host.setModelWithProviderSessionReset(targetModel, selection);
		// Identity, not object equality: the agent's resolver and metadata rebinds swap in refitted rows of the
		// same model. Only a different model means another selection replaced this one during reconciliation.
		const landed = routedModelsAreEqual(this.#model, targetModel);
		if (landed) {
			this.#host.sessionManager.appendModelChange(
				formatModelStringWithRouting(targetModel),
				options?.prewalk
					? PREWALK_MODEL_CHANGE_ROLE
					: options?.ephemeral
						? EPHEMERAL_MODEL_CHANGE_ROLE
						: TEMPORARY_MODEL_CHANGE_ROLE,
			);
			this.#host.settings.getStorage()?.recordModelUsage(`${targetModel.provider}/${targetModel.id}`);
		}

		// A user selection during the switch owns effort, even on the same model.
		if (isCurrent?.() === false || !landed) {
			this.#reapplyThinkingLevel();
		} else if (thinkingLevel !== undefined) {
			this.setThinkingLevel(thinkingLevel);
		} else {
			this.#reapplyThinkingLevel(targetModel.thinking?.defaultLevel);
		}
		await this.#host.syncAfterModelChange(previousEditMode);
		return isCurrent?.() !== false && landed;
	}

	/**
	 * Cycle to next/previous model.
	 * Uses scoped models (from --models flag) if available, otherwise all available models.
	 * @param direction - "forward" (default) or "backward"
	 * @returns The new model info, or undefined if only one model available
	 */
	async cycleModel(direction: "forward" | "backward" = "forward"): Promise<ModelCycleResult | undefined> {
		if (this.scopedModels.length > 0) {
			return this.#cycleScopedModel(direction);
		}
		return this.#cycleAvailableModel(direction);
	}

	/**
	 * Resolve the configured role models in the given order plus the index of
	 * the currently active one. Roles that have no configured model, or whose
	 * configured model is not currently available, are skipped. The `default`
	 * role falls back to the active model when no explicit assignment exists.
	 *
	 * Returns `undefined` only when there is no current model or no available
	 * models at all; an empty `models` array is never returned (callers should
	 * still guard on `models.length`).
	 */
	getRoleModelCycle(roleOrder: readonly string[]): RoleModelCycle | undefined {
		const availableModels = this.#host.modelRegistry.getAvailable();
		if (availableModels.length === 0 || !this.#model) return undefined;
		return resolveRoleModelCycle(
			this.#host.settings,
			availableModels,
			this.#model,
			this.#host.sessionManager.getLastModelChangeRole(),
			roleOrder,
		);
	}

	/**
	 * Apply a resolved role model as the active model without changing global
	 * settings. Shared with role cycling and the plan-approval model slider.
	 */
	async applyRoleModel(entry: ResolvedRoleModel): Promise<void> {
		await this.setModel(entry.model, entry.role);
		if (entry.explicitThinkingLevel && entry.thinkingLevel !== undefined) {
			this.setThinkingLevel(entry.thinkingLevel);
		}
	}

	/**
	 * Cycle through configured role models in a fixed order.
	 * Skips missing roles and changes only the active session model.
	 * @param roleOrder - Order of roles to cycle through (e.g., ["slow", "default", "smol"])
	 * @param direction - "forward" (default) or "backward"
	 */
	async cycleRoleModels(
		roleOrder: readonly string[],
		direction: "forward" | "backward" = "forward",
	): Promise<RoleModelCycleResult | undefined> {
		const cycle = this.getRoleModelCycle(roleOrder);
		if (!cycle || cycle.models.length <= 1) return undefined;

		const step = direction === "backward" ? -1 : 1;
		const next = cycle.models[(cycle.currentIndex + step + cycle.models.length) % cycle.models.length];

		await this.applyRoleModel(next);

		return { model: next.model, thinkingLevel: this.thinkingLevel, role: next.role };
	}

	async #getScopedModelsWithApiKey(): Promise<Array<{ model: Model; thinkingLevel?: ThinkingLevel }>> {
		const apiKeysByProvider = new Map<string, string | undefined>();
		const result: Array<{ model: Model; thinkingLevel?: ThinkingLevel }> = [];

		for (const scoped of this.scopedModels) {
			const provider = scoped.model.provider;
			let apiKey: string | undefined;
			if (apiKeysByProvider.has(provider)) {
				apiKey = apiKeysByProvider.get(provider);
			} else {
				apiKey = await this.#host.modelRegistry.getApiKeyForProvider(provider, this.#host.sessionId());
				apiKeysByProvider.set(provider, apiKey);
			}

			if (apiKey) {
				result.push(scoped);
			}
		}

		return result;
	}

	async #cycleScopedModel(direction: "forward" | "backward"): Promise<ModelCycleResult | undefined> {
		const previousEditMode = this.#host.resolveActiveEditMode();
		const scopedModels = await this.#getScopedModelsWithApiKey();
		if (scopedModels.length <= 1) return undefined;

		let currentIndex = findScopedModelIndex(scopedModels, this.#model);

		if (currentIndex === -1) currentIndex = 0;
		const len = scopedModels.length;
		const nextIndex = direction === "forward" ? (currentIndex + 1) % len : (currentIndex - 1 + len) % len;
		const next = scopedModels[nextIndex];

		// Apply model
		this.#host.modelRegistry.clearSuppressedSelector(formatModelStringWithRouting(next.model));
		this.#host.clearActiveRetryFallback();
		await this.#host.setModelWithProviderSessionReset(next.model);
		this.#host.sessionManager.appendModelChange(formatModelStringWithRouting(next.model));
		this.#host.settings.getStorage()?.recordModelUsage(`${next.model.provider}/${next.model.id}`);

		// Apply the scoped model's configured thinking level, preserving auto.
		this.setThinkingLevel(this.#autoThinking ? AUTO_THINKING : next.thinkingLevel);
		await this.#host.syncAfterModelChange(previousEditMode);

		return { model: next.model, thinkingLevel: this.thinkingLevel, isScoped: true };
	}

	async #cycleAvailableModel(direction: "forward" | "backward"): Promise<ModelCycleResult | undefined> {
		const previousEditMode = this.#host.resolveActiveEditMode();
		const availableModels = this.#host.modelRegistry.getAvailable();
		if (availableModels.length <= 1) return undefined;

		const currentModel = this.#model;
		let currentIndex = availableModels.findIndex(m => modelsAreEqual(m, currentModel));

		if (currentIndex === -1) currentIndex = 0;
		const len = availableModels.length;
		const nextIndex = direction === "forward" ? (currentIndex + 1) % len : (currentIndex - 1 + len) % len;
		const nextModel = availableModels[nextIndex];

		const apiKey = await this.#host.modelRegistry.getApiKey(nextModel, this.#host.sessionId());
		if (!apiKey) {
			throw new Error(`No API key for ${nextModel.provider}/${nextModel.id}`);
		}

		this.#host.modelRegistry.clearSuppressedSelector(formatModelStringWithRouting(nextModel));
		this.#host.clearActiveRetryFallback();
		await this.#host.setModelWithProviderSessionReset(nextModel);
		this.#host.sessionManager.appendModelChange(formatModelStringWithRouting(nextModel));
		this.#host.settings.getStorage()?.recordModelUsage(`${nextModel.provider}/${nextModel.id}`);
		// Re-apply the current thinking level (or auto) for the newly selected model
		this.#reapplyThinkingLevel();
		await this.#host.syncAfterModelChange(previousEditMode);

		return { model: nextModel, thinkingLevel: this.thinkingLevel, isScoped: false };
	}

	/**
	 * Get all available models with valid API keys, filtered by `enabledModels` when configured.
	 * `roleLookup` resolves role aliases in the patterns (default: the current roles).
	 * See {@link filterAvailableModelsByEnabledPatterns} for supported pattern forms and limitations.
	 */
	getAvailableModels(roleLookup?: ModelRoleLookup): Model[] {
		const all = this.#host.modelRegistry.getAvailable();
		const patterns = cfgEnabledModels.get(this.#host.settings);
		if (!patterns || patterns.length === 0) return all;
		return filterAvailableModelsByEnabledPatterns(all, patterns, this.#host.settings, roleLookup);
	}

	// =========================================================================
	// Thinking Level Management
	// =========================================================================

	#applyThinkingLevelToAgent(level: ThinkingLevel | undefined): void {
		this.#host.agent.setThinkingLevel(toReasoningEffort(level));
		this.#host.agent.setDisableReasoning(shouldDisableReasoning(level));
	}

	/**
	 * Set the thinking level. `auto` enables per-turn classification. Entering
	 * auto writes its provisional level plus `configured: "auto"` immediately,
	 * giving external readers an authoritative selection receipt before the next
	 * user turn. Later classifications persist only changed concrete resolutions.
	 */
	setThinkingLevel(level: ConfiguredThinkingLevel | undefined, persist: boolean = false): void {
		if (level === AUTO_THINKING) {
			const provisional = clampThinkingLevelToCeiling(
				this.#model,
				resolveProvisionalAutoLevel(this.#model),
				this.#thinkingLevelCeiling,
			);
			const wasAuto = this.#autoThinking;
			const previousLevel = this.#thinkingLevel;
			this.#autoThinking = true;
			this.#autoResolvedLevel = undefined;
			this.#thinkingLevel = provisional;
			if (!wasAuto) {
				this.#host.clearInheritedProviderPromptCacheKey();
			}
			this.#applyThinkingLevelToAgent(provisional);
			if (persist) {
				cfgDefaultThinkingLevel.set(this.#host.settings, AUTO_THINKING);
			}
			const isChanging = !wasAuto || previousLevel !== provisional;
			if (isChanging) {
				this.#host.sessionManager.appendThinkingLevelChange(provisional, AUTO_THINKING);
				this.#host.emit({ type: "thinking_level_changed", thinkingLevel: provisional, configured: AUTO_THINKING });
			}
			return;
		}

		const wasAuto = this.#autoThinking;
		this.#autoThinking = false;
		this.#autoResolvedLevel = undefined;
		const effectiveLevel = resolveThinkingLevelForModel(
			this.#model,
			clampThinkingLevelToCeiling(this.#model, level, this.#thinkingLevelCeiling),
		);
		// Leaving auto must persist even when the resolved effort is unchanged (e.g.
		// auto resolved to medium, then the user pins medium): otherwise the latest
		// session entry keeps `configured: "auto"` and resume re-enables auto.
		const isChanging = wasAuto || effectiveLevel !== this.#thinkingLevel;

		this.#thinkingLevel = effectiveLevel;
		this.#applyThinkingLevelToAgent(effectiveLevel);

		if (isChanging) {
			this.#host.clearInheritedProviderPromptCacheKey();
			this.#host.sessionManager.appendThinkingLevelChange(effectiveLevel, effectiveLevel);
			if (persist && effectiveLevel !== undefined && effectiveLevel !== ThinkingLevel.Off) {
				cfgDefaultThinkingLevel.set(this.#host.settings, effectiveLevel);
			}
			this.#host.emit({ type: "thinking_level_changed", thinkingLevel: effectiveLevel });
		}
	}

	/**
	 * Re-apply the active thinking selection after a model change. Preserves `auto`
	 * (re-clamping the provisional level to the new model); otherwise carries the
	 * current level, clamped to the nearest effort the new model supports.
	 * `fallback` (the new model's own default) applies only when no level is set.
	 */
	#reapplyThinkingLevel(fallback?: ThinkingLevel): void {
		this.setThinkingLevel(
			this.#autoThinking ? AUTO_THINKING : automaticThinkingLevel(this.#model, fallback ?? this.#thinkingLevel),
		);
	}

	/** All selectable effort selectors for the active model, in cycle order. */
	getAvailableEffortSelectors(): ConfiguredThinkingLevel[] {
		if (!this.#model?.reasoning) return [];
		const efforts = this.getAvailableThinkingLevels();
		const ceiling = this.#thinkingLevelCeiling;
		const selectable =
			ceiling === undefined
				? efforts
				: efforts.filter(level => THINKING_EFFORTS.indexOf(level) <= THINKING_EFFORTS.indexOf(ceiling));
		return [ThinkingLevel.Off, AUTO_THINKING, ...selectable];
	}

	/**
	 * Cycle to next thinking level: off → auto → minimal..max → off.
	 * @returns New selector, or undefined if model doesn't support thinking
	 */
	cycleThinkingLevel(): ConfiguredThinkingLevel | undefined {
		const levels = this.getAvailableEffortSelectors();
		if (levels.length === 0) return undefined;
		const configured = this.configuredThinkingLevel();
		const currentLevel = configured === ThinkingLevel.Inherit ? ThinkingLevel.Off : configured;
		const currentIndex = currentLevel ? levels.indexOf(currentLevel) : -1;
		const nextIndex = (currentIndex + 1) % levels.length;
		const nextLevel = levels[nextIndex];
		if (!nextLevel) return undefined;

		this.setThinkingLevel(nextLevel);
		return nextLevel;
	}

	/** Timeout (ms) for per-turn auto-thinking classification before falling back. */
	static readonly #AUTO_THINKING_TIMEOUT_MS = 4000;

	/**
	 * Classify the current user turn and set the effective thinking level for it.
	 * `solutionSpace` is a delegator's open-endedness description (task-spawned turns
	 * only); when non-blank it is classified instead of `promptText`.
	 * Bounded by a timeout + abort; on failure it preserves the last classified
	 * level, or uses the provisional concrete level before the first resolution.
	 * Never throws into the turn, and never clears `#autoThinking`.
	 */
	async applyAutoThinkingLevel(promptText: string, generation: number, solutionSpace?: string): Promise<void> {
		const model = this.#model;
		if (!model?.reasoning) return;
		// Models with reasoning but no controllable effort surface (devin-agent
		// Cascade routes effort via sibling model ids, not a wire param) have
		// nothing to pick — skip classification rather than discard its result.
		if (getSupportedEfforts(model).length === 0) return;

		let resolved: Effort | undefined;
		if (this.#host.magicKeywordEnabled("ultrathink") && containsMagicKeyword(promptText, "ultrathink")) {
			// The user explicitly asked for maximum thinking; bypass the classifier
			// (and the `providers.autoThinkingMaxEffort` ceiling) and jump straight
			// to the highest supported level for this model.
			resolved = clampAutoThinkingEffort(model, Effort.Max);
		} else {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), ModelControls.#AUTO_THINKING_TIMEOUT_MS);
			const usageOwner = {
				sessionId: this.#host.sessionManager.getSessionId(),
				parentId: this.#host.sessionManager.getLeafId(),
			};
			try {
				resolved = await classifyDifficulty(
					{ request: promptText, solutionSpace },
					{
						settings: this.#host.settings,
						registry: this.#host.modelRegistry,
						model,
						sessionId: this.#host.sessionId(),
						signal: controller.signal,
						metadataResolver: provider => this.#host.agent.metadataForProvider(provider),
						onUsage: usage => {
							const entryId = this.#host.sessionManager.appendModelUsage(usage, usageOwner);
							if (entryId) usageOwner.parentId = entryId;
						},
						telemetry: this.#host.agent.telemetry,
					},
				);
			} catch (error) {
				logger.debug("auto-thinking: classification failed; using fallback level", {
					error: error instanceof Error ? error.message : String(error),
				});
			} finally {
				clearTimeout(timer);
			}
		}

		// Drop the result if the turn was aborted/superseded while classifying, or if another model was
		// selected meanwhile: the classifier chose from this model's levels.
		if (this.#host.promptGeneration() !== generation || !this.#autoThinking || !modelsAreEqual(this.#model, model)) {
			return;
		}

		const effort = clampThinkingLevelToCeiling(
			model,
			resolved ?? this.#autoResolvedLevel ?? resolveProvisionalAutoLevel(model),
			this.#thinkingLevelCeiling,
		);
		if (effort === undefined) return;
		this.#resolveAutoThinkingLevel(effort);
	}

	/**
	 * Apply a `chillax` keyword in `promptText`: drop effort to the model's
	 * lowest supported level from the next request on. Only models that take
	 * per-message effort qualify — they switch effort between steps without
	 * rewriting the cached prefix, so a steer relaxes the running turn. In auto
	 * mode the floor is this turn's resolution (later prompts reclassify); a
	 * pinned level is re-pinned lower, never raised, and off stays off.
	 * @returns Whether the keyword applied, so auto classification must not run for the turn.
	 */
	applyChillax(promptText: string): boolean {
		if (!this.#host.magicKeywordEnabled("chillax") || !containsMagicKeyword(promptText, "chillax")) return false;
		const model = this.#model;
		if (!model?.reasoning || !takesPerMessageEffort(model)) return false;
		const floor = getSupportedEfforts(model)[0];
		if (floor === undefined) return false;
		if (this.#autoThinking) {
			this.#resolveAutoThinkingLevel(floor);
			return true;
		}
		const current = toReasoningEffort(this.#thinkingLevel);
		if (current !== undefined && THINKING_EFFORTS.indexOf(floor) < THINKING_EFFORTS.indexOf(current)) {
			this.setThinkingLevel(floor);
		}
		return true;
	}

	/**
	 * Settle auto on the level a starting run thinks at when no classification
	 * resolved it (IRC wakes, resumed runs, agent-originated and synthetic turns),
	 * so readers stop showing auto as pending while the agent runs at a concrete
	 * level. The next user turn still reclassifies.
	 */
	settleAutoThinkingLevel(): void {
		if (!this.#autoThinking || this.#autoResolvedLevel !== undefined) return;
		const effort = toReasoningEffort(this.#thinkingLevel);
		if (effort !== undefined) this.#resolveAutoThinkingLevel(effort);
	}

	/** Publish `effort` as the turn's auto resolution; the transcript records only a changed level. */
	#resolveAutoThinkingLevel(effort: Effort): void {
		const shouldPersistResolution = this.#thinkingLevel !== effort;
		this.#autoResolvedLevel = effort;
		this.#thinkingLevel = effort;
		this.#applyThinkingLevelToAgent(effort);
		if (shouldPersistResolution) {
			this.#host.sessionManager.appendThinkingLevelChange(effort, AUTO_THINKING);
		}
		this.#host.emit({
			type: "thinking_level_changed",
			thinkingLevel: effort,
			configured: AUTO_THINKING,
			resolved: effort,
		});
	}

	/**
	 * True when the currently selected model's family is set to a fast tier —
	 * `priority`, or `ultrafast` on the OpenAI family — the `/fast` on/off state
	 * for the active model. Returns false when no model is selected or the
	 * model exposes no service-tier family (e.g. Fireworks, which has its own
	 * Providers › Fireworks Tier toggle).
	 *
	 * For "is a fast tier actually applied to the next request?" use
	 * {@link isFastModeActive} instead.
	 */
	isFastModeEnabled(): boolean {
		const family = this.#model ? serviceTierFamily(this.#model) : undefined;
		const tier = family ? this.#serviceTierByFamily[family] : undefined;
		return tier === "priority" || tier === "ultrafast";
	}

	/** True when the active model's OpenAI family is set to `ultrafast` (`/fast ultra`). */
	isUltrafastModeEnabled(): boolean {
		const model = this.#model;
		return (
			model !== undefined &&
			serviceTierFamily(model) === "openai" &&
			this.#serviceTierByFamily.openai === "ultrafast"
		);
	}

	/**
	 * True when a fast tier is actually realized on the wire for the currently
	 * selected model: `priority` (OpenAI/Google `service_tier`, direct Anthropic
	 * fast mode, or Fireworks priority), or `ultrafast` where the model offers
	 * it. Returns false for tiers the active model can't realize and when no
	 * model is selected.
	 */
	isFastModeActive(): boolean {
		const model = this.#model;
		if (!model || !this.#realizesFastTier(model, this.#serviceTierByFamily)) return false;
		return (
			model.provider !== "anthropic" || !isAnthropicFastModeFallbackDisabled(this.#host.providerSessionState, model)
		);
	}

	/**
	 * Whether a fresh session started on `model` would realize a fast tier from
	 * the configured `tier.*` settings, ignoring this session's `/fast` toggles.
	 * Feeds the next launch's startup status prepaint.
	 */
	isFastModeConfiguredFor(model: Model): boolean {
		const settings = this.#host.settings;
		const tiers = buildServiceTierByFamily(
			cfgTierOpenai.get(settings),
			cfgTierAnthropic.get(settings),
			cfgTierGoogle.get(settings),
		);
		return this.#realizesFastTier(model, tiers);
	}

	#realizesFastTier(model: Model, tiers: ServiceTierByFamily): boolean {
		const tier = serviceTierForModel(this.#host.settings, model, tiers);
		return tier === "ultrafast" ? shouldSendServiceTier(tier, model) : realizesPriorityServiceTier(tier, model);
	}

	/**
	 * Effective wire service-tier for a request to `model`. Fireworks models take
	 * the Priority serving path only when the Providers › Fireworks Tier setting
	 * is `"priority"` (and never for `-fast` variants, whose Fast serving path is
	 * mutually exclusive with Priority). Every other model resolves the live
	 * per-family tier map down to the entry for its family.
	 */
	effectiveServiceTier(model: Model | undefined = this.#model): ServiceTier | undefined {
		return model ? serviceTierForModel(this.#host.settings, model, this.#serviceTierByFamily) : undefined;
	}

	/** The live per-family tier map, or `null` when empty (for session persistence). */
	serviceTierEntry(): ServiceTierByFamily | null {
		return Object.keys(this.#serviceTierByFamily).length > 0 ? this.#serviceTierByFamily : null;
	}

	/** Set one family's tier (or clear it with `undefined`); persists the change. */
	setServiceTierFamily(family: ServiceTierFamily, tier: ServiceTier | undefined): void {
		if (this.#serviceTierByFamily[family] === tier) return;
		const next: ServiceTierByFamily = { ...this.#serviceTierByFamily };
		if (tier) next[family] = tier;
		else delete next[family];
		this.#applyServiceTierByFamily(next);
	}

	/** Replace the whole per-family tier map; persists + re-arms Anthropic fast mode. */
	#applyServiceTierByFamily(next: ServiceTierByFamily): void {
		// Re-arming Anthropic priority clears the per-session fast-mode auto-disable
		// so the next request actually carries `speed: "fast"` again.
		if (next.anthropic === "priority" && this.#serviceTierByFamily.anthropic !== "priority") {
			clearAnthropicFastModeFallback(this.#host.providerSessionState);
		}
		this.#serviceTierByFamily = next;
		this.#host.sessionManager.appendServiceTierChange(this.serviceTierEntry());
	}

	/**
	 * `/fast on|off` targets the family of the currently selected model: it sets
	 * (or clears) that family's `priority` tier. `off` also clears `ultrafast`.
	 * Returns `false` when the model has no service-tier family, or when it is an
	 * OpenAI-family model that cannot take `priority` (a Codex model whose
	 * discovered tier list omits it), so callers can report that fast mode is
	 * unavailable instead of claiming success.
	 */
	setFastMode(enabled: boolean): boolean {
		const model = this.#model;
		const family = model ? serviceTierFamily(model) : undefined;
		if (!model || !family) {
			this.#host.emitNotice(
				"info",
				"The current model has no service-tier control for /fast to toggle.",
				"priority",
			);
			return false;
		}
		if (!enabled) {
			const tier = this.#serviceTierByFamily[family];
			if (tier === "priority" || tier === "ultrafast") this.setServiceTierFamily(family, undefined);
			return true;
		}
		if (family === "openai" && !shouldSendServiceTier("priority", model)) {
			this.#host.emitNotice(
				"info",
				"The current model does not offer the priority (Fast) service tier.",
				"priority",
			);
			return false;
		}
		if (family === "anthropic" && this.#serviceTierByFamily.anthropic === "priority") {
			clearAnthropicFastModeFallback(this.#host.providerSessionState);
		}
		this.setServiceTierFamily(family, "priority");
		return true;
	}

	/**
	 * `/fast ultra` sets the OpenAI family to `ultrafast`. Enabling requires the
	 * active model to realize it (first-party OpenAI, or a Codex model whose
	 * discovery advertises the tier); otherwise the tier is left unchanged and
	 * `false` is returned. Disabling clears only an `ultrafast` selection.
	 */
	setUltrafastMode(enabled: boolean): boolean {
		const model = this.#model;
		if (!enabled) {
			if (this.#serviceTierByFamily.openai === "ultrafast") this.setServiceTierFamily("openai", undefined);
			return true;
		}
		if (!model || serviceTierFamily(model) !== "openai" || !shouldSendServiceTier("ultrafast", model)) {
			this.#host.emitNotice("info", "The current model does not offer the Ultrafast service tier.", "priority");
			return false;
		}
		this.setServiceTierFamily("openai", "ultrafast");
		return true;
	}

	toggleFastMode(): boolean {
		if (!this.setFastMode(!this.isFastModeEnabled())) return false;
		return this.isFastModeEnabled();
	}

	/**
	 * Get available thinking levels for current model.
	 */
	getAvailableThinkingLevels(): ReadonlyArray<Effort> {
		if (!this.#model) return [];
		return getSupportedEfforts(this.#model);
	}
}
