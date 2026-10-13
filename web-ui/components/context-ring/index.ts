/**
 * Context-statistics panel (right-dock "context").
 *
 * The panel replaces the right column's default "statistics" slot with a
 * Reasonix-style context ring plus category detail, backed by the session's own
 * accounting through `GET /api/agent/<id>/context`.
 *
 * Import leaves directly in tests: `ContextRingPanel` pulls in
 * `ContextRing.css`, which the node test runner cannot load. `ContextRingView`,
 * `context-ring-model`, `useContextReport` and `panel-entry` are
 * stylesheet-free.
 */
export { ContextRingPanel, type ContextRingPanelProps } from "./ContextRingPanel";
export {
	ContextRingPanelChrome,
	ContextRingReportView,
	type ContextRingPanelChromeProps,
	type ContextRingReportViewProps,
} from "./ContextRingView";
export { ContextRing, type ContextRingProps } from "./ContextRing";
export { useContextReport, type UseContextReportOptions, type UseContextReportResult } from "./useContextReport";
export { ContextRingIcon, contextRingPanelEntry, type ContextRingPanelEntry } from "./panel-entry";
export * from "./context-ring-model";
export * from "./types";
