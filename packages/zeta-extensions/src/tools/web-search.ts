// Web search + fetch tools (no API key needed: DuckDuckGo HTML + r.jina.ai reader)
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

interface SearchResult {
	title: string;
	url: string;
	snippet: string;
}

function htmlDecode(input: string): string {
	return input
		.replaceAll("&amp;", "&")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&quot;", '"')
		.replaceAll("&#39;", "'")
		.replaceAll("&nbsp;", " ");
}

async function duckDuckGoSearch(query: string, maxResults: number): Promise<SearchResult[]> {
	const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
	const response = await fetch(url, {
		headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" },
	});
	if (!response.ok) throw new Error(`DDG request failed: ${response.status}`);
	const html = await response.text();
	const results: SearchResult[] = [];
	const linkRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/g;
	const snippetRe = /<a[^>]+class="result__snippet"[^>]*>(.*?)<\/a>/g;
	const links = [...html.matchAll(linkRe)];
	const snippets = [...html.matchAll(snippetRe)];
	for (let i = 0; i < links.length && results.length < maxResults; i++) {
		const match = links[i]!;
		let href = match[1]!.replace(/^\/\/duckduckgo\.com\/l\/\?uddg=/, "");
		href = htmlDecode(decodeURIComponent(href));
		const title = htmlDecode(match[2]!.replace(/<[^>]+>/g, "").trim());
		const snippet = snippets[i] ? htmlDecode(snippets[i]![1]!.replace(/<[^>]+>/g, "").trim()) : "";
		if (href.startsWith("http")) results.push({ title, url: href, snippet });
	}
	return results;
}

async function jinaRead(url: string): Promise<string> {
	const response = await fetch(`https://r.jina.ai/${url}`, {
		headers: { "User-Agent": "Mozilla/5.0" },
	});
	if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
	const text = await response.text();
	return text.slice(0, 12_000);
}

export function installWebSearchTools(api: ExtensionAPI): void {
	api.registerTool({
		name: "web_search",
		label: "Web Search",
		description: "Search the web (DuckDuckGo, no API key) and return titles, URLs, and snippets. Follow up with web_fetch to read a page.",
		parameters: Type.Object({
			query: Type.String({ description: "Search query" }),
			max_results: Type.Optional(Type.Number({ description: "Max results (default 5, max 10)" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			try {
				const results = await duckDuckGoSearch(params.query, Math.min(params.max_results ?? 5, 10));
				if (results.length === 0) {
					return { content: [{ type: "text", text: "No results." }], details: undefined };
				}
				const lines = results.map(
					(r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet || "(no snippet)"}`,
				);
				return { content: [{ type: "text", text: lines.join("\n\n") }], details: undefined };
			} catch (error) {
				return {
					content: [{ type: "text", text: `Search failed: ${error instanceof Error ? error.message : String(error)}` }],
					details: undefined,
				};
			}
		},
	});

	api.registerTool({
		name: "web_fetch",
		label: "Web Fetch",
		description: "Fetch a web page as readable text (via r.jina.ai reader, no API key). Returns up to 12000 characters.",
		parameters: Type.Object({
			url: Type.String({ description: "Full URL to read" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			try {
				const text = await jinaRead(params.url);
				return { content: [{ type: "text", text: text || "(empty page)" }], details: undefined };
			} catch (error) {
				return {
					content: [{ type: "text", text: `Fetch failed: ${error instanceof Error ? error.message : String(error)}` }],
					details: undefined,
				};
			}
		},
	});
}

export function installWebSearchCommand(api: ExtensionAPI): void {
	api.registerCommand("web-search", {
		description: "Search the web. Usage: /web-search <query>",
		handler: async (args, ctx) => {
			const query = args.trim();
			if (!query) {
				ctx.ui.notify("Usage: /web-search <query>", "warning");
				return;
			}
			try {
				const results = await duckDuckGoSearch(query, 5);
				const lines =
					results.length === 0
						? ["No results."]
						: results.map((r) => `${r.title}\n${r.url}\n${r.snippet || ""}`);
				void api.sendMessage({ customType: "zeta-web-search", content: lines.join("\n\n"), display: true });
			} catch (error) {
				ctx.ui.notify(`Search failed: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		},
	});
}
