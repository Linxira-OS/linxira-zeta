/**
 * Composer draft publication boundary (port of upstream PR #20 `App.tsx`
 * hunk "击键不重渲工作台", extracted from `WorkbenchCanvas` so the coalescing
 * rules are testable without a React tree).
 *
 * Upstream kept this inline as a pair of refs plus a `setTimeout`. The rules are
 * the same here:
 *
 * - every keystroke first lands in the live snapshot (imperative reads — Enter,
 *   queue edits, sends — must see the newest text, never the deferred view);
 * - the render-visible `draft` only republishes immediately when a boundary the
 *   render genuinely depends on changes: empty ↔ non-empty, an image capsule
 *   appears/disappears, a chip appears/disappears. Text content is not part of
 *   that boundary;
 * - otherwise the publish is coalesced to one commit once typing pauses;
 * - imperative actions (clear, restore, insert) call {@link DraftPublisher.commit}
 *   and publish synchronously.
 *
 * Difference from upstream: the status comparison is made against the last
 * *published* snapshot instead of the render-current `draft` prop. The two are
 * the same object between renders, but tracking the published value keeps the
 * publisher self-contained and independent of React's render timing.
 */

import { snapshotIsEmpty } from "./serialize";
import type { ComposerSnapshot } from "./types";

/** Quiet period after which a deferred draft becomes the render-visible one. */
export const COMPOSER_DRAFT_PUBLISH_MS = 140;

/**
 * Minimal timer seam so tests control the clock without fake globals. The
 * handle is a browser timer id; the default scheduler needs a DOM, and tests
 * always inject their own.
 */
export interface DraftScheduler {
  setTimeout(handler: () => void, ms: number): number;
  clearTimeout(handle: number): void;
}

const DEFAULT_SCHEDULER: DraftScheduler = {
  setTimeout(handler, ms) {
    return window.setTimeout(handler, ms);
  },
  clearTimeout(handle) {
    window.clearTimeout(handle);
  },
};

export interface DraftPublisherOptions {
  /** Receives every render-visible snapshot. Must be stable across renders. */
  readonly publish: (snapshot: ComposerSnapshot) => void;
  readonly delayMs?: number;
  readonly scheduler?: DraftScheduler;
}

export interface DraftPublisher {
  /** Newest snapshot, including text the render has not seen yet. */
  readonly live: ComposerSnapshot;
  /** Whether a keystroke is still waiting for the quiet period. */
  readonly deferred: boolean;
  /** Typing path: publish now only when a render-visible boundary changed. */
  keystroke(next: ComposerSnapshot): void;
  /** Imperative path (clear, restore, insert): publish synchronously. */
  commit(next: ComposerSnapshot): void;
  /** Drop a pending publish without emitting it (unmount). */
  dispose(): void;
}

/**
 * The render-visible boundaries of a draft. Everything else (title preview,
 * slash-command availability, skill set) is derived from text and may lag by
 * one quiet period.
 */
export function draftStatusOf(snapshot: ComposerSnapshot): string {
  return `${snapshotIsEmpty(snapshot) ? "e" : "t"}${snapshot.images.length > 0 ? "i" : ""}${
    snapshot.doc.nodes.some((node) => node.type === "chip") ? "c" : ""
  }`;
}

export function createDraftPublisher(
  initial: ComposerSnapshot,
  options: DraftPublisherOptions,
): DraftPublisher {
  const scheduler = options.scheduler ?? DEFAULT_SCHEDULER;
  const delayMs = options.delayMs ?? COMPOSER_DRAFT_PUBLISH_MS;
  let live = initial;
  let publishedStatus = draftStatusOf(initial);
  let handle: number | undefined;

  const cancel = (): void => {
    if (handle === undefined) return;
    scheduler.clearTimeout(handle);
    handle = undefined;
  };
  const publish = (snapshot: ComposerSnapshot): void => {
    publishedStatus = draftStatusOf(snapshot);
    options.publish(snapshot);
  };

  return {
    get live() {
      return live;
    },
    get deferred() {
      return handle !== undefined;
    },
    keystroke(next) {
      live = next;
      cancel();
      const status = draftStatusOf(next);
      if (status !== publishedStatus) {
        publish(next);
        return;
      }
      handle = scheduler.setTimeout(() => {
        handle = undefined;
        publish(live);
      }, delayMs);
    },
    commit(next) {
      live = next;
      cancel();
      publish(next);
    },
    dispose() {
      cancel();
    },
  };
}
