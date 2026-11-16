import type { Settings } from "../../../config/settings";
import "../../../config/all-settings";
import { cfgModelRoles } from "../../../config/model-settings";
import { lookup } from "../../../config/registry";
import { cfgHindsightApiToken, cfgHindsightApiUrl } from "../../../hindsight/settings";
import { privateMemoryCredential } from "../../../hindsight/private-credentials";
import { invalid } from "../errors";
import {
	STUDIO_RUNTIME_SETTING_KEYS,
	type StudioRuntimeSettingsGetResult,
	type StudioRuntimeSettingsSnapshot,
	type StudioRuntimeSettingKey,
} from "../protocol/contracts/runtime-settings";

/** Public configuration metadata only; supplementary credentials never enter Settings. */
export function runtimeSettingsFor(
	settings: Settings,
): StudioRuntimeSettingsGetResult & { values: StudioRuntimeSettingsSnapshot };
export function runtimeSettingsFor(
	settings: Settings,
	keys: readonly string[] | undefined,
): StudioRuntimeSettingsGetResult;
export function runtimeSettingsFor(
	settings: Settings,
	keys: readonly string[] = STUDIO_RUNTIME_SETTING_KEYS,
): StudioRuntimeSettingsGetResult {
	const values: Record<string, unknown> = {};
	const configured: Record<string, unknown> = {};
	const sources: Partial<
		Record<StudioRuntimeSettingKey, "env" | "runtime" | "overlay" | "project" | "global" | "default">
	> = {};
	for (const key of keys) {
		if (!(STUDIO_RUNTIME_SETTING_KEYS as readonly string[]).includes(key))
			throw invalid("Unsupported Runtime setting key");
		// Upstream removed Codex Code Mode; retain the read contract and block writes.
		if (key === "providers.openai-codex.codeMode") {
			values[key] = "off";
			sources[key] = "default";
			continue;
		}
		if (key === "modelRoles.judge") {
			values[key] = settings.getModelRoles().judge ?? "";
			sources[key] = cfgModelRoles.provenance(settings);
			continue;
		}
		const setting = lookup(key);
		if (!setting || setting.isCredential) continue;
		const value = setting.get(settings),
			layered = setting.layered(settings);
		if (value !== undefined) values[key] = value;
		if (layered !== undefined) configured[key] = layered;
		sources[key as StudioRuntimeSettingKey] = setting.provenance(settings);
	}
	const token = cfgHindsightApiToken.get(settings);
	const supplemental = !token && !!privateMemoryCredential(cfgHindsightApiUrl.get(settings));
	return {
		values: values as StudioRuntimeSettingsGetResult["values"],
		activation: {
			configured: configured as StudioRuntimeSettingsGetResult["values"],
			restartRequired: [],
			sources,
			hindsightCredential: {
				configured: !!token || supplemental,
				source: supplemental ? "runtime" : cfgHindsightApiToken.provenance(settings),
			},
		},
	};
}
