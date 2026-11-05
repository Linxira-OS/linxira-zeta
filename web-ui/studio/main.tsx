/**
 * OMP Studio renderer entry.
 *
 * `mountRenderer` is the public mounting API: it takes a semantic
 * `StudioClient` supplied by the caller (desktop shell, local WebUI bridge,
 * or a test) and never imports or constructs a transport itself.
 *
 * When this module is loaded directly by Vite (the auto-bootstrap entry),
 * the hosting page injects that client on `globalThis.OMP_STUDIO_CLIENT`
 * before the bundle runs. If it is absent but the desktop preload bridge
 * (`globalThis.ompStudio`) is present, the entry constructs the client
 * itself: `createDesktopTransport(ompStudio)` → `StudioClientImpl`. If
 * neither exists we render an explicit unavailable state instead of
 * failing.
 */

import { createRoot } from "react-dom/client";
import type { StudioClient } from "@/lib/studio-protocol/contract";
import { StudioClientImpl } from "@/lib/studio-client";
import { createDesktopTransport } from "@/lib/pi-desktop";
import { App, Unavailable } from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import { getAppSettings } from "./settings/appSettings";
import { applyTypography } from "./settings/typography";
import { resolveLanguage } from "./i18n";
import { initPerformanceTimelineCleanup } from "./performanceTimelineCleanup";
import { createRendererPerformanceReporter } from "./rendererPerformance";
import { PLATFORM } from "./platform";

const stopPerformanceReporter = createRendererPerformanceReporter(globalThis.ompStudioChrome);
window.addEventListener("pagehide", stopPerformanceReporter, { once: true });
import.meta.hot?.dispose(() => { window.removeEventListener("pagehide", stopPerformanceReporter); stopPerformanceReporter(); });

/* 首屏预应用主题 / 密度 / 语言：打包 CSP 是 script-src 'self'，不能靠 index.html
   内联脚本；这里在 React 挂载前同步 DOM 属性，避免首帧闪回默认主题。 */
const initialSettings = getAppSettings();
applyTypography(initialSettings);
document.documentElement.setAttribute("data-theme", initialSettings.theme);
document.documentElement.setAttribute("data-platform", PLATFORM);
document.documentElement.setAttribute("data-density", initialSettings.density);
document.documentElement.setAttribute("lang", resolveLanguage(initialSettings.language));

if (process.env.NODE_ENV !== "production") {
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

const host = document.getElementById("root");
if (host !== null) {
  let client: StudioClient | undefined = globalThis.OMP_STUDIO_CLIENT;
  if (client === undefined) {
    const bridge = globalThis.ompStudio;
    if (bridge !== undefined) {
      client = new StudioClientImpl(createDesktopTransport(bridge));
    }
  }
  createRoot(host).render(
    <ErrorBoundary>
      {client === undefined ? <Unavailable /> : <App client={client} />}
    </ErrorBoundary>,
  );
}
