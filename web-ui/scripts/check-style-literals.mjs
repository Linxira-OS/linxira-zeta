#!/usr/bin/env node
/**
 * Colour guard for the web-ui style layers. Two rules:
 *
 * 1. **No colour literals.** The three-layer token scheme
 *    (`lib/theme/tokens.ts`) puts every raw colour value in L1
 *    `--zeta-static-*`; feature CSS/TSX must consume L2 `--zeta-alias-*` (or
 *    the L3 compat bridge) and never spell a colour out. Fails on a hex, rgb()/
 *    hsl()/oklch()/named colour literal in a functional style or component.
 * 2. **No colour token as a whole box-shadow.** `box-shadow: <colour>` is
 *    invalid CSS (the grammar needs 2–4 lengths too), so the declaration is
 *    dropped and the element paints no shadow — the bug `FloatingMenu` and
 *    `SearchDialog` shipped until 2026-10-13. Never baselined.
 *
 * Scope: `.css`, `.ts`, `.tsx` under web-ui/ (excluding `node_modules/`,
 * `.next/`, test files and the paths in ALLOWED below). Comments are ignored;
 * string literals are scanned, because that is where inline styles live.
 * Escape hatches, both of which must carry a reason:
 *   - one line: the marker `zeta-style-literal-allow: <reason>` in a comment —
 *     for a literal that is a *matching key* (a selector against the
 *     highlighter's inline colours) rather than paint;
 *   - a block: `zeta-style-literal-allow-start: <reason>` … `zeta-style-literal-allow-end`
 *     — for one cohesive palette that legitimately owns its own literals (the
 *     xterm ANSI table). An unterminated or nested region is a hard error, so
 *     the exemption can never silently widen.
 * Prefer a region over a file-level ALLOWED entry: the file keeps every other
 * line under the guard.
 *
 * Files still mid-migration carry a per-file ceiling in
 * `scripts/style-literal-baseline.json` (currently empty): a literal in any
 * other file, or a count above the ceiling, fails. Counts below a ceiling are
 * reported as stale (not a failure) — migrations land in their own PR — and
 * `--update-baseline` rewrites the file from the current tree to tighten them.
 *
 * Usage: `node scripts/check-style-literals.mjs`               — exit 0/1
 *        `node scripts/check-style-literals.mjs --update-baseline`
 *        (from web-ui/)
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "..");
const BASELINE_PATH = join(ROOT, "scripts/style-literal-baseline.json");
const BASELINE_NOTE =
  "Colour-literal ceilings for files still mid-migration, enforced by check-style-literals.mjs: any literal in a file " +
  "absent here, and any count above its ceiling, fails the guard. Empty by design — every non-allow-listed file under " +
  "web-ui is literal-free as of 2026-10-13. Adding an entry means accepting debt: state the owning branch/PR in the " +
  "same commit, and tighten it again with `node scripts/check-style-literals.mjs --update-baseline` once migrated.";

const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "public"]);
const SCAN_EXT = new Set([".css", ".ts", ".tsx"]);

/**
 * Files that may spell colours out, each with the reason it is exempt. The
 * theme owner (L1) and two terminal/palette surfaces are the only legitimate
 * homes for a literal; everything else belongs in `lib/theme/tokens.ts`.
 */
const ALLOWED = [
  ["lib/theme/", "theme owner: the L1 --zeta-static-* palette is defined here"],
  ["lib/ansi.ts", "ANSI-16 → CSS colour map: terminal palette, not theme surfaces"],
  ["components/TerminalView.tsx", "xterm.js palette + theme wiring: the terminal owns its own 16 colours"],
  ["lib/rainbow.tsx", "computed rainbow palette: hues are interpolated per keyword spec, not theme surfaces"],
  ["styles/themes/", "generated L1/L2/L3 first-frame tables (scripts/gen-theme-static.mjs)"],
  ["app/api/", "standalone server-rendered HTML preview document (no theme context)"],
  ["app/layout.tsx", "pre-hydration theme-color meta; rewritten by the bootstrap script"],
];

const NAMED = "white|black|silver|gray|grey|red|maroon|yellow|olive|lime|green|aqua|teal|blue|navy|fuchsia|purple";
const HEX = /#([0-9a-fA-F]{3,8})(?![0-9a-zA-Z_-])/g;
/** `rgb(from var(--x) r g b / 0.1)` is relative-colour syntax over a token, not a literal. */
const FUNC = /(?:^|[^a-zA-Z0-9_-])(rgb|rgba|hsl|hsla|hwb|oklch|oklab|lab|lch|color)\(\s*(?!from\b)/g;
const NAMED_CSS = new RegExp(`:\\s*(${NAMED})\\b`, "g");
const NAMED_STRING = new RegExp(`["'\`](${NAMED})["'\`]`, "g");

/** Per-line escape hatch for a colour that is a *matching key*, not paint. */
const ALLOW_MARKER = /zeta-style-literal-allow:\s*\S+/;
/** Region escape hatch for a block of literals that are one cohesive palette. */
const ALLOW_REGION_START = /zeta-style-literal-allow-start:\s*\S+/;
const ALLOW_REGION_END = /zeta-style-literal-allow-end/;

/**
 * Lines exempted from rule 1: single-line markers plus whole marked regions.
 * A region that is opened and never closed is a hard error — an unterminated
 * exemption would silently swallow the rest of the file.
 */
function allowedLines(source, rel) {
  const lines = source.split(/\r?\n/);
  const allowed = new Set();
  let open = 0;
  lines.forEach((line, index) => {
    const number = index + 1;
    if (ALLOW_REGION_START.test(line)) {
      if (open) throw new Error(`${rel}:${number}: nested zeta-style-literal-allow-start`);
      open = number;
    }
    if (ALLOW_MARKER.test(line) || open) allowed.add(number);
    if (ALLOW_REGION_END.test(line)) {
      if (!open) throw new Error(`${rel}:${number}: zeta-style-literal-allow-end without a start`);
      open = 0;
    }
  });
  if (open) throw new Error(`${rel}:${open}: zeta-style-literal-allow-start is never closed`);
  return allowed;
}

/**
 * Rule 2: a colour token used as the *whole* `box-shadow` value. A colour is
 * `<color>` in the shadow grammar, which requires 2–4 lengths as well, so the
 * declaration is invalid and the element paints no shadow at all — the failure
 * mode `FloatingMenu`/`SearchDialog` shipped (2026-10-13). The alias table is
 * the authority on what counts as a colour token.
 */
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { aliasColorTokens } = await jiti.import(join(ROOT, "lib/theme/tokens.ts"));
const { getThemeById, DEFAULT_LIGHT_THEME_ID } = await jiti.import(join(ROOT, "lib/theme/themes.ts"));
const COLOUR_TOKENS = new Set(aliasColorTokens(getThemeById(DEFAULT_LIGHT_THEME_ID)).map(([name]) => name));
const BARE_TOKEN_SHADOW = /^var\(\s*--(?:zeta-alias-)?([a-z0-9-]+)\s*(?:,[\s\S]*)?\)$/;
const SHADOW_CSS = /(?:^|[;{\s])box-shadow\s*:\s*([^;{}]+);/g;
const SHADOW_TS = /boxShadow\s*:\s*(["'`])([\s\S]*?)\1/g;

/**
 * Blank out comments while preserving offsets, so a colour mentioned in prose
 * ("`#404040` on `#000000`") is not a violation but a colour in a string is.
 */
function maskComments(source, isCss) {
  const out = source.split("");
  let state = "code";
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];
    if (state === "code") {
      if (char === "/" && next === "*") {
        state = "block";
        out[i] = out[i + 1] = " ";
        i++;
      } else if (!isCss && char === "/" && next === "/") {
        state = "line";
        out[i] = out[i + 1] = " ";
        i++;
      } else if (!isCss && (char === '"' || char === "'" || char === "`")) {
        state = char;
      }
    } else if (state === "block") {
      if (char === "*" && next === "/") {
        out[i] = out[i + 1] = " ";
        i++;
        state = "code";
      } else if (char !== "\n") out[i] = " ";
    } else if (state === "line") {
      if (char === "\n") state = "code";
      else out[i] = " ";
    } else if (char === "\\") {
      i++;
    } else if (char === state) {
      state = "code";
    }
  }
  return out.join("");
}

function lineOf(source, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (source[i] === "\n") line++;
  return line;
}

/** `#fff` and `#135` are indistinguishable, so an all-digit 3/4-digit hex only
 * counts as a colour when it sits in a quoted string or a CSS declaration. */
function isShortHexColor(masked, index, raw, isCss) {
  const digits = raw.slice(1);
  if (/[a-fA-F]/.test(digits)) return true;
  if (isCss) return true;
  const before = masked[index - 1];
  const after = masked[index + raw.length];
  return (before === '"' || before === "'" || before === "`") && (after === '"' || after === "'" || after === "`");
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (SCAN_EXT.has(entry.slice(entry.lastIndexOf(".")))) files.push(full);
  }
  return files;
}

/** Rule 1 literals plus rule 2 shadow values, for one masked file body. */
function scan(masked, isCss, rel, report) {
  for (const match of masked.matchAll(HEX)) {
    const raw = match[0];
    if (raw.length - 1 < 6 && !isShortHexColor(masked, match.index, raw, isCss)) continue;
    report(lineOf(masked, match.index), raw);
  }
  for (const match of masked.matchAll(FUNC)) {
    report(lineOf(masked, match.index), `${match[1]}(`);
  }
  for (const match of masked.matchAll(isCss ? NAMED_CSS : NAMED_STRING)) {
    report(lineOf(masked, match.index), match[1]);
  }

  // Rule 2 — a colour token as the whole box-shadow value (never baselined:
  // the declaration is invalid CSS, so there is no "debt" to accept).
  for (const match of masked.matchAll(isCss ? SHADOW_CSS : SHADOW_TS)) {
    const value = (isCss ? match[1] : match[2]).trim();
    const bare = BARE_TOKEN_SHADOW.exec(value);
    if (!bare || !COLOUR_TOKENS.has(bare[1])) continue;
    shadowViolations.push({ rel, line: lineOf(masked, match.index), text: value.slice(0, 60) });
  }
}

const violations = [];
const shadowViolations = [];
try {
  for (const file of walk(ROOT)) {
    const rel = relative(ROOT, file).split("\\").join("/");
    if (rel.includes(".test.")) continue;
    if (ALLOWED.some(([prefix]) => rel.startsWith(prefix))) continue;

    const source = readFileSync(file, "utf8");
    const isCss = file.endsWith(".css");
    const marked = allowedLines(source, rel);
    scan(maskComments(source, isCss), isCss, rel, (line, text) => {
      if (!marked.has(line)) violations.push({ rel, line, text });
    });
  }
} catch (error) {
  console.error(`colour-literal guard FAILED: malformed exemption — ${error.message}`);
  process.exit(1);
}

const byFile = new Map();
for (const violation of violations) {
  if (!byFile.has(violation.rel)) byFile.set(violation.rel, []);
  byFile.get(violation.rel).push(violation);
}

if (process.argv.includes("--update-baseline")) {
  const files = Object.fromEntries([...byFile].map(([rel, list]) => [rel, list.length]));
  writeFileSync(BASELINE_PATH, `${JSON.stringify({ note: BASELINE_NOTE, files }, null, 2)}\n`);
  console.log(`wrote ${relative(ROOT, BASELINE_PATH)}: ${Object.keys(files).length} file(s), ${violations.length} literal(s)`);
  process.exit(0);
}

/**
 * Ratchet: a file still mid-migration carries a per-file **ceiling** in the
 * baseline. Any literal in an unbaselined file, and any count above the
 * ceiling, fails. A count *below* the ceiling is allowed and reported as a
 * stale entry: migrations land in their own PR (different branch, different
 * owner), so failing on a decrease would deadlock two in-flight PRs. Tighten
 * with `--update-baseline` once the file is migrated.
 */
const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")).files;
const problems = [];
const stale = [];
for (const [rel, list] of [...byFile].sort()) {
  const ceiling = baseline[rel];
  if (ceiling === undefined) {
    problems.push(`  ${rel} (${list.length} new): ${list.map(v => `${v.line}:${v.text}`).join(", ")}`);
  } else if (list.length > ceiling) {
    problems.push(`  ${rel} (${list.length} > ceiling ${ceiling}): ${list.map(v => `${v.line}:${v.text}`).join(", ")}`);
  } else if (list.length < ceiling) {
    stale.push(`  ${rel} (${list.length} < ceiling ${ceiling}) — tighten with --update-baseline`);
  }
}
for (const rel of Object.keys(baseline)) {
  if (!byFile.has(rel)) stale.push(`  ${rel} (0 < ceiling ${baseline[rel]}) — drop the entry with --update-baseline`);
}

if (shadowViolations.length > 0) {
  console.error(`colour-token guard FAILED: ${shadowViolations.length} colour token(s) used as a whole box-shadow`);
  for (const violation of shadowViolations)
    console.error(`  ${violation.rel}:${violation.line}: ${violation.text}`);
  console.error("A colour is not a shadow: add the geometry, e.g. `0 6px 20px var(--zeta-alias-surface-shadow)`.");
  process.exit(1);
}

if (problems.length > 0) {
  console.error(`colour-literal guard FAILED: ${violations.length} literal(s) outside the L1 token layer`);
  for (const problem of problems) console.error(problem);
  console.error("Use an L2 alias (var(--zeta-alias-…)), or add the value to lib/theme/tokens.ts.");
  process.exit(1);
}
if (stale.length > 0) {
  console.warn(`colour-literal guard: ${stale.length} stale baseline entr(ies) (not a failure)`);
  for (const entry of stale) console.warn(entry);
}

console.log(
  `colour-literal guard OK: ${violations.length} baselined literal(s) in ${byFile.size} file(s) pending migration, 0 elsewhere`,
);
