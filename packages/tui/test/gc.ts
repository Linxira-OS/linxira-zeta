/**
 * Garbage-collection probes for release tests.
 *
 * JSC scans the machine stack conservatively. A `Bun.gc(true)` issued from a resumed async function also
 * scans stale promise-job frames whose slots can still hold pointers to released objects, so whether a
 * target survives depends on stack layout. A timer callback runs on the event loop's shallow stack, out of
 * reach of those frames.
 */

/** Runs a full synchronous GC from a fresh timer callback, away from stale async stack frames. */
export function collectGarbage(): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	setTimeout(() => {
		Bun.gc(true);
		resolve();
	}, 0);
	return promise;
}

/**
 * Whether `target` becomes collectible within `deadlineMs`; a retained target never does.
 *
 * The bound is only a latency ceiling for a target that *can* go: {@link collectGarbage} runs one
 * timer-callback GC per pass and the loop yields between passes, so a few seconds buys hundreds of
 * passes even on a loaded runner. It cannot rescue a target pinned by a stale native stack slot —
 * JSC scans the whole stack region conservatively, so the object dropped last may stay reachable for
 * the life of the process no matter how many passes run (see the survivor tolerance in
 * `packages/coding-agent/test/task/spawn-run.test.ts`). Callers probing the last-dropped object
 * should tolerate that one survivor; widening this bound does not help.
 *
 * (Widened 3s → 8s on 2026-10-12 for the post-#92 flake, then reverted the same day: the flake was
 * the stale slot, not too few passes.)
 */
export async function becomesCollectible(target: WeakRef<object>, deadlineMs = 3_000): Promise<boolean> {
	const deadline = performance.now() + deadlineMs;
	do {
		await collectGarbage();
		if (target.deref() === undefined) return true;
	} while (performance.now() < deadline);
	return false;
}
