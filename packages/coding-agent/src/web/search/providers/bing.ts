import type { AuthStorage } from "@linxiraos/pi-ai";
import { parseHTML } from "@linxiraos/pi-utils/dom";
import type { SearchResponse, SearchSource } from "../../../web/search/types";
import { SearchProviderError } from "../../../web/search/types";
import { formatScraperQuery } from "../query";
import { clampNumResults } from "../utils";
import type { SearchParams } from "./base";
import { SearchProvider } from "./base";
import type { LoadedHtmlPage } from "./browser-page";
import { browserFetch } from "./browser-page";
import { classifyProviderHttpError, withHardTimeout } from "./utils";

const BING_HOME_URL = "https://cn.bing.com/";
const BING_SEARCH_URL = "https://cn.bing.com/search";
const DEFAULT_NUM_RESULTS = 10;
const MAX_NUM_RESULTS = 20;
const RESULT_RENDER_TIMEOUT_MS = 10_000;

interface ParsedResult {
	title: string;
	url: string;
	snippet?: string;
}

function normalizeText(value: string | null | undefined): string {
	return (value ?? "").replace(/\s+/g, " ").trim();
}

/** Accept only external HTTP(S) result targets, excluding Bing navigation links. */
function normalizeResultUrl(href: string | null | undefined): string | undefined {
	if (!href) return undefined;
	let url: URL;
	try {
		url = new URL(href, BING_HOME_URL);
	} catch {
		return undefined;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
	if (url.hostname === "bing.com" || url.hostname.endsWith(".bing.com")) return undefined;
	return url.href;
}

/** Parse organic `li.b_algo` rows from Bing's server-rendered search page. */
function parseHtmlResults(html: string): ParsedResult[] {
	const { document } = parseHTML(html);
	const results: ParsedResult[] = [];
	for (const item of document.querySelectorAll("li.b_algo")) {
		const heading = item.querySelector("h2");
		const anchor = heading?.querySelector("a") ?? item.querySelector("a");
		const url = normalizeResultUrl(anchor?.getAttribute("href"));
		if (!url) continue;
		const title = normalizeText(heading?.textContent ?? anchor?.textContent);
		if (!title) continue;
		const snippet = normalizeText(item.querySelector(".b_caption p, .b_caption")?.textContent);
		results.push({ title, url, snippet: snippet || undefined });
	}
	return results;
}

function isBlockedPage(page: LoadedHtmlPage): boolean {
	return (
		page.status === 403 ||
		page.status === 429 ||
		page.url.includes("/challenge") ||
		/verify you are human|unusual traffic|robot check|captcha challenge|enter the characters/i.test(page.html)
	);
}

function buildSearchUrl(params: SearchParams, numResults: number): string {
	const url = new URL(BING_SEARCH_URL);
	url.searchParams.set("q", formatScraperQuery(params.query, params.parsedQuery));
	url.searchParams.set("count", String(numResults));
	url.searchParams.set("setlang", "zh-Hans");
	url.searchParams.set("ensearch", "1");
	if (params.recency) {
		const freshness = { day: "ez1", week: "ez2", month: "ez3", year: "ez4" }[params.recency];
		url.searchParams.set("filters", `ex1:"${freshness}"`);
	}
	return url.href;
}

async function callBingHtml(params: SearchParams, numResults: number): Promise<string> {
	const signal = withHardTimeout(params.signal, params.timeoutMs);
	const url = buildSearchUrl(params, numResults);
	let page: LoadedHtmlPage;
	try {
		page = await browserFetch(url, {
			fetch: params.fetch,
			signal,
			timeoutMs: params.timeoutMs,
			referer: BING_HOME_URL,
			browser: {
				homeUrl: BING_HOME_URL,
				ready: { selector: "li.b_algo h2 a", timeoutMs: RESULT_RENDER_TIMEOUT_MS },
				shouldFallback: isBlockedPage,
			},
		});
	} catch (error) {
		if (error instanceof SearchProviderError || params.signal?.aborted) throw error;
		if (signal.aborted) throw new SearchProviderError("bing", "Bing search timed out.", 504);
		const message = error instanceof Error ? error.message : String(error);
		throw new SearchProviderError("bing", `Bing search failed: ${message}`, 503);
	}

	if (isBlockedPage(page)) {
		throw new SearchProviderError(
			"bing",
			"Bing blocked the request with an automated-traffic challenge. Try another web search provider or retry later.",
			429,
		);
	}
	if (page.status < 200 || page.status >= 300) {
		const classified = classifyProviderHttpError("bing", page.status, page.html);
		if (classified) throw classified;
		throw new SearchProviderError("bing", `Bing HTML error (${page.status})`, page.status);
	}
	return page.html;
}

/** Execute a credential-free Bing web search against its server-rendered results page. */
export async function searchBing(params: SearchParams): Promise<SearchResponse> {
	const numResults = clampNumResults(params.numSearchResults ?? params.limit, DEFAULT_NUM_RESULTS, MAX_NUM_RESULTS);
	const html = await callBingHtml(params, numResults);
	const sources: SearchSource[] = [];
	const seen = new Set<string>();
	for (const result of parseHtmlResults(html)) {
		if (seen.has(result.url)) continue;
		seen.add(result.url);
		sources.push({ title: result.title, url: result.url, snippet: result.snippet });
		if (sources.length >= numResults) break;
	}
	return { provider: "bing", sources };
}

/** Search provider for Bing (no API key required). */
export class BingProvider extends SearchProvider {
	readonly id = "bing";
	readonly label = "Bing";

	isAvailable(_authStorage: AuthStorage): boolean {
		return true;
	}

	override isExplicitlyAvailable(_authStorage: AuthStorage): boolean {
		return true;
	}

	search(params: SearchParams): Promise<SearchResponse> {
		return searchBing(params);
	}
}
