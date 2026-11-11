/**
 * Work Studio → identity, devices and remote access: the data layer.
 *
 * Settings → 身份与设备 is where a user finds the machine's security surface:
 * paired devices, the machine-wide remote token and its pairing QR, and the
 * TOTP second factor. The gateway owns all of it — `/api/remote/*`,
 * `/api/auth/2fa`, `remote.*` in `web.yml` — so this module only shapes
 * requests, keeps no secrets, and never invents a state the server did not
 * report.
 *
 * Remote semantics enforced server-side (see auth/two-factor-auth.ts):
 * first TOTP enrollment is local-only; device/token mutations need a
 * ten-minute step-up when the policy is enabled; reads stay open so this pane
 * can render the prompt.
 */
import { isRecord } from "../typeGuards";
import { defaultGatewayFetch, gatewayJson, type GatewayFetch } from "./gatewayRequest";

/** The mask `GET /api/web-config` uses in place of a stored secret. */
export const MASKED_SECRET = "••••";

export type SecurityFetch = GatewayFetch;

const defaultFetch: SecurityFetch = defaultGatewayFetch;

export interface PairedDevice {
	id: string;
	label: string;
	platform: string;
	scopes: readonly string[];
	createdAt: string;
	lastSeenAt: string | null;
	revokedAt: string | null;
}

export interface DeviceInventory {
	devices: readonly PairedDevice[];
	currentDeviceId: string | null;
	legacyTokenActive: boolean;
}

/**
 * The pairing response: a one-time code plus its QR payload.
 *
 * There is deliberately no token field — the server stopped returning the
 * machine token, and a surface should only ever show the short-lived code.
 */
export interface PairingQr {
	url: string;
	svg: string;
	code: string;
	/** ISO timestamp, or `null` for a pinned development code. */
	expiresAt: string | null;
}

/** `remote.*` facts from `GET /api/web-config`; the token itself stays masked. */
export interface RemoteAccessView {
	tokenActive: boolean;
	publicUrl: string | null;
	allowPlainHttp: boolean;
	tlsEnabled: boolean;
}

/** `GET /api/auth/2fa` — account/device second factor, never the secret. */
export interface TwoFactorStatus {
	enrolled: boolean;
	required: boolean;
	enrolledAt: string | null;
	recoveryCodesRemaining: number;
	pending: boolean;
	verified: boolean;
	verifiedUntil: string | null;
}

/** What enroll returns: the plaintext secret and recovery codes exist only in this response. */
export interface TwoFactorEnrollment {
	secret: string;
	otpauthUrl: string;
	qrSvg: string;
	recoveryCodes: readonly string[];
	expiresAt: string;
}

export interface TwoFactorVerification {
	verifiedUntil: string;
	method: "totp" | "recovery";
	recoveryCodesRemaining: number;
}

/** `GET /api/remote/devices` — paired devices, never their tokens. */
export async function fetchPairedDevices(fetcher: SecurityFetch = defaultFetch): Promise<DeviceInventory> {
	const payload = await gatewayJson(fetcher, "/api/remote/devices");
	if (!isRecord(payload) || !Array.isArray(payload.devices)) throw new Error("Device list response is malformed");
	const devices: PairedDevice[] = [];
	for (const entry of payload.devices) {
		if (!isRecord(entry) || typeof entry.id !== "string" || entry.id === "") continue;
		devices.push({
			id: entry.id,
			label: typeof entry.label === "string" ? entry.label : "",
			platform: typeof entry.platform === "string" ? entry.platform : "unknown",
			scopes: Array.isArray(entry.scopes) ? entry.scopes.filter((scope): scope is string => typeof scope === "string") : [],
			createdAt: typeof entry.createdAt === "string" ? entry.createdAt : "",
			lastSeenAt: typeof entry.lastSeenAt === "string" ? entry.lastSeenAt : null,
			revokedAt: typeof entry.revokedAt === "string" ? entry.revokedAt : null,
		});
	}
	return {
		devices,
		currentDeviceId: typeof payload.currentDeviceId === "string" ? payload.currentDeviceId : null,
		legacyTokenActive: payload.legacyTokenActive === true,
	};
}

/** `GET /api/remote/pairing` — the one-time code and QR a new device scans. */
export async function fetchPairingQr(fetcher: SecurityFetch = defaultFetch): Promise<PairingQr> {
	const payload = await gatewayJson(fetcher, "/api/remote/pairing");
	if (
		!isRecord(payload) ||
		typeof payload.url !== "string" ||
		typeof payload.svg !== "string" ||
		typeof payload.code !== "string"
	) {
		throw new Error("Pairing response is malformed");
	}
	return {
		url: payload.url,
		svg: payload.svg,
		code: payload.code,
		expiresAt: typeof payload.expiresAt === "string" ? payload.expiresAt : null,
	};
}

/** `DELETE /api/remote/devices/:id`. */
export async function revokePairedDevice(fetcher: SecurityFetch, id: string): Promise<void> {
	await gatewayJson(fetcher, `/api/remote/devices/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** `POST /api/remote/devices/revoke-all` — `keepCurrent` spares the calling device. */
export async function revokeAllPairedDevices(fetcher: SecurityFetch, keepCurrent: boolean): Promise<number> {
	const payload = await gatewayJson(fetcher, "/api/remote/devices/revoke-all", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ keepCurrent }),
	});
	return isRecord(payload) && typeof payload.revoked === "number" ? payload.revoked : 0;
}

/** `GET /api/web-config` → the remote-access facts (the token is masked). */
export async function fetchRemoteAccess(fetcher: SecurityFetch = defaultFetch): Promise<RemoteAccessView> {
	const payload = await gatewayJson(fetcher, "/api/web-config");
	if (!isRecord(payload) || !isRecord(payload.remote)) throw new Error("Web config response is malformed");
	const remote = payload.remote;
	const token = typeof remote.token === "string" ? remote.token : "";
	return {
		tokenActive: token !== "",
		publicUrl: typeof remote.publicUrl === "string" && remote.publicUrl !== "" ? remote.publicUrl : null,
		allowPlainHttp: remote.allowPlainHttp === true,
		tlsEnabled: isRecord(remote.tls) && remote.tls.enabled === true,
	};
}

/**
 * `POST /api/remote/token/rotate` — mints a new machine token and revokes the
 * old one. The new plaintext is deliberately not returned to the renderer:
 * pairing asks the gateway for a fresh QR, which embeds the live token.
 */
export async function rotateRemoteToken(fetcher: SecurityFetch): Promise<void> {
	await gatewayJson(fetcher, "/api/remote/token/rotate", { method: "POST" });
}

/** `POST /api/remote/token/revoke` — `{ all: true }` revokes the active token. */
export async function revokeRemoteToken(fetcher: SecurityFetch): Promise<boolean> {
	const payload = await gatewayJson(fetcher, "/api/remote/token/revoke", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ all: true }),
	});
	return isRecord(payload) && payload.activeTokenRevoked === true;
}

/** `GET /api/desktop/info` — whether the serving process was spawned by the shell. */
export async function fetchDesktopHostInfo(fetcher: SecurityFetch = defaultFetch): Promise<boolean> {
	const payload = await gatewayJson(fetcher, "/api/desktop/info");
	return isRecord(payload) && payload.desktop === true;
}

function twoFactorStatus(value: unknown): TwoFactorStatus {
	const record = isRecord(value) ? value : {};
	return {
		enrolled: record.enrolled === true,
		required: record.required === true,
		enrolledAt: typeof record.enrolledAt === "string" ? record.enrolledAt : null,
		recoveryCodesRemaining: typeof record.recoveryCodesRemaining === "number" ? record.recoveryCodesRemaining : 0,
		pending: record.pending === true,
		verified: record.verified === true,
		verifiedUntil: typeof record.verifiedUntil === "string" ? record.verifiedUntil : null,
	};
}

/** `GET /api/auth/2fa`. */
export async function fetchTwoFactorStatus(fetcher: SecurityFetch = defaultFetch): Promise<TwoFactorStatus> {
	return twoFactorStatus(await gatewayJson(fetcher, "/api/auth/2fa"));
}

/** `POST /api/auth/2fa/enroll` — local (or recently verified) callers only. */
export async function enrollTwoFactor(fetcher: SecurityFetch = defaultFetch): Promise<TwoFactorEnrollment> {
	const payload = await gatewayJson(fetcher, "/api/auth/2fa/enroll", { method: "POST" });
	if (!isRecord(payload) || typeof payload.secret !== "string" || typeof payload.otpauthUrl !== "string") {
		throw new Error("2FA enrollment response is malformed");
	}
	const codes = Array.isArray(payload.recoveryCodes)
		? payload.recoveryCodes.filter((code): code is string => typeof code === "string")
		: [];
	return {
		secret: payload.secret,
		otpauthUrl: payload.otpauthUrl,
		qrSvg: typeof payload.qrSvg === "string" ? payload.qrSvg : "",
		recoveryCodes: codes,
		expiresAt: typeof payload.expiresAt === "string" ? payload.expiresAt : "",
	};
}

/** `POST /api/auth/2fa/confirm` — activates the pending secret. */
export async function confirmTwoFactor(fetcher: SecurityFetch, code: string): Promise<void> {
	await gatewayJson(fetcher, "/api/auth/2fa/confirm", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ code }),
	});
}

/** `POST /api/auth/2fa/verify` — `{code}` or `{recoveryCode}`. */
export async function verifyTwoFactor(
	fetcher: SecurityFetch,
	credential: { code?: string; recoveryCode?: string },
): Promise<TwoFactorVerification> {
	const payload = await gatewayJson(fetcher, "/api/auth/2fa/verify", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(credential),
	});
	if (!isRecord(payload) || typeof payload.verifiedUntil !== "string") {
		throw new Error("2FA verification response is malformed");
	}
	return {
		verifiedUntil: payload.verifiedUntil,
		method: payload.method === "recovery" ? "recovery" : "totp",
		recoveryCodesRemaining: typeof payload.recoveryCodesRemaining === "number" ? payload.recoveryCodesRemaining : 0,
	};
}

/** `POST /api/auth/2fa/disable` — local callers need no code. */
export async function disableTwoFactor(fetcher: SecurityFetch, code?: string): Promise<void> {
	await gatewayJson(fetcher, "/api/auth/2fa/disable", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(code !== undefined && code !== "" ? { code } : {}),
	});
}

/** `POST /api/auth/2fa/recovery/regenerate` — the old set dies immediately. */
export async function regenerateRecoveryCodes(fetcher: SecurityFetch, code: string): Promise<string[]> {
	const payload = await gatewayJson(fetcher, "/api/auth/2fa/recovery/regenerate", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ code }),
	});
	return isRecord(payload) && Array.isArray(payload.recoveryCodes)
		? payload.recoveryCodes.filter((entry): entry is string => typeof entry === "string")
		: [];
}

/** `PUT /api/auth/2fa/policy` — enabling without enrollment is a 400, never a fake switch. */
export async function putTwoFactorPolicy(fetcher: SecurityFetch, required: boolean): Promise<void> {
	await gatewayJson(fetcher, "/api/auth/2fa/policy", {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ required }),
	});
}

/** True when a failed call needs a TOTP step-up before it can be retried. */
export function isTwoFactorRequired(error: unknown): boolean {
	return error instanceof Error && error.message === "totp_required";
}

/** True when first enrollment must happen on this machine. */
export function isLocalOnlyRequired(error: unknown): boolean {
	return error instanceof Error && error.message === "local_required";
}
