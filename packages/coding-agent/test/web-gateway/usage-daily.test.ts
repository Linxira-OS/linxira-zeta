/**
 * `GET /api/usage/daily` — the Studio home card's usage series.
 *
 * The card draws a calendar-year heatmap from `days`, a per-model curve whose
 * legend is `models`, and a 24-hour strip from `hours`. Two properties matter
 * and are pinned here:
 *
 * - the legend is the year's top five models plus one `other` bucket, and
 *   `byModel`/`hours` never name a model outside it (the renderer drops
 *   unknown ids, so a missing fold would silently lose their tokens);
 * - a day/hour without usage is absent, not zeroed, and a read that produced
 *   nothing states why instead of rendering an empty card.
 */
import { describe, expect, test } from "bun:test";
import {
	buildUsageDaily,
	handleUsageDaily,
	USAGE_EMPTY_REASON,
	USAGE_OTHER_MODEL,
	type UsageDailySource,
} from "../../src/server/web-gateway/usage-daily";

/** Mid-year instant: the year-to-date cut is unambiguous in every timezone. */
const NOW = new Date(2026, 5, 15, 12).getTime();

function source(overrides: Partial<UsageDailySource> = {}): UsageDailySource {
	return { days: [], byModelDay: [], todayByHour: [], ...overrides };
}

/** One day of `model` usage at `tokens`. */
function modelDay(day: string, model: string, tokens: number) {
	return { day, model, totalTokens: tokens };
}

describe("buildUsageDaily", () => {
	test("carries the sparse daily totals through as date/token points", () => {
		const usage = buildUsageDaily(
			source({
				days: [
					{ day: "2026-06-13", totalTokens: 120 },
					{ day: "2026-06-14", totalTokens: 80 },
				],
			}),
			NOW,
		);
		expect(usage.days).toEqual([
			{ date: "2026-06-13", totalTokens: 120 },
			{ date: "2026-06-14", totalTokens: 80 },
		]);
		expect(usage.unavailableReason).toBeUndefined();
	});

	test("keeps the year's top five models and folds every other model into one bucket per day", () => {
		const usage = buildUsageDaily(
			source({
				byModelDay: [
					modelDay("2026-01-05", "alpha", 100),
					modelDay("2026-02-01", "beta", 90),
					modelDay("2026-03-01", "gamma", 80),
					modelDay("2026-04-01", "delta", 70),
					modelDay("2026-05-01", "epsilon", 60),
					modelDay("2026-06-01", "zeta", 50),
					modelDay("2026-06-02", "eta", 40),
					modelDay("2026-06-03", "theta", 30),
					// Last year: outside the year-to-date legend and series.
					modelDay("2025-12-31", "alpha", 9_999),
				],
			}),
			NOW,
		);

		expect(usage.models).toEqual([
			{ id: "alpha" },
			{ id: "beta" },
			{ id: "gamma" },
			{ id: "delta" },
			{ id: "epsilon" },
			{ id: USAGE_OTHER_MODEL },
		]);
		// Every model outside the legend lands in `other` on its own day.
		expect(usage.byModel).toEqual([
			{ date: "2026-01-05", model: "alpha", tokens: 100 },
			{ date: "2026-02-01", model: "beta", tokens: 90 },
			{ date: "2026-03-01", model: "gamma", tokens: 80 },
			{ date: "2026-04-01", model: "delta", tokens: 70 },
			{ date: "2026-05-01", model: "epsilon", tokens: 60 },
			{ date: "2026-06-01", model: USAGE_OTHER_MODEL, tokens: 50 },
			{ date: "2026-06-02", model: USAGE_OTHER_MODEL, tokens: 40 },
			{ date: "2026-06-03", model: USAGE_OTHER_MODEL, tokens: 30 },
		]);
		// The prior year's rows never leak into the year-to-date series.
		expect(usage.byModel.some(point => point.date === "2025-12-31")).toBe(false);
		expect(usage.byModel.some(point => point.tokens === 9_999)).toBe(false);
	});

	test("ranks ties by model id so the legend is stable across reads", () => {
		const usage = buildUsageDaily(
			source({
				byModelDay: [modelDay("2026-06-01", "zulu", 10), modelDay("2026-06-01", "alpha", 10)],
			}),
			NOW,
		);
		expect(usage.models).toEqual([{ id: "alpha" }, { id: "zulu" }]);
	});

	test("sums one other row per day and per hour, ordered by date and hour", () => {
		const ranked = ["alpha", "beta", "gamma", "delta", "epsilon"];
		const usage = buildUsageDaily(
			source({
				byModelDay: [
					...ranked.map((model, index) => modelDay("2026-06-01", model, 1_000 - index * 100)),
					modelDay("2026-06-14", "alpha", 5),
					modelDay("2026-06-14", "minor-a", 2),
					modelDay("2026-06-14", "minor-b", 3),
				],
				todayByHour: [
					{ hour: 9, model: "minor-a", totalTokens: 4 },
					{ hour: 9, model: "minor-b", totalTokens: 6 },
					{ hour: 9, model: "alpha", totalTokens: 1 },
					{ hour: 7, model: "alpha", totalTokens: 2 },
				],
			}),
			NOW,
		);
		// Two models outside the top five collapse into one row per day.
		// Same token total, so the tie-break decides: ids compare by code unit
		// (deterministic across locales), and "alpha" sorts before the other bucket.
		expect(usage.byModel.filter(point => point.date === "2026-06-14")).toEqual([
			{ date: "2026-06-14", model: "alpha", tokens: 5 },
			{ date: "2026-06-14", model: USAGE_OTHER_MODEL, tokens: 5 },
		]);
		expect(usage.hours).toEqual([
			{ hour: 7, model: "alpha", tokens: 2 },
			{ hour: 9, model: "alpha", tokens: 1 },
			{ hour: 9, model: USAGE_OTHER_MODEL, tokens: 10 },
		]);
	});

	test("says why the card is empty instead of showing a silent zero", () => {
		const usage = buildUsageDaily(source(), NOW);
		expect(usage.days).toEqual([]);
		expect(usage.models).toEqual([]);
		expect(usage.byModel).toEqual([]);
		expect(usage.hours).toEqual([]);
		expect(usage.unavailableReason).toBe(USAGE_EMPTY_REASON);
	});
});

describe("GET /api/usage/daily", () => {
	test("answers the shaped series for the injected reader", async () => {
		const response = await handleUsageDaily(NOW, async () =>
			source({
				days: [{ day: "2026-06-15", totalTokens: 42 }],
				byModelDay: [modelDay("2026-06-15", "solo", 42)],
				todayByHour: [{ hour: 11, model: "solo", totalTokens: 42 }],
			}),
		);
		expect(response.status).toBe(200);
		const body = (await response.json()) as Record<string, unknown>;
		expect(body).toEqual({
			generatedAt: new Date(NOW).toISOString(),
			days: [{ date: "2026-06-15", totalTokens: 42 }],
			models: [{ id: "solo" }],
			byModel: [{ date: "2026-06-15", model: "solo", tokens: 42 }],
			hours: [{ hour: 11, model: "solo", tokens: 42 }],
		});
	});

	test("answers an empty card with the read failure attached", async () => {
		const response = await handleUsageDaily(NOW, async () => {
			throw new Error("database is locked");
		});
		expect(response.status).toBe(200);
		const body = (await response.json()) as { days: unknown[]; unavailableReason?: string };
		expect(body.days).toEqual([]);
		expect(body.unavailableReason).toContain("database is locked");
	});
});
