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
}

/**
 * Gate for browser-facing session surfaces (Studio `/api/v1`): a genuine local
 * socket passes, everything else — including loopback sockets that carry proxy
 * forwarding headers — goes through {@link checkRemoteAccess}, so it needs the
 * configured `remote.token` and shares the same failure limiter.
 */
export async function checkBrowserAccess(
	req: Request,
	remoteAddr: string | undefined,
	limiter: AuthFailureLimiter = getRemoteAuthLimiter(),
): Promise<BrowserAccessDecision> {
	if (isGenuinelyLocalRequest(req, remoteAddr)) return { denial: null, genuinelyLocal: true };
	const denial = await checkRemoteAccess(req, remoteAddr ?? "unknown", limiter);
	return { denial, genuinelyLocal: false };
}

/**
 * Full gate for one non-loopback request: rate limit, then token verification
 * (active token and not revoked). Returns `null` when the request may proceed.
 *
 * A successful check clears the peer's failure history; a failure is recorded
 * before the 401 (and a request that trips the limit is itself answered 429).
 */
export async function checkRemoteAccess(
	req: Request,
	peerKey: string,
	limiter: AuthFailureLimiter = getRemoteAuthLimiter(),
): Promise<Response | null> {
	const blocked = limiter.status(peerKey);
	if (blocked.blocked) return rateLimitedRemoteResponse(blocked.retryAfterSeconds);

	const config = await WebConfig.load();
	const provided = req.headers.get("authorization") ?? req.headers.get("x-zeta-token");
	if (isRemoteTokenAccepted(config.getData().remote, provided)) {
		limiter.clear(peerKey);
		return null;
	}
	const afterFailure = limiter.recordFailure(peerKey);
	if (afterFailure.blocked) return rateLimitedRemoteResponse(afterFailure.retryAfterSeconds);
	return unauthorizedRemoteResponse();
}
