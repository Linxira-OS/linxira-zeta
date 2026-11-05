/**
 * Entry for `perf-harness.html` (built by `vite.perf.config.ts` → `dist-perf/`).
 *
 * It mounts the two upstream measurement harnesses and the real composer on
 * one page, then hands control to `./collect.ts`, which runs the six tracked
 * scenarios once the page has settled and stores the result on
 * `window.__perfReport`.
 *
 * Not product code: nothing in `src/studio/**` imports this file.
 */
import { createElement } from "react";
import { createRoot } from "react-dom/client";

// Side effect: mounts ConversationPane + ConversationMinimap into #root and
// installs window.ompPerf (reset/run/renderWork/…). Import order matters: the
// harness must own #root before the collector flips its store.
import "../studio/perf-harness-entry";
import { ChipComposer } from "../studio/composer/ChipComposer";
import { installCollector } from "./collect";

function mountComposer(): void {
  const host = document.createElement("div");
  host.id = "perf-composer-host";
  Object.assign(host.style, {
    position: "fixed",
    right: "16px",
    bottom: "16px",
    width: "480px",
    zIndex: "10000",
    background: "var(--surface, #ffffff)",
    borderRadius: "12px",
    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.18)",
  });
  document.body.appendChild(host);
  // The id lands on the contenteditable editor (ChipComposer forwards `id`
  // to `.chip-composer-editor`), which is the node the collector types into.
  createRoot(host).render(
    createElement(ChipComposer, { id: "perf-composer", placeholder: "perf keystroke probe" }),
  );
}

mountComposer();
installCollector();
