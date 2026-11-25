/**
 * "workflowz" as a magic keyword: standalone-prose detection and the
 * keyword's editor/bubble gradient.
 *
 * The keyword table (`modes/magic-keywords`) is the single source of truth;
 * detection reuses the session matcher so settings, notice injection and the
 * composer agree on what counts as the keyword.
 */
import { type MagicKeyword, MAGIC_KEYWORDS } from "../../magic-keywords";
import { containsMagicKeyword } from "../../../session/magic-keywords";

const WORKFLOW_WORD = "workflowz";

/**
 * Whether `text` contains the standalone keyword "workflowz"
 * (lowercase, prose-delimited) in prose — never inside a code block, inline
 * code span, or XML/HTML section.
 */
export function containsWorkflow(text: string): boolean {
	return containsMagicKeyword(text, WORKFLOW_WORD);
}

/** The keyword's warm amber→green gradient (hue 30..150), shared with the composer glow. */
export const highlightWorkflow: MagicKeyword = MAGIC_KEYWORDS.find(keyword => keyword.word === WORKFLOW_WORD)!;
