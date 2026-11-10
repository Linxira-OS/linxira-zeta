/**
 * Coalescing for a task call's tool updates.
 *
 * One `task` batch can run dozens of subagents, and every spawn reports its
 * progress on its own 150 ms cadence. Each report currently rebuilds the
 * batch-wide `TaskToolDetails` and paints the transcript card, so the parent's
 * TUI thread does O(spawns) work O(spawns) times per cadence — quadratic in
 * fan-out. A progress snapshot is cumulative (latest wins), the TUI paints at
 * its own frame ceiling anyway, and no consumer needs every intermediate state.
 *
 * This keeps the first update immediate (a spawn renders as soon as it exists),
 * then emits at most one trailing update per window, always the latest. A final
 * `flush()` publishes anything still pending. The coalescer drops only
 * superseded intermediate snapshots; the tool's final result is returned
 * through the normal result path and never depends on an update frame.
 */
import { logger } from "@linxiraos/pi-utils";

/** Default coalescing window for task tool updates, in milliseconds. */
export const TASK_TOOL_UPDATE_COALESCE_MS = 100;

export interface CoalescedToolUpdates<T> {
	/** Record the latest update; emits now or at the end of the current window. */
	update(value: T): void;
	/** Emit the latest pending update immediately (no-op when none is pending). */
	flush(): void;
}

export interface CoalescedToolUpdatesOptions {
	/** Minimum spacing between two emitted updates. */
	windowMs?: number;
	/** Clock used for the window; injectable for tests. */
	now?: () => number;
	/** Timer source; injectable for tests. */
	schedule?: (callback: () => void, delayMs: number) => NodeJS.Timeout;
	/** Timer canceller paired with `schedule`. */
	cancel?: (timer: NodeJS.Timeout) => void;
}

/**
 * Build a leading + trailing coalescer around `emit`. Leading emissions stay
 * synchronous (their exceptions reach the caller as before); a trailing
 * emission runs from a timer and logs a failure instead of crashing the loop.
 */
export function createCoalescedToolUpdates<T>(
	emit: (value: T) => void,
	options: CoalescedToolUpdatesOptions = {},
): CoalescedToolUpdates<T> {
	const windowMs = options.windowMs ?? TASK_TOOL_UPDATE_COALESCE_MS;
	const now = options.now ?? Date.now;
	const schedule =
		options.schedule ??
		((callback, delayMs) => {
			const timer = setTimeout(callback, delayMs);
			timer.unref?.();
			return timer;
		});
	const cancel = options.cancel ?? clearTimeout;

	let pending: T | undefined;
	let hasPending = false;
	let timer: NodeJS.Timeout | undefined;
	let lastEmitAt = Number.NEGATIVE_INFINITY;

	const publish = (fromTimer: boolean): void => {
		if (!hasPending) return;
		const value = pending as T;
		pending = undefined;
		hasPending = false;
		lastEmitAt = now();
		if (!fromTimer) {
			emit(value);
			return;
		}
		try {
			emit(value);
		} catch (error) {
			logger.warn("Task tool update listener failed", {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	};

	return {
		update(value: T): void {
			pending = value;
			hasPending = true;
			if (timer !== undefined) return;
			const elapsed = now() - lastEmitAt;
			if (elapsed >= windowMs) {
				publish(false);
				return;
			}
			timer = schedule(() => {
				timer = undefined;
				publish(true);
			}, windowMs - elapsed);
		},
		flush(): void {
			if (timer !== undefined) {
				cancel(timer);
				timer = undefined;
			}
			publish(false);
		},
	};
}

/**
 * Run a tool call's dispatch behind a coalescer. `run` receives the callback to
 * pass down (undefined when the caller supplied none). The last requested
 * snapshot is flushed when `run` settles; a detached spawn that reports after
 * the call returned keeps the coalescer alive through the callback it retained.
 */
export async function runWithCoalescedToolUpdates<TUpdate, TResult>(
	emit: ((update: TUpdate) => void) | undefined,
	run: (update: ((update: TUpdate) => void) | undefined) => Promise<TResult>,
	options: CoalescedToolUpdatesOptions = {},
): Promise<TResult> {
	if (emit === undefined) return run(undefined);
	const coalesced = createCoalescedToolUpdates(emit, options);
	// The callback exposes `flush` to producers that know a snapshot is terminal
	// (a spawn settling), so the final row state is not held for the window.
	const wrapped = Object.assign((update: TUpdate) => coalesced.update(update), {
		flush: () => coalesced.flush(),
	});
	try {
		return await run(wrapped);
	} finally {
		coalesced.flush();
	}
}

/**
 * Publish a terminal update immediately when the producer holds a coalesced
 * callback (see {@link runWithCoalescedToolUpdates}); a plain callback needs no
 * flush and is left alone.
 */
export function flushToolUpdates<TUpdate>(update: ((update: TUpdate) => void) | undefined): void {
	if (!update || !("flush" in update)) return;
	const flush = update.flush;
	if (typeof flush === "function") flush.call(update);
}
