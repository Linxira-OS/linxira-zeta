/**
 * Visibility-gated polling for `usage.get`.
 *
 * Port of upstream PR #20 `apps/renderer/src/usage/usagePolling.ts`. Deviation:
 * the interval is injected through {@link UsagePollingTimers} (default browser
 * timers) so the timer/visibility rules are testable with bun's runner without
 * fake globals; the two call sites pass no timers and get the browser clock.
 *
 * Every `usage.get` reaches the Host's Runtime entrypoint lookup. Polling a
 * hidden or minimised window is pure cost: nobody can read the card, and the
 * window is usually hidden for hours. So a hidden document does not poll at all,
 * and becoming visible refreshes immediately instead of waiting for the next
 * tick (the numbers on screen are the ones the user just came back to look at).
 */

import { USAGE_POLL_MS } from "./tokenUsage";

/** Minimal interval seam; the default scheduler needs a DOM. */
export interface UsagePollingTimers {
  setInterval(handler: () => void, ms: number): number;
  clearInterval(handle: number): void;
}

const DEFAULT_TIMERS: UsagePollingTimers = {
  setInterval(handler, ms) {
    return window.setInterval(handler, ms);
  },
  clearInterval(handle) {
    window.clearInterval(handle);
  },
};

export interface UsagePollingOptions {
  readonly load: () => void | Promise<void>;
  /** Defaults to `USAGE_POLL_MS`. */
  readonly intervalMs?: number;
  /** Defaults to `document.hidden`. */
  readonly isHidden?: () => boolean;
  /** Subscribe to visibility changes; returns an unsubscribe. Defaults to `document`. */
  readonly onVisibilityChange?: (listener: () => void) => () => void;
  /** Defaults to browser timers. */
  readonly timers?: UsagePollingTimers;
}

function documentHidden(): boolean {
  return typeof document !== "undefined" && document.hidden === true;
}

function subscribeDocumentVisibility(listener: () => void): () => void {
  if (typeof document === "undefined") return () => undefined;
  document.addEventListener("visibilitychange", listener);
  return () => {
    document.removeEventListener("visibilitychange", listener);
  };
}

/**
 * Run `load` once now, then on every interval while the document is visible.
 * Returns a stop function that clears the timer and the visibility listener.
 */
export function startUsagePolling(options: UsagePollingOptions): () => void {
  const intervalMs = options.intervalMs ?? USAGE_POLL_MS;
  const isHidden = options.isHidden ?? documentHidden;
  const onVisibilityChange = options.onVisibilityChange ?? subscribeDocumentVisibility;
  const timers = options.timers ?? DEFAULT_TIMERS;
  let stopped = false;
  let busy = false;
  let hidden = isHidden();

  const run = (): void => {
    // A load slower than the interval must not stack a second request behind
    // itself; the next tick picks up after this one settles.
    if (stopped || busy) return;
    busy = true;
    let pending: void | Promise<void>;
    try {
      pending = options.load();
    } catch {
      busy = false;
      return;
    }
    // A synchronous load is already done; only a pending request keeps the
    // interval from starting another one.
    if (pending === undefined || typeof pending.then !== "function") {
      busy = false;
      return;
    }
    void Promise.resolve(pending)
      .catch(() => undefined)
      .finally(() => {
        busy = false;
      });
  };

  const timer = timers.setInterval(() => {
    if (isHidden()) return;
    run();
  }, intervalMs);

  const unsubscribe = onVisibilityChange(() => {
    if (stopped) return;
    const next = isHidden();
    if (next === hidden) return;
    hidden = next;
    if (!next) run();
  });

  run();
  return () => {
    stopped = true;
    timers.clearInterval(timer);
    unsubscribe();
  };
}
