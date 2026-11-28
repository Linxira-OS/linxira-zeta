import { describe, expect, it } from "bun:test";
import { buildModel } from "@linxiraos/pi-catalog/build";
import type { Model } from "@linxiraos/pi-ai";
import { orderJudgeRoleCandidates } from "@linxiraos/zeta/judgment";
import type { RoleChainCandidate } from "@linxiraos/zeta/config/model-resolver";
import { DEFAULT_JUDGE_POLICY_WEIGHTS, selectJudgeCandidates } from "@linxiraos/zeta/model-sdk";

function testModel(id: string, api = "openai-completions"): Model {
	return buildModel({
		id,
		name: id,
		api,
		provider: "test",
		baseUrl: "https://api.test",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1000,
		maxTokens: 100,
	});
}

function candidate(id: string, explicit: boolean, api?: string): RoleChainCandidate {
	return { model: testModel(id, api), explicit };
}

describe("judge decision-policy adapter", () => {
	it("selects the explainable best candidate in the leading judge-kind run", () => {
		const entries = [
			{ id: "first", explicit: false, kind: "online" },
			{ id: "second", explicit: true, kind: "online" },
			{ id: "native-first", explicit: false, kind: "native" },
			{ id: "native-second", explicit: true, kind: "native" },
		];
		const selection = selectJudgeCandidates(entries, { enabled: true, idOf: entry => entry.id });

		expect(selection.selected?.id).toBe("second");
		expect(selection.candidates.map(entry => entry.id)).toEqual(["second", "first", "native-first", "native-second"]);
		expect(selection.outcome?.selected?.reasons).toContainEqual(expect.objectContaining({ code: "selected" }));
		expect(selection.outcome?.selected?.reasons).toContainEqual(
			expect.objectContaining({ code: "signal", signal: "explicit", value: 1 }),
		);
		expect(selection.outcome?.candidates.find(entry => entry.id === "first")?.reasons).toContainEqual(
			expect.objectContaining({ code: "not-selected" }),
		);
	});

	it("leaves attempt order and outcome untouched while the feature is disabled", () => {
		const entries = [
			{ id: "first", explicit: false, kind: "online" },
			{ id: "second", explicit: true, kind: "online" },
		];
		const selection = selectJudgeCandidates(entries, { enabled: false, idOf: entry => entry.id });
		expect(selection.candidates).toBe(entries);
		expect(selection.selected).toBeUndefined();
		expect(selection.outcome).toBeNull();
	});

	it("keeps attempt order when the explicit weight is zero", () => {
		const entries = [
			{ id: "first", explicit: false, kind: "online" },
			{ id: "second", explicit: true, kind: "online" },
		];
		const selection = selectJudgeCandidates(entries, {
			enabled: true,
			idOf: entry => entry.id,
			weights: { ...DEFAULT_JUDGE_POLICY_WEIGHTS, explicit: 0 },
		});
		expect(selection.selected?.id).toBe("first");
		expect(selection.candidates.map(entry => entry.id)).toEqual(["first", "second"]);
	});

	it("is deterministic across repeated evaluations", () => {
		const entries = [
			{ id: "a", explicit: true, kind: "online" },
			{ id: "b", explicit: false, kind: "online" },
			{ id: "c", explicit: true, kind: "online" },
		];
		const first = selectJudgeCandidates(entries, { enabled: true, idOf: entry => entry.id });
		const second = selectJudgeCandidates(entries, { enabled: true, idOf: entry => entry.id });
		expect(second).toEqual(first);
		expect(first.selected?.id).toBe("a");
	});
});

describe("judgment call-site wiring", () => {
	it("reorders the resolved judge candidates through the SDK policy when enabled", () => {
		const candidates = [candidate("primary", false), candidate("configured", true)];
		expect(orderJudgeRoleCandidates(candidates, true).map(entry => entry.model.id)).toEqual([
			"configured",
			"primary",
		]);
		expect(orderJudgeRoleCandidates(candidates, false)).toBe(candidates);
	});

	it("preserves the native-only tail while selecting an earlier prompted candidate", () => {
		const candidates = [
			candidate("online-primary", false),
			candidate("online-configured", true),
			candidate("native-primary", false, "typesafe"),
			candidate("native-configured", true, "typesafe"),
		];
		const ordered = orderJudgeRoleCandidates(candidates, true);
		expect(ordered.map(entry => entry.model.id)).toEqual([
			"online-configured",
			"online-primary",
			"native-primary",
			"native-configured",
		]);
	});
});
