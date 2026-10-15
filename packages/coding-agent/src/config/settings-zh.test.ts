/**
 * Parity guard: every user-visible English label/description in the settings
 * schema must have a non-empty Simplified Chinese counterpart in
 * `settings-zh.ts`.
 *
 * Scan approach (auditable):
 *
 * 1. English inventory. The settings UI is fed by TWO English sources, and the
 *    web panel and the TUI disagree about which one enumerates rows:
 *      - the static `SETTINGS_SCHEMA` object in `settings-schema.ts` (the
 *        Zeta-owned remainder; `getPathsForTab` enumerates exactly these keys),
 *      - the runtime registry built by the per-domain `settings.ts` modules
 *        (re-exported through `all-settings`, which the TUI's
 *        `createSettingsHost` enumerates).
 *    `getUi(path)` prefers the registry and falls back to the schema, so we
 *    walk the UNION of `Object.keys(SETTINGS_SCHEMA)` and every registered id
 *    and take `getUi(path)` for each. One row per path.
 *
 * 2. Normalization (value-vs-label): the zh overlay is keyed by machine
 *    identifiers, never by the English display text:
 *      - tabs    -> `ZH_TAB_LABELS[ui.tab]`             (SettingTab id)
 *      - groups  -> `ZH_GROUP_LABELS[ui.group]`         (raw English group id)
 *      - settings-> `ZH_SETTING_TEXTS[path]`            (SettingPath)
 *      - options -> `ZH_OPTION_TEXTS[`${path}::${option.value}`]
 *    An option's English display text lives in `option.label`, but the zh key
 *    uses `option.value` — so option keys are built from `value`, never from
 *    `label`. `ui.options === "runtime"` is a sentinel (values are computed at
 *    read time by the runtime layer) and carries no static text, so it is
 *    skipped.
 *
 * 3. Emptiness rules match what the panel actually applies:
 *      - `localizeSettingUi`/`createSettingsHost` fall back to English when a
 *        key is missing, so a missing key is a coverage hole, not a crash;
 *      - a zh entry whose `label` is "" renders an empty row title, so blank
 *        counts as missing;
 *      - an English `description` must be matched by a zh `description`;
 *        omitting it is only legal when the English side has no description
 *        (documented on `ZH_SETTING_TEXTS`).
 */
import { describe, expect, it } from "bun:test";
import { orderedSettings } from "@linxiraos/zeta/config/all-settings";
import { getUi, SETTINGS_SCHEMA } from "@linxiraos/zeta/config/settings-schema";
import { ZH_GROUP_LABELS, ZH_OPTION_TEXTS, ZH_SETTING_TEXTS } from "@linxiraos/zeta/config/settings-zh";

/**
 * Fields with no Chinese counterpart on purpose. Every entry needs a one-line
 * reason — anything user-visible belongs in `settings-zh.ts` instead.
 *
 * Keys are either a setting path, a `path::option` key, or `group:<raw id>`.
 */
const EXCLUDED: Record<string, string> = {};

interface Missing {
	key: string;
	english: string;
}

/** Key of a tab/group row. */
const groupKey = (group: string) => `group:${group}`;

function collect(): { missing: Missing[]; checked: number } {
	const seen = new Set<string>();
	const paths: string[] = [];
	for (const path of Object.keys(SETTINGS_SCHEMA)) {
		if (seen.has(path)) continue;
		seen.add(path);
		paths.push(path);
	}
	for (const setting of orderedSettings()) {
		if (seen.has(setting.id)) continue;
		seen.add(setting.id);
		paths.push(setting.id);
	}

	const missing: Missing[] = [];
	const groups = new Map<string, string>();
	let checked = 0;

	/** Records `key` as missing when the zh text is absent or blank. */
	const require = (key: string, zh: string | undefined, english: string): void => {
		checked++;
		if (key in EXCLUDED) return;
		if (typeof zh === "string" && zh.trim() !== "") return;
		missing.push({ key, english });
	};

	for (const path of paths) {
		const ui = getUi(path);
		if (!ui) continue;
		if (ui.group) groups.set(ui.group, path);

		const texts = ZH_SETTING_TEXTS[path as keyof typeof ZH_SETTING_TEXTS];
		require(path, texts?.label, `${path} = "${ui.label}"`);
		if (ui.description) require(`${path} (description)`, texts?.description, `${path} = "${ui.description}"`);

		const options = ui.options;
		if (options === undefined || options === "runtime") continue;
		for (const option of options) {
			const optionKey = `${path}::${option.value}`;
			const optionTexts = ZH_OPTION_TEXTS[optionKey];
			require(optionKey, optionTexts?.label, `${optionKey} = "${option.label}"`);
			if (option.description) {
				require(`${optionKey} (description)`, optionTexts?.description, `${optionKey} = "${option.description}"`);
			}
		}
	}

	// Section headings: the group ids the schema drops into `ui.group`; every
	// such id renders as a titled section, so each needs a zh heading.
	for (const group of [...groups.keys()].sort()) {
		require(groupKey(group), ZH_GROUP_LABELS[group], group);
	}

	return { missing, checked };
}

describe("settings zh parity", () => {
	it("covers every user-visible English label and description", () => {
		const { missing, checked } = collect();
		const lines = missing.map(entry => `  ${entry.key}\n      en: ${entry.english}`);
		expect(
			missing.length === 0
				? ""
				: `${missing.length}/${checked} user-visible strings lack a zh counterpart:\n${lines.join("\n")}`,
		).toBe("");
	});
});
