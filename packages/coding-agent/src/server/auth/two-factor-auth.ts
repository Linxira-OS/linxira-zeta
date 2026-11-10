/**
 * HTTP surface for account/device two-factor auth:
 *
 *   GET  /api/auth/2fa                     status (never the secret)
 *   POST /api/auth/2fa/enroll              mint secret + recovery codes (once)
 *   POST /api/auth/2fa/confirm             activate the pending secret
 *   POST /api/auth/2fa/verify              prove a code / recovery code
 *   POST /api/auth/2fa/disable             turn 2FA off and erase the secret
 *   POST /api/auth/2fa/recovery/regenerate replace every recovery code
 *   PUT  /api/auth/2fa/policy              require 2FA for remote writes
 *
 * These routes sit behind the gateway's remote-access gate; they add no second
 * entry point. 2FA protects *account/device* access only — IM channel
 * credentials never pass through this module.
 *
 * Verification is a per-caller grant held in memory: a device token caller is
 * keyed by device id, the legacy `remote.token` by peer address. A serve
 * restart forgets every grant (the operator re-verifies), which is the safer
 * direction than persisting a 12-hour "already checked" flag across restarts.
 *
 * Sensitive device actions (revoke, rotate/revoke the machine token, add a
 * device, disable 2FA, regenerate recovery codes) need a grant from the last
 * ten minutes; ordinary remote writes accept the twelve-hour window. A
 * genuinely local (loopback, no forwarding header) caller is never challenged:
 * losing a phone must not lock the operator out of the machine itself.
 */

import type { DeviceRecord } from "./device-registry";
import { deviceRegistry } from "./device-registry";
import { renderQrSvg } from "../pairing";
import { getRemoteAuthLimiter, isGenuinelyLocalRequest, rateLimitedRemoteResponse } from "../web-gateway/remote-access";
import { twoFactorStore, type TwoFactorStore } from "./two-factor-store";

/** Ordinary remote writes stay authorized for this long after a verify. */
export const WRITE_VERIFICATION_TTL_MS = 12 * 60 * 60 * 1000;

/** Sensitive device actions need a verify from this window. */
export const STEP_UP_TTL_MS = 10 * 60 * 1000;

/** Verification failure limiter namespace; independent of token/pair budgets. */
export const TWO_FACTOR_LIMITER_PREFIX = "2fa:";

function json(data: unknown, status = 200): Response {
	return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

interface Grant {
	/** When the code was accepted. */
	verifiedAt: number;
	/** How long ordinary writes accept the grant. */
	verifiedUntil: number;
}

const grants = new Map<string, Grant>();

/** Test hook: forget every verification grant. */
export function resetTwoFactorGrantsForTests(): void {
	grants.clear();
}

/** Drop one device's grant when it is revoked. */
export function forgetDeviceVerification(deviceId: string): void {
	grants.delete(`device:${deviceId}`);
}

/** Drop every grant (revoke-all). */
export function forgetAllVerifications(): void {
	grants.clear();
}

/**
 * Identity a grant is attached to. A device token is better than an address
 * (phones change networks); the legacy machine token has no id, so the peer
 * address is the only stable handle the gateway already trusts.
 */
async function grantKey(req: Request, remoteAddr?: string): Promise<string> {
	const provided = req.headers.get("authorization") ?? req.headers.get("x-zeta-token") ?? "";
	const device: DeviceRecord | undefined = await deviceRegistry().findByToken(provided);
	if (device !== undefined) return `device:${device.id}`;
	return `peer:${remoteAddr ?? "unknown"}`;
}

/** The caller's current grant, or `undefined` when it expired. */
async function currentGrant(req: Request, remoteAddr?: string): Promise<Grant | undefined> {
	const key = await grantKey(req, remoteAddr);
	const grant = grants.get(key);
	if (grant === undefined) return undefined;
	if (grant.verifiedUntil <= Date.now()) {
		grants.delete(key);
		return undefined;
	}
	return grant;
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
	try {
		const body: unknown = await req.json();
		return body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

/** 403 payload used by every 2FA gate. `stepUp` marks the ten-minute window. */
function totpRequired(stepUp: boolean): Response {
	return json({ error: "totp_required", retryable: true, ...(stepUp ? { stepUp: true } : {}) }, 403);
}

/**
 * Enroll/confirm/disable/regenerate need the machine itself or a recent
 * step-up. First enrollment is therefore local-only: a stolen remote token
 * must not be able to install an attacker-controlled second factor.
 */
async function requireLocalOrStepUp(req: Request, remoteAddr?: string): Promise<Response | null> {
	if (isGenuinelyLocalRequest(req, remoteAddr)) return null;
	const key = await grantKey(req, remoteAddr);
	const grant = grants.get(key);
	if (grant !== undefined && grant.verifiedAt + STEP_UP_TTL_MS > Date.now()) return null;
	const status = await twoFactorStore().status();
	return status.enrolled ? totpRequired(true) : json({ error: "local_required" }, 403);
}

/** Whether a remote caller may pass a write request; local callers always can. */
export async function twoFactorWriteDenial(
	req: Request,
	remoteAddr?: string,
	store: TwoFactorStore = twoFactorStore(),
): Promise<Response | null> {
	if (isGenuinelyLocalRequest(req, remoteAddr)) return null;
	if (!(await store.isRequired())) return null;
	const grant = await currentGrant(req, remoteAddr);
	if (grant !== undefined && grant.verifiedUntil > Date.now()) return null;
	return totpRequired(false);
}

/** The ten-minute gate for device/token mutations. */
export async function twoFactorStepUpDenial(
	req: Request,
	remoteAddr?: string,
	store: TwoFactorStore = twoFactorStore(),
): Promise<Response | null> {
	if (isGenuinelyLocalRequest(req, remoteAddr)) return null;
	if (!(await store.isRequired())) return null;
	const key = await grantKey(req, remoteAddr);
	const grant = grants.get(key);
	if (grant !== undefined && grant.verifiedAt + STEP_UP_TTL_MS > Date.now()) return null;
	return totpRequired(true);
}

/**
 * Path-aware gate for `webGatewayFetch`. Only the surfaces named by the
 * contract are gated: device mutations, machine-token lifecycle, and Studio
 * pairing/command (the latter handled in `StudioHost`). Reads stay open so the
 * UI can render a code prompt.
 */
export async function guardGatewayTwoFactor(
	req: Request,
	remoteAddr: string | undefined,
	pathname: string,
): Promise<Response | null> {
	if (req.method === "GET" || req.method === "HEAD") return null;
	if (pathname === "/api/remote/devices/revoke-all") return twoFactorStepUpDenial(req, remoteAddr);
	if (/^\/api\/remote\/devices\/[A-Za-z0-9_-]{1,64}$/u.test(pathname)) return twoFactorStepUpDenial(req, remoteAddr);
	if (pathname === "/api/remote/token/rotate" || pathname === "/api/remote/token/revoke") {
		return twoFactorStepUpDenial(req, remoteAddr);
	}
	return null;
}

/** Gate used inside `StudioHost` for pairing (step-up) and commands (write). */
export async function guardStudioTwoFactor(
	req: Request,
	remoteAddr: string | undefined,
	pathname: string,
): Promise<Response | null> {
	if (pathname === "/api/v1/pair") return twoFactorStepUpDenial(req, remoteAddr);
	if (pathname === "/api/v1/command") return twoFactorWriteDenial(req, remoteAddr);
	return null;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** `GET /api/auth/2fa` — status plus this caller's verification window. */
export async function handleTwoFactorStatusGet(
	req: Request,
	remoteAddr?: string,
	store: TwoFactorStore = twoFactorStore(),
): Promise<Response> {
	if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
	const status = await store.status();
	const grant = await currentGrant(req, remoteAddr);
	return json({
		...status,
		verified: grant !== undefined,
		verifiedUntil: grant === undefined ? null : new Date(grant.verifiedUntil).toISOString(),
	});
}

/** `POST /api/auth/2fa/enroll` — secret, otpauth URL, QR and recovery codes once. */
export async function handleTwoFactorEnrollPost(
	req: Request,
	remoteAddr?: string,
	store: TwoFactorStore = twoFactorStore(),
): Promise<Response> {
	if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
	const denial = await requireLocalOrStepUp(req, remoteAddr);
	if (denial) return denial;
	const enrollment = await store.enroll();
	return json({
		secret: enrollment.secret,
		otpauthUrl: enrollment.otpauthUrl,
		qrSvg: renderQrSvg(enrollment.otpauthUrl, { margin: 2 }),
		recoveryCodes: enrollment.recoveryCodes,
		expiresAt: enrollment.expiresAt,
	});
}

/** `POST /api/auth/2fa/confirm` — `{code}` activates the pending secret. */
export async function handleTwoFactorConfirmPost(
	req: Request,
	remoteAddr?: string,
	store: TwoFactorStore = twoFactorStore(),
): Promise<Response> {
	if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
	const denial = await requireLocalOrStepUp(req, remoteAddr);
	if (denial) return denial;
	const body = await readBody(req);
	const code = typeof body.code === "string" ? body.code : "";
	const limiterKey = `${TWO_FACTOR_LIMITER_PREFIX}confirm:${remoteAddr ?? "unknown"}`;
	const limiter = getRemoteAuthLimiter();
	const blocked = limiter.status(limiterKey);
	if (blocked.blocked) return rateLimitedRemoteResponse(blocked.retryAfterSeconds);
	const result = await store.confirm(code);
	if (!result.ok) {
		const afterFailure = limiter.recordFailure(limiterKey);
		if (afterFailure.blocked) return rateLimitedRemoteResponse(afterFailure.retryAfterSeconds);
		return json({ error: result.reason }, result.reason === "invalid_code" ? 401 : 400);
	}
	limiter.clear(limiterKey);
	return json({ ok: true, enrolledAt: result.enrolledAt });
}

/** `POST /api/auth/2fa/verify` — `{code}` or `{recoveryCode}`. */
export async function handleTwoFactorVerifyPost(
	req: Request,
	remoteAddr?: string,
	store: TwoFactorStore = twoFactorStore(),
): Promise<Response> {
	if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
	const limiterKey = `${TWO_FACTOR_LIMITER_PREFIX}${remoteAddr ?? "unknown"}`;
	const limiter = getRemoteAuthLimiter();
	const blocked = limiter.status(limiterKey);
	if (blocked.blocked) return rateLimitedRemoteResponse(blocked.retryAfterSeconds);

	const body = await readBody(req);
	const code = typeof body.code === "string" ? body.code : "";
	const recoveryCode = typeof body.recoveryCode === "string" ? body.recoveryCode : "";
	if (code === "" && recoveryCode === "") return json({ error: "expected_code" }, 400);

	let method: "totp" | "recovery" = "totp";
	let accepted = false;
	if (code !== "") {
		accepted = (await store.verifyCode(code)).ok;
	} else {
		method = "recovery";
		accepted = await store.consumeRecoveryCode(recoveryCode);
	}

	if (!accepted) {
		const afterFailure = limiter.recordFailure(limiterKey);
		if (afterFailure.blocked) return rateLimitedRemoteResponse(afterFailure.retryAfterSeconds);
		return json({ error: "invalid_code" }, 401);
	}

	limiter.clear(limiterKey);
	const now = Date.now();
	grants.set(await grantKey(req, remoteAddr), {
		verifiedAt: now,
		verifiedUntil: now + WRITE_VERIFICATION_TTL_MS,
	});
	const status = await store.status();
	return json({
		ok: true,
		method,
		verifiedUntil: new Date(now + WRITE_VERIFICATION_TTL_MS).toISOString(),
		recoveryCodesRemaining: status.recoveryCodesRemaining,
	});
}

/** `POST /api/auth/2fa/disable` — local, or remote with a recent grant + code. */
export async function handleTwoFactorDisablePost(
	req: Request,
	remoteAddr?: string,
	store: TwoFactorStore = twoFactorStore(),
): Promise<Response> {
	if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
	const denial = await requireLocalOrStepUp(req, remoteAddr);
	if (denial) return denial;
	if (!isGenuinelyLocalRequest(req, remoteAddr)) {
		const body = await readBody(req);
		const code = typeof body.code === "string" ? body.code : "";
		const recoveryCode = typeof body.recoveryCode === "string" ? body.recoveryCode : "";
		if (code === "" && recoveryCode === "") return json({ error: "expected_code" }, 400);
		const valid = code !== "" ? (await store.verifyCode(code)).ok : await store.consumeRecoveryCode(recoveryCode);
		if (!valid) return json({ error: "invalid_code" }, 401);
	}
	const key = await grantKey(req, remoteAddr);
	await store.disable();
	grants.delete(key);
	return json({ ok: true, enrolled: false, required: false });
}

/** `POST /api/auth/2fa/recovery/regenerate` — `{code}`; old codes are dead. */
export async function handleTwoFactorRecoveryRegeneratePost(
	req: Request,
	remoteAddr?: string,
	store: TwoFactorStore = twoFactorStore(),
): Promise<Response> {
	if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
	if (!isGenuinelyLocalRequest(req, remoteAddr)) {
		const denial = await twoFactorStepUpDenial(req, remoteAddr, store);
		if (denial) return denial;
	}
	const body = await readBody(req);
	const code = typeof body.code === "string" ? body.code : "";
	const recoveryCode = typeof body.recoveryCode === "string" ? body.recoveryCode : "";
	if (code === "" && recoveryCode === "") return json({ error: "expected_code" }, 400);
	const limiterKey = `${TWO_FACTOR_LIMITER_PREFIX}recovery:${remoteAddr ?? "unknown"}`;
	const limiter = getRemoteAuthLimiter();
	const blocked = limiter.status(limiterKey);
	if (blocked.blocked) return rateLimitedRemoteResponse(blocked.retryAfterSeconds);
	const valid = code !== "" ? (await store.verifyCode(code)).ok : await store.consumeRecoveryCode(recoveryCode);
	if (!valid) {
		const afterFailure = limiter.recordFailure(limiterKey);
		if (afterFailure.blocked) return rateLimitedRemoteResponse(afterFailure.retryAfterSeconds);
		return json({ error: "invalid_code" }, 401);
	}
	limiter.clear(limiterKey);
	const result = await store.regenerateRecoveryCodes();
	if (!result.ok) return json({ error: "not_enrolled" }, 400);
	return json({ recoveryCodes: result.recoveryCodes });
}

/** `PUT /api/auth/2fa/policy` — `{required}`; enabling needs enrollment. */
export async function handleTwoFactorPolicyPut(
	req: Request,
	remoteAddr?: string,
	store: TwoFactorStore = twoFactorStore(),
): Promise<Response> {
	if (req.method !== "PUT") return json({ error: "Method not allowed" }, 405);
	if (!isGenuinelyLocalRequest(req, remoteAddr)) {
		const denial = await twoFactorStepUpDenial(req, remoteAddr, store);
		if (denial) return denial;
	}
	const body = await readBody(req);
	if (typeof body.required !== "boolean") return json({ error: "expected_required_boolean" }, 400);
	const result = await store.setRequired(body.required);
	if (!result.ok) return json({ error: result.reason }, 400);
	return json({ ok: true, required: body.required });
}
