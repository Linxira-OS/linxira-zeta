import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { CSSVariableGenerator } = await jiti.import("./cssGenerator.ts");
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
