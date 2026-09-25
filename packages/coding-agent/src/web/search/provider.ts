import type { WebSearchGrounding } from "@linxiraos/pi-catalog/types";
import type { SearchProvider } from "./providers/base";
import {
	getSearchProviderLabel,
	SEARCH_PROVIDER_ORDER,
	type SearchEngineId,
	type SearchProviderId,
	SearchProviderError,
} from "./types";

export type { SearchParams } from "./providers/base";
export { SearchProvider } from "./providers/base";

/**
 * Search-first-use boundary: every provider module (and its HTTP/MCP/browser
 * dependencies) loads only when a search actually selects it, so the ~40
 * provider modules stay out of interactive startup. Instances are memoized
 * per id, matching the previous singleton-per-provider behavior.
 */
type ProviderLoader = () => Promise<SearchProvider>;

type ProviderRegistry<TId extends string> = { [Id in TId]: ProviderLoader };

const PROVIDER_LOADERS: ProviderRegistry<SearchEngineId> = {
	bing: () => import("./providers/bing").then(m => new m.BingProvider()),
	perplexity: () => import("./providers/perplexity").then(m => new m.PerplexityProvider()),
	zai: () => import("./providers/zai").then(m => new m.ZaiProvider()),
	exa: () => import("./providers/exa").then(m => new m.ExaProvider()),
	tinyfish: () => import("./providers/tinyfish").then(m => new m.TinyFishProvider()),
	jina: () => import("./providers/jina").then(m => new m.JinaProvider()),
	kagi: () => import("./providers/kagi").then(m => new m.KagiProvider()),
	tavily: () => import("./providers/tavily").then(m => new m.TavilyProvider()),
	firecrawl: () => import("./providers/firecrawl").then(m => new m.FirecrawlProvider()),
	brave: () => import("./providers/brave").then(m => new m.BraveProvider()),
	kimi: () => import("./providers/kimi").then(m => new m.KimiProvider()),
	parallel: () => import("./providers/parallel").then(m => new m.ParallelProvider()),
	synthetic: () => import("./providers/synthetic").then(m => new m.SyntheticProvider()),
	ollama: () => import("./providers/ollama").then(m => new m.OllamaProvider()),
	searxng: () => import("./providers/searxng").then(m => new m.SearXNGProvider()),
	duckduckgo: () => import("./providers/duckduckgo").then(m => new m.DuckDuckGoProvider()),
	google: () => import("./providers/google").then(m => new m.GoogleProvider()),
	ecosia: () => import("./providers/ecosia").then(m => new m.EcosiaProvider()),
	startpage: () => import("./providers/startpage").then(m => new m.StartpageProvider()),
	mojeek: () => import("./providers/mojeek").then(m => new m.MojeekProvider()),
	public: () => import("./providers/public").then(m => new m.PublicWebProvider()),
};

const GROUNDED_PROVIDER_LOADERS: ProviderRegistry<WebSearchGrounding> = {
	gemini: () => import("./providers/gemini").then(m => new m.GeminiProvider()),
	anthropic: () => import("./providers/anthropic").then(m => new m.AnthropicProvider()),
	codex: () => import("./providers/codex").then(m => new m.CodexProvider()),
	xai: () => import("./providers/xai").then(m => new m.XAIProvider()),
	openrouter: () => import("./providers/openrouter").then(m => new m.OpenRouterGroundedProvider()),
};

const providerInstances = new Map<string, Promise<SearchProvider>>();

function loadProvider(id: string, loader: ProviderLoader): Promise<SearchProvider> {
	let instance = providerInstances.get(id);
	if (!instance) {
		instance = loader();
		providerInstances.set(id, instance);
	}
	return instance;
}

/** Format one provider failure for the user-facing fallback summary. */
export function formatSearchProviderFailure(error: unknown, provider: { id: string; label: string }): string {
	if (error instanceof SearchProviderError) {
		if (error.provider === "anthropic" && error.status === 404) {
			return "Anthropic web search returned 404 (model or endpoint not found).";
		}
		if (error.status === 401 || error.status === 403) {
			if (error.provider === "zai") {
				return error.message;
			}
			return `${getSearchProviderLabel(error.provider)} authorization failed (${error.status}). Check API key or base URL.`;
		}
		return error.message;
	}
	if (error instanceof Error) return error.message;
	return `Unknown error from ${provider.label}`;
}

/** Format the ordered provider fallback failures for terminal/tool output. */
export function formatSearchProviderFailures(
	failures: readonly { provider: { id: string; label: string }; error: unknown }[],
): string {
	return failures.map(f => `${f.provider.id}: ${formatSearchProviderFailure(f.error, f.provider)}`).join("; ");
}

function isRegisteredSearchEngine(id: string): id is SearchEngineId {
	return Object.hasOwn(PROVIDER_LOADERS, id);
}

/** Resolve a pure search engine after validating its catalog model id. */
export function getSearchProvider(id: string): Promise<SearchProvider> {
	if (!isRegisteredSearchEngine(id)) return Promise.reject(new Error(`Unknown search provider: ${id}`));
	return loadProvider(id, PROVIDER_LOADERS[id]);
}

/** Resolve the grounding backend declared by a selected chat model. */
export function getGroundedSearchProvider(grounding: WebSearchGrounding): Promise<SearchProvider> {
	return loadProvider(`grounded:${grounding}`, GROUNDED_PROVIDER_LOADERS[grounding]);
}

let orderedProvIds: readonly SearchProviderId[] = SEARCH_PROVIDER_ORDER;
/** Providers the user explicitly listed in `providers.webSearchOrder`. */
let explicitProvIds = new Set<SearchProviderId>();

/**
 * Prioritize configured providers while retaining every unlisted provider in
 * its built-in relative order. Invalid IDs are ignored defensively. Listed
 * providers are treated as explicit selections: they resolve through
 * `isExplicitlyAvailable`, so e.g. a hand-listed Perplexity may fall back to
 * anonymous search exactly like the retired single-preference setting did.
 */
export function setSearchProviderOrder(providers: readonly SearchProviderId[]): void {
	const prioritized = new Set(providers.filter(id => SEARCH_PROVIDER_ORDER.includes(id)));
	explicitProvIds = prioritized;
	orderedProvIds =
		prioritized.size === 0
			? SEARCH_PROVIDER_ORDER
			: [...prioritized, ...SEARCH_PROVIDER_ORDER.filter(id => !prioritized.has(id))];
}

/** Providers excluded from web search resolution via settings. */
let excludedProvIds = new Set<SearchProviderId>();

/** Set providers that web search should never use, including fallbacks. */
export function setExcludedSearchProviders(providers: readonly SearchProviderId[]): void {
	excludedProvIds = new Set(providers);
}

/** `true` when settings exclude `id` from web search (auto chain and the Public Web fan-out). */
export function isSearchProviderExcluded(id: SearchProviderId): boolean {
	return excludedProvIds.has(id);
}

export interface SearchProviderCandidate {
	id: SearchProviderId;
	explicit: boolean;
}

/**
 * Return provider candidates in fallback order without loading their modules.
 * `forcedProvider` (a per-request `provider` argument) is terminal-first and
 * bypasses exclusion; configured-order entries carry `explicit: true`.
 */
export function resolveProviderCandidates(forcedProvider?: SearchProviderId): SearchProviderCandidate[] {
	const candidates: SearchProviderCandidate[] = [];

	if (forcedProvider !== undefined && !isSearchProviderExcluded(forcedProvider)) {
		candidates.push({ id: forcedProvider, explicit: true });
	}

	for (const id of orderedProvIds) {
		if (id === forcedProvider || isSearchProviderExcluded(id)) continue;
		candidates.push({ id, explicit: explicitProvIds.has(id) });
	}

	return candidates;
}
