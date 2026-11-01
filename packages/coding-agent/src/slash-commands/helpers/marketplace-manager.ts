import { clearPluginRootsAndCaches, resolveOrDefaultProjectRegistryPath } from "../../discovery/helpers";
import {
	getInstalledPluginsRegistryPath,
	getMarketplacesCacheDir,
	getMarketplacesRegistryPath,
	getPluginsCacheDir,
	MarketplaceManager,
} from "../../extensibility/plugins/marketplace";
import type { SlashCommandRuntime } from "../types";

/**
 * Build a `MarketplaceManager` wired up with the active project's registry
 * paths and the shared plugin-root cache invalidator. Reused by both `/plugins`
 * and `/marketplace` handlers so cache invalidation stays consistent.
 *
 * The manager is also where the bundled official plugins get materialized
 * (installed, disabled) — the same one-time, offline pass the CLI runs — so the
 * plugin browser shows the official set on a fresh install.
 */
export async function createMarketplaceManager(runtime: SlashCommandRuntime): Promise<MarketplaceManager> {
	const manager = new MarketplaceManager({
		marketplacesRegistryPath: getMarketplacesRegistryPath(),
		installedRegistryPath: getInstalledPluginsRegistryPath(),
		projectInstalledRegistryPath: await resolveOrDefaultProjectRegistryPath(runtime.cwd),
		marketplacesCacheDir: getMarketplacesCacheDir(),
		pluginsCacheDir: getPluginsCacheDir(),
		clearPluginRootsCache: clearPluginRootsAndCaches,
	});
	try {
		await manager.ensureOfficialPluginsInstalled();
	} catch {
		// A broken seed must not break the plugin browser; the catalog and any
		// existing install still list.
	}
	return manager;
}
