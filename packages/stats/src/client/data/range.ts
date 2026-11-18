/**
 * Time-range metadata shared by every page: labels, the server's bucket size
 * for the range (mirrors `getTimeRangeConfig` in `aggregator.ts`), tick
 * formatting, and the contiguous bucket axis charts plot against.
 */

import { getLocale, type MessageKey } from "../i18n";
import type { TimeRange } from "../types";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export interface RangeMeta {
	/** Short selector label ("24h"); translated so the selector reads in the host language. */
	labelKey: MessageKey;
	/** Prose label for subtitles ("the last 24 hours"). */
	windowKey: MessageKey;
	/** Span covered by the range; `null` for all time. */
	spanMs: number | null;
	/** Bucket size of the server's primary time series for this range. */
	bucketMs: number;
}

const RANGE_META: Record<TimeRange, RangeMeta> = {
	"1h": { labelKey: "common.range-1h", windowKey: "common.window-1h", spanMs: HOUR_MS, bucketMs: 5 * MINUTE_MS },
	"24h": { labelKey: "common.range-24h", windowKey: "common.window-24h", spanMs: DAY_MS, bucketMs: HOUR_MS },
	"7d": { labelKey: "common.range-7d", windowKey: "common.window-7d", spanMs: 7 * DAY_MS, bucketMs: DAY_MS },
	"30d": { labelKey: "common.range-30d", windowKey: "common.window-30d", spanMs: 30 * DAY_MS, bucketMs: DAY_MS },
	"90d": { labelKey: "common.range-90d", windowKey: "common.window-90d", spanMs: 90 * DAY_MS, bucketMs: DAY_MS },
	all: { labelKey: "common.range-all", windowKey: "common.window-all", spanMs: null, bucketMs: DAY_MS },
};

const MAX_BUCKETS = 1500;

/** Ranges in selector order. */
export const TIME_RANGES: readonly TimeRange[] = ["1h", "24h", "7d", "30d", "90d", "all"];

export function rangeMeta(range: TimeRange): RangeMeta {
	return RANGE_META[range];
}

/** Layouts shared by the axis and its tooltips. */
const HOUR_OPTIONS = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } as const;
const DAY_OPTIONS = { month: "short", day: "numeric" } as const;

/** One formatter per locale+layout: charts re-render on every tick, so this must not allocate per call. */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(layout: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
	const locale = getLocale();
	const key = `${locale}:${layout}`;
	let cached = formatterCache.get(key);
	if (!cached) {
		cached = new Intl.DateTimeFormat(locale, options);
		formatterCache.set(key, cached);
	}
	return cached;
}

/** Tick/tooltip label for a bucket start, precise enough for the bucket size. */
export function formatBucket(timestamp: number, bucketMs: number): string {
	if (bucketMs < HOUR_MS) return formatter("hm", HOUR_OPTIONS).format(timestamp);
	if (bucketMs < DAY_MS) return formatter("mdhm", { ...DAY_OPTIONS, ...HOUR_OPTIONS }).format(timestamp);
	return formatter("md", DAY_OPTIONS).format(timestamp);
}

/** Compact axis tick for a bucket start. */
export function formatTick(timestamp: number, bucketMs: number): string {
	return bucketMs < DAY_MS
		? formatter("hm", HOUR_OPTIONS).format(timestamp)
		: formatter("md", DAY_OPTIONS).format(timestamp);
}

/**
 * Contiguous, ascending bucket starts covering `range`, aligned like the
 * server's series buckets: day buckets start at local midnight (a DST day is
 * 23 or 25 hours long), shorter buckets at `(timestamp / bucketMs) * bucketMs`.
 * For all time the axis starts at the earliest data point, so gaps between
 * sessions still render as zeros; it is capped at {@link MAX_BUCKETS} so a
 * stray epoch-zero timestamp cannot explode the axis into decades of empty days.
 */
export function bucketAxis(
	range: TimeRange,
	dataTimestamps: Iterable<number>,
	bucketMs = RANGE_META[range].bucketMs,
	now = Date.now(),
): number[] {
	const daily = bucketMs === DAY_MS;
	const align = (ts: number) => (daily ? new Date(ts).setHours(0, 0, 0, 0) : Math.floor(ts / bucketMs) * bucketMs);
	const last = align(now);
	const span = RANGE_META[range].spanMs;
	let first: number;
	if (span !== null) {
		first = align(now - span);
	} else {
		first = last;
		for (const ts of dataTimestamps) if (ts < first) first = ts;
		first = align(first);
	}
	first = Math.max(first, align(last - (MAX_BUCKETS - 1) * bucketMs));
	const buckets: number[] = [];
	for (let t = first; t <= last;) {
		buckets.push(t);
		if (daily) {
			const next = new Date(t);
			next.setDate(next.getDate() + 1);
			// Re-align: on a day whose midnight DST skips, `t` is 01:00 and would carry forward.
			t = next.setHours(0, 0, 0, 0);
		} else {
			t += bucketMs;
		}
	}
	return buckets;
}
