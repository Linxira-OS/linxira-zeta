/**
 * Central directive pipeline: executeSearch parses the query once, hands the
 * StructuredQuery to the provider, then lenient-filters the returned sources
 * — enforcing constraints the provider ignored and relaxing (with a note)
 * any dimension that would eliminate every result.
 */
import { afterEach, describe, expect, it, vi } from "bun:test";
import type { AuthStorage } from "@linxiraos/pi-ai";
import { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { resetSettingsForTest, Settings } from "@linxiraos/zeta/config/settings";
import { runSearchQuery } from "@linxiraos/zeta/web/search";
import type { SearchParams } from "@linxiraos/zeta/web/search/provider";
import * as provider from "@linxiraos/zeta/web/search/provider";
import type { SearchProviderId, SearchResponse, SearchSource } from "@linxiraos/zeta/web/search/types";

import { cfgRetryFallbackChains } from "@linxiraos/zeta/session/settings";
import { createInMemoryAuthStorage } from "../../helpers/agent-session-setup";

const SOURCES: SearchSource[] = [
	{ title: "Docs page", url: "https://docs.example.com/guide" },
	{ title: "Blog post", url: "https://blog.other.com/post" },
];

const openAuthStorages: AuthStorage[] = [];

async function stubProvider(id: SearchProviderId, behaviour: (params: SearchParams) => Promise<SearchResponse>) {
	const settings = await Settings.init({ inMemory: true });
	settings.setModelRole("web", `web/${id}`);
	cfgRetryFallbackChains.set(settings, { web: [] });
	const authStorage = createInMemoryAuthStorage();
	openAuthStorages.push(authStorage);
	const modelRegistry = new ModelRegistry(authStorage, undefined, { settings });
	const stub: provider.SearchProvider = {
		id,
		label: id,
		isAvailable: () => true,
		isExplicitlyAvailable: () => true,
		search: behaviour,
	};
	vi.spyOn(provider, "getSearchProvider").mockImplementation(async requested => {
		if (requested !== id) throw new Error(`Unexpected provider: ${requested}`);
		return stub;
	});
	return { authStorage, modelRegistry };
}

describe("web search directive pipeline", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		resetSettingsForTest();
		for (const authStorage of openAuthStorages.splice(0)) authStorage.close();
	});

	it("passes the parsed query to the provider and post-filters sources it did not constrain", async () => {
		let seen: SearchParams | undefined;
		const context = await stubProvider("brave", async params => {
			seen = params;
			return { provider: "brave", sources: SOURCES };
		});

		const result = await runSearchQuery({ query: "guide site:docs.example.com", provider: "brave" }, context);

		expect(seen?.parsedQuery?.sites).toEqual(["docs.example.com"]);
		expect(seen?.parsedQuery?.text).toBe("guide");
		expect(result.details.response.sources.map(s => s.url)).toEqual(["https://docs.example.com/guide"]);
		expect(result.content[0]?.text).not.toContain("Note:");
	});

	it("relaxes a constraint that matches nothing and leads the LLM text with a note", async () => {
		const context = await stubProvider("brave", async () => ({ provider: "brave", sources: SOURCES }));

		const result = await runSearchQuery({ query: "guide site:nowhere.example", provider: "brave" }, context);

		// Leniency: nothing matched site:nowhere.example, so all sources survive
		// and the model is told the constraint was relaxed.
		expect(result.details.response.sources).toHaveLength(SOURCES.length);
		expect(result.content[0]?.text).toStartWith(
			"Note: no results matched `site:nowhere.example`; the constraint was relaxed",
		);
	});
});
