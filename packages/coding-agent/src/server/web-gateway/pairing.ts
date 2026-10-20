/**
 * Remote-access settings surface exposed over REST: the pairing QR payload and
 * the token lifecycle (rotate / revoke).
 *
 * These are authenticated endpoints (the generic gate applies: loopback or a
 * valid token), and they are the only places the plaintext token is returned
 * after configuration — `GET /api/web-config` keeps masking it. A pairing
 * response therefore carries `Cache-Control: no-store`.
 */

import { WebConfig } from "../../config/web-config";
import { buildPairingPayload, parsePairingPayload, renderPairingQrSvg, resolvePairingBaseUrl } from "../pairing";

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
	return Response.json(data, { status, headers: { "cache-control": "no-store", ...headers } });
}

/**
 * GET /api/remote/pairing[?url=https://…] — `{ url, token, payload, svg }`
 * for the settings panel, which renders the QR and can show the URL.
 */
export async function handleRemotePairingGet(req: Request): Promise<Response> {
	const config = await WebConfig.load();
	const token = config.getRemoteToken();
	if (!token) {
		return json({ error: "No remote token is configured; set one under Remote Access first" }, 409);
	}
	const requestUrl = new URL(req.url);
	const explicit = requestUrl.searchParams.get("url");
	const url = resolvePairingBaseUrl({
		requestUrl: req.url,
		config: config.getData(),
		explicitUrl: explicit,
	});
	let payload: string;
	try {
		payload = buildPairingPayload({ url, token });
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, 400);
	}
	const parsed = parsePairingPayload(payload);
	return json({ url: parsed?.url ?? url, token, payload, svg: renderPairingQrSvg(payload) });
}

/** POST /api/remote/token/rotate — mint a new token, revoke the old one. */
export async function handleRemoteTokenRotatePost(req: Request): Promise<Response> {
	if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
	const config = await WebConfig.load();
	const token = await config.rotateRemoteToken();
	return json({ ok: true, token, tokenUpdatedAt: config.getData().remote.tokenUpdatedAt ?? null });
}

/**
 * POST /api/remote/token/revoke — body `{ token }` or `{ all: true }`.
 * Revoking the active token clears it, so the gate fails closed until a new
 * token is configured (an authenticated remote caller stays authenticated
 * only for this request).
 */
export async function handleRemoteTokenRevokePost(req: Request): Promise<Response> {
	if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
	let body: { token?: unknown; all?: unknown };
	try {
		body = (await req.json()) as { token?: unknown; all?: unknown };
	} catch {
		return json({ error: "Expected a JSON body" }, 400);
	}
	const config = await WebConfig.load();
	const activeToken = config.getRemoteToken();
	const revokeAll = body.all === true;
	const token = typeof body.token === "string" ? body.token.trim() : "";
	if (!revokeAll && token === "") {
		return json({ error: "Provide { token } or { all: true }" }, 400);
	}
	const target = revokeAll ? activeToken : token;
	if (target) await config.revokeRemoteToken(target);
	return json({ ok: true, activeTokenRevoked: target !== undefined && target === activeToken });
}
