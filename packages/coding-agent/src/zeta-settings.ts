/**
 * Settings owned by the Zeta distribution.
 *
 * Keeping the Zeta-specific keys in a registry domain prevents upstream merges
 * from dropping them while preserving the legacy defaults and settings-panel
 * metadata.
 */
import { register } from "./config/registry";
import type { ZetaLanguage } from "./i18n";

const LANGUAGE_VALUES = ["en", "zh"] as const satisfies readonly ZetaLanguage[];

/** CLI display language; system prompts remain English. */
export const cfgLanguage = register({
	id: "language",
	type: "enum",
	values: LANGUAGE_VALUES,
	default: "en",
	ui: {
		tab: "appearance",
		group: "General",
		label: "Language",
		description: "CLI language for user-facing text (system prompts stay English)",
		options: [
			{ value: "en", label: "English", description: "English UI text (default)" },
			{ value: "zh", label: "中文", description: "简体中文界面" },
		],
	},
});
