import { describe, expect, test } from "bun:test";

import {
  COMPOSER_DRAFT_PUBLISH_MS,
  createDraftPublisher,
  draftStatusOf,
} from "./draftPublish";
import { createComposerDraftBook } from "./draftStore";
import { snapshotFromText, snapshotFromTextAndImages } from "./serialize";
import { emptySnapshot } from "./types";

/**
 * Keystroke budget for the composer (port of upstream PR #20
 * `apps/renderer/src/App.composerPerf.test.tsx`).
 *
 * Upstream measured render counts through a React tree. This tree has no DOM
 * test harness, so the same rules are asserted where they actually live: the
 * publisher that decides whether a snapshot reaches React state at all. A
 * character that does not move the render-visible boundary must produce zero
 * publishes; the deferred one lands once typing pauses; imperative actions
 * publish synchronously.
 */
function fakeClock() {
  let nextId = 1;
  const timers = new Map<number, { readonly handler: () => void; readonly ms: number }>();
  return {
    scheduler: {
      setTimeout(handler: () => void, ms: number): number {
        const id = nextId;
        nextId += 1;
        timers.set(id, { handler, ms });
        return id;
      },
      clearTimeout(id: number): void {
        timers.delete(id);
      },
    },
    /** Fire every armed timer, in arming order. */
    advance(): void {
      const armed = [...timers.values()];
      timers.clear();
      for (const { handler } of armed) handler();
    },
    get pending(): number {
      return timers.size;
    },
    get lastDelay(): number | undefined {
      return [...timers.values()].at(-1)?.ms;
    },
  };
}

function harness() {
  const clock = fakeClock();
  const published: string[] = [];
  const publisher = createDraftPublisher(emptySnapshot(), {
    publish: (snapshot) => published.push(snapshot.text),
    scheduler: clock.scheduler,
  });
  return { clock, publisher, published };
}

describe("composer draft publishing", () => {
  test("the empty → text boundary publishes at once, later characters wait", () => {
    const { clock, publisher, published } = harness();

    // Send button / placeholder depend on emptiness: the first character has to
    // reach the render immediately.
    publisher.keystroke(snapshotFromText("a"));
    expect(published).toEqual(["a"]);
    expect(clock.pending).toBe(0);

    // Plain typing next to it does not move that boundary.
    publisher.keystroke(snapshotFromText("ab"));
    publisher.keystroke(snapshotFromText("abc"));
    expect(published).toEqual(["a"]);
    expect(clock.pending).toBe(1);
    expect(clock.lastDelay).toBe(COMPOSER_DRAFT_PUBLISH_MS);

    // One quiet period, one publish, carrying the newest text.
    clock.advance();
    expect(published).toEqual(["a", "abc"]);
    expect(clock.pending).toBe(0);
  });

  test("the live snapshot is never behind the editor", () => {
    const { publisher, published } = harness();
    publisher.keystroke(snapshotFromText("a"));
    publisher.keystroke(snapshotFromText("hello"));
    // Enter reads the live draft, not the deferred render view.
    expect(publisher.deferred).toBe(true);
    expect(publisher.live.text).toBe("hello");
    expect(published.at(-1)).toBe("a");
  });

  test("an imperative commit publishes immediately and cancels the deferred one", () => {
    const { clock, publisher, published } = harness();
    publisher.keystroke(snapshotFromText("a"));
    publisher.keystroke(snapshotFromText("ab"));
    expect(clock.pending).toBe(1);

    publisher.commit(emptySnapshot());
    expect(published).toEqual(["a", ""]);
    expect(clock.pending).toBe(0);
    expect(publisher.deferred).toBe(false);
    // The cancelled timer must not republish the stale text later.
    clock.advance();
    expect(published).toEqual(["a", ""]);
    expect(publisher.live.text).toBe("");
  });

  test("image capsules move the boundary; text does not", () => {
    const empty = emptySnapshot();
    const withImage = snapshotFromTextAndImages("", [
      { type: "image", mimeType: "image/png", data: "AAAA" },
    ]);
    expect(draftStatusOf(empty)).not.toBe(draftStatusOf(withImage));

    const { clock, publisher, published } = harness();
    publisher.keystroke(withImage);
    expect(published.length).toBe(1);
    expect(clock.pending).toBe(0);
  });

  test("dispose drops the pending publish", () => {
    const { clock, publisher, published } = harness();
    publisher.keystroke(snapshotFromText("a"));
    publisher.keystroke(snapshotFromText("ab"));
    publisher.dispose();
    expect(clock.pending).toBe(0);
    clock.advance();
    expect(published).toEqual(["a"]);
  });
});

describe("composer draft book", () => {
  test("stores drafts per owner without publishing anything", () => {
    const book = createComposerDraftBook();
    const draft = snapshotFromText("half-typed");
    book.set("session-a", draft);
    expect(book.get("session-a")).toBe(draft);
    expect(book.get("session-b")).toBe(undefined);
    expect(book.get(undefined)).toBe(undefined);
    expect(book.size).toBe(1);
  });

  test("clearing a draft drops the entry instead of keeping an empty one", () => {
    const book = createComposerDraftBook();
    book.set("session-a", snapshotFromText("text"));
    book.set("session-a", emptySnapshot());
    expect(book.get("session-a")).toBe(undefined);
    expect(book.size).toBe(0);
  });
});
