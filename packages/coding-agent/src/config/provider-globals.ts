import type { Settings } from "./settings";
import { setImageProviderOrder } from "../tools/image-gen";
import { type ImageProvider } from "../tools/image-providers";
import { cfgProvidersImageOrder } from "../tools/settings";
import * as webSearch from "../web/search";
import { cfgProvidersWebSearchExclude, cfgProvidersWebSearchOrder } from "../web/search/provider-order-settings";

/**
 * Seed the module-level provider ordering state from settings.
 *
 * Runs at session start and whenever the providers tab writes one of these
 * lists, so the search and image-gen modules read the configured order without
 * having to know the setting ids themselves.
 */
export function applyProviderGlobalsFromSettings(settings: Settings): void {
	const excludedWebSearchProviders = cfgProvidersWebSearchExclude.get(settings);
	if (Array.isArray(excludedWebSearchProviders)) {
		webSearch.setExcludedSearchProviders(excludedWebSearchProviders.filter(webSearch.isSearchProviderId));
	}

	const orderedWebSearchProviders = cfgProvidersWebSearchOrder.get(settings);
	if (Array.isArray(orderedWebSearchProviders)) {
		webSearch.setSearchProviderOrder(orderedWebSearchProviders.filter(webSearch.isSearchProviderId));
	}

	const orderedImageProviders = cfgProvidersImageOrder.get(settings);
	if (Array.isArray(orderedImageProviders)) {
		setImageProviderOrder(orderedImageProviders.filter((entry): entry is ImageProvider => typeof entry === "string"));
	}
}
