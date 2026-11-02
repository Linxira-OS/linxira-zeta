/**
 * The taste scoring model — pure functions, no I/O, no model calls.
 *
 * A preference is a Beta posterior over "the user means this":
 *
 *     alpha = 1 + Σ w⁺,  beta = 1 + Σ w⁻,  p = (alpha + w_j·p_judge) / (alpha + beta + w_j)
 *
 * with a decision model's probability entering as pseudo-counts (`w_j = 2·strength`)
 * rather than as an answer: the host still owns the number, a model only moves it.
 * Retention multiplies `p` by veracity and by a Weibull decay clocked from the last
 * time the entry was *used*, not the day it was written — a habit that keeps being
 * applied never decays, which is the whole point of the layer.
 *
 * Injection additionally rewards category coverage and punishes divergence from an
 * explicit rule (AGENTS.md, project settings, the current message).
 */
import { WEIBULL_PARAMS, weibullDecayFactor } from "@linxiraos/pi-mnemopi/core/weibull";
import { VERACITY_WEIGHTS } from "@linxiraos/pi-mnemopi/core/veracity-consolidation";

import { daysBetween, type TasteEntry, topicKey, today } from "./store";

/** KL weight of the explicit-rule divergence term. */
export const BETA_NS = 0.5;
/** Weight of the category-coverage term. */
export const GAMMA_NS = 0.2;

/** Decay scale for a protected entry: twice the preference half-life. */
const PROTECTED_ETA_HOURS = WEIBULL_PARAMS.preference.eta * 2;

/** Evidence kinds and the pseudo-count each contributes when observed once. */
export const EVIDENCE_WEIGHTS = {
	stated: 1.0,
	applied_ok: 0.8,
	no_revert: 0.8,
	tool_outcome: 0.5,
	inferred: 0.3,
	imported: 0.0,
	contradiction: -1.0,
	revert: -1.0,
} as const;

export type EvidenceKind = keyof typeof EVIDENCE_WEIGHTS;

/** Veracity of an evidence tally: the strongest source it rests on. */
const EVIDENCE_VERACITY: Record<EvidenceKind, keyof typeof VERACITY_WEIGHTS> = {
	stated: "stated",
	applied_ok: "tool",
	no_revert: "tool",
	tool_outcome: "tool",
	inferred: "inferred",
	imported: "imported",
	contradiction: "unknown",
	revert: "unknown",
};

/** Weight of the `n`-th repeat observation (diminishing, never below a quarter). */
export function repeatWeight(n: number): number {
	if (!Number.isFinite(n) || n <= 0) return 0;
	return Math.max(0.25, 1 / Math.log2(n + 1));
}

/** Beta posterior mean, with a decision model's probability folded in as pseudo-counts. */
export function betaPosterior(
	positive: number,
	negative: number,
	judge?: { p: number; strength: number } | undefined,
): number {
	const pos = Math.max(0, positive);
	const neg = Math.max(0, negative);
	if (!judge) return (1 + pos) / (2 + pos + neg);
	const weight = 2 * Math.min(1, Math.max(0, judge.strength));
	const p = Math.min(1, Math.max(0, judge.p));
	return (1 + pos + weight * p) / (2 + pos + neg + weight);
}

/** Parse the stored tally (`["stated×2", "applied_ok×1"]`) into per-kind counts. */
export function evidenceTally(evidence: readonly string[]): Partial<Record<EvidenceKind, number>> {
	const tally: Partial<Record<EvidenceKind, number>> = {};
	for (const item of evidence) {
		const [kind, countText] = item.split("×");
		if (kind === undefined || !(kind in EVIDENCE_WEIGHTS)) continue;
		const count = countText === undefined ? 1 : Number.parseInt(countText, 10);
		if (!Number.isFinite(count) || count <= 0) continue;
		tally[kind as EvidenceKind] = (tally[kind as EvidenceKind] ?? 0) + count;
	}
	return tally;
}

/** Positive and negative pseudo-counts an entry's tally implies. */
export function evidenceCounts(entry: Pick<TasteEntry, "evidence">): { positive: number; negative: number } {
	const tally = evidenceTally(entry.evidence);
	let positive = 0;
	let negative = 0;
	for (const [kind, count] of Object.entries(tally) as [EvidenceKind, number][]) {
		const weight = EVIDENCE_WEIGHTS[kind] * count;
		if (weight >= 0) positive += weight;
		else negative += -weight;
	}
	return { positive, negative };
}

/** Veracity of the strongest source an entry's evidence rests on. */
export function evidenceVeracity(entry: Pick<TasteEntry, "evidence">): number {
	const tally = evidenceTally(entry.evidence);
	let best: keyof typeof VERACITY_WEIGHTS = "unknown";
	let bestRank = -1;
	for (const kind of Object.keys(tally) as EvidenceKind[]) {
		const veracity = EVIDENCE_VERACITY[kind];
		const rank = VERACITY_WEIGHTS[veracity];
		if (rank > bestRank) {
			best = veracity;
			bestRank = rank;
		}
	}
	return VERACITY_WEIGHTS[best];
}

/** Hours between a `YYYY-MM-DD` stamp and `now`. */
function ageHours(stamp: string, now: Date): number {
	return Math.max(0, daysBetween(stamp, today(now)) * 24);
}

/**
 * `R_e`: the retention score — posterior × veracity × Weibull decay from the day
 * the entry was last used. A protected entry (strong and repeatedly corroborated)
 * decays at half speed and is never deleted for age.
 */
export function retentionScore(entry: TasteEntry, now: Date = new Date()): number {
	const decay = entry.protected
		? Math.exp(-((ageHours(entry.lastUsed, now) / PROTECTED_ETA_HOURS) ** WEIBULL_PARAMS.preference.k))
		: weibullDecayFactor(ageHours(entry.lastUsed, now), "preference");
	return clamp01(entry.confidence * evidenceVeracity(entry) * decay);
}

/** `S_e`: the injection score. `divergence` is 1 when an explicit rule contradicts the entry. */
export function injectionScore(
	entry: TasteEntry,
	now: Date = new Date(),
	options: { divergence: 0 | 1; coverage: number } = { divergence: 0, coverage: 1 },
): number {
	const retention = retentionScore(entry, now);
	const coverage = clamp01(options.coverage);
	return clamp01(retention * (1 - BETA_NS * options.divergence) + GAMMA_NS * coverage);
}

/**
 * Whether two entries contradict each other: same topic, opposite polarity.
 * `detectConflict` is symmetric and tolerant of punctuation/case differences,
 * which is what `topicKey` normalizes.
 */
export function detectConflict(a: TasteEntry, b: TasteEntry): boolean {
	if (a.polarity === b.polarity) return false;
	return a.topicKey === b.topicKey || topicKey(similarStatement(a.statement)) === topicKey(similarStatement(b.statement));
}

/** Strip the leading preference verb so "prefers X" and "avoids X" share a topic. */
function similarStatement(statement: string): string {
	return statement.replace(/^(?:prefers?|avoids?|likes?|dislikes?|wants?)\s+/i, "");
}

/**
 * Whether an entry may reach the prompt: it must clear the score floor and have
 * no unresolved conflict. Protection only affects deletion, never injection —
 * an old strong habit that has not been used in a year still has to earn its
 * place through the decayed score.
 */
export function shouldInject(entry: TasteEntry, now: Date, floor: number, coverage = 1): boolean {
	if (entry.conflict) return false;
	return injectionScore(entry, now, { divergence: 0, coverage }) >= floor;
}

/** Protected once it is both strong and repeatedly corroborated. */
export function isProtected(entry: Pick<TasteEntry, "confidence" | "mentions">): boolean {
	return entry.confidence >= 0.8 && entry.mentions >= 5;
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}
