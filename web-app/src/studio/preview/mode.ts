/** 发布时为 false：顶栏开关消失，并强制真实数据。 */
export const PREVIEW_MODE_SWITCH_ENABLED = false;
export const PREVIEW_MODE_STORAGE_KEY = "zeta.previewMode";

/**
 * `?preview=1` 只在开发构建里强制预览夹具（截图/QA 用）。
 *
 * 生产构建忽略该参数：交付的渲染器绝不会因为一个 URL 参数就展示演示数据。
 * `dev` 由调用方从构建环境读取，便于测试两条分支。
 */
export function previewForcedByQuery(search: string, dev: boolean): boolean {
	if (!dev) return false;
	try {
		return new URLSearchParams(search).get("preview") === "1";
	} catch {
		return false;
	}
}

/** 当前构建是否为开发构建（`vite` dev server / 测试）。 */
export function isDevBuild(): boolean {
	return (import.meta as ImportMeta & { readonly env?: { readonly DEV?: boolean } }).env?.DEV === true;
}

export function readStoredPreviewMode(): boolean {
  try {
    const raw = localStorage.getItem(PREVIEW_MODE_STORAGE_KEY);
    if (raw === "0" || raw === "false") return false;
    if (raw === "1" || raw === "true") return true;
  } catch {
    /* localStorage may be blocked */
  }
  return false;
}

export function writeStoredPreviewMode(on: boolean): void {
  try {
    localStorage.setItem(PREVIEW_MODE_STORAGE_KEY, on ? "1" : "0");
  } catch {
    /* localStorage may be blocked */
  }
}
