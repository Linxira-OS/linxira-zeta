/**
 * Regenerates the checked-in first-frame theme sheet
 * (`web-ui/styles/themes/zeta-static.css`) from the theme registry.
 *
 * Usage (from web-ui/): `node scripts/gen-theme-static.mjs`
 *
 * `lib/theme/theme-system.test.mjs` asserts the checked-in file equals this
 * renderer's output, so a stale sheet fails `npm test` instead of shipping.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const here = dirname(fileURLToPath(import.meta.url));
const webUi = resolve(here, "..");
const target = resolve(webUi, "styles/themes/zeta-static.css");

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { renderStaticThemeSheet } = await jiti.import(resolve(webUi, "lib/theme/staticSheet.ts"));
const { DEFAULT_DARK_THEME_ID, DEFAULT_LIGHT_THEME_ID, getThemeById } = await jiti.import(
  resolve(webUi, "lib/theme/themes.ts"),
);

const light = getThemeById(DEFAULT_LIGHT_THEME_ID);
const dark = getThemeById(DEFAULT_DARK_THEME_ID);
if (!light || !dark) throw new Error(`theme registry is missing ${DEFAULT_LIGHT_THEME_ID} / ${DEFAULT_DARK_THEME_ID}`);

const rendered = renderStaticThemeSheet(light, dark);
if (process.argv.includes("--check")) {
  const current = readFileSync(target, "utf8");
  if (current !== rendered) {
    console.error(`${target} is stale — run \`node scripts/gen-theme-static.mjs\` from web-ui/`);
    process.exit(1);
  }
  console.log(`${target} is up to date`);
} else {
  writeFileSync(target, rendered);
  console.log(`wrote ${target}`);
}
