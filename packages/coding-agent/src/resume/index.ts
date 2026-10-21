/**
 * Resume picker data layer (local-first).
 *
 * Entry points for renderers:
 * - {@link loadResumeDirectory} / {@link buildResumeDirectory}: projects,
 *   workspaces and conversations from session files + the on-disk registry.
 * - {@link buildResumeView}: pure ordered rows for a scope + query.
 * - Preference helpers in `preferences.ts` are shared by the terminal picker
 *   and the serve/GUI side.
 */

export * from "./types";
export * from "./paths";
export * from "./preferences";
export * from "./directory";
export * from "./view-model";
export * from "./adapter";
