/**
 * Page-side collector for the Studio renderer's six tracked costs.
 *
 * It runs the real harness (`window.ompPerf`, installed by
 * `perf-harness-entry.tsx`) and the real composer, and reports only numbers it
 * actually observed. Every Chromium-only API is feature-detected: when it is
 * missing the metric is `null` and `notes`/`supported` say why.
 *
 * Exposed as `window.__perf.run()`; the page also runs it once after load and
 * stores the result on `window.__perfReport`.
 */
import type { PerfResult, PerfRunOptions, PerfSeed } from "../studio/perf-harness-entry";
import { performanceOptions } from "../studio/performanceOptions";

type OmpPerf = Window["ompPerf"];
type ChromiumMemory = {
  readonly usedJSHeapSize: number;
  readonly totalJSHeapSize: number;
  readonly jsHeapSizeLimit: number;
};

export type Percentiles = {
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly worstMs: number;
};

export type LongTaskSummary = Percentiles & {
  readonly count: number;
  readonly totalMs: number;
  readonly supported: boolean;
};

export type ScrollSummary = Percentiles & {
  readonly fps: number;
  readonly frames: number;
  readonly durationMs: number;
  readonly droppedFrames: number;
  readonly rows: number | null;
};

export type PaintMeasurement = {
  readonly firstPaintMs: number | null;
  readonly firstContentfulPaintMs: number | null;
  readonly paintSupported: boolean;
};

export type KeystrokeSummary = Percentiles & {
  readonly count: number;
  readonly observedInputs: number;
  readonly method: string;
};

export type PerfReport = {
  readonly generatedAt: string;
  readonly url: string;
  readonly userAgent: string;
  readonly viewport: {
    readonly width: number;
    readonly height: number;
    readonly devicePixelRatio: number;
  };
  /** Build-time performance switches, so two reports are comparable. */
  readonly buildSwitches: typeof performanceOptions;
  readonly supported: {
    readonly memory: boolean;
    readonly longtask: boolean;
    readonly paint: boolean;
    readonly forcedGc: boolean;
  };
  readonly paint: {
    readonly firstPaintMs: number | null;
    readonly firstContentfulPaintMs: number | null;
    readonly method: string;
  };
  readonly heap: {
    readonly afterLoadBytes: number | null;
    readonly after500MessageSessionBytes: number | null;
    readonly afterLoadTotalBytes: number | null;
    readonly after500MessageSessionTotalBytes: number | null;
  };
  readonly metrics: {
    readonly jsTransferredBytes: number | null;
    readonly jsDecodedBytes: number | null;
    readonly jsScripts: number;
    readonly jsCachedScripts: number;
    readonly longTasksDuringStream: LongTaskSummary | null;
    readonly stream: {
      readonly frames: number;
      readonly medianFrameMs: number;
      readonly p95FrameMs: number;
      readonly worstFrameMs: number;
      readonly droppedFrames: number;
      readonly stallFrames: number;
    } | null;
    readonly keystrokeToPaint: KeystrokeSummary | null;
    readonly scrollFrameRate: ScrollSummary | null;
  };
  readonly fixture: {
    readonly turns: number;
    readonly toolsPerTurn: number;
    readonly outputLines: number;
    readonly streamFrames: number;
    readonly charsPerFrame: number;
    readonly toolLinesPerFrame: number;
    readonly scrollMs: number;
    readonly keystrokes: number;
    readonly rowsAfterSession: number | null;
  };
  readonly raw: {
    readonly stream: PerfResult | null;
    readonly longTaskDurationsMs: readonly number[];
    readonly scrollIntervalsMs: readonly number[];
    readonly keystrokeSamplesMs: readonly number[];
  };
  readonly notes: readonly string[];
  readonly errors: readonly string[];
};

declare global {
  interface Window {
    __perf?: { run(): Promise<PerfReport> };
    __perfReport?: PerfReport;
  }
}

const FIXTURE: PerfSeed = { turns: 500, toolsPerTurn: 0, outputLines: 3 };
/**
 * The harness's `toggleTailCard` option does not exist; the real field is
 * `toggleEveryFrames` (0 = never toggle). `toggleTailCard: false` from the
 * brief therefore maps to `toggleEveryFrames: 0` — same scenario, real name.
 */
const STREAM: PerfRunOptions = { frames: 20, charsPerFrame: 120, toolLinesPerFrame: 0, toggleEveryFrames: 0 };
const SCROLL_MS = 2000;
const KEYSTROKES = 20;
const DROPPED_FRAME_MS = 32;

const frame = (): Promise<number> => {
  const { promise, resolve } = Promise.withResolvers<number>();
  requestAnimationFrame(resolve);
  return promise;
};

/** First task after the frame has been painted (same probe the upstream
 *  render-work harness uses for input latency). */
const afterPaint = (): Promise<number> => {
  const { promise, resolve } = Promise.withResolvers<number>();
  requestAnimationFrame(() => { setTimeout(() => resolve(performance.now()), 0); });
  return promise;
};

const round = (value: number): number => Math.round(value * 100) / 100;

const delay = (ms: number): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};

function quantile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * fraction)));
  return sorted[index]!;
}

function summarize(samples: readonly number[]): Percentiles {
  if (samples.length === 0) return { medianMs: 0, p95Ms: 0, worstMs: 0 };
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    medianMs: round(quantile(sorted, 0.5)),
    p95Ms: round(quantile(sorted, 0.95)),
    worstMs: round(sorted[sorted.length - 1]!),
  };
}

async function waitForSelector<T extends Element>(selector: string, timeoutMs: number): Promise<T | null> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const found = document.querySelector<T>(selector);
    if (found !== null) return found;
    await frame();
  }
  return document.querySelector<T>(selector);
}

async function waitForHarness(timeoutMs = 5000): Promise<OmpPerf> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (typeof window.ompPerf?.reset === "function") return window.ompPerf;
    await frame();
  }
  throw new Error("window.ompPerf was never installed (perf-harness-entry did not mount)");
}

// CHROMIUM-ONLY: `performance.memory` is not in lib.dom; the cast is the
// boundary, and absence is reported as null instead of guessed.
const perfWithMemory = performance as Performance & { memory?: ChromiumMemory };
const memoryInfo = (): ChromiumMemory | null => perfWithMemory.memory ?? null;

async function collectGarbage(): Promise<boolean> {
  const gcHost = globalThis as typeof globalThis & { gc?: () => void };
  const gc = gcHost.gc;
  if (typeof gc !== "function") return false;
  gc();
  await frame();
  gc();
  await afterPaint();
  return true;
}

async function heapAfterGc(): Promise<{ used: number | null; total: number | null; forced: boolean }> {
  const forced = await collectGarbage();
  const info = memoryInfo();
  return { used: info?.usedJSHeapSize ?? null, total: info?.totalJSHeapSize ?? null, forced };
}

/** Observe the paint timeline once; entries themselves are buffered, so this
 *  works even though the collector starts after load. */
async function readPaint(): Promise<PaintMeasurement> {
  const observed = new Map<string, number>();
  let paintSupported = false;
  const observer = typeof PerformanceObserver === "function"
    ? new PerformanceObserver((list) => { for (const entry of list.getEntries()) observed.set(entry.name, entry.startTime); })
    : null;
  if (observer !== null) {
    try { observer.observe({ type: "paint", buffered: true }); paintSupported = true; } catch { paintSupported = false; }
  }
  await delay(0);
  await frame();
  for (const entry of performance.getEntriesByType("paint")) {
    if (!observed.has(entry.name)) observed.set(entry.name, entry.startTime);
  }
  observer?.disconnect();
  return {
    firstPaintMs: observed.get("first-paint") ?? null,
    firstContentfulPaintMs: observed.get("first-contentful-paint") ?? null,
    paintSupported,
  };
}

type ResourceSummary = {
  readonly transferredBytes: number | null;
  readonly decodedBytes: number | null;
  readonly scripts: number;
  readonly cachedScripts: number;
  readonly resourceEntries: number;
};

/** JS transferred = sum of `transferSize` for script resources (headers
 *  included, which is what the wire carried). `decodedBodySize` is kept as a
 *  separate, non-wire number. */
function readResources(): ResourceSummary {
  const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
  const scripts = entries.filter(
    (entry) => entry.initiatorType === "script" || /\.m?js(?:\?|$)/u.test(entry.name),
  );
  const cachedScripts = scripts.filter((entry) => entry.transferSize === 0).length;
  return {
    transferredBytes: scripts.length === 0 ? null : scripts.reduce((sum, entry) => sum + entry.transferSize, 0),
    decodedBytes: scripts.length === 0 ? null : scripts.reduce((sum, entry) => sum + entry.decodedBodySize, 0),
    scripts: scripts.length,
    cachedScripts,
    resourceEntries: entries.length,
  };
}

async function settleTranscript(timeoutMs = 3000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const body = document.querySelector<HTMLElement>(".convo-body");
    if (body !== null && document.querySelector(".convo-virtual-row") !== null) {
      const phase = body.dataset.phase ?? "idle";
      const opacity = Number.parseFloat(getComputedStyle(body).opacity || "1");
      if (phase === "idle" && opacity > 0.99) break;
    }
    await frame();
  }
  await frame();
  await afterPaint();
}

type StreamMeasurement = {
  readonly result: PerfResult;
  readonly longTasks: readonly number[];
  readonly longTaskSupported: boolean;
};

async function measureStream(omp: OmpPerf): Promise<StreamMeasurement> {
  const durations: number[] = [];
  let supported = false;
  const observer = typeof PerformanceObserver === "function"
    ? new PerformanceObserver((list) => { for (const entry of list.getEntries()) durations.push(entry.duration); })
    : null;
  if (observer !== null) {
    try { observer.observe({ type: "longtask" } as PerformanceObserverInit); supported = true; }
    catch {
      try { observer.observe({ entryTypes: ["longtask"] }); supported = true; } catch { supported = false; }
    }
  }
  let result: PerfResult;
  try {
    result = await omp.run(STREAM);
  } finally {
    await delay(0);
    if (observer !== null) {
      try { for (const entry of observer.takeRecords()) durations.push(entry.duration); } catch { /* detached */ }
      observer.disconnect();
    }
  }
  return { result, longTasks: durations, longTaskSupported: supported };
}

type ScrollMeasurement = {
  readonly summary: ScrollSummary;
  readonly intervals: readonly number[];
};

/** Programmatic ping-pong over the mounted transcript for ~2 s, one scroll
 *  write per animation frame; the interval samples are the rendered frames. */
async function measureScroll(omp: OmpPerf): Promise<ScrollMeasurement> {
  const scroller = await waitForSelector<HTMLElement>(".convo-scroll", 3000);
  if (scroller === null) throw new Error("transcript scroller `.convo-scroll` not found");
  const rowProbe = await omp.run({ ...STREAM, frames: 0 });
  scroller.scrollTop = scroller.scrollHeight;
  await afterPaint();
  const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  if (maxScroll < 1000) {
    throw new Error(`transcript is not scrollable (scrollHeight ${scroller.scrollHeight}px, clientHeight ${scroller.clientHeight}px)`);
  }
  const intervals: number[] = [];
  let previous = await frame();
  const start = performance.now();
  while (performance.now() - start < SCROLL_MS) {
    const progress = Math.min(1, (performance.now() - start) / SCROLL_MS);
    const triangle = progress < 0.5 ? progress * 2 : (1 - progress) * 2;
    scroller.scrollTop = maxScroll * (1 - triangle);
    const now = await frame();
    intervals.push(now - previous);
    previous = now;
  }
  const durationMs = performance.now() - start;
  const sorted = [...intervals].sort((left, right) => left - right);
  return {
    summary: {
      fps: round(intervals.length / (durationMs / 1000)),
      frames: intervals.length,
      durationMs: round(durationMs),
      medianMs: round(quantile(sorted, 0.5)),
      p95Ms: round(quantile(sorted, 0.95)),
      worstMs: round(sorted[sorted.length - 1] ?? 0),
      droppedFrames: intervals.filter((value) => value > DROPPED_FRAME_MS).length,
      rows: rowProbe.rows,
    },
    intervals: intervals.map(round),
  };
}

type KeystrokeMeasurement = {
  readonly samples: readonly number[];
  readonly observed: number;
  readonly method: string;
};

async function measureKeystrokes(): Promise<KeystrokeMeasurement> {
  const editor = await waitForSelector<HTMLElement>("#perf-composer", 3000);
  if (editor === null) throw new Error("composer editor `#perf-composer` not found");
  editor.focus();
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  await afterPaint();

  const execCommand = typeof document.execCommand === "function" ? document.execCommand.bind(document) : null;
  const methods = new Set<string>();
  const samples: number[] = [];
  let observed = 0;

  for (let index = 0; index < KEYSTROKES; index += 1) {
    const character = "abcdefghijklmnopqrst"[index % 20]!;
    await frame();
    const before = editor.textContent?.length ?? 0;
    const stamp = performance.now();
    let inserted = false;
    if (execCommand !== null) {
      try { inserted = execCommand("insertText", false, character); } catch { inserted = false; }
    }
    if (inserted) {
      methods.add("document.execCommand(insertText)");
    } else {
      editor.appendChild(document.createTextNode(character));
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: character }));
      methods.add("synthetic InputEvent after DOM insert");
    }
    samples.push(round(await afterPaint() - stamp));
    if ((editor.textContent?.length ?? 0) > before) observed += 1;
  }
  return { samples, observed, method: [...methods].join(" + ") || "none" };
}

async function attempt<T>(
  errors: string[],
  label: string,
  action: () => Promise<T>,
): Promise<T | null> {
  try {
    return await action();
  } catch (error) {
    errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function buildReport(input: {
  readonly errors: readonly string[];
  readonly notes: readonly string[];
  readonly paint: PaintMeasurement;
  readonly resources: ResourceSummary;
  readonly loadHeap: { readonly used: number | null; readonly total: number | null; readonly forced: boolean };
  readonly sessionHeap: { readonly used: number | null; readonly total: number | null; readonly forced: boolean } | null;
  readonly rowsAfterSession: number | null;
  readonly stream: StreamMeasurement | null;
  readonly scroll: ScrollMeasurement | null;
  readonly keys: KeystrokeMeasurement | null;
}): PerfReport {
  const { paint, resources, loadHeap, sessionHeap, stream, scroll, keys } = input;
  const memory = memoryInfo();
  const forcedGc = loadHeap.forced || (sessionHeap?.forced ?? false);
  const longTaskDurations = stream === null ? [] : [...stream.longTasks].filter((value) => value > 50);
  const longTaskSummary: LongTaskSummary | null = stream === null || !stream.longTaskSupported
    ? null
    : {
        ...summarize(longTaskDurations),
        count: longTaskDurations.length,
        totalMs: round(longTaskDurations.reduce((sum, value) => sum + value, 0)),
        supported: true,
      };
  const streamSummary = stream === null ? null : {
    frames: stream.result.frames,
    medianFrameMs: stream.result.median,
    p95FrameMs: stream.result.p95,
    worstFrameMs: stream.result.worst,
    droppedFrames: stream.result.dropped,
    stallFrames: stream.result.stalls,
  };
  const keystrokeSummary: KeystrokeSummary | null = keys === null ? null : {
    ...summarize(keys.samples),
    count: keys.samples.length,
    observedInputs: keys.observed,
    method: keys.method,
  };

  return {
    generatedAt: new Date().toISOString(),
    url: location.href,
    userAgent: navigator.userAgent,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    },
    buildSwitches: performanceOptions,
    supported: {
      memory: memory !== null,
      longtask: stream?.longTaskSupported ?? false,
      paint: paint.paintSupported,
      forcedGc,
    },
    paint: {
      firstPaintMs: paint.firstPaintMs === null ? null : round(paint.firstPaintMs),
      firstContentfulPaintMs: paint.firstContentfulPaintMs === null ? null : round(paint.firstContentfulPaintMs),
      method: "PerformanceObserver({type:\"paint\", buffered:true}) + performance.getEntriesByType(\"paint\")",
    },
    heap: {
      afterLoadBytes: loadHeap.used,
      after500MessageSessionBytes: sessionHeap?.used ?? null,
      afterLoadTotalBytes: loadHeap.total,
      after500MessageSessionTotalBytes: sessionHeap?.total ?? null,
    },
    metrics: {
      jsTransferredBytes: resources.transferredBytes,
      jsDecodedBytes: resources.decodedBytes,
      jsScripts: resources.scripts,
      jsCachedScripts: resources.cachedScripts,
      longTasksDuringStream: longTaskSummary,
      stream: streamSummary,
      keystrokeToPaint: keystrokeSummary,
      scrollFrameRate: scroll?.summary ?? null,
    },
    fixture: {
      turns: FIXTURE.turns,
      toolsPerTurn: FIXTURE.toolsPerTurn,
      outputLines: FIXTURE.outputLines,
      streamFrames: STREAM.frames,
      charsPerFrame: STREAM.charsPerFrame,
      toolLinesPerFrame: STREAM.toolLinesPerFrame,
      scrollMs: SCROLL_MS,
      keystrokes: KEYSTROKES,
      rowsAfterSession: input.rowsAfterSession,
    },
    raw: {
      stream: stream?.result ?? null,
      longTaskDurationsMs: longTaskDurations.map(round),
      scrollIntervalsMs: scroll?.intervals ?? [],
      keystrokeSamplesMs: keys?.samples ?? [],
    },
    notes: input.notes,
    errors: input.errors,
  };
}

async function collect(): Promise<PerfReport> {
  const errors: string[] = [];
  const notes: string[] = [];
  const omp = await attempt(errors, "harness", () => waitForHarness());
  if (omp === null) throw new Error("perf harness unavailable: window.ompPerf is missing");

  // Let the first paint of the mounted page land before reading "after load".
  await frame();
  await delay(250);
  await afterPaint();

  const paint = await readPaint();
  const resources = readResources();
  if (!paint.paintSupported) notes.push("paint observer unsupported: paint timestamps came from performance.getEntriesByType(\"paint\") only.");
  if (resources.scripts === 0) notes.push("no script resource entries: JS transferred is null (page may have loaded all scripts from a warm cache).");
  if (resources.cachedScripts > 0) notes.push(`${resources.cachedScripts} script(s) had transferSize 0 (cache hit); transferred bytes only cover network loads.`);
  if (resources.resourceEntries >= 250) notes.push("resource timing buffer hit its 250-entry default; scripts after the 250th entry are not counted.");
  notes.push("stream fixture uses the harness's real option name `toggleEveryFrames: 0`; there is no `toggleTailCard` option.");
  notes.push(`the 500 \"messages\" fixture is ompPerf.reset({turns: ${FIXTURE.turns}}); the harness seeds one user + one assistant item per turn.`);

  const loadHeap = await heapAfterGc();
  if (!loadHeap.forced) notes.push("performance.memory exists but globalThis.gc does not: heap numbers are un-GCed (launch Chromium with --js-flags=--expose-gc for comparable numbers).");
  if (memoryInfo() === null) notes.push("performance.memory is unavailable in this browser: heap metrics are null.");

  const sessionRows = await attempt(errors, "500-message session", async () => {
    await omp.reset(FIXTURE);
    await settleTranscript();
    const probe = await omp.run({ ...STREAM, frames: 0 });
    return probe.rows;
  });
  const sessionHeap = sessionRows === null ? null : await heapAfterGc();

  const stream = await attempt(errors, "20-message stream", () => measureStream(omp));
  if (stream !== null && !stream.longTaskSupported) notes.push("longtask observer unsupported: long tasks during the stream are null.");

  const scroll = await attempt(errors, "scroll frame rate", async () => {
    await omp.reset(FIXTURE);
    await settleTranscript();
    return measureScroll(omp);
  });
  if (scroll === null) notes.push("scroll frame rate needs the 500-turn transcript; see errors.");

  const keys = await attempt(errors, "keystroke-to-paint", () => measureKeystrokes());
  if (keys !== null && keys.observed < keys.samples.length) {
    notes.push(`only ${keys.observed}/${keys.samples.length} keystrokes changed the composer DOM: the composer may have re-rendered without inserting.`);
  }

  return buildReport({
    errors,
    notes,
    paint,
    resources,
    loadHeap,
    sessionHeap,
    rowsAfterSession: sessionRows,
    stream,
    scroll,
    keys,
  });
}

let inFlight: Promise<PerfReport> | null = null;

/** Run the six scenarios again; concurrent callers share the same run. */
export function runPerf(): Promise<PerfReport> {
  if (inFlight === null) {
    inFlight = collect()
      .then((report) => {
        window.__perfReport = report;
        window.dispatchEvent(new CustomEvent("perf-report", { detail: report }));
        return report;
      })
      .finally(() => { inFlight = null; });
  }
  return inFlight;
}

export function installCollector(): void {
  window.__perf = { run: runPerf };
  const start = (): void => { void runPerf().catch((error) => { console.error("perf harness failed", error); }); };
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
}
