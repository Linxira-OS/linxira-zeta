import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { CSSVariableGenerator } = await jiti.import("./cssGenerator.ts");
const { aliasColorTokens, staticColorTokens } = await jiti.import("./tokens.ts");
const { renderStaticThemeSheet } = await jiti.import("./staticSheet.ts");
const {
  DEFAULT_DARK_THEME_ID,
  DEFAULT_LIGHT_THEME_ID,
  getThemeById,
  themes,
  validateThemeRegistry,
} = await jiti.import("./themes.ts");

const darkThemes = themes.filter((theme) => theme.metadata.variant === "dark");
const lightThemes = themes.filter((theme) => theme.metadata.variant === "light");

function paletteSignature(theme) {
  return [
    theme.colors.surface.background,
    theme.colors.surface.muted,
    theme.colors.surface.elevated,
    theme.colors.interactive.border,
    ...theme.colors.chart,
  ].join("|");
}

test("registry exposes stable unique ids with both variants and the starfield preset", () => {
  const ids = themes.map((theme) => theme.metadata.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(lightThemes.length >= 10);
  assert.ok(darkThemes.length >= 10);
  assert.equal(getThemeById(DEFAULT_LIGHT_THEME_ID)?.metadata.variant, "light");
  assert.equal(getThemeById(DEFAULT_DARK_THEME_ID)?.metadata.variant, "dark");
  assert.equal(getThemeById("light")?.metadata.id, DEFAULT_LIGHT_THEME_ID);
  assert.equal(getThemeById("dark")?.metadata.id, DEFAULT_DARK_THEME_ID);
  assert.equal(getThemeById("starfield")?.metadata.id, "zeta-starfield");
});

test("registry validates all checked-in resources and normalizes Vitesse ids", () => {
  assert.equal(themes.length, 43);
  assert.equal(getThemeById("vitesse-light-light")?.metadata.id, "vitesse-light");
  assert.equal(getThemeById("vitesse-dark-dark")?.metadata.id, "vitesse-dark");
  for (const theme of themes) {
    assert.ok(["light", "dark"].includes(theme.metadata.variant));
    assert.equal(theme.colors.chart.length, 8);
    assert.doesNotMatch(JSON.stringify(theme), /undefined|null/);
  }
  assert.throws(() => validateThemeRegistry([themes[0], themes[0]]), /duplicate/);
  assert.throws(() => validateThemeRegistry([{ ...themes[0], colors: { ...themes[0].colors, chart: [] } }]), /8 chart/);
});

test("preset palettes change visible surfaces and chart colors, not only accents", () => {
  const zeta = getThemeById(DEFAULT_DARK_THEME_ID);
  const nord = getThemeById("nord-dark");
  const gruvbox = getThemeById("gruvbox-dark");
  assert.ok(zeta && nord && gruvbox);
  assert.notEqual(paletteSignature(zeta), paletteSignature(nord));
  assert.notEqual(paletteSignature(nord), paletteSignature(gruvbox));
  assert.equal(zeta.colors.chart.length, 8);
  assert.equal(nord.colors.chart.length, 8);
  assert.equal(gruvbox.colors.chart.length, 8);
});

test("generator emits semantic and legacy variables without unresolved values", () => {
  const generator = new CSSVariableGenerator();
  for (const theme of themes) {
    const css = generator.generate(theme);
    assert.doesNotMatch(css, /undefined|null|NaN/);
    assert.match(css, /--background:/);
    assert.match(css, /--surface-elevated:/);
    assert.match(css, /--syntax-background:/);
    assert.match(css, /--chat-tool-background:/);
    assert.match(css, /--bg-elevated:/);
    assert.match(css, /--accent-dim:/);
    assert.equal((css.match(/--chart-\d+:/g) ?? []).length, 8);
  }
});

test("generator emits the three colour layers with L2/L3 resolving to L1", () => {
  const generator = new CSSVariableGenerator();
  for (const theme of themes) {
    const css = generator.generate(theme);
    assert.match(css, /--zeta-static-surface-background:/);
    assert.match(css, /--zeta-alias-surface-background: var\(--zeta-static-surface-background\)/);
    assert.match(css, /--surface-background: var\(--zeta-alias-surface-background\)/);
    assert.match(css, /--zeta-alias-accent: var\(--zeta-static-primary-base\)/);
    // No L2/L3 declaration may carry a literal; only L1 may.
    for (const line of css.split("\n")) {
      if (line.includes("--zeta-alias-") || (!line.includes("--zeta-static-") && line.startsWith("  --")))
        assert.doesNotMatch(line, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, line);
    }
  }
});

test("text-dim is bound to the secondary-text role, not the code gutter", () => {
  const generator = new CSSVariableGenerator();
  for (const theme of themes) {
    const css = generator.generate(theme);
    assert.match(css, /--text-dim: var\(--zeta-alias-text-dim\)/);
    assert.match(css, /--zeta-alias-text-dim: var\(--zeta-static-surface-muted-foreground\)/);
    assert.equal(new Map(aliasColorTokens(theme)).get("text-dim"), "var(--zeta-static-surface-muted-foreground)");
    assert.match(css, new RegExp(`--zeta-static-surface-muted-foreground: ${theme.colors.surface.mutedForeground};`));
  }
  // mono-dark is where the mis-binding was visible: the gutter grey (#404040)
  // sat at ~1.5:1 on the #000000 background; secondary text is #808080.
  const mono = getThemeById("mono-dark");
  assert.equal(mono.colors.syntax.lineNumber, "#404040");
  assert.equal(mono.colors.surface.mutedForeground, "#808080");
  assert.match(generator.generate(mono), /--zeta-static-surface-muted-foreground: #808080;/);
});

test("control tokens bg-input and border-strong are declared and resolve to theme values", () => {
  const generator = new CSSVariableGenerator();
  for (const theme of themes) {
    const css = generator.generate(theme);
    const aliases = new Map(aliasColorTokens(theme));
    // bg-input keeps the surface the app already paints fields on …
    assert.equal(aliases.get("bg-input"), "var(--zeta-static-surface-muted)", theme.metadata.id);
    // … and border-strong is the theme's hover-border step, never a foreground.
    assert.equal(aliases.get("border-strong"), "var(--zeta-static-interactive-border-hover)", theme.metadata.id);
    assert.match(css, /--zeta-alias-bg-input: var\(--zeta-static-surface-muted\)/);
    assert.match(css, /--zeta-alias-border-strong: var\(--zeta-static-interactive-border-hover\)/);
    // L3 redirects so the unprefixed design-system names keep resolving.
    assert.match(css, /--bg-input: var\(--zeta-alias-bg-input\)/);
    assert.match(css, /--border-strong: var\(--zeta-alias-border-strong\)/);
    // The raw value published behind the hover-border alias is the theme's own.
    assert.ok(
      css.includes(`--zeta-static-interactive-border-hover: ${theme.colors.interactive.borderHover};`),
      `${theme.metadata.id}: hover-border raw value missing from L1`,
    );
  }
  // mono-dark is one of the themes whose hover border is deliberately a subtle
  // step; the point is that the value is a border role, not `#808080` text.
  const mono = getThemeById("mono-dark");
  assert.equal(mono.colors.interactive.borderHover, "#333333");
  assert.notEqual(mono.colors.interactive.borderHover, mono.colors.surface.mutedForeground);
});

test("checked-in first-frame sheet matches the generator for the default themes", () => {
  const sheet = readFileSync(new URL("../../styles/themes/zeta-static.css", import.meta.url), "utf8");
  assert.equal(sheet, renderStaticThemeSheet(getThemeById(DEFAULT_LIGHT_THEME_ID), getThemeById(DEFAULT_DARK_THEME_ID)));
  const generator = new CSSVariableGenerator();
  const light = getThemeById(DEFAULT_LIGHT_THEME_ID);
  const dark = getThemeById(DEFAULT_DARK_THEME_ID);
  for (const [name, value] of staticColorTokens(light)) {
    assert.ok(sheet.includes(`--zeta-static-${name}: ${value};`), `${name} missing from the light table`);
  }
  const darkTable = sheet.slice(sheet.indexOf('[data-theme="dark"]'));
  for (const [name, value] of staticColorTokens(dark)) {
    assert.ok(darkTable.includes(`--zeta-static-${name}: ${value};`), `${name} missing from the dark table`);
  }
  assert.equal(generator.generate(light).includes("--zeta-alias-bg:"), true);
});
