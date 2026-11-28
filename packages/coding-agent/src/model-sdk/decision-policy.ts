/**
 * Deterministic candidate scoring for decision models.
 *
 * A policy declares signals and explicit weights once. Candidate values are
 * normalized across the candidate set, weighted, and rounded to six decimal
 * places. Every candidate carries a reason list naming each signal's raw
 * value, normalization, weight, and contribution. Selection is by score and
 * then an explicit tie-breaker; when nothing meets the policy the result has
 * no selected candidate (it never falls back to a weaker candidate).
 */
import { DecisionPolicyError } from "./errors";

export type DecisionSignalDirection = "higher-is-better" | "lower-is-better";

export interface DecisionSignal {
	readonly id: string;
	readonly weight: number;
	readonly direction?: DecisionSignalDirection;
	readonly required?: boolean;
}

export interface DecisionCandidate {
	readonly id: string;
	readonly signals: Readonly<Record<string, number>>;
}

export type DecisionTieBreaker = "candidate-id" | "input-order";

export interface DecisionPolicy {
	readonly signals: readonly DecisionSignal[];
	/** Minimum rounded score; defaults to 0. */
	readonly minScore?: number;
	/** Defaults to `"candidate-id"` for a stable, order-independent tie-break. */
	readonly tieBreaker?: DecisionTieBreaker;
}

export type DecisionReasonCode =
	| "signal"
	| "missing-signal"
	| "invalid-signal"
	| "below-min-score"
	| "score"
	| "selected"
	| "tie-break"
	| "not-selected";

export interface DecisionReason {
	readonly code: DecisionReasonCode;
	readonly message: string;
	readonly signal?: string;
	readonly value?: number;
	readonly normalized?: number;
	readonly weight?: number;
	readonly contribution?: number;
}

export interface ScoredCandidate {
	readonly id: string;
	readonly score: number;
	readonly eligible: boolean;
	readonly reasons: DecisionReason[];
}

export interface DecisionOutcome {
	readonly selected: ScoredCandidate | null;
	/** Candidates in input order, each with its explanation. */
	readonly candidates: readonly ScoredCandidate[];
	readonly reason: string;
}

interface NormalizedSignal {
	readonly id: string;
	readonly weight: number;
	readonly direction: DecisionSignalDirection;
	readonly required: boolean;
	min: number;
	max: number;
}

function roundScore(value: number): number {
	return Number(value.toFixed(6));
}

function validatePolicy(policy: DecisionPolicy): {
	readonly signals: readonly NormalizedSignal[];
	readonly totalWeight: number;
	readonly minScore: number;
	readonly tieBreaker: DecisionTieBreaker;
} {
	if (policy === null || typeof policy !== "object" || !Array.isArray(policy.signals) || policy.signals.length === 0) {
		throw new DecisionPolicyError("Decision policy requires at least one declared signal.");
	}
	const seen = new Set<string>();
	let totalWeight = 0;
	const signals: NormalizedSignal[] = [];
	for (const signal of policy.signals) {
		if (signal === null || typeof signal !== "object" || typeof signal.id !== "string" || signal.id.trim() === "") {
			throw new DecisionPolicyError("Every decision signal requires a non-empty id.");
		}
		if (seen.has(signal.id)) {
			throw new DecisionPolicyError(`Decision policy declares signal "${signal.id}" more than once.`);
		}
		seen.add(signal.id);
		if (typeof signal.weight !== "number" || !Number.isFinite(signal.weight) || signal.weight < 0) {
			throw new DecisionPolicyError(`Decision signal "${signal.id}" requires a finite non-negative weight.`);
		}
		const direction = signal.direction === undefined ? "higher-is-better" : signal.direction;
		if (direction !== "higher-is-better" && direction !== "lower-is-better") {
			throw new DecisionPolicyError(`Decision signal "${signal.id}" has an unknown direction.`);
		}
		if (signal.required !== undefined && typeof signal.required !== "boolean") {
			throw new DecisionPolicyError(`Decision signal "${signal.id}" required flag must be boolean.`);
		}
		totalWeight += signal.weight;
		signals.push({
			id: signal.id,
			weight: signal.weight,
			direction,
			required: signal.required === undefined ? true : signal.required,
			min: 0,
			max: 0,
		});
	}
	if (!Number.isFinite(totalWeight) || !(totalWeight > 0)) {
		throw new DecisionPolicyError("Decision policy requires a finite positive total signal weight.");
	}
	const minScore = policy.minScore === undefined ? 0 : policy.minScore;
	if (typeof minScore !== "number" || !Number.isFinite(minScore) || minScore < 0 || minScore > 1) {
		throw new DecisionPolicyError("Decision policy minScore must be a finite number from 0 to 1.");
	}
	const tieBreaker = policy.tieBreaker === undefined ? "candidate-id" : policy.tieBreaker;
	if (tieBreaker !== "candidate-id" && tieBreaker !== "input-order") {
		throw new DecisionPolicyError('Decision policy tieBreaker must be "candidate-id" or "input-order".');
	}
	return { signals, totalWeight, minScore, tieBreaker };
}

function validateCandidates(candidates: readonly DecisionCandidate[]): void {
	if (!Array.isArray(candidates)) {
		throw new DecisionPolicyError("Decision candidates must be an array.");
	}
	const seen = new Set<string>();
	for (const candidate of candidates) {
		if (candidate === null || typeof candidate !== "object") {
			throw new DecisionPolicyError("Decision candidates must be objects.");
		}
		if (typeof candidate.id !== "string" || candidate.id === "") {
			throw new DecisionPolicyError("Every decision candidate requires a non-empty id.");
		}
		if (seen.has(candidate.id)) {
			throw new DecisionPolicyError(`Decision candidate "${candidate.id}" appears more than once.`);
		}
		seen.add(candidate.id);
		if (candidate.signals === null || typeof candidate.signals !== "object" || Array.isArray(candidate.signals)) {
			throw new DecisionPolicyError(`Decision candidate "${candidate.id}" requires a signals object.`);
		}
	}
}

function readSignal(candidate: DecisionCandidate, id: string): number | undefined {
	if (!Object.prototype.hasOwnProperty.call(candidate.signals, id)) return undefined;
	const value = candidate.signals[id];
	return typeof value === "number" && Number.isFinite(value) ? value : Number.NaN;
}

function rankCandidates(
	candidates: readonly ScoredCandidate[],
	tieBreaker: DecisionTieBreaker,
): readonly ScoredCandidate[] {
	const order = new Map<string, number>();
	for (const [index, candidate] of candidates.entries()) order.set(candidate.id, index);
	return [...candidates].sort((left, right) => {
		if (left.eligible !== right.eligible) return left.eligible ? -1 : 1;
		if (left.score !== right.score) return right.score - left.score;
		if (tieBreaker === "input-order") return (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0);
		return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
	});
}

/** Scores candidates and selects one, or fails closed when none meets the policy. */
export function evaluateDecisionCandidates(
	candidates: readonly DecisionCandidate[],
	policy: DecisionPolicy,
): DecisionOutcome {
	const { signals, totalWeight, minScore, tieBreaker } = validatePolicy(policy);
	validateCandidates(candidates);

	for (const signal of signals) {
		let min = Number.POSITIVE_INFINITY;
		let max = Number.NEGATIVE_INFINITY;
		for (const candidate of candidates) {
			const value = readSignal(candidate, signal.id);
			if (value === undefined || Number.isNaN(value)) continue;
			if (value < min) min = value;
			if (value > max) max = value;
		}
		const resolvedMin = min === Number.POSITIVE_INFINITY ? 0 : min;
		const resolvedMax = max === Number.NEGATIVE_INFINITY ? 0 : max;
		signal.min = resolvedMin;
		signal.max = resolvedMax;
	}

	const scored: ScoredCandidate[] = candidates.map(candidate => {
		const reasons: DecisionReason[] = [];
		let score = 0;
		let eligible = true;
		for (const signal of signals) {
			const raw = readSignal(candidate, signal.id);
			if (raw === undefined) {
				if (signal.required) {
					eligible = false;
					reasons.push({
						code: "missing-signal",
						signal: signal.id,
						message: `required signal "${signal.id}" is missing`,
					});
				} else {
					reasons.push({
						code: "missing-signal",
						signal: signal.id,
						normalized: 0,
						weight: signal.weight,
						contribution: 0,
						message: `optional signal "${signal.id}" is missing and counts as the minimum`,
					});
				}
				continue;
			}
			if (Number.isNaN(raw)) {
				eligible = false;
				reasons.push({
					code: "invalid-signal",
					signal: signal.id,
					message: `signal "${signal.id}" is not a finite number`,
				});
				continue;
			}
			const normalized =
				signal.max === signal.min
					? 1
					: signal.direction === "higher-is-better"
						? (raw - signal.min) / (signal.max - signal.min)
						: (signal.max - raw) / (signal.max - signal.min);
			const contribution = (signal.weight / totalWeight) * normalized;
			score += contribution;
			reasons.push({
				code: "signal",
				signal: signal.id,
				value: raw,
				normalized: roundScore(normalized),
				weight: signal.weight,
				contribution: roundScore(contribution),
				message:
					`${signal.id}=${raw} normalized=${roundScore(normalized).toFixed(6)} ` +
					`(${signal.direction}, weight ${signal.weight}/${totalWeight}) ` +
					`contribution=${roundScore(contribution).toFixed(6)}`,
			});
		}
		score = roundScore(score);
		if (eligible && score < minScore) {
			eligible = false;
			reasons.push({
				code: "below-min-score",
				message: `score ${score.toFixed(6)} is below minScore ${minScore.toFixed(6)}`,
			});
		}
		reasons.push({
			code: "score",
			message: `weighted score ${score.toFixed(6)}${eligible ? "" : " (ineligible)"}`,
		});
		return { id: candidate.id, score, eligible, reasons };
	});

	const eligible = scored.filter(candidate => candidate.eligible);
	if (eligible.length === 0) {
		return {
			selected: null,
			candidates: scored,
			reason:
				scored.length === 0
					? "No decision candidates were provided."
					: `No candidate met the policy (${scored.length} candidate(s) evaluated, minScore ${minScore.toFixed(6)}).`,
		};
	}

	const ranked = rankCandidates(eligible, tieBreaker);
	const selected = ranked[0]!;
	const topScore = selected.score;
	const tied = ranked.filter(candidate => candidate.score === topScore);
	const selectedReasons: DecisionReason[] = [
		{
			code: "selected",
			message: `selected with score ${topScore.toFixed(6)} among ${eligible.length} eligible candidate(s)`,
		},
	];
	if (tied.length > 1) {
		selectedReasons.push({
			code: "tie-break",
			message: `${tied.length} candidates tied at ${topScore.toFixed(6)}; ${tieBreaker} selected "${selected.id}"`,
		});
	}
	for (const candidate of scored) {
		if (candidate.id === selected.id) {
			candidate.reasons.push(...selectedReasons);
			continue;
		}
		const tiedAtTop = candidate.score === topScore && candidate.eligible;
		candidate.reasons.push({
			code: "not-selected",
			message: !candidate.eligible
				? "candidate is ineligible under the policy"
				: tiedAtTop
					? `tied at ${topScore.toFixed(6)} but lost the ${tieBreaker} tie-break`
					: `score ${candidate.score.toFixed(6)} was below selected score ${topScore.toFixed(6)}`,
		});
	}
	return {
		selected,
		candidates: scored,
		reason: `Selected "${selected.id}" with score ${topScore.toFixed(6)}.`,
	};
}
