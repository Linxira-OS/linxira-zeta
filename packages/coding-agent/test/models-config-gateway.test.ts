/**
 * Model-config gateway endpoints — catalog / discover / metadata.
 *
 * Contracts (shapes mirror the upstream web-ui routes the ModelsConfig panel
 * consumes):
 * - GET  /api/models-config/catalog   → models.dev flatten + search + price
 *   preset recommendation behind a 1h in-process cache; `{ error }` + 502 when
 *   the catalog source is unusable.
 * - POST /api/models-config/discover  → probe a provider config's /models list;
 *   auth header per API family (anthropic key header, Google key header, else
 *   Bearer); `{ models, endpoint }` on success, `{ error }` + 502 upstream
 *   failures.
 * - POST /api/models-config/metadata  → context/output limits for one model
 *   from the runtime catalog, the configured models file, or the provider's
 *   live /models catalog; `{ ok: false }` + 404 when nothing matches.
 *
 * Network is mocked via globalThis.fetch (gateway test convention); concrete
 * request apiKeys keep the auth-resolution path free of registry side effects,
 * and a temp ZETA_CODING_AGENT_DIR isolates the metadata registry/models-file
 * lookups.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshDirsFromEnv } from "@linxiraos/pi-utils";
import {
	buildModelsListUrl,
	flattenModelsDevCatalog,
	handleModelsConfigCatalog,
	handleModelsConfigDiscover,
	handleModelsConfigMetadata,
	parseDiscoveredModels,
	recommendModelCatalogPreset,
	searchModelCatalog,
} from "../src/server/web-gateway/models-config";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const savedAgentDir = process.env.ZETA_CODING_AGENT_DIR;
let agentDir: string;

beforeAll(async () => {
	agentDir = await mkdtemp(join(tmpdir(), "zeta-gw-models-config-"));
	process.env.ZETA_CODING_AGENT_DIR = agentDir;
	refreshDirsFromEnv();
});

afterAll(async () => {
	if (savedAgentDir === undefined) delete process.env.ZETA_CODING_AGENT_DIR;
	else process.env.ZETA_CODING_AGENT_DIR = savedAgentDir;
	refreshDirsFromEnv();
	// The auth-storage sqlite handle can outlive the test on Windows; retry and
	// never fail the suite over temp-dir cleanup.
	await rm(agentDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
});

interface CapturedRequest {
	url: string;
	headers: Headers;
}

function jsonResponse(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

/** Spy on globalThis.fetch, capturing every request; responses resolve via `respond`. */
function spyFetch(respond: (url: string, init?: RequestInit) => Response | Promise<Response>): CapturedRequest[] {
	const calls: CapturedRequest[] = [];
	const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
		calls.push({ url, headers: new Headers(init?.headers) });
		return respond(url, init);
	};
	const fetchMock = Object.assign(impl, { preconnect: globalThis.fetch.preconnect });
	vi.spyOn(globalThis, "fetch").mockImplementation(fetchMock);
	return calls;
}

const CATALOG_JSON = {
	acme: {
		name: "Acme",
		api: "https://api.acme.dev/v1",
		models: {
			"acme-large": {
				id: "acme-large",
				name: "Acme Large",
				reasoning: true,
				modalities: { input: ["text", "image", "pdf"], output: ["text"] },
				limit: { context: 400_000, output: 128_000 },
				cost: { input: 1.25, output: 10, cache_read: 0.125 },
			},
			"acme-mini": {
				id: "acme-mini",
				name: "Acme Mini",
				limit: { context: 32_000, output: 8_000 },
			},
		},
	},
	"acme-cloud": {
		name: "Acme Cloud",
		models: {
			"acme-large": {
				id: "acme-large",
				name: "Acme Large (Cloud)",
				limit: { context: 1_000_000, output: 64_000 },
				cost: { input: 1.3, output: 10.5 },
			},
		},
	},
};

// ---------------------------------------------------------------------------
// Catalog pure functions
// ---------------------------------------------------------------------------

describe("flattenModelsDevCatalog", () => {
	it("flattens providers and models into searchable entries", () => {
		const entries = flattenModelsDevCatalog(CATALOG_JSON);
		expect(entries).toHaveLength(3);

		const large = entries.find(entry => entry.key === "acme/acme-large");
		expect(large).toEqual({
			key: "acme/acme-large",
			providerId: "acme",
			providerName: "Acme",
			providerBaseUrl: "https://api.acme.dev/v1",
			id: "acme-large",
			name: "Acme Large",
			reasoning: true,
			input: ["text", "image"],
			contextWindow: 400_000,
			maxTokens: 128_000,
			cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: undefined },
		});

		const mini = entries.find(entry => entry.key === "acme/acme-mini");
		expect(mini?.cost).toEqual({});
		expect(mini?.contextWindow).toBe(32_000);
	});

	it("ignores malformed providers and non-object payloads", () => {
		expect(flattenModelsDevCatalog({ broken: { name: "Broken" }, junk: "nope" })).toEqual([]);
		expect(flattenModelsDevCatalog("nope")).toEqual([]);
		expect(flattenModelsDevCatalog(null)).toEqual([]);
	});
});

describe("searchModelCatalog", () => {
	const entries = flattenModelsDevCatalog(CATALOG_JSON);

	it("ranks exact ids and provider-scoped full ids first", () => {
		expect(searchModelCatalog(entries, "acme-large", "acme")[0]?.providerId).toBe("acme");
		expect(searchModelCatalog(entries, "acme-cloud/acme-large")[0]?.providerId).toBe("acme-cloud");
	});

	it("returns everything ranked when the query is empty and caps the limit", () => {
		const all = searchModelCatalog(entries, "");
		expect(all).toHaveLength(3);
		expect(searchModelCatalog(entries, "", "", 1)).toHaveLength(1);
	});

	it("drops entries that do not match the query", () => {
		expect(searchModelCatalog(entries, "acme-mini")).toHaveLength(1);
		expect(searchModelCatalog(entries, "nonexistent")).toHaveLength(0);
	});
});

describe("recommendModelCatalogPreset", () => {
	const entries = flattenModelsDevCatalog(CATALOG_JSON);

	it("prefers an exact provider match and its price", () => {
		const recommendation = recommendModelCatalogPreset(entries, "acme-large", "acme-cloud");
		expect(recommendation.metadataMethod).toBe("provider");
		expect(recommendation.matchedProviderId).toBe("acme-cloud");
		expect(recommendation.price).toMatchObject({
			status: "reliable",
			method: "provider",
			cost: { input: 1.3, output: 10.5 },
			support: 1,
			total: 1,
		});
	});

	it("matches canonical provider hosts by base URL hostname", () => {
		const recommendation = recommendModelCatalogPreset(entries, "acme/acme-large", "", "https://api.acme.dev/other");
		expect(recommendation.metadataMethod).toBe("base-url");
		expect(recommendation.matchedProviderId).toBe("acme");
		expect(recommendation.price).toMatchObject({ status: "reliable", method: "base-url" });
	});

	it("reports no-exact-match for unknown models", () => {
		const recommendation = recommendModelCatalogPreset(entries, "unknown-model");
		expect(recommendation.exactMatches).toBe(0);
		expect(recommendation.metadataMethod).toBe("none");
		expect(recommendation.price).toMatchObject({ status: "unreliable", reason: "no-exact-match" });
	});
});

describe("parseDiscoveredModels / buildModelsListUrl", () => {
	it("parses strings, objects, models/ prefixes, and dedupes + sorts", () => {
		const models = parseDiscoveredModels({
			data: [
				"b-model",
				{ id: "models/gemini-pro", displayName: "Gemini Pro" },
				{ id: "b-model" },
				{ name: "unnamed" },
			],
		});
		expect(models).toEqual([{ id: "b-model" }, { id: "gemini-pro", name: "Gemini Pro" }, { id: "unnamed" }]);
	});

	it("builds API-family-specific /models URLs with page params", () => {
		expect(buildModelsListUrl("https://api.acme.dev", "openai-completions").toString()).toBe(
			"https://api.acme.dev/models",
		);
		expect(buildModelsListUrl("https://api.anthropic.com", "anthropic-messages").toString()).toBe(
			"https://api.anthropic.com/v1/models?limit=1000",
		);
		expect(buildModelsListUrl("https://generativelanguage.googleapis.com", "google-generative-ai").toString()).toBe(
			"https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
		);
		expect(buildModelsListUrl("https://api.acme.dev/v1/", "openai-completions").toString()).toBe(
			"https://api.acme.dev/v1/models",
		);
	});
});

// ---------------------------------------------------------------------------
// GET /api/models-config/catalog
// ---------------------------------------------------------------------------

describe("handleModelsConfigCatalog", () => {
	it("returns the upstream 502 error shape when the catalog source is empty", async () => {
		spyFetch(() => jsonResponse({}));
		const response = await handleModelsConfigCatalog(new Request("https://gateway.test/api/models-config/catalog"));
		expect(response.status).toBe(502);
		expect(await response.json()).toEqual({ error: "models.dev returned an empty catalog" });
	});

	it("serves search + recommendation + source from models.dev", async () => {
		spyFetch(url => {
			expect(url).toBe("https://models.dev/api.json");
			return jsonResponse(CATALOG_JSON);
		});
		const response = await handleModelsConfigCatalog(
			new Request("https://gateway.test/api/models-config/catalog?q=acme-large&provider=acme"),
		);
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.source).toBe("https://models.dev/api.json");
		expect(body.models).toHaveLength(2);
		expect(body.models[0]).toMatchObject({ id: "acme-large", providerId: "acme" });
		expect(body.recommendation.metadataMethod).toBe("provider");
		expect(body.recommendation.preset).toMatchObject({ name: "Acme Large", reasoning: true });
		expect(body.recommendation.price).toMatchObject({ status: "reliable", method: "provider" });
	});

	it("serves repeat requests from the 1h cache without refetching", async () => {
		let refetches = 0;
		spyFetch(() => {
			refetches += 1;
			return jsonResponse(CATALOG_JSON);
		});
		const response = await handleModelsConfigCatalog(new Request("https://gateway.test/api/models-config/catalog"));
		expect(response.status).toBe(200);
		expect(refetches).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// POST /api/models-config/discover
// ---------------------------------------------------------------------------

describe("handleModelsConfigDiscover", () => {
	const discover = (body: unknown): Request =>
		new Request("https://gateway.test/api/models-config/discover", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});

	it("requires providerName and a provider baseUrl", async () => {
		const noName = await handleModelsConfigDiscover(discover({ provider: { baseUrl: "https://api.acme.dev" } }));
		expect(noName.status).toBe(400);
		expect(await noName.json()).toEqual({ error: "providerName is required" });

		const noBaseUrl = await handleModelsConfigDiscover(discover({ providerName: "acme", provider: {} }));
		expect(noBaseUrl.status).toBe(400);
		expect(await noBaseUrl.json()).toEqual({ error: "Base URL is required" });
	});

	it("sends the anthropic key header and API version for anthropic-messages", async () => {
		const calls = spyFetch(() => jsonResponse({ data: [{ id: "claude-sonnet-x" }] }));
		const response = await handleModelsConfigDiscover(
			discover({
				providerName: "anthropic",
				provider: { baseUrl: "https://api.anthropic.com", api: "anthropic-messages", apiKey: "sk-ant-test" },
			}),
		);
		expect(response.status).toBe(200);
		const call = calls[0];
		expect(call?.url).toBe("https://api.anthropic.com/v1/models?limit=1000");
		expect(call?.headers.get("x-api-key")).toBe("sk-ant-test");
		expect(call?.headers.get("anthropic-version")).toBe("2023-06-01");
		expect(call?.headers.has("authorization")).toBe(false);

		const body = await response.json();
		expect(body.endpoint).toBe("https://api.anthropic.com/v1/models?limit=1000");
		expect(body.models).toEqual([{ id: "claude-sonnet-x" }]);
	});

	it("sends the Google key header for google-generative-ai", async () => {
		const calls = spyFetch(() => jsonResponse({ models: [{ name: "models/gemini-x", displayName: "Gemini X" }] }));
		const response = await handleModelsConfigDiscover(
			discover({
				providerName: "google",
				provider: {
					baseUrl: "https://generativelanguage.googleapis.com",
					api: "google-generative-ai",
					apiKey: "g-key",
				},
			}),
		);
		expect(response.status).toBe(200);
		const call = calls[0];
		expect(call?.url).toBe("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000");
		expect(call?.headers.get("x-goog-api-key")).toBe("g-key");
		expect(call?.headers.has("authorization")).toBe(false);
		expect(call?.headers.has("anthropic-version")).toBe(false);

		const body = await response.json();
		expect(body.models).toEqual([{ id: "gemini-x", name: "Gemini X" }]);
	});

	it("sends Bearer auth and preserves configured headers otherwise", async () => {
		const calls = spyFetch(() => jsonResponse({ data: [{ id: "m-1" }, { id: "m-1" }, { id: "m-2" }] }));
		const response = await handleModelsConfigDiscover(
			discover({
				providerName: "acme",
				provider: {
					baseUrl: "https://api.acme.dev/v1",
					apiKey: "sk-acme",
					headers: { "X-Custom": "custom-value" },
				},
			}),
		);
		expect(response.status).toBe(200);
		const call = calls[0];
		expect(call?.url).toBe("https://api.acme.dev/v1/models");
		expect(call?.headers.get("authorization")).toBe("Bearer sk-acme");
		expect(call?.headers.get("x-custom")).toBe("custom-value");
		expect(call?.headers.get("accept")).toBe("application/json");

		const body = await response.json();
		expect(body.models).toEqual([{ id: "m-1" }, { id: "m-2" }]);
	});

	it("mirrors the upstream 502 shapes for upstream failures", async () => {
		const httpError = spyFetch(() => new Response("rate limited", { status: 429 }));
		const httpErrorResponse = await handleModelsConfigDiscover(
			discover({ providerName: "acme", provider: { baseUrl: "https://api.acme.dev", apiKey: "k" } }),
		);
		expect(httpErrorResponse.status).toBe(502);
		expect(await httpErrorResponse.json()).toEqual({ error: "rate limited", status: 429 });

		const badJson = spyFetch(() => new Response("not json", { status: 200 }));
		const badJsonResponse = await handleModelsConfigDiscover(
			discover({ providerName: "acme", provider: { baseUrl: "https://api.acme.dev", apiKey: "k" } }),
		);
		expect(badJsonResponse.status).toBe(502);
		expect(await badJsonResponse.json()).toEqual({ error: "Upstream model list was not valid JSON" });

		const empty = spyFetch(() => jsonResponse({ data: [] }));
		const emptyResponse = await handleModelsConfigDiscover(
			discover({ providerName: "acme", provider: { baseUrl: "https://api.acme.dev", apiKey: "k" } }),
		);
		expect(emptyResponse.status).toBe(502);
		expect(await emptyResponse.json()).toEqual({ error: "No models found in the upstream response" });
		expect(httpError).toHaveLength(1);
		expect(badJson).toHaveLength(1);
		expect(empty).toHaveLength(1);
	});

	it("resolves env-named request keys through zeta config-value rules", async () => {
		process.env.ACME_DISCOVERY_KEY = "resolved-acme-key";
		try {
			const calls = spyFetch(() => jsonResponse({ data: [{ id: "m-1" }] }));
			const response = await handleModelsConfigDiscover(
				discover({
					providerName: "acme",
					provider: { baseUrl: "https://api.acme.dev", apiKey: "ACME_DISCOVERY_KEY" },
				}),
			);
			expect(response.status).toBe(200);
			expect(calls[0]?.headers.get("authorization")).toBe("Bearer resolved-acme-key");
		} finally {
			delete process.env.ACME_DISCOVERY_KEY;
		}
	});
});

// ---------------------------------------------------------------------------
// POST /api/models-config/metadata
// ---------------------------------------------------------------------------

describe("handleModelsConfigMetadata", () => {
	const metadata = (body: unknown): Request =>
		new Request("https://gateway.test/api/models-config/metadata", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});

	const provider = {
		baseUrl: "https://api.acme-remote.test/v1",
		api: "openai-completions",
		apiKey: "sk-remote",
	};

	it("requires providerName, provider, and modelId", async () => {
		const response = await handleModelsConfigMetadata(metadata({ providerName: "acme" }));
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			ok: false,
			error: "providerName, provider, and modelId are required",
		});
	});

	it("resolves limits from the provider /models catalog, falling back across URL variants", async () => {
		const calls = spyFetch(url => {
			// /v1 base tries host-rooted /models first, then /v1/models.
			if (url === "https://api.acme-remote.test/models") return new Response("nope", { status: 404 });
			expect(url).toBe("https://api.acme-remote.test/v1/models");
			return jsonResponse({
				object: "list",
				data: [
					{ id: "other-model", context_window: 1 },
					{ id: "acme-remote-large", context_window: 131_072, max_output_tokens: 16_384 },
				],
			});
		});
		const response = await handleModelsConfigMetadata(
			metadata({ providerName: "acme-remote", provider, modelId: "acme-remote-large" }),
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			ok: true,
			contextWindow: 131_072,
			maxTokens: 16_384,
			source: "Provider /models catalog",
		});
		expect(calls).toHaveLength(2);
		expect(calls[1]?.headers.get("authorization")).toBe("Bearer sk-remote");
	});

	it("withholds templated keys from provider requests", async () => {
		const calls = spyFetch(() => jsonResponse({ data: [{ id: "acme-remote-large", context_window: 4096 }] }));
		const response = await handleModelsConfigMetadata(
			metadata({
				providerName: "acme-remote",
				provider: { ...provider, apiKey: "$ACME_REMOTE_KEY" },
				modelId: "acme-remote-large",
			}),
		);
		expect(response.status).toBe(200);
		expect(calls[0]?.headers.has("authorization")).toBe(false);
	});

	it("returns the upstream 404 shape when no limits are found", async () => {
		spyFetch(() => jsonResponse({ data: [{ id: "unrelated" }] }));
		const response = await handleModelsConfigMetadata(
			metadata({ providerName: "acme-remote", provider, modelId: "acme-remote-large" }),
		);
		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({
			ok: false,
			error: "No context or output limits found for acme-remote/acme-remote-large",
		});
	});
});
