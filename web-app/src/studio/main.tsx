/**
 * Zeta renderer entry.
 *
 * `mountRenderer` is the public mounting API: it takes a semantic
 * `StudioClient` supplied by the caller and never imports or constructs a
 * transport itself. The browser host entry (`host/boot.ts`) builds the
 * same-origin Zeta client and calls it; the desktop shell supplies its own
 * client. This module must not mount on its own: doing so created a second
 * React root on `#root` and duplicated the startup notice.
 */

import { createRoot } from "react-dom/client";
import type { StudioClient } from "@linxiraos/studio-contract";
import { App } from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import { getAppSettings } from "./settings/appSettings";
import { applyTypography } from "./settings/typography";
import { resolveLanguage } from "./i18n";
import { initPerformanceTimelineCleanup } from "./performanceTimelineCleanup";
import { createRendererPerformanceReporter } from "./rendererPerformance";
import { PLATFORM } from "./platform";
import { startTierControl } from "./perf/tierControl";
import { migrateLegacyStorageKeys } from "./storageMigration";

const stopPerformanceReporter = createRendererPerformanceReporter(globalThis.zetaStudioChrome);
window.addEventListener("pagehide", stopPerformanceReporter, { once: true });
import.meta.hot?.dispose(() => { window.removeEventListener("pagehide", stopPerformanceReporter); stopPerformanceReporter(); });

/* 首屏预应用主题 / 密度 / 语言：打包 CSP 是 script-src 'self'，不能靠 index.html
   内联脚本；这里在 React 挂载前同步 DOM 属性，避免首帧闪回默认主题。 */
/* `omp.*` storage keys predate the product name; copy them to `zeta.*` once,
   before anything reads a preference. */
migrateLegacyStorageKeys();

const initialSettings = getAppSettings();
applyTypography(initialSettings);
document.documentElement.setAttribute("data-theme", initialSettings.theme);
document.documentElement.setAttribute("data-platform", PLATFORM);
document.documentElement.setAttribute("data-density", initialSettings.density);
if (initialSettings.fileTypePalette === "tri") document.documentElement.dataset.palette = "tri";
document.documentElement.setAttribute("lang", resolveLanguage(initialSettings.language));

/**
 * P0-6：首帧前把 GPU / 低配 / 动效分级写到 `<html>`。
 *
 * Main 用 `app.getGPUFeatureStatus()`（不是 `getGPUInfo("basic")`：实测两者在
 * 软合成下字段完全相同）判定机器等级 L0–L3；`zetaStudioPerf.cached` 是 preload
 * 同步读到的上一次快照，所以首帧不需要 IPC 往返。等级规则只在 Main 一处，渲染层
 * 只负责「保存最新机器等级 + 叠加用户的减少动效偏好」（见 `perf/tierControl.ts`），
 * 不再自己从 GPU/CPU/内存事实推导等级。
 *
 * 「减少动效」是用户能收紧的下限（L0 → L1），绝不会把 L2/L3 抬回去；系统的
 * `prefers-reduced-motion` 与显式 `zeta.perf.motion=off` 走同一条路径。
 */
const reducedMotionQuery = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : undefined;
const stopTierControl = startTierControl({
  root: document.documentElement,
  source: globalThis.zetaStudioPerf,
  motionOff: () => {
    try {
      if (window.localStorage.getItem("zeta.perf.motion") === "off") return true;
    } catch {
      /* storage blocked: fall through to the OS preference */
    }
    return reducedMotionQuery?.matches === true;
  },
  onMotionPreferenceChange: listener => {
    reducedMotionQuery?.addEventListener?.("change", listener);
    return () => reducedMotionQuery?.removeEventListener?.("change", listener);
  },
});
// One wiring per document: a hot reload must not stack a second set of listeners
// on the old module instance, and a page hide tears them down.
import.meta.hot?.dispose(stopTierControl);
window.addEventListener("pagehide", stopTierControl, { once: true });
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/sidebar.css";
import "./styles/workbench.css";
import "./styles/pages.css";
import "./styles/team.css";
import "./styles/rooms.css";
import "./styles/agent-hub.css";
import "./styles/model-picker.css";
import "./styles/btw.css";
import "./App.css";
import "./styles/typography.css";
import "./styles/tabs.css";

if (import.meta.env.DEV) {
  const disposePerformanceTimelineCleanup = initPerformanceTimelineCleanup();
  import.meta.hot?.dispose(() => {
    disposePerformanceTimelineCleanup();
  });
}

/** Mount the renderer into `element` with an injected semantic client. */
export function mountRenderer(element: Element, client: StudioClient): void {
  createRoot(element).render(
    <ErrorBoundary>
      <App client={client} />
    </ErrorBoundary>,
  );
}

/*
 * The host entry (`host/boot.ts`) owns mounting, and the desktop shell supplies
 * its own client. Mounting here as well created a second React root on `#root`:
 * the host tree plus an `Unavailable` tree, which duplicated the startup
 * notice (two identical dialogs, so Close needed two clicks).
 */
