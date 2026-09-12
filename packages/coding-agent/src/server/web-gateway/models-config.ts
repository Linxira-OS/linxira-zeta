/**
 * Web Gateway — model catalog, discovery, and metadata handlers.
 *
 * Semantic port of the upstream web UI model-config API routes
 * (`/api/models-config/{catalog,discover,metadata}`). The ModelsConfig panel
 * needs a models.dev catalog (search + price-preset recommendation), a live
 * `/models` probe for a provider config being edited, and context/output
 * limits for a single model. The upstream routes leaned on Next.js route
 * handlers plus the external `ModelRuntime` package; here the same logic runs
 * in the gateway process on top of the runtime-native `ModelRegistry`,
 * `ModelsConfigFile`, and the shared auth storage.
 *
 * Response shapes mirror the upstream routes exactly — the web-ui
 * ModelsConfig panel consumes them verbatim.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { resolveConfigValue } from "../../config/model-config-values";
import { ModelRegistry } from "../../config/model-registry";
import { ModelsConfigFile } from "../../config/models-config";
import { getSharedAuthStorage, getSharedModelRegistry } from "./auth";

function json(data: unknown, status = 200): Response {
	return Response.json(data, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// models.dev catalog — flatten / search / price-preset recommendation
// ---------------------------------------------------------------------------

export interface ModelCatalogCost {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
}

export interface ModelCatalogEntry {
	key: string;
	providerId: string;
	providerName: string;
	providerBaseUrl?: string;
	id: string;
	name: string;
	reasoning?: boolean;
	input?: string[];
	contextWindow?: number;
	maxTokens?: number;
	cost: ModelCatalogCost;
}

export interface ModelCatalogPreset {
	name?: string;
	reasoning?: boolean;
	input?: string[];
	contextWindow?: number;
	maxTokens?: number;
	cost?: ModelCatalogCost;
}

type ModelCatalogMatchMethod = "provider" | "base-url" | "consensus" | "none";

export type ModelCatalogPriceRecommendation =
	| {
			status: "reliable";
			method: Exclude<ModelCatalogMatchMethod, "none">;
			cost: ModelCatalogCost;
			providerId?: string;
			providerName?: string;
			support: number;
			total: number;
	  }
	| {
			status: "unreliable";
			reason: "no-exact-match" | "no-valid-price" | "insufficient-support" | "conflict";
			support: number;
			total: number;
	  };

export interface ModelCatalogRecommendation {
	exactMatches: number;
	metadataMethod: ModelCatalogMatchMethod;
	matchedProviderId?: string;
	matchedProviderName?: string;
	preset: ModelCatalogPreset;
	price: ModelCatalogPriceRecommendation;
}

const CONSENSUS_MIN_SHARE = 0.6;
const KNOWN_PROVIDER_HOSTS: Record<string, readonly string[]> = {
	anthropic: ["api.anthropic.com"],
	google: ["generativelanguage.googleapis.com"],
	openai: ["api.openai.com"],
	openrouter: ["openrouter.ai"],
};
const SUPPORTED_INPUT_MODALITIES: Record<string, true> = { text: true, image: true };

function cleanString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalNonNegativeNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function optionalPositiveNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function readCost(value: unknown): ModelCatalogCost {
	if (!isRecord(value)) return {};
	return {
		input: optionalNonNegativeNumber(value.input),
		output: optionalNonNegativeNumber(value.output),
		cacheRead: optionalNonNegativeNumber(value.cache_read),
		cacheWrite: optionalNonNegativeNumber(value.cache_write),
	};
}

function readInputModalities(value: unknown): string[] | undefined {
	if (!isRecord(value) || !Array.isArray(value.input)) return undefined;
	const input = Array.from(
		new Set(
			value.input
				.filter((entry): entry is string => typeof entry === "string")
				.map(entry => entry.trim().toLocaleLowerCase())
				.filter(entry => entry in SUPPORTED_INPUT_MODALITIES),
		),
	);
	return input.length ? input : undefined;
}

function normalizeProvider(value: string): string {
	return value
		.trim()
		.toLocaleLowerCase()
		.replace(/[^a-z0-9]/g, "");
}

function normalizeModelId(value: string): string {
	return value
		.trim()
		.toLocaleLowerCase()
		.replace(/^models\//, "");
}

function hostname(value: string | undefined): string | undefined {
	if (!value) return undefined;
	try {
		return new URL(value).hostname.toLocaleLowerCase().replace(/\.$/, "");
	} catch {
		return undefined;
	}
}

function hostMatches(actual: string, expected: string): boolean {
	return actual === expected || actual.endsWith(`.${expected}`);
}

function providerMatches(entry: ModelCatalogEntry, providerHint: string): boolean {
	const normalizedHint = normalizeProvider(providerHint);
	if (!normalizedHint) return false;
	return (
		normalizeProvider(entry.providerId) === normalizedHint || normalizeProvider(entry.providerName) === normalizedHint
	);
}

function baseUrlMatches(entry: ModelCatalogEntry, baseUrl: string): boolean {
	const actualHost = hostname(baseUrl);
	if (!actualHost) return false;
	const knownHosts = KNOWN_PROVIDER_HOSTS[normalizeProvider(entry.providerId)] ?? [];
	const providerHost = hostname(entry.providerBaseUrl);
	return [...knownHosts, ...(providerHost ? [providerHost] : [])].some(candidate =>
		hostMatches(actualHost, candidate),
	);
}

function exactModelMatches(entry: ModelCatalogEntry, query: string): boolean {
	const normalizedQuery = normalizeModelId(query);
	if (!normalizedQuery) return false;
	const normalizedId = normalizeModelId(entry.id);
	const normalizedFullId = `${entry.providerId.toLocaleLowerCase()}/${normalizedId}`;
	return normalizedId === normalizedQuery || normalizedFullId === normalizedQuery;
}

function validPrice(
	entry: ModelCatalogEntry,
): entry is ModelCatalogEntry & { cost: ModelCatalogCost & { input: number; output: number } } {
	return entry.cost.input !== undefined && entry.cost.output !== undefined;
}

function modeValue<T>(values: readonly T[], total: number, keyFor: (value: T) => string): T | undefined {
	if (values.length === 0 || total <= 0) return undefined;
	const groups = new Map<string, { value: T; count: number }>();
	for (const value of values) {
		const key = keyFor(value);
		const current = groups.get(key);
		if (current) current.count += 1;
		else groups.set(key, { value, count: 1 });
	}
	const ranked = [...groups.values()].sort((a, b) => b.count - a.count);
	const winner = ranked[0];
	if (!winner || winner.count / total < CONSENSUS_MIN_SHARE) return undefined;
	if (ranked[1]?.count === winner.count) return undefined;
	return winner.value;
}

function modeNumber(values: readonly number[]): number | undefined {
	if (values.length === 0) return undefined;
	const groups = new Map<number, number>();
	for (const value of values) groups.set(value, (groups.get(value) ?? 0) + 1);
	const ranked = [...groups.entries()].sort((a, b) => b[1] - a[1]);
	if (!ranked[0] || ranked[1]?.[1] === ranked[0][1]) return undefined;
	return ranked[0][0];
}

function metadataFromEntry(entry: ModelCatalogEntry): ModelCatalogPreset {
	return {
		name: entry.name,
		reasoning: entry.reasoning,
		input: entry.input,
		contextWindow: entry.contextWindow,
		maxTokens: entry.maxTokens,
	};
}

function consensusMetadata(entries: readonly ModelCatalogEntry[]): ModelCatalogPreset {
	const total = entries.length;
	return {
		name: modeValue(
			entries.map(entry => entry.name),
			total,
			value => value.toLocaleLowerCase(),
		),
		reasoning: modeValue(
			entries.flatMap(entry => (entry.reasoning === undefined ? [] : [entry.reasoning])),
			total,
			String,
		),
		input: modeValue(
			entries.flatMap(entry => (entry.input ? [entry.input] : [])),
			total,
			value => [...value].sort().join(","),
		),
		contextWindow: modeValue(
			entries.flatMap(entry => (entry.contextWindow === undefined ? [] : [entry.contextWindow])),
			total,
			String,
		),
		maxTokens: modeValue(
			entries.flatMap(entry => (entry.maxTokens === undefined ? [] : [entry.maxTokens])),
			total,
			String,
		),
	};
}

function priceFromEntry(
	entry: ModelCatalogEntry & { cost: ModelCatalogCost & { input: number; output: number } },
	method: "provider" | "base-url",
): ModelCatalogPriceRecommendation {
	return {
		status: "reliable",
		method,
		cost: entry.cost,
		providerId: entry.providerId,
		providerName: entry.providerName,
		support: 1,
		total: 1,
	};
}

function consensusPrice(entries: readonly ModelCatalogEntry[]): ModelCatalogPriceRecommendation {
	const priced = entries.filter(validPrice);
	if (priced.length === 0) {
		return { status: "unreliable", reason: "no-valid-price", support: 0, total: 0 };
	}
	if (priced.length === 1) {
		return { status: "unreliable", reason: "insufficient-support", support: 1, total: 1 };
	}

	const groups = new Map<string, typeof priced>();
	for (const entry of priced) {
		const key = JSON.stringify([entry.cost.input, entry.cost.output]);
		const group = groups.get(key);
		if (group) group.push(entry);
		else groups.set(key, [entry]);
	}
	const ranked = [...groups.values()].sort((a, b) => b.length - a.length);
	const winner = ranked[0];
	if (!winner) {
		return { status: "unreliable", reason: "no-valid-price", support: 0, total: priced.length };
	}
	if (ranked[1]?.length === winner.length || winner.length / priced.length < CONSENSUS_MIN_SHARE) {
		return {
			status: "unreliable",
			reason: "conflict",
			support: winner.length,
			total: priced.length,
		};
	}

	const cacheRead = modeNumber(
		winner.flatMap(entry => (entry.cost.cacheRead === undefined ? [] : [entry.cost.cacheRead])),
	);
	const cacheWrite = modeNumber(
		winner.flatMap(entry => (entry.cost.cacheWrite === undefined ? [] : [entry.cost.cacheWrite])),
	);
	return {
		status: "reliable",
		method: "consensus",
		cost: {
			input: winner[0].cost.input,
			output: winner[0].cost.output,
			cacheRead,
			cacheWrite,
		},
		support: winner.length,
		total: priced.length,
	};
}

export function flattenModelsDevCatalog(value: unknown): ModelCatalogEntry[] {
	if (!isRecord(value)) return [];

	const entries: ModelCatalogEntry[] = [];
	for (const [providerId, rawProvider] of Object.entries(value)) {
		if (!isRecord(rawProvider) || !isRecord(rawProvider.models)) continue;
		const providerName = cleanString(rawProvider.name) ?? providerId;
		const providerBaseUrl = cleanString(rawProvider.api);

		for (const [fallbackId, rawModel] of Object.entries(rawProvider.models)) {
			if (!isRecord(rawModel)) continue;
			const id = cleanString(rawModel.id) ?? fallbackId;
			if (!id) continue;
			const name = cleanString(rawModel.name) ?? id;
			const entry: ModelCatalogEntry = {
				key: `${providerId}/${id}`,
				providerId,
				providerName,
				id,
				name,
				cost: readCost(rawModel.cost),
			};
			if (providerBaseUrl) entry.providerBaseUrl = providerBaseUrl;
			if (typeof rawModel.reasoning === "boolean") entry.reasoning = rawModel.reasoning;
			const input = readInputModalities(rawModel.modalities);
			if (input) entry.input = input;
			if (isRecord(rawModel.limit)) {
				const contextWindow = optionalPositiveNumber(rawModel.limit.context);
				const maxTokens = optionalPositiveNumber(rawModel.limit.output);
				if (contextWindow !== undefined) entry.contextWindow = contextWindow;
				if (maxTokens !== undefined) entry.maxTokens = maxTokens;
			}
			entries.push(entry);
		}
	}

	return entries;
}

export function recommendModelCatalogPreset(
	entries: readonly ModelCatalogEntry[],
	query: string,
	providerHint = "",
	baseUrl = "",
): ModelCatalogRecommendation {
	const exactEntries = entries.filter(entry => exactModelMatches(entry, query));
	if (exactEntries.length === 0) {
		return {
			exactMatches: 0,
			metadataMethod: "none",
			preset: {},
			price: { status: "unreliable", reason: "no-exact-match", support: 0, total: 0 },
		};
	}

	const providerEntries = exactEntries.filter(entry => providerMatches(entry, providerHint));
	const baseUrlEntries = exactEntries.filter(entry => baseUrlMatches(entry, baseUrl));
	const metadataEntry = providerEntries[0] ?? baseUrlEntries[0];
	const metadataMethod: ModelCatalogMatchMethod = providerEntries.length
		? "provider"
		: baseUrlEntries.length
			? "base-url"
			: "consensus";
	const preset = metadataEntry ? metadataFromEntry(metadataEntry) : consensusMetadata(exactEntries);

	const providerPrice = providerEntries.find(validPrice);
	const baseUrlPrice = baseUrlEntries.find(validPrice);
	const price = providerPrice
		? priceFromEntry(providerPrice, "provider")
		: baseUrlPrice
			? priceFromEntry(baseUrlPrice, "base-url")
			: consensusPrice(exactEntries);
	if (price.status === "reliable") preset.cost = price.cost;

	return {
		exactMatches: exactEntries.length,
		metadataMethod,
		matchedProviderId: metadataEntry?.providerId,
		matchedProviderName: metadataEntry?.providerName,
		preset,
		price,
	};
}

function matchRank(entry: ModelCatalogEntry, query: string, providerHint: string): number {
	const id = entry.id.toLocaleLowerCase();
	const name = entry.name.toLocaleLowerCase();
	const providerId = entry.providerId.toLocaleLowerCase();
	const providerName = entry.providerName.toLocaleLowerCase();
	const fullId = `${providerId}/${id}`;

	let rank = 20;
	if (!query) rank = 10;
	else if (id === query || fullId === query) rank = 0;
	else if (name === query) rank = 1;
	else if (id.startsWith(query) || name.startsWith(query)) rank = 2;
	else if (fullId.startsWith(query) || providerId === query || providerName === query) rank = 3;
	else if (id.includes(query) || name.includes(query)) rank = 4;
	else if (fullId.includes(query) || providerName.includes(query)) rank = 5;

	if (rank < 20 && providerHint && (providerId === providerHint || providerName === providerHint)) rank -= 0.5;
	return rank;
}

export function searchModelCatalog(
	entries: readonly ModelCatalogEntry[],
	query: string,
	providerHint = "",
	limit = 50,
): ModelCatalogEntry[] {
	const normalizedQuery = query.trim().toLocaleLowerCase();
	const normalizedProvider = providerHint.trim().toLocaleLowerCase();
	const cappedLimit = Math.max(1, Math.min(100, Math.floor(limit) || 50));

	return entries
		.map(entry => ({ entry, rank: matchRank(entry, normalizedQuery, normalizedProvider) }))
		.filter(({ rank }) => !normalizedQuery || rank < 20)
		.sort(
			(a, b) =>
				a.rank - b.rank ||
				a.entry.providerName.localeCompare(b.entry.providerName, undefined, { sensitivity: "base" }) ||
				a.entry.name.localeCompare(b.entry.name, undefined, { numeric: true, sensitivity: "base" }) ||
				a.entry.id.localeCompare(b.entry.id, undefined, { numeric: true, sensitivity: "base" }),
		)
		.slice(0, cappedLimit)
		.map(({ entry }) => entry);
}

// ---------------------------------------------------------------------------
// GET /api/models-config/catalog — models.dev catalog with a 1h in-process cache
// ---------------------------------------------------------------------------

const MODELS_DEV_URL = "https://models.dev/api.json";
const CATALOG_TTL_MS = 60 * 60 * 1000;
const CATALOG_FETCH_TIMEOUT_MS = 15_000;

interface CatalogCache {
	entries: ModelCatalogEntry[];
	expiresAt: number;
	inFlight?: Promise<ModelCatalogEntry[]>;
}

const catalogCache: CatalogCache = { entries: [], expiresAt: 0 };

async function fetchCatalog(): Promise<ModelCatalogEntry[]> {
	const response = await fetch(MODELS_DEV_URL, {
		cache: "no-store",
		headers: { Accept: "application/json" },
		signal: AbortSignal.timeout(CATALOG_FETCH_TIMEOUT_MS),
	});
	if (!response.ok) throw new Error(`models.dev returned HTTP ${response.status}`);
	const entries = flattenModelsDevCatalog(await response.json());
	if (entries.length === 0) throw new Error("models.dev returned an empty catalog");
	return entries;
}

async function loadCatalog(): Promise<ModelCatalogEntry[]> {
	if (catalogCache.entries.length > 0 && catalogCache.expiresAt > Date.now()) return catalogCache.entries;
	if (!catalogCache.inFlight) {
		catalogCache.inFlight = fetchCatalog()
			.then(entries => {
				catalogCache.entries = entries;
				catalogCache.expiresAt = Date.now() + CATALOG_TTL_MS;
				return entries;
			})
			.finally(() => {
				catalogCache.inFlight = undefined;
			});
	}

	try {
		return await catalogCache.inFlight;
	} catch (error) {
		if (catalogCache.entries.length > 0) return catalogCache.entries;
		throw error;
	}
}

export async function handleModelsConfigCatalog(req: Request): Promise<Response> {
	const { searchParams } = new URL(req.url);
	const query = (searchParams.get("q") ?? "").slice(0, 120);
	const provider = (searchParams.get("provider") ?? "").slice(0, 120);
	const baseUrl = (searchParams.get("baseUrl") ?? "").slice(0, 500);
	const parsedLimit = Number.parseInt(searchParams.get("limit") ?? "50", 10);
	const limit = Number.isFinite(parsedLimit) ? parsedLimit : 50;

	try {
		const entries = await loadCatalog();
		const models = searchModelCatalog(entries, query, provider, limit);
		const recommendation = recommendModelCatalogPreset(entries, query, provider, baseUrl);
		return json({ models, recommendation, source: MODELS_DEV_URL });
	} catch (error) {
		return json({ error: errorMessage(error) }, 502);
	}
}

// ---------------------------------------------------------------------------
// POST /api/models-config/discover — probe a provider config's /models list
// ---------------------------------------------------------------------------

export interface DiscoveredModel {
	id: string;
	name?: string;
}

function modelFromValue(value: unknown): DiscoveredModel | null {
	if (typeof value === "string") {
		const id = value.trim();
		return id ? { id } : null;
	}
	if (!isRecord(value)) return null;

	const rawId = cleanString(value.id) ?? cleanString(value.model) ?? cleanString(value.name);
	if (!rawId) return null;
	const id = rawId.startsWith("models/") ? rawId.slice("models/".length) : rawId;
	if (!id) return null;
	const name =
		cleanString(value.display_name) ??
		cleanString(value.displayName) ??
		(cleanString(value.id) || cleanString(value.model) ? cleanString(value.name) : undefined);
	return name && name !== id ? { id, name } : { id };
}

function listFromResponse(value: unknown): unknown[] {
	if (Array.isArray(value)) return value;
	if (!isRecord(value)) return [];
	for (const key of ["data", "models", "results", "items"]) {
		const candidate = value[key];
		if (Array.isArray(candidate)) return candidate;
		if (isRecord(candidate)) return Object.values(candidate);
	}
	return [];
}

export function parseDiscoveredModels(value: unknown): DiscoveredModel[] {
	const seen = new Set<string>();
	const models: DiscoveredModel[] = [];
	for (const item of listFromResponse(value)) {
		const model = modelFromValue(item);
		if (!model || seen.has(model.id)) continue;
		seen.add(model.id);
		models.push(model);
	}
	return models.sort((a, b) =>
		(a.name ?? a.id).localeCompare(b.name ?? b.id, undefined, { numeric: true, sensitivity: "base" }),
	);
}

export function buildModelsListUrl(baseUrl: string, api: string): URL {
	const url = new URL(baseUrl.trim());
	const trimmedPath = url.pathname.replace(/\/+$/, "");

	if (!/\/models$/i.test(trimmedPath)) {
		let pathName = trimmedPath;
		if (api === "anthropic-messages" && !/\/v\d+(?:beta)?$/i.test(pathName)) pathName += "/v1";
		if (api === "google-generative-ai" && !/\/v\d+(?:beta)?$/i.test(pathName)) pathName += "/v1beta";
		url.pathname = `${pathName}/models`.replace(/\/+/g, "/");
	}

	if (api === "anthropic-messages" && !url.searchParams.has("limit")) {
		url.searchParams.set("limit", "1000");
	}
	if (api === "google-generative-ai" && !url.searchParams.has("pageSize")) {
		url.searchParams.set("pageSize", "1000");
	}
	return url;
}

const DISCOVERY_TIMEOUT_MS = 20_000;
/** Sentinel model id written into the throwaway provider config for auth resolution. */
const DISCOVERY_MODEL_ID = "__zeta_model_discovery__";

interface ModelDiscoveryAuth {
	apiKey?: string;
	headers: Record<string, string>;
}

function stringRecord(value: unknown): Record<string, string> {
	if (!isRecord(value)) return {};
	return Object.fromEntries(
		Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
	);
}

/**
 * Resolve the credentials for a provider config coming from the browser.
 *
 * The upstream reference ran the config through a throwaway external
 * `ModelRuntime`; here the same resolution uses the zeta config-value rules
 * for `!command` / env-var indirections, then a throwaway `ModelRegistry` over
 * a temp models file sharing the gateway auth storage (the same isolation
 * pattern as `handleModelsConfigTest` in `models.ts`) for stored credentials.
 */
async function resolveModelDiscoveryAuth(
	providerName: string,
	provider: Record<string, unknown>,
): Promise<ModelDiscoveryAuth> {
	const requestKey = typeof provider.apiKey === "string" ? provider.apiKey.trim() : "";
	const providerHeaders = stringRecord(provider.headers);
	if (requestKey) {
		// Zeta config-value rules: `!command` runs, an env-var name resolves,
		// anything else stays literal.
		const resolved = resolveConfigValue(requestKey);
		if (resolved) return { apiKey: resolved, headers: providerHeaders };
	}

	let tempDir: string | undefined;
	try {
		tempDir = mkdtempSync(path.join(tmpdir(), "zeta-web-model-discovery-"));
		const modelsPath = path.join(tempDir, "models.json");
		writeFileSync(
			modelsPath,
			JSON.stringify(
				{
					providers: {
						[providerName]: {
							...provider,
							models: [{ id: DISCOVERY_MODEL_ID }],
						},
					},
				},
				null,
				2,
			),
			"utf8",
		);

		const authStorage = await getSharedAuthStorage();
		const registry = new ModelRegistry(authStorage, modelsPath, { ignoreLocalModelConfig: true });
		const loadError = registry.getError();
		if (loadError) throw new Error(loadError.message);
		const model = registry.find(providerName, DISCOVERY_MODEL_ID);
		if (!model) throw new Error(`Unable to load provider "${providerName}"`);

		const apiKey = await authStorage.getApiKey(providerName, undefined, {
			modelId: model.id,
			baseUrl: model.baseUrl,
		});
		return { apiKey, headers: { ...providerHeaders, ...stringRecord(model.headers) } };
	} finally {
		if (tempDir) rmSync(tempDir, { recursive: true, force: true });
	}
}

/** Header rules per provider API family (anthropic key header, Google key header, else Bearer). */
function buildDiscoveryHeaders(api: string, apiKey: string | undefined, configured: Record<string, string>): Headers {
	const headers = new Headers(configured);
	if (!headers.has("accept")) headers.set("Accept", "application/json");
	if (!apiKey) return headers;

	if (api === "anthropic-messages") {
		if (!headers.has("x-api-key")) headers.set("x-api-key", apiKey);
		if (!headers.has("anthropic-version")) headers.set("anthropic-version", "2023-06-01");
	} else if (api === "google-generative-ai") {
		if (!headers.has("x-goog-api-key")) headers.set("x-goog-api-key", apiKey);
	} else if (!headers.has("authorization")) {
		headers.set("Authorization", `Bearer ${apiKey}`);
	}
	return headers;
}

export async function handleModelsConfigDiscover(req: Request): Promise<Response> {
	try {
		const body = (await req.json()) as { providerName?: unknown; provider?: unknown };
		const providerName = typeof body.providerName === "string" ? body.providerName.trim() : "";
		if (!providerName) return json({ error: "providerName is required" }, 400);
		if (!isRecord(body.provider)) return json({ error: "provider is required" }, 400);

		const baseUrl = typeof body.provider.baseUrl === "string" ? body.provider.baseUrl.trim() : "";
		if (!baseUrl) return json({ error: "Base URL is required" }, 400);
		const api = typeof body.provider.api === "string" && body.provider.api ? body.provider.api : "openai-completions";

		let endpoint: URL;
		try {
			endpoint = buildModelsListUrl(baseUrl, api);
		} catch {
			return json({ error: "Base URL is invalid" }, 400);
		}

		const auth = await resolveModelDiscoveryAuth(providerName, body.provider);
		if (typeof body.provider.apiKey === "string" && body.provider.apiKey.trim() && !auth.apiKey) {
			return json({ error: `No API key found for "${providerName}"` }, 400);
		}

		const response = await fetch(endpoint, {
			cache: "no-store",
			headers: buildDiscoveryHeaders(api, auth.apiKey, auth.headers),
			signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
		});
		const responseText = await response.text();
		if (!response.ok) {
			return json(
				{
					error: responseText.slice(0, 500) || `Upstream returned HTTP ${response.status}`,
					status: response.status,
				},
				502,
			);
		}

		let payload: unknown;
		try {
			payload = JSON.parse(responseText);
		} catch {
			return json({ error: "Upstream model list was not valid JSON" }, 502);
		}
		const models = parseDiscoveredModels(payload);
		if (models.length === 0) {
			return json({ error: "No models found in the upstream response" }, 502);
		}

		return json({ models, endpoint: endpoint.toString() });
	} catch (error) {
		const status = error instanceof DOMException && error.name === "TimeoutError" ? 504 : 500;
		return json({ error: errorMessage(error) }, status);
	}
}

// ---------------------------------------------------------------------------
// POST /api/models-config/metadata — context/output limits for one model
// ---------------------------------------------------------------------------

interface ModelMetadata {
	contextWindow?: number;
	maxTokens?: number;
}

const METADATA_LOOKUP_TIMEOUT_MS = 8_000;
const METADATA_MAX_RESPONSE_BYTES = 1_000_000;

function firstPositiveInteger(record: Record<string, unknown>, keys: readonly string[]): number | undefined {
	for (const key of keys) {
		const raw = record[key];
		const number = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : NaN;
		if (Number.isFinite(number) && number > 0) return Math.floor(number);
	}
	return undefined;
}

const METADATA_CONTEXT_KEYS = [
	"contextWindow",
	"context_window",
	"contextLength",
	"context_length",
	"maxContextLength",
	"max_context_length",
	"maxInputTokens",
	"max_input_tokens",
	"inputTokenLimit",
	"input_token_limit",
] as const;

const METADATA_OUTPUT_KEYS = [
	"maxTokens",
	"max_tokens",
	"maxOutputTokens",
	"max_output_tokens",
	"maxCompletionTokens",
	"max_completion_tokens",
	"outputTokenLimit",
	"output_token_limit",
] as const;

function extractModelMetadata(value: unknown): ModelMetadata {
	if (!isRecord(value)) return {};

	const nestedRecords = [value.limits, value.capabilities, value.metadata].filter(isRecord);
	const records = [value, ...nestedRecords];
	let contextWindow: number | undefined;
	let maxTokens: number | undefined;

	for (const record of records) {
		contextWindow ??= firstPositiveInteger(record, METADATA_CONTEXT_KEYS);
		maxTokens ??= firstPositiveInteger(record, METADATA_OUTPUT_KEYS);
		if (contextWindow !== undefined && maxTokens !== undefined) break;
	}

	return {
		...(contextWindow !== undefined ? { contextWindow } : {}),
		...(maxTokens !== undefined ? { maxTokens } : {}),
	};
}

function extractMatchingModelMetadata(payload: unknown, modelId: string): ModelMetadata {
	const models = Array.isArray(payload)
		? payload
		: isRecord(payload) && Array.isArray(payload.data)
			? payload.data
			: isRecord(payload) && Array.isArray(payload.models)
				? payload.models
				: [];
	const normalizedId = modelId.trim().toLowerCase();
	const match = models.find(
		model => isRecord(model) && typeof model.id === "string" && model.id.toLowerCase() === normalizedId,
	);
	return extractModelMetadata(match);
}

function hasMetadata(metadata: ModelMetadata): boolean {
	return metadata.contextWindow !== undefined || metadata.maxTokens !== undefined;
}

function modelCatalogMetadata(
	registry: Pick<ModelRegistry, "getAll">,
	providerName: string,
	modelId: string,
): ModelMetadata {
	const models = registry.getAll();
	const providerNameLower = providerName.toLowerCase();
	const modelIdLower = modelId.toLowerCase();
	const matchesModelId = (model: { id?: string }): boolean =>
		typeof model.id === "string" && model.id.toLowerCase() === modelIdLower;
	const exactProvider = models.filter(
		model =>
			typeof model.provider === "string" &&
			model.provider.toLowerCase() === providerNameLower &&
			matchesModelId(model),
	);
	const exactId = models.filter(model => matchesModelId(model) && !exactProvider.includes(model));
	for (const model of [...exactProvider, ...exactId]) {
		const metadata = extractModelMetadata(model);
		if (hasMetadata(metadata)) return metadata;
	}
	return {};
}

function metadataModelUrls(baseUrl: string): string[] {
	let url: URL;
	try {
		url = new URL(baseUrl);
	} catch {
		return [];
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return [];

	const pathName = url.pathname.replace(/\/+$/u, "").replace(/\/chat\/completions$/u, "");
	const paths = pathName.endsWith("/v1")
		? ["/models", "/v1/models"]
		: [`${pathName || ""}/models`, `${pathName || ""}/v1/models`];
	const seen = new Set<string>();
	return paths.flatMap(candidatePath => {
		const candidate = new URL(url.toString());
		candidate.pathname = candidatePath.replace(/\/+/gu, "/") || "/models";
		candidate.search = "";
		candidate.hash = "";
		const value = candidate.toString();
		if (seen.has(value)) return [];
		seen.add(value);
		return [value];
	});
}

function metadataRequestHeaders(provider: Record<string, unknown>): Record<string, string> {
	const headers: Record<string, string> = { Accept: "application/json" };
	if (isRecord(provider.headers)) {
		for (const [name, value] of Object.entries(provider.headers)) {
			if (typeof value === "string" && value.trim()) headers[name] = value;
		}
	}
	const hasAuthorization = Object.keys(headers).some(name => name.toLowerCase() === "authorization");
	const configuredKey = provider.apiKey ?? provider.key;
	const apiKey =
		typeof configuredKey === "string" &&
		configuredKey.trim() &&
		!configuredKey.startsWith("$") &&
		!configuredKey.startsWith("!")
			? configuredKey.trim()
			: undefined;
	if (apiKey && !hasAuthorization) headers.Authorization = `Bearer ${apiKey}`;
	return headers;
}

async function fetchRemoteMetadata(provider: Record<string, unknown>, modelId: string): Promise<ModelMetadata> {
	const baseUrl = typeof provider.baseUrl === "string" ? provider.baseUrl.trim() : "";
	if (!baseUrl) return {};
	const api = typeof provider.api === "string" ? provider.api : "";
	if (api && api !== "openai-completions" && api !== "openai-responses") return {};

	for (const url of metadataModelUrls(baseUrl)) {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), METADATA_LOOKUP_TIMEOUT_MS);
		try {
			const response = await fetch(url, { headers: metadataRequestHeaders(provider), signal: controller.signal });
			if (!response.ok) continue;
			const buffer = await response.arrayBuffer();
			if (buffer.byteLength > METADATA_MAX_RESPONSE_BYTES) continue;
			const payload = JSON.parse(new TextDecoder().decode(buffer)) as unknown;
			const metadata = extractMatchingModelMetadata(payload, modelId);
			if (hasMetadata(metadata)) return metadata;
		} catch {
			// Try the alternate /models URL, then fall back to the local catalog.
		} finally {
			clearTimeout(timeout);
		}
	}
	return {};
}

export async function handleModelsConfigMetadata(req: Request): Promise<Response> {
	try {
		const body = (await req.json()) as { providerName?: unknown; provider?: unknown; modelId?: unknown };
		const providerName = typeof body.providerName === "string" ? body.providerName.trim() : "";
		const modelId = typeof body.modelId === "string" ? body.modelId.trim() : "";
		const provider = isRecord(body.provider) ? body.provider : null;
		if (!providerName || !modelId || !provider) {
			return json({ ok: false, error: "providerName, provider, and modelId are required" }, 400);
		}

		// Runtime catalog first (bundled + cached discovery models).
		try {
			const registry = await getSharedModelRegistry();
			const metadata = modelCatalogMetadata(registry, providerName, modelId);
			if (hasMetadata(metadata)) {
				return json({ ok: true, ...metadata, source: "Pi model catalog" });
			}
		} catch {
			// Continue with the provider's own catalog if the registry cannot load.
		}

		// Then the user's configured models file.
		const configResult = ModelsConfigFile.tryLoad();
		const providers: Record<string, unknown> =
			configResult.status === "ok"
				? ((configResult.value.providers as Record<string, unknown> | undefined) ?? {})
				: {};
		const configuredProvider = providers[providerName];
		const configuredModels =
			configuredProvider && isRecord(configuredProvider) && Array.isArray(configuredProvider.models)
				? configuredProvider.models
				: [];
		const configuredModel = configuredModels.find(model => isRecord(model) && model.id === modelId);
		if (configuredModel && isRecord(configuredModel)) {
			const localMetadata = extractModelMetadata({ ...configuredModel, provider: providerName });
			if (hasMetadata(localMetadata)) {
				return json({ ok: true, ...localMetadata, source: "models.yml" });
			}
		}

		// Finally the provider's live /models catalog.
		const remoteMetadata = await fetchRemoteMetadata(provider, modelId);
		if (hasMetadata(remoteMetadata)) {
			return json({ ok: true, ...remoteMetadata, source: "Provider /models catalog" });
		}

		return json({ ok: false, error: `No context or output limits found for ${providerName}/${modelId}` }, 404);
	} catch (error) {
		return json({ ok: false, error: errorMessage(error) }, 500);
	}
}
