/**
 * Web Gateway — `/api/web-config` handlers for the independent web layer
 * config (`~/.zeta/agent/web.yml`). Mirrors the `/api/settings` GET/PUT
 * pattern; secrets are masked on GET and never revealed.
 */

import { isKnownWebConfigPath, WebConfig } from "../../config/web-config";

function json(data: unknown, status = 200): Response {
	return Response.json(data, { status });
}

/** GET /api/web-config — full merged structure with secrets masked. */
export async function handleWebConfigGet(): Promise<Response> {
	try {
		const config = await WebConfig.load();
		return json(config.getMasked());
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
