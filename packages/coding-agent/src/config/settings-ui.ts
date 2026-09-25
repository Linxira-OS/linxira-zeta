import { currentLanguage } from "../i18n";
import { ZH_GROUP_LABELS, ZH_OPTION_TEXTS, ZH_SETTING_TEXTS, ZH_TAB_LABELS } from "./settings-zh";
import { TERMINAL } from "@linxiraos/pi-tui";
import { SETTING_TABS, type SettingsDisplayEntry, type SettingsHost } from "@linxiraos/pi-tui/overlays/settings-defs";
import { isSettingsInitialized, Settings, settings } from "./settings";
import { orderedSettings } from "./all-settings";
import { type AnySetting, lookup } from "./registry";

import { cfgPlanAutosave, cfgPlanEnabled } from "../plan-mode/settings";
import {
	cfgRetryUsageAwareFallback,
	cfgDefaultThinkingLevel,
	normalizeProviderMaxInFlightRequests,
	validateProviderMaxInFlightRequests,
} from "../session/settings";
import { cfgAutolearnEnabled } from "../autolearn/settings";
import { cfgMemoryBackend } from "../memory-backend/settings";
import { cfgTuiVimMode } from "../modes/settings";
import { cfgAdvisorEnabled } from "../advisor/settings";

/** Condition over the global settings; hidden (false) until they are initialized. */
function whenSettings(test: (settings: Settings) => boolean): () => boolean {
	return () => isSettingsInitialized() && test(Settings.instance);
}

const CONDITIONS: Record<string, () => boolean> = {
	macOS: () => process.platform === "darwin",
	hasImageProtocol: () => !!TERMINAL.imageProtocol,
	advisorEnabled: whenSettings(s => cfgAdvisorEnabled.get(s) === true),
	vimModeEnabled: whenSettings(s => cfgTuiVimMode.get(s) === true),
	hindsightActive: whenSettings(s => cfgMemoryBackend.get(s) === "hindsight"),
	mnemopiActive: whenSettings(s => cfgMemoryBackend.get(s) === "mnemopi"),
	autolearnActive: whenSettings(s => cfgAutolearnEnabled.get(s) === true),
	autoThinkingActive: whenSettings(s => cfgDefaultThinkingLevel.get(s) === "auto"),
	usageAwareFallbackEnabled: whenSettings(s => cfgRetryUsageAwareFallback.get(s) === true),
	planModeEnabled: whenSettings(s => cfgPlanEnabled.get(s)),
	planAutosaveEnabled: whenSettings(s => cfgPlanEnabled.get(s) && cfgPlanAutosave.get(s)),
};

/** Description suffix telling the panel user that an environment variable is in play. */
function envNote(setting: AnySetting): string {
	if (!setting.envName || setting.envValue() === undefined) return "";
	return setting.envFallback
		? ` Unset, it falls back to $${setting.envName}.`
		: ` $${setting.envName} overrides this setting while it is set.`;
}

/**
 * Adapt the application schema and settings store to the terminal overlay. The panel shows and
 * edits the value of the settings layers, never an environment-supplied one (so an env credential
 * is never pre-filled or written to config); descriptions note an active environment variable.
 */
export function createSettingsHost(): SettingsHost {
	const zh = currentLanguage() === "zh";
	const entries: SettingsDisplayEntry[] = [];
	for (const tab of SETTING_TABS) {
		for (const setting of orderedSettings()) {
			const ui = setting.ui;
			if (ui?.tab !== tab) continue;
			const note = envNote(setting);
			// The registry carries the English copy; the zh overlay is applied here so
			// both the TUI selector and the web panel read the same localized text.
			const text = zh ? ZH_SETTING_TEXTS[setting.id] : undefined;
			const localizedUi = text
				? {
						...ui,
						label: text.label ?? ui.label,
						description: text.description ?? ui.description,
						group: ZH_GROUP_LABELS[ui.group ?? ""] ?? ui.group,
						// `options` is either a concrete list or the "runtime" sentinel
						// (values computed at read time), which has nothing to translate.
						options: Array.isArray(ui.options)
							? ui.options.map(option => {
									const optionText = zh ? ZH_OPTION_TEXTS[option.value] : undefined;
									return optionText
										? {
												...option,
												label: optionText.label,
												description: optionText.description ?? option.description,
											}
										: option;
								})
							: ui.options,
					}
				: ui;
			entries.push({
				path: setting.id,
				type: setting.type,
				defaultValue: setting.default,
				ui: note ? { ...localizedUi, description: `${localizedUi.description ?? ""}${note}` } : localizedUi,
				enumValues: setting.enumValues,
				credential: setting.isCredential,
				condition: ui.condition ? CONDITIONS[ui.condition] : undefined,
			});
		}
	}
	const resolve = (path: string): AnySetting => {
		const setting = lookup(path);
		if (!setting) throw new Error(`Unknown setting: ${path}`);
		return setting;
	};
	return {
		entries,
		get: path => lookup(path)?.layered(settings),
		set: (path, value) => resolve(path).set(settings, value),
		unset: path => resolve(path).unset(settings),
		normalizeProviderLimits: normalizeProviderMaxInFlightRequests,
		validateProviderLimits: validateProviderMaxInFlightRequests,
	};
}
