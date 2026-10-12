/**
 * Memory-pressure gate for subagent fan-out.
 *
 * Fan-out is the fastest way for one session to turn a tight machine into an
 * out-of-memory crash: every `task` spawn is another process with its own
 * runtime, and `task.maxConcurrency` is a *work* limit, not a memory limit.
 *
 * The gate samples the machine when a spawn permit is about to be taken and
 * lowers the effective ceiling while memory is short. It never raises the
 * configured cap, never touches work that is already running, never kills
 * anything, and returns to the configured value as soon as the sample is
 * healthy again — a safety rail, not a scheduler.
 *
 * The thresholds are constants on purpose: `task.maxConcurrency` stays the one
 * knob that expresses intent, and a rail nobody tunes is a rail nobody blames
 * for the wrong number.
 */

import { freemem, totalmem } from "node:os";
import { normalizeConcurrencyLimit } from "./parallel";

/** How short the machine is on memory right now. */
export type MemoryPressureLevel = "ok" | "tight" | "critical";

/** Below this share of installed memory the machine counts as short. */
const TIGHT_FREE_RATIO = 0.15;
/** Below this share it counts as critical. */
const CRITICAL_FREE_RATIO = 0.08;
/** Process RSS that counts as short regardless of what the OS still reports free. */
const TIGHT_RSS_BYTES = 6 * 1024 ** 3;
/** Process RSS that counts as critical. */
const CRITICAL_RSS_BYTES = 10 * 1024 ** 3;
/** Ceiling applied while `tight`; a configured `0` ("Unlimited") is bounded by it. */
const TIGHT_FANOUT_CAP = 8;
/** Ceiling applied while `critical`. */
const CRITICAL_FANOUT_CAP = 2;

/** One memory reading: this process, plus what the OS says is available. */
export interface MemorySample {
	rssBytes: number;
	systemTotalBytes: number;
	systemFreeBytes: number;
}

/** Read the current sample — the same sources the profiler and crash reports use. */
export function readMemorySample(): MemorySample {
	return {
		rssBytes: process.memoryUsage().rss,
		systemTotalBytes: totalmem(),
		systemFreeBytes: freemem(),
	};
}

/** Classify a sample; the worse of the two signals wins. */
export function memoryPressureLevel(sample: MemorySample = readMemorySample()): MemoryPressureLevel {
	let level: MemoryPressureLevel = "ok";
	if (Number.isFinite(sample.systemTotalBytes) && sample.systemTotalBytes > 0) {
		const freeRatio = sample.systemFreeBytes / sample.systemTotalBytes;
		if (freeRatio < CRITICAL_FREE_RATIO) level = "critical";
		else if (freeRatio < TIGHT_FREE_RATIO) level = "tight";
	}
	if (sample.rssBytes >= CRITICAL_RSS_BYTES) return "critical";
	if (sample.rssBytes >= TIGHT_RSS_BYTES && level === "ok") return "tight";
	return level;
}

/**
 * Concurrency for one fan-out decision: the configured cap, lowered while
 * memory is short. Never above the configured value, and a configured `0`
 * ("Unlimited") becomes a bounded ceiling under pressure instead of staying
 * unbounded.
 */
export function effectiveFanOutCap(configured: number, level: MemoryPressureLevel): number {
	const cap = normalizeConcurrencyLimit(configured);
	if (level === "ok") return cap;
	const ceiling = level === "critical" ? CRITICAL_FANOUT_CAP : TIGHT_FANOUT_CAP;
	// `normalizeConcurrencyLimit` keeps `0` as the "Unlimited" sentinel (the
	// caller converts it, e.g. `Semaphore` widens it to Infinity). Under pressure
	// that sentinel becomes the bounded ceiling instead of a zero-width cap.
	return cap > 0 ? Math.max(1, Math.min(cap, ceiling)) : ceiling;
}

/** One-line explanation for the log, or `undefined` while pressure is `ok`. */
export function describePressure(level: MemoryPressureLevel, sample: MemorySample): string | undefined {
	if (level === "ok") return undefined;
	const gib = (bytes: number) => (bytes / 1024 ** 3).toFixed(1);
	return (
		`memory pressure (${level}): rss ${gib(sample.rssBytes)} GiB, ` +
		`system free ${gib(sample.systemFreeBytes)} of ${gib(sample.systemTotalBytes)} GiB — ` +
		"subagent fan-out ceiling lowered for this decision (task.maxConcurrency unchanged)"
	);
}
