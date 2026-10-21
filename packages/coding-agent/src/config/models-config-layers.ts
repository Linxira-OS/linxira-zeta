/**
 * Two-layer model configuration.
 *
 * The hand-written layer (`~/.zeta/agent/models.yml`, or legacy `models.yaml`)
 * belongs to the user and is never written by Zeta's web panel. The panel owns
 * a sibling layer (`models.web.yml`) next to it, written only by the gateway.
 *
 * Effective config = the user layer, then the panel layer for providers the
 * user layer does not define: **the user layer always wins for a provider it
 * defines**. Both layers use the same YAML schema; an invalid panel layer is
 * logged and ignored rather than failing startup or hiding the user layer.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { logger, stringifyYamlConfig } from "@linxiraos/pi-utils";
import { type ConfigError, ConfigFile } from "./config-file";
import { ModelsConfigFile } from "./models-config";
import type { ModelsConfig } from "./models-config-schema";
import { getModelsConfigSchema } from "./models-config-schema-bundle";

/** Canonical file name of the panel-owned layer, next to the user's `models.yml`. */
export const MODELS_WEB_FILENAME = "models.web.yml";

/** Which layer a provider definition comes from. */
export type ModelsConfigOrigin = "user" | "web";

/** The panel layer beside a user models path (never the user's own file). */
export function modelsWebConfigPath(modelsPath: string): string {
	return path.join(path.dirname(modelsPath), MODELS_WEB_FILENAME);
}

const modelsWebConfigFile = new ConfigFile<ModelsConfig>("models.web", {
	kind: "deferred",
	resolve: getModelsConfigSchema,
});

export interface LoadedModelsLayers {
	/** Path the user layer was read from (canonical, or its `.yaml` fallback). */
	userPath: string;
	/** Panel-layer path; `null` when the user path is not a YAML file. */
	webPath: string | null;
	user: ModelsConfig | undefined;
	web: ModelsConfig | undefined;
	userError: ConfigError | undefined;
	/** Set when the panel layer exists but is invalid; the layer is ignored. */
	webError: ConfigError | undefined;
}

/** Read both layers for `modelsPath`. Never throws; reports per-layer errors. */
export function loadModelsLayers(modelsPath: string): LoadedModelsLayers {
	const userResult = ModelsConfigFile.relocate(modelsPath).tryLoad();
	const layers: LoadedModelsLayers = {
		userPath: modelsPath,
		webPath: null,
		user: userResult.status === "ok" ? userResult.value : undefined,
		web: undefined,
		userError: userResult.status === "error" ? userResult.error : undefined,
		webError: undefined,
	};
	if (!modelsPath.endsWith(".yml") && !modelsPath.endsWith(".yaml")) return layers;

	const webPath = modelsWebConfigPath(modelsPath);
	layers.webPath = webPath;
	const webResult = modelsWebConfigFile.relocate(webPath).tryLoad();
	if (webResult.status === "error") {
		layers.webError = webResult.error;
		logger.warn("Ignoring invalid models web layer", { path: webPath, error: webResult.error });
		return layers;
	}
	layers.web = webResult.value ?? undefined;
	return layers;
}

/** Merge the user layer over the panel layer; the user wins per provider. */
export function mergeModelsConfigs(
	user: ModelsConfig | undefined,
	web: ModelsConfig | undefined,
): ModelsConfig | undefined {
	if (!user && !web) return undefined;
	const providers = { ...(web?.providers ?? {}), ...(user?.providers ?? {}) };
	return { ...web, ...user, providers };
}

/** Origin of every provider in the merged config, keyed by provider name. */
export function modelsConfigOrigins(
	user: ModelsConfig | undefined,
	web: ModelsConfig | undefined,
): Record<string, ModelsConfigOrigin> {
	const origins: Record<string, ModelsConfigOrigin> = {};
	for (const name of Object.keys(web?.providers ?? {})) origins[name] = "web";
	for (const name of Object.keys(user?.providers ?? {})) origins[name] = "user";
	return origins;
}

/** Overwrite the panel layer with `providers` (YAML). The user file is untouched. */
export function writeModelsWebConfig(webPath: string, providers: Record<string, unknown>): void {
	fs.mkdirSync(path.dirname(webPath), { recursive: true });
	fs.writeFileSync(webPath, stringifyYamlConfig({ providers }));
}
