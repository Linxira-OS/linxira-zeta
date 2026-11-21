import type { Theme } from "./types";

/**
 * Colour token layers (see `web-ui/AGENTS.md` § "CSS Variables — three colour layers").
 *
 * L1 `--zeta-static-*`  raw palette values. The ONLY place a colour literal may
 *                       live (theme JSON + {@link STATIC_CONSTANTS}). Theme
 *                       derived values are emitted per active theme; the
 *                       checked-in fallback sheet re-declares the whole layer
 *                       for the default light theme in `:root` and for the
 *                       default dark theme in the single `[data-theme="dark"]`
 *                       override table.
 * L2 `--zeta-alias-*`   semantic aliases. Every L1 token gets a same-named
 *                       alias; {@link ALIAS_OVERRIDES} adds the short legacy
 *                       vocabulary (`bg`, `text-dim`, `accent`, …) and
 *                       {@link COMPOSITE_ALIASES} the few derived values.
 *                       Feature CSS/TSX consumes this layer only.
 * L3 bridge             the pre-2026-10-13 unprefixed names (`--bg`, `--accent`,
 *                       `--chart-1`, …) stay defined as `var(--zeta-alias-…)`.
 *                       They are pure redirects: one value source, no removal
 *                       deadline, zero breakage for unmigrated components.
 *
 * Typography, spacing, radius, motion and z-index tokens are outside the
 * colour layers and are untouched by this file.
 */

export const STATIC_PREFIX = "--zeta-static-";
export const ALIAS_PREFIX = "--zeta-alias-";

/** L1 entries that are not theme-derived: shared raw constants. */
export const STATIC_CONSTANTS: ReadonlyArray<readonly [string, string]> = [
  // Elevation primitives: shadows/rims are expressed as
  // `color-mix(in srgb, var(--zeta-static-neutral-…) n%, transparent)`, so the
  // pure endpoints are the only literals the elevation sheets need.
  ["neutral-0", "#ffffff"],
  ["neutral-1000", "#000000"],
  // Soft-shadow tint: a slate-black used for the low-alpha composer/popover
  // shadows. Kept as its own raw value (rather than folded into neutral-1000)
  // so the de-literalisation is exactly value-preserving.
  ["shadow-ink", "#0f172a"],
  // Starfield brand palette (NASA-punk preset: one raw value per shade, named
  // after its role in the starfield chrome).
  ["sf-navy", "#1b365d"],
  ["sf-navy-mid", "#0f1e38"],
  ["sf-navy-dark", "#0c1a2e"],
  ["sf-navy-deep", "#0d1a33"],
  ["sf-deep", "#0a1020"],
  ["sf-void", "#0b0f18"],
  ["sf-abyss", "#06080f"],
  ["sf-slate", "#1e2d45"],
  ["sf-steel", "#3d5070"],
  ["sf-mist", "#4b5a72"],
  ["sf-gold", "#d99b26"],
  ["sf-gold-dim", "#a07018"],
  ["sf-amber", "#f0b840"],
  ["sf-orange", "#e05a2b"],
  ["sf-red", "#c81d25"],
  ["sf-green", "#22c55e"],
  ["sf-cyan", "#38bdf8"],
  ["sf-ice", "#f0f4ff"],
  ["sf-frost", "#e8eeff"],
];

/**
 * L1 — the theme-derived raw palette. Name = the theme JSON leaf path, so a
 * value can always be traced back to its source field.
 */
export function staticColorTokens(theme: Theme): Array<[string, string]> {
  const { colors } = theme;
  const tokens: Array<[string, string]> = [
    ["primary-base", colors.primary.base],
    ["primary-hover", colors.primary.hover],
    ["primary-active", colors.primary.active],
    ["primary-foreground", colors.primary.foreground],
    ["primary-muted", colors.primary.muted],
    ["surface-background", colors.surface.background],
    ["surface-foreground", colors.surface.foreground],
    ["surface-muted", colors.surface.muted],
    ["surface-muted-foreground", colors.surface.mutedForeground],
    ["surface-elevated", colors.surface.elevated],
    ["surface-elevated-foreground", colors.surface.elevatedForeground],
    ["surface-overlay", colors.surface.overlay],
    ["surface-subtle", colors.surface.subtle],
    ["interactive-border", colors.interactive.border],
    ["interactive-border-hover", colors.interactive.borderHover],
    ["interactive-border-focus", colors.interactive.borderFocus],
    ["interactive-selection", colors.interactive.selection],
    ["interactive-selection-foreground", colors.interactive.selectionForeground],
    ["interactive-focus", colors.interactive.focus],
    ["interactive-focus-ring", colors.interactive.focusRing],
    ["interactive-cursor", colors.interactive.cursor],
    ["interactive-hover", colors.interactive.hover],
    ["interactive-active", colors.interactive.active],
    ["status-error", colors.status.error],
    ["status-error-foreground", colors.status.errorForeground],
    ["status-error-background", colors.status.errorBackground],
    ["status-error-border", colors.status.errorBorder],
    ["status-warning", colors.status.warning],
    ["status-warning-foreground", colors.status.warningForeground],
    ["status-warning-background", colors.status.warningBackground],
    ["status-warning-border", colors.status.warningBorder],
    ["status-success", colors.status.success],
    ["status-success-foreground", colors.status.successForeground],
    ["status-success-background", colors.status.successBackground],
    ["status-success-border", colors.status.successBorder],
    ["status-info", colors.status.info],
    ["status-info-foreground", colors.status.infoForeground],
    ["status-info-background", colors.status.infoBackground],
    ["status-info-border", colors.status.infoBorder],
    ["syntax-background", colors.syntax.background],
    ["syntax-foreground", colors.syntax.foreground],
    ["syntax-comment", colors.syntax.comment],
    ["syntax-keyword", colors.syntax.keyword],
    ["syntax-string", colors.syntax.string],
    ["syntax-number", colors.syntax.number],
    ["syntax-function", colors.syntax.function],
    ["syntax-variable", colors.syntax.variable],
    ["syntax-type", colors.syntax.type],
    ["syntax-operator", colors.syntax.operator],
    ["syntax-property", colors.syntax.property],
    ["syntax-header", colors.syntax.header],
    ["syntax-line-number", colors.syntax.lineNumber],
    ["chat-user-background", colors.chat.userBackground],
    ["chat-user-border", colors.chat.userBorder],
    ["chat-assistant-background", colors.chat.assistantBackground],
    ["chat-tool-background", colors.chat.toolBackground],
    ["chat-tool-border", colors.chat.toolBorder],
  ];

  colors.chart.forEach((color, index) => {
    tokens.push([`chart-${index + 1}`, color]);
  });

  return tokens;
}

/**
 * L2 — alias names that are not the same-named static token.
 *
 * `text-dim` used to be bound to `syntax.lineNumber` (the code-gutter grey:
 * `#404040` on mono-dark's `#000000` background, ≈1.5:1) while it is the main
 * secondary-text colour of the UI. It is now bound to the secondary-text role,
 * matching what `lib/theme/bootstrap.ts` already published pre-hydration.
 */
export const ALIAS_OVERRIDES: Readonly<Record<string, string>> = {
  // Short legacy vocabulary → the static token that owns the role.
  bg: "surface-background",
  "bg-panel": "surface-muted",
  "bg-elevated": "surface-elevated",
  "bg-hover": "interactive-hover",
  "bg-selected": "interactive-selection",
  "bg-subtle": "surface-subtle",
  border: "interactive-border",
  text: "surface-foreground",
  "text-muted": "surface-muted-foreground",
  "text-dim": "surface-muted-foreground",
  primary: "primary-base",
  accent: "primary-base",
  "accent-hover": "primary-hover",
  "accent-active": "primary-active",
  "accent-muted": "primary-muted",
  "accent-dim": "primary-muted",
  "accent-foreground": "primary-foreground",
  "user-bg": "chat-user-background",
  "assistant-bg": "chat-assistant-background",
  "tool-bg": "chat-tool-background",
  "surface-shadow": "surface-overlay",
  // Control surfaces (settings primitives, spec D14: "inputs sit on `bg-input`
  // with default/hover/focus border states"). `bg-input` is the same raw
  // surface the rest of the app paints fields on (`bg-panel`, and the
  // ChatInput composer), so declaring it keeps the rendering identical while
  // giving the design vocabulary its own name. `border-strong` must stay a
  // *border* role: the only consumers are `:hover` rules, so it binds to the
  // theme's hover-border step rather than to `surface-muted-foreground` (a
  // foreground colour) that its fallback used to resolve to.
  "bg-input": "surface-muted",
  "border-strong": "interactive-border-hover",
  // shadcn-compatible names the design system publishes.
  card: "surface-elevated",
  "card-foreground": "surface-elevated-foreground",
  popover: "surface-elevated",
  "popover-foreground": "surface-elevated-foreground",
  secondary: "surface-muted",
  "secondary-foreground": "surface-muted-foreground",
  muted: "surface-muted",
  "muted-foreground": "surface-muted-foreground",
  destructive: "status-error",
  "destructive-foreground": "status-error-foreground",
  input: "interactive-border",
  ring: "interactive-focus-ring",
  sidebar: "surface-muted",
  "sidebar-foreground": "surface-muted-foreground",
  "sidebar-primary": "primary-base",
  "sidebar-primary-foreground": "primary-foreground",
  "sidebar-accent": "interactive-hover",
  "sidebar-accent-foreground": "surface-foreground",
  "sidebar-border": "interactive-border",
  "sidebar-ring": "interactive-focus-ring",
  background: "surface-background",
  foreground: "surface-foreground",
  // Markdown syntax mapping.
  "md-syntax-foreground": "syntax-foreground",
  "md-syntax-comment": "syntax-comment",
  "md-syntax-keyword": "syntax-keyword",
  "md-syntax-string": "syntax-string",
  "md-syntax-number": "syntax-number",
  "md-syntax-function": "syntax-function",
  "md-syntax-variable": "syntax-variable",
  "md-syntax-type": "syntax-type",
  "md-syntax-operator": "syntax-operator",
  "md-syntax-property": "syntax-property",
  "md-syntax-inserted": "status-success",
  "md-syntax-deleted": "status-error",
};

/** L2 entries whose value is computed rather than a plain static reference. */
export const COMPOSITE_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ["sf-glow", "color-mix(in srgb, var(--zeta-static-sf-gold) 22%, transparent)"],
  [
    "sf-stripe",
    "linear-gradient(90deg, var(--zeta-static-sf-navy) 0% 25%, var(--zeta-static-sf-gold) 25% 50%, var(--zeta-static-sf-orange) 50% 75%, var(--zeta-static-sf-red) 75% 100%)",
  ],
];

/**
 * L3 — unprefixed names that must keep resolving, mapped to the alias they
 * redirect to. Every alias name is bridged automatically (identity redirect);
 * this table adds the names that do not share an alias name.
 */
export const LEGACY_BRIDGE_OVERRIDES: ReadonlyArray<readonly [string, string]> = [
  ["color-bg", "bg"],
  ["color-bg-panel", "bg-panel"],
  ["color-bg-hover", "bg-hover"],
  ["color-bg-selected", "bg-selected"],
  ["color-bg-subtle", "bg-subtle"],
  ["color-border", "border"],
  ["color-text", "text"],
  ["color-text-muted", "text-muted"],
  ["color-text-dim", "text-dim"],
  ["color-accent", "accent"],
  ["color-accent-hover", "accent-hover"],
  ["color-user-bg", "user-bg"],
  ["color-assistant-bg", "assistant-bg"],
  ["color-tool-bg", "tool-bg"],
];

/** L2 — the semantic alias layer as `[aliasName, valueExpression]`. */
export function aliasColorTokens(theme: Theme): Array<[string, string]> {
  const aliases: Array<[string, string]> = [...staticColorTokens(theme), ...STATIC_CONSTANTS].map(([name]) => [
    name,
    `var(${STATIC_PREFIX}${name})`,
  ]);
  for (const [name, staticName] of Object.entries(ALIAS_OVERRIDES)) {
    aliases.push([name, `var(${STATIC_PREFIX}${staticName})`]);
  }
  for (const [name, value] of COMPOSITE_ALIASES) aliases.push([name, value]);
  return aliases;
}

/** L3 — the unprefixed compat bridge as `[legacyName, aliasName]`. */
export function legacyColorTokens(theme: Theme): Array<[string, string]> {
  const bridge: Array<[string, string]> = aliasColorTokens(theme).map(([name]) => [name, name]);
  for (const [legacy, alias] of LEGACY_BRIDGE_OVERRIDES) {
    if (!bridge.some(([name]) => name === legacy)) bridge.push([legacy, alias]);
  }
  return bridge;
}
