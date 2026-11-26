/**
 * Canonical fallback-chain normalization for the model control plane.
 *
 * The runtime already skips a repeated catalog identity while walking a chain;
 * this module is the config/UI boundary: it trims, drops empty entries, keeps
 * the first spelling of an identity, and reports duplicates instead of silently
 * rendering them twice. It does not resolve models or read credentials.
 */

const THINKING_SUFFIXES: ReadonlySet<string> = new Set([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
	"auto",
]);

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
	/** `provider/id`. */
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

/** Split a selector into the catalog key and an optional trailing thinking suffix. */
export function parseFallbackEntry(raw: string): FallbackEntryParts | undefined {
	const trimmed = raw.trim();
	if (trimmed === "") return undefined;
	const match = /^(.*?)(?::(off|minimal|low|medium|high|xhigh|max|auto))?$/.exec(trimmed);
	if (!match?.[1]) return undefined;
	const modelKey = match[1];
	const thinkingLevel = match[2];
	return {
		raw: trimmed,
		modelKey,
		identity: thinkingLevel === undefined ? modelKey : `${modelKey}:${thinkingLevel}`,
		...(thinkingLevel === undefined ? {} : { thinkingLevel }),
	};
}

/**
 * Normalize one configured chain. Exact duplicate identities are removed
 * (first spelling wins); the same model at different thinking levels is kept
 * and reported separately, because that difference can be deliberate.
 */
export function normalizeFallbackChain(chain: readonly string[] | undefined): NormalizedFallbackChain {
	const normalized: string[] = [];
	const duplicates: FallbackDuplicate[] = [];
	const byIdentity = new Map<string, string>();
	const effortsByModel = new Map<string, string[]>();
	for (const value of chain ?? []) {
		const parsed = parseFallbackEntry(value);
		if (!parsed) continue;
		const kept = byIdentity.get(parsed.identity);
		if (kept !== undefined) {
			duplicates.push({ removed: parsed.raw, kept });
			continue;
		}
		byIdentity.set(parsed.identity, parsed.raw);
		normalized.push(parsed.raw);
		const levels = effortsByModel.get(parsed.modelKey) ?? [];
		const level = parsed.thinkingLevel ?? "";
		if (!levels.includes(level)) levels.push(level);
		effortsByModel.set(parsed.modelKey, levels);
	}
	const sameModelDifferentEffort = [...effortsByModel.entries()]
		.filter(([, levels]) => levels.length > 1)
		.map(([modelKey, thinkingLevels]) => ({ modelKey, thinkingLevels }));
	return { chain: normalized, duplicates, sameModelDifferentEffort };
}

/** Normalize every chain in a role/model-keyed map, preserving key order. */
export function normalizeFallbackChains(
	chains: Readonly<Record<string, readonly string[]>>,
): Readonly<Record<string, NormalizedFallbackChain>> {
	const result: Record<string, NormalizedFallbackChain> = {};
	for (const [key, chain] of Object.entries(chains)) result[key] = normalizeFallbackChain(chain);
	return result;
}

/** Pick the first unique entry from two ordered chains, primary first. */
export function mergeFallbackChains(
	primary: readonly string[] | undefined,
	secondary: readonly string[] | undefined,
): readonly string[] {
	const merged: string[] = [];
	const seen = new Set<string>();
	for (const value of [...(primary ?? []), ...(secondary ?? [])]) {
		const parsed = parseFallbackEntry(value);
		if (!parsed || seen.has(parsed.identity)) continue;
		seen.add(parsed.identity);
		merged.push(parsed.raw);
	}
	return merged;
}
