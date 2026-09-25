/**
 * Provider ordering settings.
 *
 * These three lists are read at startup by the search and image-gen modules to
 * seed their module-level ordering state, and edited from the providers tab.
 * They live here rather than in the old `settings-schema.ts` so they resolve
 * through the v18.3.1 registry like every other setting.
 */
import { register } from "../../config/registry";
import type { SearchProviderId } from "@linxiraos/pi-tui/tools/web-search";
import { SEARCH_PROVIDER_CHOICES } from "./types";

/** Prioritized web_search providers; unlisted ones keep their default order. */
export const cfgProvidersWebSearchOrder = register({
	id: "providers.webSearchOrder",
	type: "array",
	default: [] as SearchProviderId[],
	ui: {
		tab: "providers",
		group: "Services",
		label: "Web Search Provider Order",
		description:
			"Prioritized providers for the web_search tool; unlisted providers retain their default order afterward",
		options: SEARCH_PROVIDER_CHOICES,
		ordered: true,
	},
});

/** Providers web_search must never use, even as a fallback. */
export const cfgProvidersWebSearchExclude = register({
	id: "providers.webSearchExclude",
	type: "array",
	default: [] as SearchProviderId[],
	ui: {
		tab: "providers",
		group: "Services",
		label: "Excluded Web Search Providers",
		description: "Providers that web_search should never use, even as fallbacks",
		options: SEARCH_PROVIDER_CHOICES,
	},
});
