import { describe, expect, it } from "bun:test";
import type { AuthStorage, FetchImpl } from "@linxiraos/pi-ai";
import type { SearchParams } from "@linxiraos/zeta/web/search/providers/base";
import { searchBing } from "@linxiraos/zeta/web/search/providers/bing";
import { SearchProviderError } from "@linxiraos/zeta/web/search/types";

const fakeAuthStorage = {
	async getApiKey() {
		throw new Error("Bing search must not request API keys");
	},
	resolver() {
		throw new Error("Bing search must not request credential resolvers");
	},
	hasAuth() {
		throw new Error("Bing search must not check auth");
	},
} as unknown as AuthStorage;

function makeParams(query: string, fetch: FetchImpl): SearchParams {
	return {
		query,
		authStorage: fakeAuthStorage,
		systemPrompt: "Bing search test prompt",
		fetch,
	};
}

function resultItem(href: string, title: string, snippet?: string): string {
	return `<li class="b_algo"><h2><a href="${href}">${title}</a></h2>${
		snippet ? `<div class="b_caption"><p class="b_lineclamp2">${snippet}</p></div>` : ""
	}</li>`;
}

function resultsPage(items: string): string {
	return `<!DOCTYPE html><html><body><ol id="b_results">${items}</ol></body></html>`;
}

describe("Bing web search provider", () => {
	it("requests cn.bing.com with scraper query parameters and parses deduplicated organic results", async () => {
		let capturedUrl = "";
		let capturedInit: RequestInit | undefined;
		const html = resultsPage(
			[
				resultItem("https://example.com/one", "First &amp; useful result", "A <strong>useful</strong> snippet."),
				resultItem("https://example.com/one", "Duplicate result", "Duplicate snippet."),
				resultItem("/search?q=next", "Bing navigation"),
				resultItem("https://example.org/two", "Second result"),
			].join(""),
		);
		const fetchMock: FetchImpl = (input, init) => {
			capturedUrl = typeof input === "string" ? input : input.toString();
			capturedInit = init;
			return Promise.resolve(new Response(html, { status: 200 }));
		};

		const response = await searchBing({
			...makeParams("web search site:example.com", fetchMock),
			numSearchResults: 99,
			recency: "week",
		});

		const url = new URL(capturedUrl);
		expect(url.origin + url.pathname).toBe("https://cn.bing.com/search");
		expect(url.searchParams.get("q")).toBe("web search site:example.com");
		expect(url.searchParams.get("count")).toBe("20");
		expect(url.searchParams.get("setlang")).toBe("zh-Hans");
		expect(url.searchParams.get("ensearch")).toBe("1");
		expect(url.searchParams.get("filters")).toBe('ex1:"ez2"');
		expect(capturedInit?.method).toBeUndefined();
		const headers = new Headers(capturedInit?.headers);
		expect(headers.get("accept")).toContain("text/html");
		// The navigation fingerprint randomizes across coherent Chrome, Firefox,
		// and Safari profiles; asserting one family would flake ~2/3 of runs.
		expect(headers.get("user-agent")).toMatch(/(Chrome\/\d+\.0\.0\.0|Firefox\/\d+\.0|Safari\/605)/);
		expect(headers.get("referer")).toBe("https://cn.bing.com/");

		expect(response).toEqual({
			provider: "bing",
			sources: [
				{
					title: "First & useful result",
					url: "https://example.com/one",
					snippet: "A useful snippet.",
				},
				{ title: "Second result", url: "https://example.org/two", snippet: undefined },
			],
		});
	});

	it("maps Bing bot challenges to the shared provider 429 contract", async () => {
		const fetchMock: FetchImpl = () =>
			Promise.resolve(
				new Response("<html><body><h1>Verify you are human</h1><p>captcha challenge</p></body></html>", {
					status: 403,
				}),
			);

		try {
			await searchBing(makeParams("blocked", fetchMock));
			expect.unreachable("Bing bot challenge should reject");
		} catch (error) {
			expect(error).toBeInstanceOf(SearchProviderError);
			expect(error).toMatchObject({ provider: "bing", status: 429 });
		}
	});

	it("maps transport failures to a provider-tagged 503", async () => {
		const fetchMock: FetchImpl = () => Promise.reject(new Error("network unavailable"));

		try {
			await searchBing(makeParams("unavailable", fetchMock));
			expect.unreachable("Bing transport failure should reject");
		} catch (error) {
			expect(error).toBeInstanceOf(SearchProviderError);
			expect(error).toMatchObject({ provider: "bing", status: 503 });
			expect((error as SearchProviderError).message).toContain("network unavailable");
		}
	});
});
