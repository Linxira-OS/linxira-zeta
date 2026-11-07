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
import { attachTierControl } from "./perf/tierControl";
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
document.documentElement.setAttribute("lang", resolveLanguage(initialSettings.language));

/**
 * P0-6：首帧前把 GPU / 低配 / 动效分级写到 `<html>`。
 *
 * 机器等级（L0–L3）只由桌面 Main 判定并通过 `zetaStudioPerf` 只读桥下发；
 * `cached` 是 preload 同步读到的上一次快照，所以首帧不需要 IPC 往返。渲染层只负责
 * 「保存最新机器等级 + 叠加用户的减少动效偏好」（见 `perf/tierControl.ts`），不再
 * 自己从 GPU/CPU/内存事实推导等级。WebUI 构建没有这个桥：等级保持 L0，只有
 * `prefers-reduced-motion` / `zeta.perf.motion=off` 生效。
 *
 * 「减少动效」是用户能收紧的下限（L0 → L1），绝不会把 L2/L3 抬回去。
 */
const stopTierControl = attachTierControl(document.documentElement);
// 一个文档只接一次线：热更新不能把第二套监听器叠在旧模块实例上，页面隐藏时拆掉。
import.meta.hot?.dispose(stopTierControl);
window.addEventListener("pagehide", stopTierControl, { once: true });

import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/sidebar.css";
import "./styles/workbench.css";
import "./styles/pages.css";
import "./styles/agent-hub.css";
import "./styles/models-roles.css";
import "./styles/btw.css";
import "./App.css";
import "./styles/typography.css";

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
