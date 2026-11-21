/**
 * Upstream Studio imports `spansText` from `html-form/model`; the Zeta OMP
 * runtime keeps that parser entry in `html-form/parse`. Re-export the same
 * symbol so the vendored renderer and the TUI share one implementation.
 */
export { spansText } from "./parse";
