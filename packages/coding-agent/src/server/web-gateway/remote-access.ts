/**
 * Remote-access gate hardening for WAN exposure.
 *
 * The access gate (`authorizedForAccess` in `../web-gateway`) decides *who* may
 * reach the control plane: loopback sockets pass, everyone else must present
 * `remote.token`. This module adds the two things a public endpoint needs on
 * top of that:
 *
 * - **Rate limiting** — repeated failed token attempts from one peer are
 *   blocked for a cooldown, so a scanner cannot brute-force a token; a valid
 *   token is not honoured while that peer is blocked either.
 * - **Token lifecycle** — a token that was rotated away or explicitly revoked
 *   is rejected even if someone still holds it (see `utils/remote-token.ts`).
 *
 * Failures are counted per socket peer address (never the client-controlled
 * `Host`), and a successful authentication clears the counter.
 */

import { WebConfig } from "../../config/web-config";
import { isRemoteTokenAccepted, MASKED_TOKEN } from "../../utils/remote-token";
import { deviceRegistry, type DeviceRecord, type DeviceScope } from "../auth/device-registry";
import { effectiveBinding, type DeviceBinding } from "../auth/binding";
import { sessionStore } from "../auth/session-store";
import { hostIsLoopback } from "./origin";

export interface AuthLimiterOptions {
	/** Failed attempts allowed inside one window before the peer is blocked. */
	maxFailures: number;
	/** Sliding window over which failures accumulate. */
	windowMs: number;
	/** How long a tripped peer stays blocked. */
	blockMs: number;
}

export const DEFAULT_AUTH_LIMITER_OPTIONS: AuthLimiterOptions = {
	maxFailures: 10,
	windowMs: 60_000,
	blockMs: 60_000,
};

export interface AuthLimitStatus {
	blocked: boolean;
	/** Whole seconds until the block lifts (0 when not blocked). */
	retryAfterSeconds: number;
}

/**
 * Sliding-window failure limiter keyed by peer address. Pure in-memory state:
 * a serve restart starts from a clean slate, which is the right trade-off for
 * a single-user desktop agent (persisting lockouts would outlive the attack).
 */
export class AuthFailureLimiter {
	readonly #options: AuthLimiterOptions;
	readonly #failures = new Map<string, number[]>();
	readonly #blockedUntil = new Map<string, number>();

	constructor(options: Partial<AuthLimiterOptions> = {}) {
		this.#options = { ...DEFAULT_AUTH_LIMITER_OPTIONS, ...options };
	}

	status(key: string, now = Date.now()): AuthLimitStatus {
		const until = this.#blockedUntil.get(key);
		if (until === undefined) return { blocked: false, retryAfterSeconds: 0 };
		if (until > now) return { blocked: true, retryAfterSeconds: Math.ceil((until - now) / 1000) };
		this.#blockedUntil.delete(key);
		return { blocked: false, retryAfterSeconds: 0 };
	}

	/** Count one failed attempt; returns the peer's state after recording it. */
	recordFailure(key: string, now = Date.now()): AuthLimitStatus {
		const { maxFailures, windowMs, blockMs } = this.#options;
		const recent = (this.#failures.get(key) ?? []).filter(at => now - at < windowMs);
		recent.push(now);
		if (recent.length >= maxFailures) {
			this.#failures.delete(key);
			this.#blockedUntil.set(key, now + blockMs);
			return { blocked: true, retryAfterSeconds: Math.ceil(blockMs / 1000) };
		}
		this.#failures.set(key, recent);
		return { blocked: false, retryAfterSeconds: 0 };
	}

	/** A successful authentication wipes the peer's failure history. */
	clear(key: string): void {
		this.#failures.delete(key);
		this.#blockedUntil.delete(key);
	}

	reset(): void {
		this.#failures.clear();
		this.#blockedUntil.clear();
	}
}

let sharedLimiter: AuthFailureLimiter | undefined;

export function getRemoteAuthLimiter(): AuthFailureLimiter {
	sharedLimiter ??= new AuthFailureLimiter();
	return sharedLimiter;
}

/** Test isolation: bun runs every suite in one process. */
export function resetRemoteAccessForTests(): void {
	sharedLimiter = undefined;
}

/** 401 for a missing/wrong/revoked token (distinct from a CSRF 403). */
export function unauthorizedRemoteResponse(reason = "remote access requires a valid remote token"): Response {
	return Response.json(
		{ error: reason },
		{ status: 401, headers: { "WWW-Authenticate": 'Bearer realm="zeta-remote"' } },
	);
}

export function rateLimitedRemoteResponse(retryAfterSeconds: number): Response {
	return Response.json(
		{ error: "Too many failed authentication attempts; retry later", retryAfterSeconds },
		{ status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
	);
}

/**
 * Headers a reverse proxy, tunnel (ngrok, cloudflared, Tailscale Funnel) or
 * load balancer adds to the request it forwards. A direct browser socket never
 * carries one, so their presence proves the socket address is the proxy's —
 * a loopback peer behind such a proxy is the whole internet, not the desktop.
 */
const PROXY_FORWARDING_HEADERS = [
	"forwarded",
	"x-forwarded-for",
	"x-forwarded-host",
	"x-forwarded-proto",
	"x-forwarded-port",
	"x-forwarded-server",
	"x-real-ip",
	"x-client-ip",
	"x-original-forwarded-for",
	"x-cluster-client-ip",
	"cf-connecting-ip",
	"cf-connecting-ipv6",
	"true-client-ip",
	"fastly-client-ip",
] as const;

/** Whether `req` was forwarded by a proxy/tunnel (see {@link PROXY_FORWARDING_HEADERS}). */
export function hasProxyForwardingHeaders(req: Request): boolean {
	for (const name of PROXY_FORWARDING_HEADERS) {
		if (req.headers.get(name) !== null) return true;
	}
	return false;
}

/**
 * A peer that may be trusted as the local desktop: the socket address is
 * loopback AND no forwarding header says a proxy relayed the request.
 *
 * Loopback alone is not enough behind a reverse proxy or tunnel: every remote
 * client then shares `127.0.0.1` with the local renderer, and treating that as
 * "local" would open the whole control plane to the internet.
 */
export function isGenuinelyLocalRequest(req: Request, remoteAddr?: string): boolean {
	return hostIsLoopback(req, remoteAddr) && !hasProxyForwardingHeaders(req);
}

/**
 * Whether the operator turned remote access on: a live `remote.token` or a
 * `remote.publicUrl` (proxy/tunnel origin). While it is on, a loopback peer
 * still passes the socket gate but must prove itself — no implicit pairing.
 */
export function isRemoteModeActive(remote: { token?: string; publicUrl?: string } | undefined): boolean {
	const token = remote?.token?.trim() ?? "";
	const hasToken = token !== "" && token !== MASKED_TOKEN;
	const hasPublicUrl = (remote?.publicUrl?.trim() ?? "") !== "";
	return hasToken || hasPublicUrl;
}

export interface BrowserAccessDecision {
	/** Response to send, or `null` when the request may proceed. */
	denial: Response | null;
	/** Whether the peer is a genuine local socket (trusted, may auto-pair). */
	genuinelyLocal: boolean;
	/** Resolved credential; `null` only when `denial` is set. */
	credential: RemoteCredential | null;
}

/**
 * What authenticated a request.
 *
 * `local` is a genuine loopback socket; `machine` is the machine-wide
 * `remote.token`; `device` is a per-device `zdt_…` header; `session` is the
 * device-bound `studio_session` cookie. Cookies are checked **first** and never
 * fall back to a stronger credential: a revoked cookie must not silently regain
 * access through a still-valid machine token.
 */
export type RemoteCredential =
	| { readonly kind: "local" }
	| { readonly kind: "machine" }
	| { readonly kind: "device"; readonly device: DeviceRecord }
	| {
			readonly kind: "session";
			readonly sessionId: string;
			readonly device: DeviceRecord;
			readonly binding?: DeviceBinding;
	  };

/** Read one cookie value from a request (no dependency on the host's parser). */
export function readCookie(req: Request, name: string): string | undefined {
	for (const part of (req.headers.get("cookie") ?? "").split(";")) {
		const index = part.indexOf("=");
		if (index <= 0) continue;
		if (part.slice(0, index).trim() !== name) continue;
		const value = decodeURIComponent(part.slice(index + 1).trim());
		return value === "" ? undefined : value;
	}
	return undefined;
}

/** Scopes attached to a credential. Local and machine credentials are unrestricted. */
export function credentialScopes(credential: RemoteCredential): readonly DeviceScope[] {
	if (credential.kind === "local" || credential.kind === "machine") return ["read", "write"];
	return credential.device.scopes;
}

export function credentialAllows(credential: RemoteCredential, scope: DeviceScope): boolean {
	return credentialScopes(credential).includes(scope);
}

/**
 * Binding carried by the credential.
 *
 * `null` means the device and session bindings contradict each other; callers
 * must refuse the request (a contradictory binding is narrower than either, and
 * treating it as "unbound" would widen the grant).
 */
export function credentialBinding(credential: RemoteCredential): DeviceBinding | undefined | null {
	if (credential.kind === "device") return credential.device.binding;
	if (credential.kind === "session") return effectiveBinding(credential.device.binding, credential.binding);
	return undefined;
}

/**
 * Resolve the credential a request presents, without rate limiting.
 *
 * Order is deliberate: cookie → header. A present-but-invalid cookie is a
 * hard failure (no silent fallback), because a revoked session must not be
 * resurrected by a machine token the browser also happens to carry.
 * Device `lastSeenAt` is refreshed on header use (throttled inside the registry).
 */
export async function resolveCredential(req: Request): Promise<RemoteCredential | null> {
	const cookie = readCookie(req, "studio_session");
	if (cookie !== undefined) {
		const session = await sessionStore().get(cookie);
		if (session === undefined) return null;
		const device = await deviceRegistry().get(session.deviceId);
		if (device === undefined || device.revokedAt !== null) {
			// Revoked underneath a live session: drop it so the next request is clean.
			await sessionStore().delete(cookie);
			return null;
		}
		await sessionStore().touch(cookie);
		return {
			kind: "session",
			sessionId: cookie,
			device,
			...(session.binding !== undefined ? { binding: session.binding } : {}),
		};
	}
	const provided = req.headers.get("authorization") ?? req.headers.get("x-zeta-token");
	const config = await WebConfig.load();
	if (isRemoteTokenAccepted(config.getData().remote, provided)) return { kind: "machine" };
	const device = await deviceRegistry().resolve(provided ?? "");
	return device !== undefined ? { kind: "device", device } : null;
}

/**
 * Gate for browser-facing session surfaces: a genuine local socket passes,
 * everything else resolves a credential (session cookie, device token, or the
 * machine token) under the shared failure limiter.
 */
export async function checkBrowserAccess(
	req: Request,
	remoteAddr: string | undefined,
	limiter: AuthFailureLimiter = getRemoteAuthLimiter(),
): Promise<BrowserAccessDecision> {
	if (isGenuinelyLocalRequest(req, remoteAddr)) {
		return { denial: null, genuinelyLocal: true, credential: { kind: "local" } };
	}
	const result = await authenticateRemote(req, remoteAddr ?? "unknown", limiter);
	if (result.denial !== null) return { denial: result.denial, genuinelyLocal: false, credential: null };
	return { denial: null, genuinelyLocal: false, credential: result.credential };
}

export type AccessResult =
	| { readonly denial: Response; readonly credential?: undefined }
	| { readonly denial: null; readonly credential: RemoteCredential };

/**
 * Full gate for one non-loopback request: rate limit, then credential
 * verification. A request passes with a device-bound session cookie, a
 * per-device token, or the machine-wide `remote.token`.
 *
 * A successful check clears the peer's failure history; a failure is recorded
 * before the 401 (and a request that trips the limit is itself answered 429).
 */
export async function authenticateRemote(
	req: Request,
	peerKey: string,
	limiter: AuthFailureLimiter = getRemoteAuthLimiter(),
): Promise<AccessResult> {
	const blocked = limiter.status(peerKey);
	if (blocked.blocked) return { denial: rateLimitedRemoteResponse(blocked.retryAfterSeconds) };

	const credential = await resolveCredential(req);
	if (credential !== null) {
		limiter.clear(peerKey);
		return { denial: null, credential };
	}
	const afterFailure = limiter.recordFailure(peerKey);
	if (afterFailure.blocked) return { denial: rateLimitedRemoteResponse(afterFailure.retryAfterSeconds) };
	return { denial: unauthorizedRemoteResponse() };
}

/** Boolean/response form kept for callers that only need pass/fail (stats). */
export async function checkRemoteAccess(
	req: Request,
	peerKey: string,
	limiter: AuthFailureLimiter = getRemoteAuthLimiter(),
): Promise<Response | null> {
	return (await authenticateRemote(req, peerKey, limiter)).denial ?? null;
}
