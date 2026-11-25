/**
 * "ultrathink" as a magic keyword: standalone-prose detection and the
 * keyword's editor/bubble gradient.
 *
 * The keyword table (`modes/magic-keywords`) is the single source of truth;
 * detection reuses the session matcher so settings, notice injection and the
 * composer agree on what counts as the keyword.
 */
import { type MagicKeyword, MAGIC_KEYWORDS } from "../../magic-keywords";
import { containsMagicKeyword } from "../../../session/magic-keywords";

const ULTRATHINK_WORD = "ultrathink";

/**
 * Whether `text` contains the standalone keyword "ultrathink" (lowercase,
 * prose-delimited) in prose — never inside a code block, inline code span,
 * or XML/HTML section.
 */
export function containsUltrathink(text: string): boolean {
	return containsMagicKeyword(text, ULTRATHINK_WORD);
}

/** The keyword's rainbow gradient (hue 0..330), shared with the composer glow. */
export const highlightUltrathink: MagicKeyword = MAGIC_KEYWORDS.find(keyword => keyword.word === ULTRATHINK_WORD)!;
