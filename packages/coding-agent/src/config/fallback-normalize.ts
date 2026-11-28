/**
 * Canonical fallback-chain normalization for the model control plane.
 *
 * The runtime already skips a repeated catalog identity while walking a chain;
 * this module is the config/UI boundary: it trims, drops empty entries, keeps
 * the first spelling of an identity, and reports duplicates instead of silently
 * rendering them twice. It does not resolve models or read credentials, but a
 * caller that owns a catalog can pass `resolveModel` so aliases (a dotted
 * revision spelling, a provider alias) collapse onto the catalog identity.
 *
 * Chains are scoped: the runtime surfaces (`resume`, `retry`, `role`, `agent`,
 * `mode`) and the model kinds (`chat`, `image`, `tts`, `stt`, `decision`,
 * `embedding`) are separate maps. A chain configured for one scope is never
 * copied into another, so a kind chain never borrows `retry` or the legacy
 * `retry.fallbackChains` default.
 */

import { AUTO_THINKING, parseThinkingLevel } from "../thinking/levels";

/** Runtime fallback surfaces. */
export const TARGET_FALLBACK_SCOPES = ["resume", "retry", "role", "agent", "mode"] as const;
export type TargetFallbackScope = (typeof TARGET_FALLBACK_SCOPES)[number];

/** Model-kind fallback surfaces. Keys are model selectors, roles, or providers. */
export const KIND_FALLBACK_SCOPES = ["chat", "image", "tts", "stt", "decision", "embedding"] as const;
export type KindFallbackScope = (typeof KIND_FALLBACK_SCOPES)[number];

/** Every scope accepted by `fallbackScopes` (ADR-0102). */
export const FALLBACK_SCOPES = [
	"resume",
	"retry",
	"role",
	"agent",
	"mode",
	"chat",
	"image",
	"tts",
	"stt",
	"decision",
	"embedding",
] as const;
export type FallbackScope = (typeof FALLBACK_SCOPES)[number];

/** Whether a configured scope name is a model-kind surface. */
export function isKindFallbackScope(value: string): value is KindFallbackScope {
	return (KIND_FALLBACK_SCOPES as readonly string[]).includes(value);
}

/** Whether a configured scope name is a runtime target surface. */
export function isTargetFallbackScope(value: string): value is TargetFallbackScope {
	return (TARGET_FALLBACK_SCOPES as readonly string[]).includes(value);
}

export type FallbackChainMap = Readonly<Record<string, readonly string[]>>;

/**
 * Per-scope fallback maps as written in `fallbackScopes`. Every scope is
 * optional so a config can override only the surface it cares about; absent
 * scopes normalize to an empty map.
 */
export interface ScopedFallbackChainsInput {
	readonly [scope: string]: FallbackChainMap | undefined;
	readonly resume?: FallbackChainMap;
	readonly retry?: FallbackChainMap;
	readonly role?: FallbackChainMap;
	readonly agent?: FallbackChainMap;
	readonly mode?: FallbackChainMap;
	readonly chat?: FallbackChainMap;
	readonly image?: FallbackChainMap;
	readonly tts?: FallbackChainMap;
	readonly stt?: FallbackChainMap;
	readonly decision?: FallbackChainMap;
	readonly embedding?: FallbackChainMap;
}

/** The default value for `fallbackScopes`: one empty map per scope. */
export const EMPTY_SCOPED_FALLBACK_CHAINS: ScopedFallbackChainsInput = {
	resume: {},
	retry: {},
	role: {},
	agent: {},
	mode: {},
	chat: {},
	image: {},
	tts: {},
	stt: {},
	decision: {},
	embedding: {},
};

export interface FallbackEntryParts {
	readonly raw: string;
	/** `provider/id` with any thinking suffix removed. */
	readonly modelKey: string;
	/** Full canonical key including the thinking suffix, if any. */
	readonly identity: string;
	readonly thinkingLevel?: string;
}

export interface FallbackDuplicate {
	/** Entry that was removed from the normalized chain. */
	readonly removed: string;
	/** Earlier entry that owns the identity. */
	readonly kept: string;
}

export interface FallbackSameModelEffort {
	/** `provider/id` as first spelled in the chain. */
	readonly modelKey: string;
	/** Distinct thinking suffixes (or `""` for no suffix), in first-seen order. */
	readonly thinkingLevels: readonly string[];
}

export interface NormalizedFallbackChain {
	/** Trimmed, de-duplicated entries, original order preserved. */
	readonly chain: readonly string[];
	readonly duplicates: readonly FallbackDuplicate[];
	/** Same model at different thinking levels: kept, but worth showing in the UI. */
	readonly sameModelDifferentEffort: readonly FallbackSameModelEffort[];
}

/** A catalog-resolved model identity. */
export interface FallbackResolvedModel {
	readonly provider: string;
	readonly id: string;
}

/**
 * Optional catalog hook: map a parsed entry onto the provider/id the registry
 * would actually load. Returning undefined keeps the literal spelling.
 */
export type FallbackModelResolver = (entry: FallbackEntryParts) => FallbackResolvedModel | undefined;

export interface FallbackNormalizeOptions {
	readonly resolveModel?: FallbackModelResolver;
}

/**
 * The catalog treats a dotted revision (`gpt-5.5`) and its dashed spelling
 * (`gpt-5-5`) as one id. Keep this in sync with `revisionSpellingKey` in
 * `model-resolver.ts`; the kernel stays import-free of the resolver so settings
 * can import it without a cycle.
 */
function revisionSpellingKey(id: string): string {
	return id.toLowerCase().replace(/(?<=\d)\.(?=\d)/g, "-");
}

/**
 * Canonical spelling of the model portion. The whole key is lowercased because
 * provider and model lookup are case-insensitive; the first spelling is still
 * what the normalized chain returns.
 */
function canonicalLiteralModelKey(modelKey: string): string {
	const slash = modelKey.indexOf("/");
	if (slash <= 0) return revisionSpellingKey(modelKey);
	return `${modelKey.slice(0, slash).toLowerCase()}/${revisionSpellingKey(modelKey.slice(slash + 1))}`;
}

function canonicalModelKey(parts: FallbackEntryParts, options: FallbackNormalizeOptions): string {
	const resolved = options.resolveModel?.(parts);
	return resolved
		? `${resolved.provider.toLowerCase()}/${revisionSpellingKey(resolved.id)}`
		: canonicalLiteralModelKey(parts.modelKey);
}

function canonicalIdentity(parts: FallbackEntryParts, options: FallbackNormalizeOptions): string {
	const modelKey = canonicalModelKey(parts, options);
	return parts.thinkingLevel === undefined ? modelKey : `${modelKey}:${parts.thinkingLevel}`;
}

/**
 * Split a selector into the catalog key and an optional trailing thinking
 * suffix. The suffix accepts the same abbreviations as every other selector
 * surface (`hi` -> high, `med` -> medium), so they collapse to one identity.
 */
export function parseFallbackEntry(raw: string): FallbackEntryParts | undefined {
	const trimmed = raw.trim();
	if (trimmed === "") return undefined;
	const colon = trimmed.lastIndexOf(":");
	if (colon === 0) return undefined;
	let modelKey = trimmed;
	let thinkingLevel: string | undefined;
	if (colon > 0 && colon < trimmed.length - 1) {
		const suffix = trimmed.slice(colon + 1);
		if (suffix === AUTO_THINKING) {
			modelKey = trimmed.slice(0, colon);
			thinkingLevel = AUTO_THINKING;
		} else {
			const level = parseThinkingLevel(suffix);
			// `inherit` is the same semantic as writing no suffix at all.
			if (level !== undefined && level !== "inherit") {
				modelKey = trimmed.slice(0, colon);
				thinkingLevel = level;
			}
		}
	}
	if (modelKey === "") return undefined;
	const modelIdentity = canonicalLiteralModelKey(modelKey);
	return {
		raw: trimmed,
		modelKey,
		identity: thinkingLevel === undefined ? modelIdentity : `${modelIdentity}:${thinkingLevel}`,
		...(thinkingLevel === undefined ? {} : { thinkingLevel }),
	};
}

/**
 * Normalize one configured chain. Exact duplicate identities are removed
 * (first spelling wins); the same model at different thinking levels is kept
 * and reported separately, because that difference can be deliberate.
 *
 * With `resolveModel`, entries the catalog maps onto one provider/id are
 * duplicates too (`provider/alias` vs `provider/catalog-id`).
 */
export function normalizeFallbackChain(
	chain: readonly string[] | undefined,
	options: FallbackNormalizeOptions = {},
): NormalizedFallbackChain {
	const normalized: string[] = [];
	const duplicates: FallbackDuplicate[] = [];
	const byIdentity = new Map<string, string>();
	const effortsByModel = new Map<string, { modelKey: string; thinkingLevels: string[] }>();
	for (const value of Array.isArray(chain) ? chain : []) {
		if (typeof value !== "string") continue;
		const parsed = parseFallbackEntry(value);
		if (!parsed) continue;
		const identity = canonicalIdentity(parsed, options);
		const kept = byIdentity.get(identity);
		if (kept !== undefined) {
			duplicates.push({ removed: parsed.raw, kept });
			continue;
		}
		byIdentity.set(identity, parsed.raw);
		normalized.push(parsed.raw);
		const modelKey = canonicalModelKey(parsed, options);
		const effort = effortsByModel.get(modelKey) ?? { modelKey: parsed.modelKey, thinkingLevels: [] };
		const level = parsed.thinkingLevel ?? "";
		if (!effort.thinkingLevels.includes(level)) effort.thinkingLevels.push(level);
		effortsByModel.set(modelKey, effort);
	}
	const sameModelDifferentEffort = [...effortsByModel.values()]
		.filter(entry => entry.thinkingLevels.length > 1)
		.map(entry => ({ modelKey: entry.modelKey, thinkingLevels: entry.thinkingLevels }));
	return { chain: normalized, duplicates, sameModelDifferentEffort };
}

/**
 * Normalize every chain in a role/model-keyed map, preserving key order.
 *
 * This is one scope's map. Call {@link normalizeScopedFallbackChains} for the
 * runtime and model-kind surfaces so one scope can never be flattened over
 * another.
 */
export function normalizeFallbackChains(
	chains: Readonly<Record<string, readonly string[]>>,
	options: FallbackNormalizeOptions = {},
): Readonly<Record<string, NormalizedFallbackChain>> {
	const result: Record<string, NormalizedFallbackChain> = {};
	for (const [key, chain] of Object.entries(chains)) result[key] = normalizeFallbackChain(chain, options);
	return result;
}

export type NormalizedScopedFallbackChains = Readonly<
	Record<FallbackScope, Readonly<Record<string, NormalizedFallbackChain>>>
>;

function isFallbackChainMap(value: unknown): value is FallbackChainMap {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Normalize each scope independently, always returning every scope (an absent
 * scope is `{}`). Keys and chains never cross scopes.
 */
export function normalizeScopedFallbackChains(
	input?: ScopedFallbackChainsInput,
	options: FallbackNormalizeOptions = {},
): NormalizedScopedFallbackChains {
	const scopes = (input ?? {}) as Readonly<Record<string, unknown>>;
	const result = {} as Record<FallbackScope, Readonly<Record<string, NormalizedFallbackChain>>>;
	for (const scope of FALLBACK_SCOPES) {
		const chains = scopes[scope];
		result[scope] = normalizeFallbackChains(isFallbackChainMap(chains) ? chains : {}, options);
	}
	return result;
}

/** One (scope, key) candidate when resolving a target's fallback. */
export interface ScopedFallbackLookup {
	readonly scope: FallbackScope;
	readonly key: string;
}

export interface FoundScopedFallbackChain extends ScopedFallbackLookup {
	readonly chain: NormalizedFallbackChain;
}

/**
 * Pick the first configured chain from `lookups` without concatenating scopes
 * or borrowing another scope's key. An explicitly empty chain wins over later
 * candidates, so it stays a way to disable fallbacks.
 */
export function findScopedFallbackChain(
	normalized: NormalizedScopedFallbackChains,
	lookups: readonly ScopedFallbackLookup[],
): FoundScopedFallbackChain | undefined {
	for (const lookup of lookups) {
		const chain = normalized[lookup.scope]?.[lookup.key];
		if (chain !== undefined) return { ...lookup, chain };
	}
	return undefined;
}

export interface FoundKindFallbackChain extends Omit<FoundScopedFallbackChain, "scope"> {
	readonly scope: KindFallbackScope;
}

/**
 * Pick the first configured chain for a model kind, in key order. Only the
 * kind's own scope is consulted: a missing kind chain resolves to `undefined`,
 * never to `retry`, `role`, or the legacy retry default.
 */
export function findKindFallbackChain(
	normalized: NormalizedScopedFallbackChains,
	kind: KindFallbackScope,
	keys: readonly string[],
): FoundKindFallbackChain | undefined {
	const found = findScopedFallbackChain(
		normalized,
		keys.map(key => ({ scope: kind, key })),
	);
	return found === undefined ? undefined : { ...found, scope: kind };
}

/** Pick the first unique entry from two ordered chains, primary first. */
export function mergeFallbackChains(
	primary: readonly string[] | undefined,
	secondary: readonly string[] | undefined,
	options: FallbackNormalizeOptions = {},
): readonly string[] {
	const merged: string[] = [];
	const seen = new Set<string>();
	for (const value of [...(primary ?? []), ...(secondary ?? [])]) {
		const parsed = parseFallbackEntry(value);
		if (!parsed) continue;
		const identity = canonicalIdentity(parsed, options);
		if (seen.has(identity)) continue;
		seen.add(identity);
		merged.push(parsed.raw);
	}
	return merged;
}
