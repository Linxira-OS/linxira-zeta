#!/usr/bin/env node
/**
 * Colour-literal guard for the web-ui style layers.
 *
 * The three-layer token scheme (`lib/theme/tokens.ts`) puts every raw colour
 * value in L1 `--zeta-static-*`; feature CSS/TSX must consume L2
 * `--zeta-alias-*` (or the L3 compat bridge) and never spell a colour out.
 * This guard is the mechanical half of that rule: it fails when a hex, rgb()/
 * hsl()/oklch()/named colour literal appears in a functional style or
 * component file.
 *
 * Scope: `.css`, `.ts`, `.tsx` under web-ui/ (excluding `node_modules/`,
 * `.next/`, test files and the paths in ALLOWED below). Comments are ignored;
 * string literals are scanned, because that is where inline styles live.
 *
 * Usage: `node scripts/check-style-literals.mjs` (from web-ui/) — exit 0/1.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "..");

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

const violations = [];
for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file).split("\\").join("/");
  if (rel.includes(".test.")) continue;
  if (ALLOWED.some(([prefix]) => rel.startsWith(prefix))) continue;

  const source = readFileSync(file, "utf8");
  const isCss = file.endsWith(".css");
  const masked = maskComments(source, isCss);
  const marked = new Set(source.split(/\r?\n/).flatMap((line, index) => (ALLOW_MARKER.test(line) ? [index + 1] : [])));
  const report = (line, text) => {
    if (!marked.has(line)) violations.push({ rel, line, text });
  };

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
}

if (violations.length > 0) {
  console.error(`colour-literal guard FAILED: ${violations.length} literal(s) outside the L1 token layer`);
  const byFile = new Map();
  for (const violation of violations) {
    if (!byFile.has(violation.rel)) byFile.set(violation.rel, []);
    byFile.get(violation.rel).push(violation);
  }
  for (const [rel, list] of [...byFile].sort()) {
    console.error(`  ${rel} (${list.length}): ${list.map(v => `${v.line}:${v.text}`).join(", ")}`);
  }
  console.error("Use an L2 alias (var(--zeta-alias-…)) or add the value to lib/theme/tokens.ts.");
  process.exit(1);
}

console.log("colour-literal guard OK: no literals outside the L1 token layer");
