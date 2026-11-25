/**
 * "orchestrate" as a magic keyword: standalone-prose detection and the
 * keyword's editor/bubble gradient.
 *
 * The keyword table (`modes/magic-keywords`) is the single source of truth;
 * detection reuses the session matcher so settings, notice injection and the
 * composer agree on what counts as the keyword.
 */
import { type MagicKeyword, MAGIC_KEYWORDS } from "../../magic-keywords";
import { containsMagicKeyword } from "../../../session/magic-keywords";

const ORCHESTRATE_WORD = "orchestrate";

/**
 * Whether `text` contains the standalone keyword "orchestrate" (lowercase,
 * prose-delimited) in prose — never inside a code block, inline code span,
 * or XML/HTML section.
 */
export function containsOrchestrate(text: string): boolean {
	return containsMagicKeyword(text, ORCHESTRATE_WORD);
}

/** The keyword's gradient (teal→violet, hue 150..280), shared with the composer glow. */
export const highlightOrchestrate: MagicKeyword = MAGIC_KEYWORDS.find(keyword => keyword.word === ORCHESTRATE_WORD)!;
