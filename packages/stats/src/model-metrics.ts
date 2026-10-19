/**
 * Behavioral metrics extracted from a single assistant message: the model-side
 * counterpart of `user-metrics.ts`.
 *
 * The dashboard calls this "AI breakdown level" (AI 崩溃度): how often a model's
 * replies show the textual marks of a turn that is going badly. Every signal
 * is a count, so the dashboard can report a share of turns that carry it:
 *
 * - `selfBlame` — apologies and admissions ("I'm sorry", "my mistake", "是我搞错了")
 * - `restatement` — "as I said earlier", "to reiterate", "如前所述", plus
 *   near-duplicate repetition of the previous assistant prose (language-neutral)
 * - `hedge` — hedged fallbacks ("I'm not sure", "you could also try", "仅供参考")
 * - `verbose` — 1 when the turn runs past {@link VERBOSE_WORD_THRESHOLD} words
 * - `toolSpiral` — 1 when the turn follows {@link TOOL_SPIRAL_THRESHOLD}+ failed
 *   tool results (the parser counts `toolResult.isError`, the same flag
 *   `tool_calls.is_error` stores)
 * - `collapse` — the per-turn aggregate: the marker counts plus failed tool
 *   results (capped), so one turn with one marker scores 1
 *
 * Lexicons are summed together, never chosen by detected language: a mixed
 * Chinese/English reply, or one written in a language a recognizer mislabels,
 * must not silently lose half its markers. Code fences, XML wrappers, URLs and
 * inline code are stripped by {@link analysisProse} before scoring, so a
 * model quoting a failing test or a config file does not look broken.
 *
 * Pure and side-effect free, like the user analyzer.
 */
import { countMatches, detectRepeatedMessage, detectUnsupportedScript, WORD_RE } from "./user-metrics";

export interface AssistantMessageMetrics {
	/** Characters of analyzed prose (code and markup stripped, capped). */
	chars: number;
	/** Whitespace-delimited words of analyzed prose. */
	words: number;
	/** Apology / self-blame markers. */
	selfBlame: number;
	/** Repeated-restatement markers plus near-duplicate previous turn. */
	restatement: number;
	/** Hedged fallback markers. */
	hedge: number;
	/** 1 when the turn is long-winded (see {@link VERBOSE_WORD_THRESHOLD}). */
	verbose: number;
	/** Failed tool results preceding this turn, as counted at ingest. */
	toolErrors: number;
	/** 1 when {@link toolErrors} reaches {@link TOOL_SPIRAL_THRESHOLD}. */
	toolSpiral: number;
	/** Per-turn aggregate (see the module docs). */
	collapse: number;
	/** 1 when the prose leans on a script no lexicon covers; such rows are unscored, not calm. */
	unsupportedScript: number;
}

/**
 * Words past which a reply counts as long-winded. Coding-agent answers usually
 * land well under this; a 400-word turn is the point where the model is
 * explaining at the user instead of answering.
 */
export const VERBOSE_WORD_THRESHOLD = 400;

/**
 * Character floor for the same signal. Chinese prose has no spaces, so
 * `WORD_RE` sees one "word" per line; roughly 1.5 characters per word makes
 * this the equivalent of {@link VERBOSE_WORD_THRESHOLD}.
 */
export const VERBOSE_CHAR_THRESHOLD = 2_400;

/** Consecutive failed tool results that make a turn part of a failure spiral. */
export const TOOL_SPIRAL_THRESHOLD = 3;

/** Failed tool results beyond this many add no further weight to `collapse`. */
export const TOOL_ERROR_COLLAPSE_CAP = 10;

// Apologies and admissions, English and Chinese. `apologies` stands alone;
// "I'm afraid" is hedged uncertainty and lives in HEDGE_RE instead.
const SELF_BLAME_RE =
	/(?:\bi(?:'m| am) (?:so |really |very )?sorry\b|\bmy (?:apologies|bad|mistake|fault)\b|\bi apologi[sz]e\b|\bapologies\b|\bi was (?:wrong|mistaken)\b|\bi made (?:a|an|the) (?:mistake|error|bug)\b|\bi(?:'ve| have) (?:made|introduced) (?:a|an|the) (?:mistake|error|bug)\b|\bthat(?:'s| is| was) my (?:mistake|fault|error)\b|\bi stand corrected\b|\bsorry (?:about|for) (?:that|this|the confusion)\b)/gi;
const ZH_SELF_BLAME_RE =
	/(?:抱歉|对不起|不好意思|是我(?:的)?错|我错了|我搞错(?:了)?|我弄错(?:了)?|是我疏忽|我疏忽了|我犯(?:了)?错|实在抱歉|非常抱歉|请原谅)/g;

// Explicit restatement. Bare "again" / "repeating" are far too common in
// technical prose ("repeating pattern") to count on their own.
const RESTATEMENT_RE =
	/(?:\bas i (?:said|mentioned|noted) (?:earlier|before|above)\b|\bas (?:previously|mentioned|noted) (?:above|earlier)\b|\bto reiterate\b|\bto restate\b|\blet me (?:repeat|restate|clarify)\b|\bin other words\b|\bonce again\b|\bas noted (?:above|earlier)\b|\blike i said\b|\bto repeat\b)/gi;
const ZH_RESTATEMENT_RE =
	/(?:再说一遍|再说一次|重复一遍|重复一次|如前所述|正如(?:我)?(?:之前|前面)(?:所说|提到)|我(?:已经)?说过|再次(?:说明|强调)|换句话(?:说)?|重申)/g;

// Uncertainty and work-avoiding fallbacks. Deliberately excludes bare
// "I think" / "maybe", which are ordinary model prose and would swamp the
// signal; only explicit inability or deferral counts.
const HEDGE_RE =
	/(?:\bi(?:'m| am) (?:not (?:entirely |completely |100% )?sure|unsure|not certain)\b|\bnot 100% sure\b|\bit depends\b|\bas far as i can tell\b|\bif that helps\b|\blet me know if\b|\byou could also\b|\balternatively, you could\b|\bone option is\b|\bin theory\b|\bi can(?:no|')?t (?:be sure|guarantee|promise)\b|\bi(?:'m| am) afraid\b|\bhopefully\b)/gi;
const ZH_HEDGE_RE =
	/(?:我不(?:太)?确定|不太确定|不确定|可能|也许|或许|应该(?:可以|能|没问题)|大概(?:是|可以|能)?|你可以(?:试试|尝试)|可以试试|试试看|仅供参考|如果(?:还)?不行|希望(?:这|对你)?(?:有)?(?:所)?帮助|不太好说|说不准)/g;

/** Empty metrics constant for callers that need a default. */
export const EMPTY_ASSISTANT_METRICS: AssistantMessageMetrics = Object.freeze({
	chars: 0,
	words: 0,
	selfBlame: 0,
	restatement: 0,
	hedge: 0,
	verbose: 0,
	toolErrors: 0,
	toolSpiral: 0,
	collapse: 0,
	unsupportedScript: 0,
});

/**
 * Compute behavioral metrics for one assistant turn.
 *
 * `text` is the turn's analysis prose (see {@link analysisProse}) — the parser
 * strips thinking blocks and structured content before calling this. Empty or
 * whitespace-only input returns zeros.
 */
export function computeAssistantMessageMetrics(
	text: string,
	options: {
		/** The previous prose-bearing assistant turn in the same session, for restatement. */
		prevText?: string;
		/** Failed tool results since the previous assistant turn. */
		toolErrors?: number;
	} = {},
): AssistantMessageMetrics {
	const trimmed = text.trim();
	const toolErrors = Math.max(0, Math.trunc(options.toolErrors ?? 0));
	if (!trimmed)
		return { ...EMPTY_ASSISTANT_METRICS, toolErrors, toolSpiral: toolErrors >= TOOL_SPIRAL_THRESHOLD ? 1 : 0 };

	const words = countMatches(trimmed, WORD_RE);
	const selfBlame = countMatches(trimmed, SELF_BLAME_RE) + countMatches(trimmed, ZH_SELF_BLAME_RE);
	const restatement =
		countMatches(trimmed, RESTATEMENT_RE) +
		countMatches(trimmed, ZH_RESTATEMENT_RE) +
		detectRepeatedMessage(trimmed, options.prevText ?? "");
	const hedge = countMatches(trimmed, HEDGE_RE) + countMatches(trimmed, ZH_HEDGE_RE);
	const verbose = words >= VERBOSE_WORD_THRESHOLD || trimmed.length >= VERBOSE_CHAR_THRESHOLD ? 1 : 0;
	const toolSpiral = toolErrors >= TOOL_SPIRAL_THRESHOLD ? 1 : 0;
	const toolPenalty = toolSpiral === 1 ? Math.min(toolErrors, TOOL_ERROR_COLLAPSE_CAP) : 0;

	return {
		chars: trimmed.length,
		words,
		selfBlame,
		restatement,
		hedge,
		verbose,
		toolErrors,
		toolSpiral,
		collapse: selfBlame + restatement + hedge + verbose + toolPenalty,
		unsupportedScript: detectUnsupportedScript(trimmed),
	};
}
