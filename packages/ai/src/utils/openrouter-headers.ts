import packageJson from "../../package.json" with { type: "json" };

export function getOpenRouterHeaders(): Record<string, string> {
	return {
		"User-Agent": `Zeta/${packageJson.version}`,
		"HTTP-Referer": "https://linxira-os.github.io/",
		"X-OpenRouter-Title": "Zeta",
		"X-OpenRouter-Categories": "cli-agent",
		"X-OpenRouter-Cache": "true",
		"X-OpenRouter-Cache-TTL": "3600",
	};
}
