import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
	jsx: { runtime: "automatic" },
	tsconfigPaths: true,
});
const model = await jiti.import("@/components/context-ring/context-ring-model");

const {
	cacheHitRate,
	categorySlices,
	clampPercent,
	compactionMarkerPercent,
	formatCostUsd,
	formatTokensCompact,
	formatTokensExact,
	nonNegativeCount,
	ringDashOffset,
	toneForUsage,
	usedWindowPercent,
} = model;

/** Minimal report factory: only the fields each test needs. */
function report(overrides = {}) {
	return {
		sessionId: "s1",
		model: { provider: "anthropic", modelId: "claude" },
		contextWindow: 200_000,
		usedTokens: 50_000,
		percent: 25,
		categories: [
			{ id: "systemPrompt", tokens: 2_000 },
			{ id: "systemTools", tokens: 8_000 },
			{ id: "systemContext", tokens: 0 },
			{ id: "skills", tokens: 5_000 },
			{ id: "messages", tokens: 35_000 },
		],
		freeTokens: 120_000,
		autoCompactBufferTokens: 30_000,
		compaction: {
			enabled: true,
			thresholdTokens: 170_000,
			thresholdPercent: 85,
			speculationPercent: 75,
		},
		usage: { input: 1_000, output: 2_000, reasoning: 100, cacheRead: 3_000, cacheWrite: 500, total: 6_600 },
		calls: {
			userMessages: 3,
			assistantMessages: 4,
			toolCalls: 9,
			toolResults: 9,
			totalMessages: 16,
			premiumRequests: 0,
		},
		cost: 0.0123,
		routedModels: null,
		...overrides,
	};
}

test("clampPercent bounds and maps non-finite input to 0", () => {
	assert.equal(clampPercent(-5), 0);
	assert.equal(clampPercent(42.5), 42.5);
	assert.equal(clampPercent(140), 100);
	assert.equal(clampPercent(Number.NaN), 0);
});

test("nonNegativeCount rejects zero, negatives, NaN and null", () => {
	assert.equal(nonNegativeCount(0), 0);
	assert.equal(nonNegativeCount(-3), 0);
	assert.equal(nonNegativeCount(Number.NaN), 0);
	assert.equal(nonNegativeCount(null), 0);
	assert.equal(nonNegativeCount(undefined), 0);
	assert.equal(nonNegativeCount(7), 7);
});

test("usedWindowPercent prefers the reported percent and clamps it", () => {
	assert.equal(usedWindowPercent(report()), 25);
	assert.equal(usedWindowPercent(report({ percent: 140 })), 100);
	assert.equal(usedWindowPercent(report({ percent: Number.NaN, usedTokens: 20_000 })), 10);
});

test("usedWindowPercent is 0 when the window is unknown", () => {
	assert.equal(usedWindowPercent(report({ contextWindow: 0, percent: 25 })), 0);
});

test("categorySlices keeps only reported categories, in canonical order", () => {
	const slices = categorySlices(report());
	assert.deepEqual(
		slices.map(slice => slice.id),
		["systemPrompt", "systemTools", "skills", "messages"],
	);
	assert.deepEqual(
		slices.map(slice => slice.tokens),
		[2_000, 8_000, 5_000, 35_000],
	);
});

test("categorySlices normalises onto usedTokens and the window axis", () => {
	const slices = categorySlices(report());
	const width = slices.reduce((sum, slice) => sum + slice.windowPercent, 0);
	// 50k used of a 200k window = 25% of the axis, exactly the ring reading.
	assert.ok(Math.abs(width - 25) < 1e-9, `expected 25, got ${width}`);
	assert.ok(Math.abs(slices[0].usedShare - 0.04) < 1e-9);
});

test("categorySlices drops unknown ids and returns [] for an empty split", () => {
	const withUnknown = categorySlices(
		report({ categories: [{ id: "promptCache", tokens: 1_000 }, { id: "messages", tokens: 1_000 }] }),
	);
	assert.deepEqual(
		withUnknown.map(slice => slice.id),
		["messages"],
	);
	assert.deepEqual(categorySlices(report({ categories: [] })), []);
	assert.deepEqual(
		categorySlices(report({ categories: [{ id: "messages", tokens: 0 }] })),
		[],
	);
});

test("toneForUsage uses threshold-relative bands when a threshold exists", () => {
	assert.equal(toneForUsage(10, 85), "ok");
	assert.equal(toneForUsage(74, 85), "ok");
	assert.equal(toneForUsage(75, 85), "near");
	assert.equal(toneForUsage(85, 85), "full");
	assert.equal(toneForUsage(99, 85), "full");
});

test("toneForUsage falls back to fixed bands without a threshold", () => {
	assert.equal(toneForUsage(50, null), "ok");
	assert.equal(toneForUsage(70, null), "near");
	assert.equal(toneForUsage(90, null), "full");
	// A disabled compaction reports 0, which must not read as "at the threshold".
	assert.equal(toneForUsage(30, 0), "ok");
});

test("formatTokensCompact shortens thousands and millions", () => {
	assert.equal(formatTokensCompact(0), "0");
	assert.equal(formatTokensCompact(973), "973");
	assert.equal(formatTokensCompact(12_400), "12.4k");
	assert.equal(formatTokensCompact(2_000), "2k");
	assert.equal(formatTokensCompact(1_200_000), "1.2M");
});

test("formatTokensExact groups by locale", () => {
	assert.equal(formatTokensExact(12_345, "en"), "12,345");
	assert.equal(formatTokensExact(-5, "en"), "0");
});

test("formatCostUsd keeps the CLI's four decimals", () => {
	assert.equal(formatCostUsd(0.0123, "en"), "$0.0123");
	assert.equal(formatCostUsd(0, "en"), "$0.0000");
});

test("cacheHitRate is null without cache accounting and reads the session pair otherwise", () => {
	assert.equal(cacheHitRate(null), null);
	assert.equal(cacheHitRate({ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 }), null);
	// 3000 cached reads over 3000 + 1000 uncached prompt tokens.
	assert.equal(cacheHitRate(report().usage), 75);
});

test("ringDashOffset maps the reading onto the circumference", () => {
	assert.equal(ringDashOffset(0, 100), 100);
	assert.equal(ringDashOffset(25, 100), 75);
	assert.equal(ringDashOffset(100, 100), 0);
	assert.equal(ringDashOffset(50, 0), 0);
});

test("compactionMarkerPercent uses the reported percent, then the token fallback", () => {
	assert.equal(compactionMarkerPercent(report()), 85);
	assert.equal(
		compactionMarkerPercent(
			report({ compaction: { enabled: true, thresholdTokens: 100_000, thresholdPercent: null } }),
		),
		50,
	);
	assert.equal(
		compactionMarkerPercent(report({ compaction: { enabled: false, thresholdTokens: null, thresholdPercent: null } })),
		null,
	);
});
