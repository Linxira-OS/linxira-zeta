/**
 * The canonical welcome/splash brand art, rendered by the FIGlet standard tool.
 *
 * The three arrays in `packages/tui/src/prompt/welcome.ts` — `ZETA_LOGO`
 * (mark), `ZETA_WORDMARK` (primary product name) and `ZETA_SUBLINE` (the
 * `Linxira-Zeta` identity line) — are **generated, never hand-drawn**:
 *
 *   mark      `Z`             ANSI Shadow   (FIGlet standard font)
 *   wordmark  `Zeta`          ANSI Shadow
 *   subline   `Linxira-Zeta`  mini
 *
 * Both fonts are the standard FIGlet fonts (the figlet.org set shipped by
 * github.com/patorjk/figlet.js), vendored verbatim under
 * `scripts/brand/fonts/` and parsed by the `figlet` renderer pinned in the root
 * devDependencies. Generation and the brand check are therefore byte-for-byte
 * reproducible and offline: the vendored `.flf` bytes, not a system install,
 * decide the output.
 *
 * Why the Latin `Z` rather than the Greek `Ζ`: every standard FIGlet font is a
 * single-byte (CP437/Latin-1) code table with no Greek block, so `Ζ`/`ζ`
 * render as the empty string (`figlet.textSync("Ζ", { font }).length === 0`).
 * The Latin `Z` is the same glyph — it descends from the Greek zeta — so the
 * ASCII-only standard tool renders `Z`.
 *
 * Reading back is format-agnostic (it collects the row string literals), so the
 * oxfmt line-splitting of the long arrays never registers as drift.
 *
 * Regenerate: `bun scripts/brand/generate-logo-art.ts`
 * Verify:     `bun scripts/brand/brand-check.ts` (guards all three constants)
 */
import * as fs from "node:fs";
import * as path from "node:path";
import figlet from "figlet";

/** Vendored standard FIGlet fonts, `fonts/<font>.flf`. */
const FONT_DIR = path.join(import.meta.dir, "fonts");

/**
 * One generated array: the `welcome.ts` constant it fills, the FIGlet text it
 * renders, and the standard font's canonical name (what `figlet -f "<name>"`
 * uses on a system install).
 */
export interface BrandArtSpec {
	/** Name of the exported constant in `packages/tui/src/prompt/welcome.ts`. */
	readonly constant: string;
	/** Text handed to FIGlet. */
	readonly text: string;
	/** Canonical FIGlet font name (`figlet -f "<font>"`). */
	readonly font: string;
}

/** The mark, wordmark and identity subline, in lockup order. */
export const BRAND_ART_SPEC: readonly BrandArtSpec[] = [
	{ constant: "ZETA_LOGO", text: "Z", font: "ANSI Shadow" },
	{ constant: "ZETA_WORDMARK", text: "Zeta", font: "ANSI Shadow" },
	{ constant: "ZETA_SUBLINE", text: "Linxira-Zeta", font: "mini" },
];

/** FIGlet registers fonts by an internal name; map each vendored font to one. */
const FONT_REGISTRY: Record<string, string> = {
	"ANSI Shadow": "zetabrand-ansi-shadow",
	mini: "zetabrand-mini",
};

for (const [font, registered] of Object.entries(FONT_REGISTRY)) {
	figlet.parseFont(registered, fs.readFileSync(path.join(FONT_DIR, `${font}.flf`), "utf8"));
}

/** Render `text` with a standard FIGlet font as art rows (equal width, no tail blanks). */
function render(text: string, font: string): string[] {
	const registered = FONT_REGISTRY[font];
	if (registered === undefined) throw new Error(`logo-art: no vendored FIGlet font "${font}"`);
	const art = figlet.textSync(text, { font: registered });
	if (art.length === 0) {
		throw new Error(`logo-art: FIGlet font "${font}" rendered "${text}" as nothing (ASCII fonts only)`);
	}
	const rows = art.split("\n");
	// FIGlet pads every row to the art width and appends blank separator rows;
	// keep the padding (the lockup relies on equal-width rows) but drop the tail.
	while (rows.length > 0 && (rows[rows.length - 1] ?? "").trim().length === 0) rows.pop();
	return rows;
}

/** The generated art for every {@link BRAND_ART_SPEC} entry, keyed by constant. */
export function renderBrandArt(): Record<string, string[]> {
	const art: Record<string, string[]> = {};
	for (const spec of BRAND_ART_SPEC) art[spec.constant] = render(spec.text, spec.font);
	return art;
}

/** The row literals currently in `source` for `constant`, or undefined when absent. */
function readConstant(source: string, constant: string): string[] | undefined {
	const region = new RegExp(String.raw`(export const ${constant} = )\[[\s\S]*?\];`).exec(source)?.[0];
	if (region === undefined) return undefined;
	return [...region.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(match => JSON.parse(`"${match[1] ?? ""}"`)) as string[];
}

/** A `welcome.ts` constant that no longer matches the FIGlet render. */
export interface BrandArtDrift {
	readonly constant: string;
	/** What the committed constant says, as JSON. */
	readonly actual: string;
	/** What the generators render, as JSON. */
	readonly expected: string;
}

/**
 * Compare the committed `welcome.ts` source against {@link renderBrandArt}.
 * Returns one {@link BrandArtDrift} per constant that differs — a hand-edited
 * glyph, a merge that reverted the art, or a stale render after a font bump.
 */
export function diffBrandArt(source: string): BrandArtDrift[] {
	const art = renderBrandArt();
	const drift: BrandArtDrift[] = [];
	for (const spec of BRAND_ART_SPEC) {
		const actual = readConstant(source, spec.constant);
		const expected = art[spec.constant] ?? [];
		if (JSON.stringify(actual) !== JSON.stringify(expected)) {
			drift.push({
				constant: spec.constant,
				actual: actual === undefined ? "(constant missing)" : JSON.stringify(actual),
				expected: JSON.stringify(expected),
			});
		}
	}
	return drift;
}

/**
 * Rewrite every {@link BRAND_ART_SPEC} constant in `source` to the current
 * FIGlet render. Throws when a constant is absent so a rename cannot silently
 * leave the file un-generated; the caller re-formats (oxfmt re-splits the long
 * rows, which {@link diffBrandArt} ignores).
 */
export function applyBrandArt(source: string): string {
	const art = renderBrandArt();
	let result = source;
	for (const spec of BRAND_ART_SPEC) {
		// Matches the whole `export const NAME = [ … ];` region, single- or multi-line.
		const region = new RegExp(String.raw`(export const ${spec.constant} = )\[[\s\S]*?\];`);
		if (!region.test(result)) throw new Error(`logo-art: constant "${spec.constant}" not found`);
		result = result.replace(region, (_match, prefix: string) => `${prefix}${JSON.stringify(art[spec.constant])};`);
	}
	return result;
}
