/**
 * Studio chrome — window titlebar, page frame, command palette.
 *
 * The lead mounts these from `StudioShell`; nothing here reads a `StudioClient`
 * and nothing here paints data it does not own. See each module's header for the
 * exact Studio file it came from and what the port changed.
 */

export { StudioTitlebar, type StudioTitlebarProps } from "./StudioTitlebar";
export { TitleMenu, TitleMenuScope } from "./TitleMenu";
export { StudioTitleMenus } from "./StudioTitleMenus";
export { StudioSecondaryPage, type StudioSecondaryPageProps } from "./StudioSecondaryPage";
export { StudioCommandPalette, type StudioCommandPaletteProps } from "./StudioCommandPalette";
export { StudioRuntimeBanner, type StudioRuntimeBannerProps } from "./StudioRuntimeBanner";
export { formatShortcut, isPrimaryModifier, shortcutSearchText, SHORTCUTS, type ShortcutSpec, type ShortcutStyle } from "./shortcuts";
export {
	buildPaletteGroups,
	flattenPaletteItems,
	runPaletteAction,
	type PaletteAction,
	type PaletteCatalogInput,
	type PaletteGroup,
	type PaletteItem,
	type StudioPaletteActions,
} from "./palette-catalog";
export { CHROME_UNMAPPED_OPERATIONS, commands, queries, type UnmappedChromeOperation } from "./client-handlers";
