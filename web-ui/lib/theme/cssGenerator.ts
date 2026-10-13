import type { Theme } from "./types";
import { ALIAS_PREFIX, STATIC_PREFIX, aliasColorTokens, legacyColorTokens, staticColorTokens } from "./tokens";

const STYLE_ID = "zeta-theme-variables";

/**
 * Publishes the three colour layers for the active theme (see
 * `lib/theme/tokens.ts`): L1 raw palette, L2 semantic aliases, L3 the
 * unprefixed compat bridge. The checked-in fallback sheet
 * (`styles/themes/zeta-static.css`) carries the same three layers for the
 * default light/dark themes so the first frame is complete before this runs.
 */
export class CSSVariableGenerator {
  generate(theme: Theme): string {
    const values: string[] = ["  /* L1 — raw palette */"];
    for (const [name, value] of staticColorTokens(theme)) values.push(`  ${STATIC_PREFIX}${name}: ${value};`);

    values.push("  /* L2 — semantic aliases (the layer feature CSS/TSX may use) */");
    for (const [name, value] of aliasColorTokens(theme)) values.push(`  ${ALIAS_PREFIX}${name}: ${value};`);

    values.push("  /* L3 — compat bridge for unprefixed names (pure redirects) */");
    for (const [name, alias] of legacyColorTokens(theme)) values.push(`  --${name}: var(${ALIAS_PREFIX}${alias});`);

    if (theme.config?.fonts?.display) values.push(`  --font-display: ${theme.config.fonts.display};`);
    if (theme.config?.fonts?.mono) values.push(`  --font-mono: ${theme.config.fonts.mono};`);
    return values.join("\n");
  }

  apply(theme: Theme): void {
    const style = document.getElementById(STYLE_ID) ?? document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `:root {\n${this.generate(theme)}\n}`;
    if (!style.parentElement) document.head.appendChild(style);
    const root = document.documentElement;
    root.dataset.theme = theme.metadata.variant;
    root.dataset.themeId = theme.metadata.id;
    root.classList.toggle("dark", theme.metadata.variant === "dark");
    root.classList.toggle("light", theme.metadata.variant === "light");
    root.classList.toggle("starfield", theme.metadata.id === "zeta-starfield");
    document.getElementById("zeta-theme-bootstrap")?.remove();
  }
}
