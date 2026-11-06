/**
 * `usage.get` — the Studio operation that feeds the home usage card.
 *
 * The gateway route owns the aggregation; this operation only validates the
 * `/api/usage/daily` answer and maps it onto the contract read model. Two
 * failure modes are worth pinning: a renamed/missing array must fail loudly
 * (an empty card would look like "no usage"), while one malformed point must
 * not blank the rest of the heatmap. The op is also what advertises the
 * surface, so the manifest entry is asserted alongside the mapping.
 */
import { describe, expect, test } from "bun:test";
import { StudioOpError } from "../../src/server/studio-host/gateway";
import { usageDailyReadModel, usageOps } from "../../src/server/studio-host/ops/usage";

const NOW = new Date(2026, 5, 15, 12).getTime();

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		generatedAt: new Date(NOW).toISOString(),
		days: [{ date: "2026-06-15", totalTokens: 42 }],
		models: [{ id: "alpha" }],
		byModel: [{ date: "2026-06-15", model: "alpha", tokens: 42 }],
		hours: [{ hour: 11, model: "alpha", tokens: 42 }],
		...overrides,
	};
}

describe("usage.get mapping", () => {
	test("maps the route's series field for field", () => {
		expect(usageDailyReadModel(payload())).toEqual({
			generatedAt: new Date(NOW).toISOString(),
			days: [{ date: "2026-06-15", totalTokens: 42 }],
			models: [{ id: "alpha" }],
			byModel: [{ date: "2026-06-15", model: "alpha", tokens: 42 }],
			hours: [{ hour: 11, model: "alpha", tokens: 42 }],
		});
	});

	test("keeps an honest reason and drops the field when the route had data", () => {
		const failed = usageDailyReadModel(payload({ unavailableReason: "database is locked" }));
		expect(failed.unavailableReason).toBe("database is locked");
		expect(usageDailyReadModel(payload()).unavailableReason).toBeUndefined();
	});

	test("drops malformed points instead of rendering NaN", () => {
		const model = usageDailyReadModel(
			payload({
				days: [{ date: "2026-06-15", totalTokens: 42 }, { date: "2026-06-14" }, null],
				hours: [
					{ hour: 11, model: "alpha", tokens: 7 },
					{ hour: "11", model: "alpha", tokens: 7 },
				],
			}),
		);
		expect(model.days).toEqual([{ date: "2026-06-15", totalTokens: 42 }]);
		expect(model.hours).toEqual([{ hour: 11, model: "alpha", tokens: 7 }]);
	});

	test("refuses an answer that is not the route's shape", () => {
		for (const missing of ["days", "models", "byModel", "hours"] as const) {
			const body = payload();
			delete body[missing];
			expect(() => usageDailyReadModel(body)).toThrow(StudioOpError);
		}
		expect(() => usageDailyReadModel(null)).toThrow(StudioOpError);
		expect(() => usageDailyReadModel(payload({ byModel: "nope" }))).toThrow("/api/usage/daily");
	});
});

describe("usage family surface", () => {
	test("advertises usage.get and the dashboard command", () => {
		expect(Object.keys(usageOps.queries ?? {})).toContain("usage.get");
		expect(Object.keys(usageOps.commands ?? {})).toContain("usage.openDashboard");
	});
});
