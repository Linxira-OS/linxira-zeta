/**
 * Web Gateway — `/api/web-config` handlers for the independent web layer
 * config (`~/.zeta/agent/web.yml`). Mirrors the `/api/settings` GET/PUT
 * pattern; secrets are masked on GET and never revealed.
 */

import { isKnownWebConfigPath, WebConfig } from "../../config/web-config";

function json(data: unknown, status = 200): Response {
	return Response.json(data, { status });
}

/** Tray/app-menu labels localized for the desktop shell (en/zh-CN). */
const DESKTOP_LABELS: Record<string, Record<string, string>> = {
	en: {
		showWindow: "Show Window",
		statsDashboard: "Stats Dashboard",
		openSettings: "Open Settings",
		quit: "Quit",
		webUi: "Web UI",
		reload: "Reload",
	},
	"zh-CN": {
		showWindow: "显示主窗口",
		statsDashboard: "统计面板",
		openSettings: "打开设置",
		quit: "退出",
		webUi: "Web 界面",
		reload: "重新加载",
	},
};

/** GET /api/web-config — full merged structure with secrets masked. */
export async function handleWebConfigGet(req: Request): Promise<Response> {
	try {
		const config = await WebConfig.load();
		const masked = config.getMasked();
		// The desktop shell passes its Electron locale (e.g. `zh-CN`) so the tray
		// and app menu can be localized through the same gateway it already
		// reads tray preferences from. Unknown/absent → English fallback.
		const header = req.headers.get("x-zeta-locale") ?? "";
		const desktopLocale = Object.hasOwn(DESKTOP_LABELS, header) ? header : "en";
		return json({
			...masked,
			desktopLocale,
			desktopLabels: DESKTOP_LABELS[desktopLocale],
		});
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, 500);
	}
}

/**
 * PUT /api/web-config — body `{ path, value }` with a dot path such as
 * `channels.wechat.enabled`. Unknown paths or mistyped values are 400.
 */
export async function handleWebConfigPut(req: Request): Promise<Response> {
	try {
		const body = (await req.json()) as { path?: unknown; value?: unknown };
		if (!isKnownWebConfigPath(body.path)) {
			return json({ error: `Unknown web config path: ${String(body.path)}` }, 400);
		}
		const config = await WebConfig.load();
		try {
			await config.set(body.path, body.value);
		} catch (error) {
			return json({ error: error instanceof Error ? error.message : String(error) }, 400);
		}
		return json({ ok: true });
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, 500);
	}
}
