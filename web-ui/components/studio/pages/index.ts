/**
 * Studio pages — the non-workbench surfaces, one per route.
 *
 * Every export is a real surface over the Zeta gateway. A page whose data has
 * no endpoint is absent from this barrel rather than rendered empty; the
 * per-page headers list what was dropped and why.
 *
 * `client-handlers.ts` carries the Studio operation → HTTP mapping these pages
 * (and any ported Studio component) dispatch through.
 */

export { SkillsPage } from "./SkillsPage";
export { ModelsPage } from "./ModelsPage";
export { GitPage } from "./GitPage";
export { UsagePage } from "./UsagePage";
export { HistoryPage } from "./HistoryPage";
export { SettingsPage } from "./SettingsPage";
export { PageFrame, PageBanner, PageEmpty } from "./page-frame";
export { PagesStudioClient, usePagesStudioClient } from "./studio-client";
export {
	commands,
	createCommands,
	createQueries,
	createReceiptStore,
	queries,
	defaultTransport,
	transportFor,
	type PagesTransport,
	type ReceiptStore,
} from "./client-handlers";
