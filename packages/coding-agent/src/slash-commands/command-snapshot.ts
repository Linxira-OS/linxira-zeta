import { currentLanguage, type ZetaLanguage } from "../i18n";

/**
 * Everything that decides which copy a materialized builtin slash-command list
 * carries.
 *
 * Materialization resolves `description: () => M.cmdFoo` thunks into plain
 * strings (see `resolveCommandDescription`), so a list built under one language
 * keeps that language's copy until it is rebuilt. A cache keyed on the symbol
 * preset alone therefore leaves the picker half-translated after `/language`:
 * frozen static descriptions stay in the startup language while render-time
 * thunks (`getAutocompleteDescription`, inline hints) follow the live
 * catalogue. The active language belongs in this key so the rebuild is
 * automatic.
 */
export interface SlashCommandSnapshotKey {
	readonly symbolPreset: string;
	readonly language: ZetaLanguage;
}

export interface SlashCommandSnapshot<T> {
	readonly key: SlashCommandSnapshotKey;
	readonly commands: readonly T[];
}

/** Cache key for the materialized builtin command list at the given symbol preset. */
export function slashCommandSnapshotKey(symbolPreset: string): SlashCommandSnapshotKey {
	return { symbolPreset, language: currentLanguage() };
}

/**
 * Reuse `previous` while its key still matches, otherwise rebuild through
 * `build`. Callers pass `undefined` for `previous` to force a rebuild when
 * session state changed but the key did not (skill/MCP/plugin rediscovery).
 */
export function resolveCommandSnapshot<T>(
	previous: SlashCommandSnapshot<T> | undefined,
	key: SlashCommandSnapshotKey,
	build: () => readonly T[],
): SlashCommandSnapshot<T> {
	if (
		previous !== undefined &&
		previous.key.symbolPreset === key.symbolPreset &&
		previous.key.language === key.language
	) {
		return previous;
	}
	return { key, commands: build() };
}
