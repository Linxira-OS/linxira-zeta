import type { ReactNode } from "react";

/**
 * Rainbow gradient highlighting for magic keywords, ported from the CLI's
 * `createGradientHighlighter` (packages/coding-agent/src/modes/). Each
 * standalone lowercase keyword occurrence in prose is painted per-character
 * with an HSL gradient; the flicker itself is driven by CSS
 * (`sf-rainbow-flicker` hue-rotate, period aligned to the CLI's shimmer).
 *
 * Matching mirrors the CLI's prose rule: the keyword must be flanked by
 * punctuation / whitespace / string edges (never letters, digits, `_`, `/`,
 * `\`, `-`, a following extension dot, `::` prefix, or an immediate call
 * paren), and occurrences inside fenced code blocks or inline code spans are
 * skipped via a simplified mask.
 */

export interface RainbowKeywordSpec {
	stops: number;
	hue: (t: number) => number;
}

/** Same keyword set and palettes as the CLI (ultrathink/orchestrate/workflowz). */
export const RAINBOW_KEYWORDS: Record<string, RainbowKeywordSpec> = {
	ultrathink: { stops: 14, hue: t => t * 330 },
	orchestrate: { stops: 14, hue: t => 150 + t * 130 },
	workflowz: { stops: 14, hue: t => 30 + t * 120 },
};

/** CLI `magicKeywordRegex` boundaries (case-sensitive, lowercase keywords). */
const LEFT_BOUNDARY = String.raw`(?<![\p{L}\p{N}_./\\-])(?<!::)`;
const RIGHT_BOUNDARY = String.raw`(?![\p{L}\p{N}_/\\-])(?!\.[\p{L}\p{N}_-])(?!\()`;

function escapeRegExp(value: string): string {
	return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function magicKeywordRegex(keyword: string): RegExp {
	return new RegExp(`${LEFT_BOUNDARY}${escapeRegExp(keyword)}${RIGHT_BOUNDARY}`, "gu");
}

const PALETTE_LIGHTNESS = 62;
const PALETTE_SATURATION = 90;

function paletteFor(spec: RainbowKeywordSpec): string[] {
	const colors: string[] = [];
	for (let i = 0; i < spec.stops; i++) {
		colors.push(`hsl(${Math.round(spec.hue(i / spec.stops))}, ${PALETTE_SATURATION}%, ${PALETTE_LIGHTNESS}%)`);
	}
	return colors;
}

/**
 * Return a copy of `text` (same length, indices map 1:1) with every character
 * inside a fenced code block or inline code span replaced by a space, so
 * keyword matching never fires inside code. Simplified port of the CLI's
 * `maskNonProse`: fences are lines starting (after ≤3 spaces) with 3+
 * backticks/tildes closed by a matching line; inline code is a backtick run
 * closed by an equal-length run.
 */
export function maskCodeSpans(text: string): string {
	const chars = text.split("");
	const n = text.length;
	const mask = (from: number, to: number): void => {
		for (let k = from; k < to; k++) if (chars[k] !== "\n") chars[k] = " ";
	};

	// Pass 1: fenced code blocks (line based).
	let fenceChar = "";
	let i = 0;
	while (i < n) {
		const nl = text.indexOf("\n", i);
		const lineEnd = nl === -1 ? n : nl;
		const line = text.slice(i, lineEnd);
		const fence = /^ {0,3}([`~]{3,})/.exec(line);
		if (fenceChar === "") {
			if (fence) {
				fenceChar = fence[1]![0]!;
				mask(i, lineEnd);
			}
		} else {
			if (fence && fence[1]![0]! === fenceChar) fenceChar = "";
			mask(i, lineEnd);
		}
		i = lineEnd < n ? lineEnd + 1 : lineEnd;
	}

	// Pass 2: inline code (backtick runs) on the already-fence-masked text.
	let j = 0;
	while (j < n) {
		if (chars[j] !== "`") {
			j++;
			continue;
		}
		let run = 0;
		while (j + run < n && chars[j + run] === "`") run++;
		let k = j + run;
		let closed = false;
		while (k < n) {
			if (chars[k] !== "`") {
				k++;
				continue;
			}
			let run2 = 0;
			while (k + run2 < n && chars[k + run2] === "`") run2++;
			if (run2 === run) {
				closed = true;
				break;
			}
			k += run2;
		}
		const end = closed ? k + run : j + run;
		mask(j, end);
		j = end;
	}

	return chars.join("");
}

interface KeywordMatch {
	start: number;
	end: number;
	spec: RainbowKeywordSpec;
}

function findMatches(text: string, masked: string): KeywordMatch[] {
	const matches: KeywordMatch[] = [];
	for (const [keyword, spec] of Object.entries(RAINBOW_KEYWORDS)) {
		for (const m of masked.matchAll(magicKeywordRegex(keyword))) {
			matches.push({ start: m.index, end: m.index + m[0].length, spec });
		}
	}
	return matches.sort((a, b) => a.start - b.start || a.end - b.end);
}

/**
 * Paint every standalone occurrence of `keyword` in `text` with its rainbow
 * gradient, returning React nodes (plain strings for surrounding text, one
 * `<span className="sf-rainbow-flicker">` per keyword character). `phase` in
 * [0, 1) rotates the palette start (default 0 = static; the CSS animation
 * provides the shimmer).
 */
export function rainbowKeywordSpans(text: string, keyword: string, phase: number = 0): ReactNode[] {
	const spec = RAINBOW_KEYWORDS[keyword];
	if (!spec || !text.includes(keyword)) return [text];
	const wrappedPhase = ((phase % 1) + 1) % 1;
	const palette = paletteFor(spec);
	const masked = maskCodeSpans(text);
	const nodes: ReactNode[] = [];
	let last = 0;
	for (const m of masked.matchAll(magicKeywordRegex(keyword))) {
		const start = m.index;
		const end = start + m[0].length;
		if (start > last) nodes.push(text.slice(last, start));
		const word = text.slice(start, end);
		const length = word.length;
		for (let i = 0; i < length; i++) {
			const t = (i / length + wrappedPhase) % 1;
			const color = palette[Math.floor(t * palette.length) % palette.length] ?? palette[0]!;
			nodes.push(
				<span key={`${start}:${i}`} style={{ color }} className="sf-rainbow-flicker">
					{word[i]}
				</span>,
			);
		}
		last = end;
	}
	if (last < text.length) nodes.push(text.slice(last));
	return nodes;
}

/**
 * Whether `text` contains any magic keyword as standalone prose (skipping
 * occurrences inside code blocks / inline code spans).
 */
export function hasProseKeyword(text: string): boolean {
	const masked = maskCodeSpans(text);
	return Object.keys(RAINBOW_KEYWORDS).some(keyword => magicKeywordRegex(keyword).test(masked));
}

/**
 * Paint every magic keyword occurrence in `text` (ultrathink / orchestrate /
 * workflowz) in one pass, so distinct keywords never double-match.
 */
export function rainbowMagicKeywords(text: string, phase: number = 0): ReactNode[] {
	const wrappedPhase = ((phase % 1) + 1) % 1;
	const masked = maskCodeSpans(text);
	const matches = findMatches(text, masked);
	if (matches.length === 0) return [text];
	const nodes: ReactNode[] = [];
	let last = 0;
	for (const match of matches) {
		const { start, end, spec } = match;
		if (start > last) nodes.push(text.slice(last, start));
		const palette = paletteFor(spec);
		const word = text.slice(start, end);
		const length = word.length;
		for (let i = 0; i < length; i++) {
			const t = (i / length + wrappedPhase) % 1;
			const color = palette[Math.floor(t * palette.length) % palette.length] ?? palette[0]!;
			nodes.push(
				<span key={`${start}:${i}`} style={{ color }} className="sf-rainbow-flicker">
					{word[i]}
				</span>,
			);
		}
		last = end;
	}
	if (last < text.length) nodes.push(text.slice(last));
	return nodes;
}
