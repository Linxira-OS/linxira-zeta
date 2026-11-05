/**
 * Studio i18n surface for ported renderer code.
 *
 * Import shape mirrors the upstream module (`export * from "./types"`,
 * `useI18n`, `t`) so ported components keep their call sites unchanged. The
 * provider itself is Zeta-backed — see `I18nContext.tsx`.
 */
export * from "./types";
export { StudioI18nProvider, useI18n, setStudioTranslator, t, dictionaries } from "./I18nContext";
