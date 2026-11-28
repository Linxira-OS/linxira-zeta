import { describe, expect, it } from "bun:test";
import {
	DecisionPolicyError,
	evaluateDecisionCandidates,
	type DecisionCandidate,
	type DecisionPolicy,
} from "@linxiraos/zeta/model-sdk";

function candidates(): DecisionCandidate[] {
	return [
		{ id: "b", signals: { quality: 5, cost: 5 } },
		{ id: "a", signals: { quality: 10, cost: 1 } },
		{ id: "c", signals: { quality: 7, cost: 3 } },
	];
}

const policy: DecisionPolicy = {
	signals: [
		{ id: "quality", weight: 3, direction: "higher-is-better" },
		{ id: "cost", weight: 1, direction: "lower-is-better" },
	],
	minScore: 0.5,
	tieBreaker: "candidate-id",
};

describe("decision candidate policy", () => {
	it("scores declared signals deterministically with explicit weights and reasons", () => {
		const first = evaluateDecisionCandidates(candidates(), policy);
		const second = evaluateDecisionCandidates(candidates(), policy);
		expect(second).toEqual(first);

		expect(first.selected?.id).toBe("a");
		expect(first.reason).toBe('Selected "a" with score 1.000000.');

		const a = first.candidates.find(candidate => candidate.id === "a")!;
		expect(a.score).toBe(1);
		expect(a.eligible).toBe(true);
		const quality = a.reasons.find(reason => reason.signal === "quality")!;
		expect(quality).toMatchObject({
			code: "signal",
			value: 10,
			normalized: 1,
			weight: 3,
			contribution: 0.75,
		});
		const cost = a.reasons.find(reason => reason.signal === "cost")!;
		expect(cost).toMatchObject({
			code: "signal",
			value: 1,
			normalized: 1,
			weight: 1,
			contribution: 0.25,
		});
		expect(a.reasons.some(reason => reason.code === "selected")).toBe(true);

		const b = first.candidates.find(candidate => candidate.id === "b")!;
		expect(b.score).toBe(0);
		expect(b.eligible).toBe(false);
		expect(b.reasons).toContainEqual(expect.objectContaining({ code: "below-min-score" }));
		expect(b.reasons).toContainEqual(expect.objectContaining({ code: "not-selected" }));
	});

	it("breaks ties deterministically by candidate id or input order", () => {
		const tied: DecisionCandidate[] = [
			{ id: "z", signals: { quality: 4, cost: 2 } },
			{ id: "a", signals: { quality: 4, cost: 2 } },
		];
		const byId = evaluateDecisionCandidates(tied, {
			signals: [
				{ id: "quality", weight: 1 },
				{ id: "cost", weight: 1, direction: "lower-is-better" },
			],
			tieBreaker: "candidate-id",
		});
		expect(byId.selected?.id).toBe("a");
		expect(byId.selected?.reasons).toContainEqual(expect.objectContaining({ code: "tie-break" }));

		const byInput = evaluateDecisionCandidates(tied, {
			signals: [
				{ id: "quality", weight: 1 },
				{ id: "cost", weight: 1, direction: "lower-is-better" },
			],
			tieBreaker: "input-order",
		});
		expect(byInput.selected?.id).toBe("z");
	});

	it("fails closed when no candidate meets the policy", () => {
		const outcome = evaluateDecisionCandidates(
			[
				{ id: "p", signals: { quality: 10, cost: 5 } },
				{ id: "q", signals: { quality: 5, cost: 1 } },
			],
			{
				...policy,
				minScore: 0.8,
			},
		);
		expect(outcome.selected).toBeNull();
		expect(outcome.reason).toContain("No candidate met the policy");
		expect(outcome.candidates.every(candidate => candidate.eligible === false)).toBe(true);
		expect(
			outcome.candidates.every(candidate => candidate.reasons.some(reason => reason.code === "below-min-score")),
		).toBe(true);

		const missing = evaluateDecisionCandidates([{ id: "only", signals: { cost: 1 } }], {
			signals: [{ id: "quality", weight: 1 }],
			minScore: 0,
		});
		expect(missing.selected).toBeNull();
		expect(missing.reason).toContain("No candidate met the policy");
		expect(missing.candidates[0]!.reasons).toContainEqual(
			expect.objectContaining({ code: "missing-signal", signal: "quality" }),
		);
	});

	it("counts a missing optional signal as the minimum but keeps the candidate eligible", () => {
		const outcome = evaluateDecisionCandidates(
			[
				{ id: "full", signals: { quality: 5, cost: 5 } },
				{ id: "partial", signals: { quality: 10 } },
			],
			{
				signals: [
					{ id: "quality", weight: 2 },
					{ id: "cost", weight: 1, direction: "lower-is-better", required: false },
				],
				minScore: 0,
			},
		);
		expect(outcome.selected?.id).toBe("partial");
		expect(outcome.selected?.score).toBe(0.666667);
		expect(outcome.selected?.reasons).toContainEqual(
			expect.objectContaining({ code: "missing-signal", signal: "cost", normalized: 0 }),
		);
	});

	it("marks non-finite candidate signals ineligible instead of coercing them", () => {
		const outcome = evaluateDecisionCandidates(
			[
				{ id: "bad", signals: { quality: Number.NaN } },
				{ id: "good", signals: { quality: 1 } },
			],
			{ signals: [{ id: "quality", weight: 1 }] },
		);
		expect(outcome.selected?.id).toBe("good");
		expect(outcome.candidates.find(candidate => candidate.id === "bad")).toMatchObject({
			eligible: false,
		});
		expect(outcome.candidates.find(candidate => candidate.id === "bad")!.reasons).toContainEqual(
			expect.objectContaining({ code: "invalid-signal", signal: "quality" }),
		);
	});

	it("rejects malformed policies and duplicate candidates", () => {
		const invalid = (value: DecisionPolicy) =>
			expect(() => evaluateDecisionCandidates([{ id: "a", signals: {} }], value)).toThrow(DecisionPolicyError);
		invalid({ signals: [] });
		invalid({ signals: [{ id: "q", weight: 0 }] });
		invalid({ signals: [{ id: "q", weight: -1 }] });
		invalid({
			signals: [
				{ id: "q", weight: 1 },
				{ id: "q", weight: 1 },
			],
		});
		invalid({ signals: [{ id: "q", weight: 1 }], minScore: 2 });
		invalid({ signals: [{ id: "q", weight: 1 }], tieBreaker: "random" as never });
		expect(() =>
			evaluateDecisionCandidates(
				[
					{ id: "a", signals: {} },
					{ id: "a", signals: {} },
				],
				{ signals: [{ id: "q", weight: 1 }] },
			),
		).toThrow(DecisionPolicyError);
	});
});
