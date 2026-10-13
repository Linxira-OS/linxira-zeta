/**
 * Pure derivation + formatting for the context-statistics panel.
 *
 * Everything here takes the gateway report and returns plain numbers, so the
 * ring, the composition bar and the legend can never disagree: the shares are
 * computed once, in one place, and unit-tested without a DOM.
 */

import {
	CONTEXT_CATEGORY_IDS,
	type ContextCategoryId,
	type ContextUsageReport,
} from "./types";

/** Ring tone, driven by proximity to the auto-compaction threshold. */
export type ContextTone = "ok" | "near" | "full";

export interface ContextCategorySlice {
	id: ContextCategoryId;
	tokens: number;
	/** Width of this slice on a 0-100 window axis (already scaled to `usedTokens`). */
	windowPercent: number;
	/** Share of the used context, 0-1. */
	usedShare: number;
}

/** Membership table for the category ids this panel can render. */
const KNOWN_CATEGORY: Record<ContextCategoryId, true> = {
	systemPrompt: true,
	systemTools: true,
	systemContext: true,
	skills: true,
	messages: true,
};

/** Clamp into 0-100, mapping non-finite input to 0. */
export function clampPercent(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.min(100, Math.max(0, value));
}

/** Non-negative, finite count (rounding artifacts otherwise leak into the UI). */
export function nonNegativeCount(value: number | null | undefined): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
	return value;
}

/**
 * Panel headline percentage. Uses the report's own `percent` when the window is
 * known, otherwise recomputes and clamps so a stale/partial payload still
 * renders a sane ring.
 */
export function usedWindowPercent(report: Pick<ContextUsageReport, "percent" | "usedTokens" | "contextWindow">): number {
	const contextWindow = nonNegativeCount(report.contextWindow);
	if (contextWindow > 0) {
		const derived = (nonNegativeCount(report.usedTokens) / contextWindow) * 100;
		return clampPercent(Number.isFinite(report.percent) ? report.percent : derived);
	}
	return 0;
}

/**
 * Composition slices in legend order.
 *
 * The gateway's category split is an estimate of the same total the ring shows,
 * so the slices are normalized onto `usedTokens` before being placed on the
 * window axis — the bar's total width then always equals the ring's reading.
 * Unknown ids are dropped (forward-compat) and an empty/all-zero split yields
 * an empty array, which the renderer draws as a single neutral bar.
 */
export function categorySlices(
	report: Pick<ContextUsageReport, "categories" | "usedTokens" | "contextWindow" | "percent">,
): ContextCategorySlice[] {
	const reported = new Map<ContextCategoryId, number>();
	for (const category of report.categories ?? []) {
		if (KNOWN_CATEGORY[category.id] !== true) continue;
		reported.set(category.id, nonNegativeCount(category.tokens));
	}
	const total = [...reported.values()].reduce((sum, tokens) => sum + tokens, 0);
	if (total <= 0) return [];

	const windowShare = usedWindowPercent(report) / total;
	return CONTEXT_CATEGORY_IDS.flatMap(id => {
		const tokens = reported.get(id) ?? 0;
		if (tokens <= 0) return [];
		return [
			{
				id,
				tokens,
				windowPercent: tokens * windowShare,
				usedShare: tokens / total,
			},
		];
	});
}

/**
 * Ring/bar tone from the occupancy and the auto-compaction threshold.
 *
 * With a threshold the two warning bands are relative to it (Reasonix's
 * `contextWindowStatus`): at/over the threshold the next turn may compact, and
 * within 10 points below it is "watch". Without a threshold (compaction off or
 * window unknown) the bands fall back to fixed 90/70 points.
 */
export function toneForUsage(percent: number, thresholdPercent: number | null | undefined): ContextTone {
	const occupancy = clampPercent(percent);
	const threshold = nonNegativeCount(thresholdPercent ?? 0);
	if (threshold > 0) {
		if (occupancy >= threshold) return "full";
		if (occupancy >= Math.max(0, threshold - 10)) return "near";
		return "ok";
	}
	if (occupancy >= 90) return "full";
	if (occupancy >= 70) return "near";
	return "ok";
}

/** Compact token count for the ring centre: `973`, `12.4k`, `1.2M`. */
export function formatTokensCompact(tokens: number): string {
	const value = nonNegativeCount(tokens);
	if (value < 1_000) return String(Math.round(value));
	const scaled = value < 1_000_000 ? (value / 1_000).toFixed(1) : (value / 1_000_000).toFixed(1);
	const suffix = value < 1_000_000 ? "k" : "M";
	return `${scaled.endsWith(".0") ? scaled.slice(0, -2) : scaled}${suffix}`;
}

/** Grouped exact count for the detail rows, in the panel's locale. */
export function formatTokensExact(tokens: number, locale: string): string {
	const value = Math.round(nonNegativeCount(tokens));
	try {
		return new Intl.NumberFormat(locale).format(value);
	} catch {
		return String(value);
	}
}

/**
 * Prompt-cache hit rate in percent, or null when the provider reported no
 * cache accounting. `session-stats` keeps cached reads out of `input`, so the
 * denominator is `cacheRead + input` (misses are the uncached prompt tokens).
 */
export function cacheHitRate(usage: ContextUsageReport["usage"] | null | undefined): number | null {
	if (!usage) return null;
	const read = nonNegativeCount(usage.cacheRead);
	const uncached = nonNegativeCount(usage.input);
	const total = read + uncached;
	if (total <= 0) return null;
	return (read / total) * 100;
}

/**
 * Provider spend in USD, matching the CLI's `/session` cost row (4 decimals,
 * `$0.0123`). `session-stats` sums `usage.cost.total`, which every provider
 * prices in USD, so no currency code travels with the report.
 */
export function formatCostUsd(cost: number, locale: string): string {
	try {
		return new Intl.NumberFormat(locale, {
			style: "currency",
			currency: "USD",
			minimumFractionDigits: 4,
			maximumFractionDigits: 4,
		}).format(nonNegativeCount(cost));
	} catch {
		return `$${nonNegativeCount(cost).toFixed(4)}`;
	}
}

/** SVG `stroke-dashoffset` for a 0-100 reading on a track of `circumference`. */
export function ringDashOffset(percent: number, circumference: number): number {
	if (!Number.isFinite(circumference) || circumference <= 0) return 0;
	return circumference * (1 - clampPercent(percent) / 100);
}

/**
 * Marker position (0-100 window axis) for the auto-compaction threshold, or
 * null when there is none to draw. Falls back to `thresholdTokens` when the
 * provider-supplied percentage is missing.
 */
export function compactionMarkerPercent(
	report: Pick<ContextUsageReport, "compaction" | "contextWindow">,
): number | null {
	const contextWindow = nonNegativeCount(report.contextWindow);
	const compaction = report.compaction;
	if (!compaction || compaction.thresholdTokens === null) return null;
	const percent = nonNegativeCount(compaction.thresholdPercent ?? 0);
	if (percent > 0) return clampPercent(percent);
	if (contextWindow <= 0) return null;
	return clampPercent((nonNegativeCount(compaction.thresholdTokens) / contextWindow) * 100);
}
