import { describe, expect, test } from "bun:test";
import { en } from "../src/i18n/en";
import { zh } from "../src/i18n/zh";

/**
 * Welcome-tip catalogue coverage guard.
 *
 * `packages/tui/src/prompt/welcome.ts` embeds `tips.txt` line by line and
 * resolves the picked tip through the host text bridge as
 * `tuiText(\`tip${line}\`, english)`, where `line` is the 1-based number in the
 * *raw* split (blank lines are dropped but still consume their number). A
 * `tips.txt` line with no `tipN` key in a catalogue therefore silently renders
 * its English body in *every* language — the reported "some tips never
 * translate": v18.6.0 shipped 33 lines against 26 keys, with the keys several
 * lines out of step, so the tail fell back to English and the middle served
 * the wrong translation.
 *
 * `scripts/check-i18n-consistency.ts` only proves en/zh agree with *each other*,
 * so both failure modes stayed green: a missing key, and a key that drifted out
 * of step with `tips.txt`. This guard closes that gap mechanically — the `tipN`
 * key set must equal the `tips.txt` line numbers, the English value must be
 * that line verbatim (minus the `[NEW]` marker, exactly like the runtime
 * fallback), and both catalogues must keep the same `{key:…}` / `{tap:…}`
 * render placeholders so a translation can never drop a keystroke hint.
 *
 * `tips.txt` has no comment syntax — the runtime parser drops blank lines only,
 * and line 2 legitimately opens with a `#` prompt hint — so blank lines are the
 * only exclusion.
 */

const TIPS_PATH = `${import.meta.dir}/../../tui/src/prompt/tips.txt`;

/** Mirrors `NEW_TIP_MARKER` in welcome.ts: pool weighting only, never rendered. */
const NEW_TIP_MARKER = /\s*\[NEW\]\s*$/;

/** Mirrors `TIP_KEY_PLACEHOLDER` in welcome.ts. */
const TIP_KEY_PLACEHOLDER = /\{(?:key|keys|tap|action):[^}]+\}/g;

const TIP_KEY_NAME = /^tip(\d+)$/;

const tipsText = await Bun.file(TIPS_PATH).text();

/** The runtime's line map: 1-based over the raw split, blanks dropped. */
const tipLines: ReadonlyArray<{ line: number; english: string }> = tipsText.split("\n").flatMap((raw, index) => {
	const trimmed = raw.trim();
	return trimmed.length === 0 ? [] : [{ line: index + 1, english: trimmed.replace(NEW_TIP_MARKER, "") }];
});

const catalogueByLanguage: Readonly<Record<"en" | "zh", Record<string, unknown>>> = { en, zh };

describe("welcome tip i18n coverage", () => {
	test("every tips.txt line has a non-empty tipN entry in both catalogues", () => {
		const problems: string[] = [];
		for (const { line, english } of tipLines) {
			for (const [language, catalogue] of Object.entries(catalogueByLanguage)) {
				const text = catalogue[`tip${line}`];
				if (typeof text !== "string" || text.length === 0) {
					problems.push(`${language}.tip${line} missing — tips.txt:${line} would render English: ${english}`);
				}
			}
		}
		expect(problems, `tips.txt lines without a catalogue entry:\n${problems.join("\n")}`).toEqual([]);
	});

	test("the tipN key set equals the tips.txt line numbers (no orphans, no gaps)", () => {
		const expected = tipLines.map(({ line }) => line);
		const actual: Record<string, number[]> = {};
		for (const [language, catalogue] of Object.entries(catalogueByLanguage)) {
			actual[language] = Object.keys(catalogue)
				.map(key => TIP_KEY_NAME.exec(key))
				.filter(match => match !== null)
				.map(match => Number(match[1]))
				.sort((a, b) => a - b);
		}
		expect(actual, "tipN keys must mirror the tips.txt lines exactly (drop the key when the line goes)").toEqual({
			en: expected,
			zh: expected,
		});
	});

	test("the English value is its tips.txt line verbatim, minus the [NEW] marker", () => {
		const drifted = tipLines.flatMap(({ line, english }) => {
			const actual = catalogueByLanguage.en[`tip${line}`];
			return actual === english ? [] : [`en.tip${line}:\n    catalogue: ${actual}\n    tips.txt:  ${english}`];
		});
		expect(drifted, `en.tipN drifted from tips.txt (the key must track its line):\n${drifted.join("\n")}`).toEqual(
			[],
		);
	});

	test("both catalogues keep their tips.txt line's placeholders (key names are never translated)", () => {
		const problems: string[] = [];
		for (const { line, english } of tipLines) {
			const sourceTokens = [...english.matchAll(TIP_KEY_PLACEHOLDER)].map(match => match[0]).sort();
			for (const [language, catalogue] of Object.entries(catalogueByLanguage)) {
				const text = catalogue[`tip${line}`];
				if (typeof text !== "string") continue;
				const tokens = [...text.matchAll(TIP_KEY_PLACEHOLDER)].map(match => match[0]).sort();
				if (sourceTokens.join("\u0000") !== tokens.join("\u0000")) {
					problems.push(
						`tip${line} (${language}):\n    tips.txt: ${JSON.stringify(sourceTokens)}\n    ${language}: ${JSON.stringify(tokens)}`,
					);
				}
			}
		}
		expect(problems, `placeholder drift against tips.txt:\n${problems.join("\n")}`).toEqual([]);
	});
});
