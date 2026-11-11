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
import { deviceRegistry } from "../auth/device-registry";
import { twoFactorStepUpDenial } from "../auth/two-factor-auth";
import { studioHost } from "../studio-host/server";
import { buildPairPayload, parsePairingPayload, renderPairingQrSvg, resolvePairingBaseUrl } from "../pairing";
import { credentialAllows, type RemoteCredential } from "./remote-access";

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
	return Response.json(data, { status, headers: { "cache-control": "no-store", ...headers } });
}

/**
 * `GET /api/remote/pairing` — the one-time code a settings panel renders.
 *
 * The response carries the **pairing code** (60 s, single-use) and a QR payload
 * that embeds it. It never carries the machine token: a `read` device must not
 * be able to trade its narrow credential for the machine-wide one, and a token
 * in a URL leaks through screenshots and proxy logs.
 *
 * Access: genuinely local, or a `write` credential with a fresh step-up. A
 * device allowed to mint another device is already privileged; requiring both
 * scope and a recent verification keeps a stolen read credential from printing
 * a QR.
 */
export async function handleRemotePairingGet(
	req: Request,
	remoteAddr?: string,
	credential: RemoteCredential = { kind: "local" },
): Promise<Response> {
	if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
	if (credential.kind !== "local") {
		if (!credentialAllows(credential, "write")) return json({ error: "insufficient_scope" }, 403);
		const denial = await twoFactorStepUpDenial(req, remoteAddr);
		if (denial) return denial;
	}
	const config = await WebConfig.load();
	const host = studioHost();
	const code = host.pairingCode;
	const expiresAtMs = host.pairingExpiresAt;
	const requestUrl = new URL(req.url);
	const explicit = requestUrl.searchParams.get("url");
	const url = resolvePairingBaseUrl({
		requestUrl: req.url,
		config: config.getData(),
		explicitUrl: explicit,
	});
	let payload: string;
	try {
		payload = buildPairPayload({ url, code });
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, 400);
	}
	const parsed = parsePairingPayload(payload);
	return json({
		url: parsed?.url ?? url,
		code,
		expiresAt: expiresAtMs === null ? null : new Date(expiresAtMs).toISOString(),
		payload,
		svg: renderPairingQrSvg(payload),
	});
}

/** POST /api/remote/token/rotate — mint a new token, revoke the old one. */
export async function handleRemoteTokenRotatePost(req: Request): Promise<Response> {
	if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
	const config = await WebConfig.load();
	const token = await config.rotateRemoteToken();
	// Rotation retires the machine-wide secret only. Paired devices keep their own
	// tokens, so the response reports how many are still active — a settings panel
	// must be able to say "rotate did not log out your phone".
	const devicesStillActive = await deviceRegistry().activeCount();
	return json({
		ok: true,
		token,
		tokenUpdatedAt: config.getData().remote.tokenUpdatedAt ?? null,
		devicesStillActive,
	});
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
