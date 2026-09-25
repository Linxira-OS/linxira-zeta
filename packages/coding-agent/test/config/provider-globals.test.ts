import { afterEach, describe, expect, it, vi } from "bun:test";
import { applyProviderGlobalsFromSettings } from "@linxiraos/zeta/config/provider-globals";
import { Settings } from "@linxiraos/zeta/config/settings";
import { cfgProvidersImageOrder } from "@linxiraos/zeta/tools/settings";
import type { ImageProvider } from "@linxiraos/zeta/tools/image-providers";
import {
	cfgProvidersWebSearchExclude,
	cfgProvidersWebSearchOrder,
} from "@linxiraos/zeta/web/search/provider-order-settings";
import type { SearchProviderId } from "@linxiraos/zeta/web/search/types";
import * as imageGen from "@linxiraos/zeta/tools/image-gen";
import * as webSearch from "@linxiraos/zeta/web/search";

describe("applyProviderGlobalsFromSettings", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("reapplies valid web and image provider globals from cwd-scoped settings", () => {
		const excludeSpy = vi.spyOn(webSearch, "setExcludedSearchProviders").mockImplementation(() => {});
		const orderSpy = vi.spyOn(webSearch, "setSearchProviderOrder").mockImplementation(() => {});
		const imageOrderSpy = vi.spyOn(imageGen, "setImageProviderOrder").mockImplementation(() => {});

		const settings = Settings.isolated();
		cfgProvidersWebSearchOrder.set(settings, [
			"perplexity",
			"not-a-provider",
			"exa",
		] as unknown as SearchProviderId[]);
		cfgProvidersWebSearchExclude.set(settings, ["exa", "not-a-provider", "gemini"] as unknown as SearchProviderId[]);
		cfgProvidersImageOrder.set(settings, ["xai", 42, "gemini"] as unknown as ImageProvider[]);

		applyProviderGlobalsFromSettings(settings);

		expect(orderSpy).toHaveBeenCalledWith(["perplexity", "exa"]);
		expect(excludeSpy).toHaveBeenCalledWith(["exa", "gemini"]);
		expect(imageOrderSpy).toHaveBeenCalledWith(["xai", "gemini"]);
	});
});
