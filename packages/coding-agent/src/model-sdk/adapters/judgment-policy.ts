/**
 * Decision-policy adapter for judge-role candidate selection.
 *
 * The judgment runtime already resolves an ordered candidate chain. This
 * helper makes the leading contiguous kind-run (prompted candidates before the
 * native tail, or the native tail itself) pass through the SDK's deterministic
 * candidate policy. Selection is explainable through the returned
 * {@link DecisionOutcome}; the native-only tail is never interleaved because
 * only candidates from that first kind-run are reordered.
 *
 * Disabled by default: the runtime opts in through `JudgeDeps.decisionPolicy`
 * or `ZETA_JUDGE_DECISION_POLICY=1`.
 */
import { type DecisionOutcome, type DecisionTieBreaker, evaluateDecisionCandidates } from "../decision-policy";

export interface JudgePolicyCandidate {
	readonly explicit: boolean;
	/** JudgeKind from the judgment runtime (`native`, `local`, or `online`). */
	readonly kind: string;
}

export interface JudgePolicyWeights {
	readonly attemptOrder: number;
	readonly explicit: number;
	readonly native: number;
}

export const DEFAULT_JUDGE_POLICY_WEIGHTS: JudgePolicyWeights = Object.freeze({
	attemptOrder: 1,
	explicit: 2,
	native: 1,
});

export interface JudgeCandidatePolicyOptions<T extends JudgePolicyCandidate = JudgePolicyCandidate> {
	readonly enabled?: boolean;
	readonly weights?: Partial<JudgePolicyWeights>;
	readonly tieBreaker?: DecisionTieBreaker;
	/** Stable candidate identity; defaults to a padded input index. */
	readonly idOf?: (candidate: T, index: number) => string;
}

export interface JudgeCandidateSelection<T extends JudgePolicyCandidate> {
	/** New attempt order, or the original array when disabled. */
	readonly candidates: readonly T[];
	readonly selected: T | undefined;
	/** Scoring reasons; `null` when disabled or when there are no candidates. */
	readonly outcome: DecisionOutcome | null;
}

function leadingKindRunLength(candidates: readonly JudgePolicyCandidate[]): number {
	if (candidates.length === 0) return 0;
	const kind = candidates[0]!.kind;
	const boundary = candidates.findIndex(candidate => candidate.kind !== kind);
	return boundary < 0 ? candidates.length : boundary;
}

/**
 * Ranks the first contiguous candidate-kind run. With `enabled: false` the
 * input order is returned untouched; with no candidates the result is empty
 * and no policy is evaluated. Scoring failures (e.g. all-zero weights) throw
 * the same `DecisionPolicyError` as `evaluateDecisionCandidates`.
 */
export function selectJudgeCandidates<T extends JudgePolicyCandidate>(
	candidates: readonly T[],
	options: JudgeCandidatePolicyOptions<T> = {},
): JudgeCandidateSelection<T> {
	if (options.enabled !== true || candidates.length === 0) {
		return { candidates, selected: undefined, outcome: null };
	}
	const runLength = leadingKindRunLength(candidates);
	const run = candidates.slice(0, runLength);
	const weights = {
		...DEFAULT_JUDGE_POLICY_WEIGHTS,
		...options.weights,
	};
	const idOf = options.idOf ?? ((_candidate: T, index: number) => `candidate-${String(index).padStart(4, "0")}`);
	const entries = run.map((candidate, index) => ({
		candidate,
		id: idOf(candidate, index),
		signals: {
			"attempt-order": index,
			explicit: candidate.explicit ? 1 : 0,
			native: candidate.kind === "native" ? 1 : 0,
		},
	}));
	const outcome = evaluateDecisionCandidates(
		entries.map(entry => ({ id: entry.id, signals: entry.signals })),
		{
			signals: [
				{
					id: "attempt-order",
					weight: weights.attemptOrder,
					direction: "lower-is-better",
					required: true,
				},
				{ id: "explicit", weight: weights.explicit, direction: "higher-is-better", required: true },
				{ id: "native", weight: weights.native, direction: "higher-is-better", required: true },
			],
			tieBreaker: options.tieBreaker ?? "input-order",
		},
	);
	const selectedId = outcome.selected?.id;
	const selectedIndex = selectedId === undefined ? -1 : entries.findIndex(entry => entry.id === selectedId);
	if (selectedIndex < 0) {
		return { candidates, selected: undefined, outcome };
	}
	const selectedEntry = entries[selectedIndex]!;
	const reorderedRun = [selectedEntry.candidate, ...run.filter((_candidate, index) => index !== selectedIndex)];
	return {
		candidates: [...reorderedRun, ...candidates.slice(runLength)],
		selected: selectedEntry.candidate,
		outcome,
	};
}
