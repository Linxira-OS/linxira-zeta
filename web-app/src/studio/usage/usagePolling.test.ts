import { describe, expect, test } from "bun:test";

import { startUsagePolling } from "./usagePolling";

/**
 * The 30 s `usage.get` poll must not run while the window is hidden, and must
 * refresh at once when it becomes visible again (port of upstream PR #20
 * `apps/renderer/src/usage/usagePolling.test.ts`).
 *
 * Deviation: time is driven through the injected timer seam instead of
 * `vi.useFakeTimers()`, so the rules are exercised without patching globals.
 */
function fakeTimers() {
  let nextId = 1;
  const intervals = new Map<number, { readonly handler: () => void; readonly ms: number }>();
  return {
    timers: {
      setInterval(handler: () => void, ms: number): number {
        const id = nextId;
        nextId += 1;
        intervals.set(id, { handler, ms });
        return id;
      },
      clearInterval(id: number): void {
        intervals.delete(id);
      },
    },
    /** Fire every live interval once. */
    tick(): void {
      for (const { handler } of [...intervals.values()]) handler();
    },
    get live(): number {
      return intervals.size;
    },
    get intervalMs(): number | undefined {
      return [...intervals.values()][0]?.ms;
    },
  };
}

function visibilitySource(initiallyHidden = false) {
  let hidden = initiallyHidden;
  const listeners = new Set<() => void>();
  return {
    isHidden: () => hidden,
    onVisibilityChange: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next: boolean): void {
      hidden = next;
      for (const listener of [...listeners]) listener();
    },
    get listeners(): number {
      return listeners.size;
    },
  };
}

function countingLoad() {
  const calls: number[] = [];
  return {
    calls,
    load: () => {
      calls.push(calls.length);
    },
  };
}

describe("usage polling", () => {
  test("loads once on mount and then on every interval while visible", () => {
    const clock = fakeTimers();
    const visibility = visibilitySource();
    const { calls, load } = countingLoad();
    const stop = startUsagePolling({
      load,
      isHidden: visibility.isHidden,
      onVisibilityChange: visibility.onVisibilityChange,
      timers: clock.timers,
    });

    expect(calls.length).toBe(1);
    expect(clock.intervalMs).toBe(30_000);
    clock.tick();
    expect(calls.length).toBe(2);
    clock.tick();
    expect(calls.length).toBe(3);
    stop();
  });

  test("stops polling while hidden and refreshes as soon as it is visible", () => {
    const clock = fakeTimers();
    const visibility = visibilitySource();
    const { calls, load } = countingLoad();
    const stop = startUsagePolling({
      load,
      isHidden: visibility.isHidden,
      onVisibilityChange: visibility.onVisibilityChange,
      timers: clock.timers,
    });
    expect(calls.length).toBe(1);

    visibility.set(true);
    // Hidden for minutes: no request at all, not a series of no-ops that still
    // cost a Host round trip.
    clock.tick();
    clock.tick();
    clock.tick();
    clock.tick();
    expect(calls.length).toBe(1);

    visibility.set(false);
    expect(calls.length).toBe(2);
    clock.tick();
    expect(calls.length).toBe(3);
    stop();
  });

  test("a window that mounts hidden still loads once and does not poll", () => {
    const clock = fakeTimers();
    const visibility = visibilitySource(true);
    const { calls, load } = countingLoad();
    const stop = startUsagePolling({
      load,
      isHidden: visibility.isHidden,
      onVisibilityChange: visibility.onVisibilityChange,
      timers: clock.timers,
    });
    expect(calls.length).toBe(1);
    clock.tick();
    clock.tick();
    clock.tick();
    expect(calls.length).toBe(1);
    visibility.set(false);
    expect(calls.length).toBe(2);
    stop();
  });

  test("does not stack requests when a load takes longer than the interval", async () => {
    const clock = fakeTimers();
    const visibility = visibilitySource();
    const calls: number[] = [];
    const gate = Promise.withResolvers<void>();
    const stop = startUsagePolling({
      load: () => {
        calls.push(calls.length);
        return gate.promise;
      },
      isHidden: visibility.isHidden,
      onVisibilityChange: visibility.onVisibilityChange,
      timers: clock.timers,
    });

    expect(calls.length).toBe(1);
    clock.tick();
    clock.tick();
    expect(calls.length).toBe(1);

    gate.resolve();
    await gate.promise;
    await Promise.resolve();
    clock.tick();
    expect(calls.length).toBe(2);
    stop();
  });

  test("releases the interval and the visibility listener when stopped", () => {
    const clock = fakeTimers();
    const visibility = visibilitySource();
    const { calls, load } = countingLoad();
    const stop = startUsagePolling({
      load,
      isHidden: visibility.isHidden,
      onVisibilityChange: visibility.onVisibilityChange,
      timers: clock.timers,
    });
    expect(visibility.listeners).toBe(1);
    expect(clock.live).toBe(1);

    stop();
    expect(visibility.listeners).toBe(0);
    expect(clock.live).toBe(0);
    clock.tick();
    visibility.set(true);
    visibility.set(false);
    expect(calls.length).toBe(1);
  });
});
