/**
 * The Studio host HTTP surface: `/health` and `/api/v1/*`.
 *
 * This is the browser-facing contract `@linxiraos/studio-transport-web` speaks
 * (pairing, `studio_session` cookie + CSRF for mutations, semantic
 * query/command envelopes, one event WebSocket). Semantics are copied from the
 * vendored loopback adapter so the desktop shell and `zeta serve` cannot
 * disagree about auth or envelope shape.
 *
 * Auth model, in order:
 * - `GET /health` is unprotected: it is the "am I talking to a Studio host"
 *   probe, and it carries no state.
 * - every other route goes through the same remote-access gate as the rest of
 *   `zeta serve`: only a *genuine* local peer (loopback socket with no proxy
 *   forwarding header) may skip `remote.token`; anything behind a reverse
 *   proxy/tunnel needs the token and shares the failure limiter, because such
 *   a proxy makes every remote peer look like `127.0.0.1`;
 * - an allowed `Origin` is still required (loopback pages only, the same
 *   allowlist the gateway uses) — a hostile page cannot drive this host;
 * - pairing mints a `studio_session` cookie plus the CSRF token the page must
 *   echo on mutations; the pairing code is printed by `zeta serve` and is
 *   single-use and time-boxed. Failed pair attempts are rate-limited;
 * - implicit (loopback) pairing is only for a plain local install: once
 *   remote access is configured, even a local peer pairs with the code;
 * - request bodies are capped at 1 MiB and one session may hold only a few
 *   commands in flight.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import type {
	ClientBootstrap,
	ClientCommandRequest,
	ClientEvent,
	ClientQueryRequest,
	CommandReceipt,
	EventCursor,
	RuntimeConnection,
	SubscriptionScope,
} from "./contract/index.js";
import { isAllowedOrigin } from "../web-gateway/origin";
import {
	checkBrowserAccess,
	getRemoteAuthLimiter,
	isRemoteModeActive,
	rateLimitedRemoteResponse,
} from "../web-gateway/remote-access";
import { WebConfig } from "../../config/web-config";
import { logger } from "@linxiraos/pi-utils";
import { deviceRegistry, inferPlatform, type PublicDevice } from "../auth/device-registry";
import { guardStudioTwoFactor } from "../auth/two-factor-auth";
import { buildBootstrap } from "./bootstrap.js";
import { StudioOperations, StudioOpError, toClientError } from "./registry.js";
import type { StudioHostContext } from "./registry.js";

/** Prefix every Studio route hangs off. */
export const STUDIO_API_PREFIX = "/api/v1/";
/** Event WebSocket path. */
export const STUDIO_EVENTS_PATH = "/api/v1/events";
/** Cookie carrying the pairing session. */
export const STUDIO_SESSION_COOKIE = "studio_session";
/** Header the page must echo on mutating routes. */
export const STUDIO_CSRF_HEADER = "x-studio-csrf";

const MAX_BODY_BYTES = 1_048_576;
const MAX_OUTSTANDING_COMMANDS = 8;
const PAIRING_TTL_MS = 60_000;
const SESSION_TTL_MS = 3_600_000;

interface StudioSession {
	csrf: string;
	expiresAt: number;
	scope: SubscriptionScope;
	outstanding: number;
	/**
	 * Device this session was paired for. Present when pairing issued a device
	 * token, so revoking that device can drop the session and its sockets.
	 */
	deviceId?: string;
}

/** Per-connection state for the event socket. */
export interface StudioWsData {
	kind: "studio";
	sessionId: string;
}

/** The slice of a Bun socket the host needs (kept structural for testability). */
export interface StudioSocket {
	send(data: string): unknown;
	/** Optional so test doubles stay trivial; real Bun sockets close on revoke. */
	close?(): unknown;
}

/** Event bodies the host emits; the envelope fields are added here, once. */
type StudioEventBody =
	| { readonly kind: "command.receipt"; readonly receipt: CommandReceipt }
	| { readonly kind: "runtime.changed"; readonly connection: RuntimeConnection }
	| { readonly kind: "resync.required"; readonly reason: string }
	| { readonly kind: "state.changed" };

function token(bytes = 24): string {
	return randomBytes(bytes).toString("base64url");
}

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
	});
}

function cookies(header: string | null): Record<string, string> {
	const out: Record<string, string> = {};
	for (const part of (header ?? "").split(";")) {
		const index = part.indexOf("=");
		if (index > 0) out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
	}
	return out;
}

/**
 * Namespace for pairing attempts in the shared failure limiter: a wrong code
 * is an auth failure like a wrong token, but it must not consume the token
 * gate's budget for the same peer (and vice versa).
 */
const PAIR_LIMITER_PREFIX = "studio-pair:";

/** Whether `req` belongs to the Studio surface (`/health` or `/api/v1/*`). */
export function isStudioRequest(req: Request): boolean {
	const path = new URL(req.url).pathname;
	return path === "/health" || path.startsWith(STUDIO_API_PREFIX);
}

/** Whether `req` is the Studio event WebSocket upgrade. */
export function isStudioWsUpgradeRequest(req: Request): boolean {
	if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return false;
	return new URL(req.url).pathname === STUDIO_EVENTS_PATH;
}

/** Structural stand-in for `Bun.Server` so the host stays unit-testable. */
export interface StudioWsServer {
	upgrade(req: Request, options: { data: StudioWsData }): boolean;
}

/**
 * The Studio host: one instance per process, created on first use so `zeta
 * serve` logs the pairing code exactly once.
 */
export class StudioHost {
	readonly #operations: StudioOperations;
	readonly #sessions = new Map<string, StudioSession>();
	readonly #sockets = new Map<string, Set<StudioSocket>>();
	#pairing: { code: string; expiresAt: number; used: boolean };
	/**
	 * A pinned pairing code (`ZETA_STUDIO_PAIRING_CODE` or the constructor
	 * option) is a local-testing affordance: it stays valid for its TTL instead
	 * of being consumed by the first pairing, so a script can pair again after a
	 * reload. A generated code is always single-use.
	 */
	readonly #pairingReusable: boolean;
	#cursor = 0;

	constructor(operations: StudioOperations = new StudioOperations(), options: { pairingCode?: string } = {}) {
		this.#operations = operations;
		const pinned = options.pairingCode ?? process.env.ZETA_STUDIO_PAIRING_CODE;
		const code = pinned ?? token(8);
		this.#pairingReusable = pinned !== undefined;
		this.#pairing = {
			code,
			// A pinned code is a development affordance, not a one-shot secret:
			// it stays valid so a script can pair again after every rebuild.
			expiresAt: this.#pairingReusable ? Number.POSITIVE_INFINITY : Date.now() + PAIRING_TTL_MS,
			used: false,
		};
	}

	get operations(): StudioOperations {
		return this.#operations;
	}

	/** Single-use pairing code the operator types into the browser. */
	get pairingCode(): string {
		return this.#pairing.code;
	}

	#now(): number {
		return Date.now();
	}

	#session(req: Request): [string, StudioSession] | undefined {
		const id = cookies(req.headers.get("cookie"))[STUDIO_SESSION_COOKIE];
		if (!id) return undefined;
		const session = this.#sessions.get(id);
		if (!session || session.expiresAt <= this.#now()) return undefined;
		return [id, session];
	}

	/** Origin + session (+ CSRF when mutating); `undefined` when unauthorised. */
	#authorize(req: Request, mutate = false): [string, StudioSession] | undefined {
		if (!isAllowedOrigin(req.headers.get("origin"))) return undefined;
		const session = this.#session(req);
		if (!session) return undefined;
		if (mutate && req.headers.get(STUDIO_CSRF_HEADER) !== session[1].csrf) return undefined;
		return session;
	}

	async #body(req: Request): Promise<unknown> {
		const length = Number(req.headers.get("content-length") ?? "0");
		if (Number.isFinite(length) && length > MAX_BODY_BYTES) throw new Error("body_too_large");
		const text = await req.text();
		if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw new Error("body_too_large");
		if (text === "") return {};
		return JSON.parse(text) as unknown;
	}

	/** Handle one Studio request; throws nothing, always answers a Response. */
	async handle(req: Request, remoteAddr?: string): Promise<Response> {
		const url = new URL(req.url);
		if (url.pathname === "/health") {
			if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
			return json({ ok: true, protocolVersion: 1 });
		}
		// Same remote-access gate as every other remote surface: only a genuine
		// local socket skips `remote.token`. A reverse proxy/tunnel makes every
		// peer look like loopback, so forwarding headers force the token path —
		// `isAllowedOrigin` + implicit pairing alone must never authorize `/api/v1`.
		const access = await checkBrowserAccess(req, remoteAddr);
		if (access.denial) return access.denial;
		// The Origin allowlist is a CSRF guard for *ambient* authority: a local
		// browser whose cookie the page carries implicitly. A peer that already
		// presented a token (or device token) proved possession of a secret, and a
		// phone's own origin is never loopback — enforcing the allowlist there
		// made every remote, correctly authenticated Studio 403.
		if (access.genuinelyLocal && !isAllowedOrigin(req.headers.get("origin"))) {
			return json({ error: "forbidden" }, 403);
		}
		// 2FA gates exactly two surfaces here: adding a device (pairing) needs a
		// ten-minute step-up, and `/api/v1/command` needs the twelve-hour write
		// window. Queries and bootstrap stay readable so the UI can ask for a code.
		const twoFactorDenial = await guardStudioTwoFactor(req, remoteAddr, url.pathname);
		if (twoFactorDenial) return twoFactorDenial;
		const context: StudioHostContext = {
			origin: req.headers.get("origin") ?? undefined,
			capabilities: this.#operations.capabilities().manifest,
		};
		try {
			if (url.pathname === "/api/v1/pair" && req.method === "POST") return await this.#pair(req, remoteAddr);
			if (url.pathname === "/api/v1/session/revoke" && req.method === "POST") return this.#revoke(req);
			if (url.pathname === "/api/v1/bootstrap" && req.method === "GET")
				return await this.#bootstrap(req, access.genuinelyLocal);
			if (url.pathname === "/api/v1/query" && req.method === "POST") return await this.#query(req, context);
			if (url.pathname === "/api/v1/command" && req.method === "POST") return await this.#command(req, context);
			return json({ error: "not_found" }, 404);
		} catch (error) {
			const tooLarge = error instanceof Error && error.message === "body_too_large";
			return json({ error: tooLarge ? "body_too_large" : "bad_request" }, 400);
		}
	}

	async #pair(req: Request, remoteAddr?: string): Promise<Response> {
		// The pairing code is a login secret: wrong guesses are rate-limited on
		// the same limiter (and cooldown) as token failures, so brute force over
		// `/api/v1/pair` is bounded.
		const limiter = getRemoteAuthLimiter();
		const limiterKey = `${PAIR_LIMITER_PREFIX}${remoteAddr ?? "unknown"}`;
		const blocked = limiter.status(limiterKey);
		if (blocked.blocked) return rateLimitedRemoteResponse(blocked.retryAfterSeconds);
		const body = await this.#body(req);
		const rawCode = body !== null && typeof body === "object" && "code" in body ? body.code : undefined;
		const code = typeof rawCode === "string" ? rawCode : "";
		const expected = this.#pairing.code;
		const matches =
			!this.#pairing.used &&
			this.#pairing.expiresAt > this.#now() &&
			code.length === expected.length &&
			timingSafeEqual(Buffer.from(code), Buffer.from(expected));
		if (!matches) {
			const afterFailure = limiter.recordFailure(limiterKey);
			if (afterFailure.blocked) return rateLimitedRemoteResponse(afterFailure.retryAfterSeconds);
			return json({ error: "unauthenticated" }, 401);
		}
		limiter.clear(limiterKey);
		if (!this.#pairingReusable) this.#pairing.used = true;
		// Pairing is what turns "this phone knows the QR secret" into "this phone
		// has its own revocable credential". The plaintext token leaves only in
		// this response; the registry keeps its hash.
		let issued: { device: PublicDevice; token: string };
		try {
			issued = await deviceRegistry().issue(this.#deviceRequest(body, req));
		} catch (error) {
			logger.warn("Device registration failed during pairing", {
				error: error instanceof Error ? error.message : String(error),
			});
			return json({ error: "device_registry_unavailable" }, 500);
		}
		const [sessionId, session] = this.#createSession(issued.device.id);
		return json(
			{ csrf: session.csrf, expiresAt: session.expiresAt, device: { ...issued.device, token: issued.token } },
			200,
			{ "set-cookie": this.#sessionCookie(sessionId) },
		);
	}

	/**
	 * Read the optional `device` block a client sends with its pairing code.
	 * The label is a display string; the platform is normalized by the registry
	 * and defaults to what the User-Agent implies.
	 */
	#deviceRequest(body: unknown, req: Request): { label?: string; platform?: string; machineId?: string } {
		const empty: { label?: string; platform?: string; machineId?: string } = {
			platform: inferPlatform(req.headers.get("user-agent")),
		};
		if (body === null || typeof body !== "object" || !("device" in body)) return empty;
		const raw = body.device;
		if (raw === null || typeof raw !== "object") return empty;
		const label = "label" in raw && typeof raw.label === "string" ? raw.label : undefined;
		const platform = "platform" in raw && typeof raw.platform === "string" ? raw.platform : undefined;
		const machineId = "machineId" in raw && typeof raw.machineId === "string" ? raw.machineId : undefined;
		return {
			...(label !== undefined ? { label } : {}),
			platform: platform ?? empty.platform,
			...(machineId !== undefined ? { machineId } : {}),
		};
	}

	#createSession(deviceId?: string): [string, StudioSession] {
		const sessionId = token(32);
		const session: StudioSession = {
			csrf: token(24),
			expiresAt: this.#now() + SESSION_TTL_MS,
			scope: { scope: "all" },
			outstanding: 0,
			...(deviceId !== undefined ? { deviceId } : {}),
		};
		this.#sessions.set(sessionId, session);
		return [sessionId, session];
	}

	#sessionCookie(sessionId: string): string {
		return `${STUDIO_SESSION_COOKIE}=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Strict; Path=/`;
	}

	#revoke(req: Request): Response {
		const authorized = this.#authorize(req, true);
		if (!authorized) return json({ error: "unauthenticated" }, 401);
		this.#sessions.delete(authorized[0]);
		return json({ ok: true });
	}

	async #bootstrap(req: Request, genuinelyLocal: boolean): Promise<Response> {
		const bootstrap: ClientBootstrap = buildBootstrap(this.#operations);
		if (this.#authorize(req)) return json(bootstrap);
		// The same-origin renderer is served on a direct loopback socket by
		// `zeta serve` and the desktop shell, so it may establish its own session
		// on the bootstrap read. A proxied peer was already rejected by the
		// remote-access gate; a local peer of an install with remote access turned
		// on must pair with the code instead of pairing implicitly.
		if (genuinelyLocal) {
			const config = await WebConfig.load();
			if (!isRemoteModeActive(config.getData().remote)) {
				const [sessionId, session] = this.#createSession();
				return json(bootstrap, 200, {
					"set-cookie": this.#sessionCookie(sessionId),
					[STUDIO_CSRF_HEADER]: session.csrf,
				});
			}
		}
		return json({ error: "unauthenticated" }, 401);
	}

	async #query(req: Request, context: StudioHostContext): Promise<Response> {
		if (!this.#authorize(req)) return json({ error: "unauthenticated" }, 401);
		const body = (await this.#body(req)) as ClientQueryRequest;
		if (body === null || typeof body !== "object" || typeof body.queryName !== "string") {
			return json({ error: "bad_request" }, 400);
		}
		return json(await this.#operations.query(body, context));
	}

	async #command(req: Request, context: StudioHostContext): Promise<Response> {
		const authorized = this.#authorize(req, true);
		if (!authorized) return json({ error: "unauthenticated" }, 401);
		const [, session] = authorized;
		const body = (await this.#body(req)) as ClientCommandRequest;
		if (body === null || typeof body !== "object" || typeof body.commandName !== "string") {
			return json({ error: "bad_request" }, 400);
		}
		if (session.outstanding >= MAX_OUTSTANDING_COMMANDS) return json({ error: "rate_limited" }, 429);
		session.outstanding += 1;
		try {
			const { accepted, result } = await this.#operations.command(body, context);
			// The work already ran, so the terminal outcome is known before the
			// acknowledgement. An operation with no result payload (the host has no
			// runtime snapshot feed) reports `state.changed` instead of inventing
			// one: the renderer re-reads the state it actually needs.
			if (result === undefined) {
				this.#emit(authorized[0], { kind: "state.changed" });
			} else {
				this.#emit(authorized[0], {
					kind: "command.receipt",
					receipt: {
						requestId: body.requestId,
						commandName: body.commandName,
						status: "completed",
						result,
						observedAt: new Date().toISOString(),
					},
				});
			}
			return json(accepted, 202);
		} catch (error) {
			const failure = toClientError(error);
			// A rejected input or an unknown operation is the client's mistake: no
			// command was taken, so no receipt may be produced.
			if (error instanceof StudioOpError && (error.code === "INVALID_ARGUMENT" || error.code === "unsupported")) {
				return json({ ok: false, commandName: body.commandName, error: failure }, 400);
			}
			this.#emit(authorized[0], {
				kind: "command.receipt",
				receipt: {
					requestId: body.requestId,
					commandName: body.commandName,
					status: "failed",
					error: failure,
					observedAt: new Date().toISOString(),
				},
			});
			return json(
				{
					commandName: body.commandName,
					requestId: body.requestId,
					status: "accepted",
					acceptedAt: new Date().toISOString(),
				},
				202,
			);
		} finally {
			session.outstanding -= 1;
		}
	}

	/**
	 * Authorize and perform the event WebSocket upgrade.
	 *
	 * Returns the Response to send when the upgrade must be refused, or `null`
	 * once the socket is upgraded.
	 */
	async upgrade(req: Request, server: StudioWsServer, remoteAddr?: string): Promise<Response | null> {
		// The event stream belongs to `/api/v1`, so it sits behind the same gate
		// as the REST routes: a proxied socket needs `remote.token`, not just a
		// session cookie.
		const access = await checkBrowserAccess(req, remoteAddr);
		if (access.denial) return access.denial;
		const authorized = this.#authorize(req);
		if (!authorized) return json({ error: "unauthenticated" }, 401);
		const upgraded = server.upgrade(req, { data: { kind: "studio", sessionId: authorized[0] } });
		return upgraded ? null : json({ error: "websocket_upgrade_failed" }, 500);
	}

	/** Track a live event socket for a paired session (called on socket open). */
	attachSocket(sessionId: string, socket: StudioSocket): void {
		const set = this.#sockets.get(sessionId) ?? new Set<StudioSocket>();
		set.add(socket);
		this.#sockets.set(sessionId, set);
	}

	/** Drop a closed socket. */
	detachSocket(sessionId: string, socket: StudioSocket): void {
		const set = this.#sockets.get(sessionId);
		if (!set) return;
		set.delete(socket);
		if (set.size === 0) this.#sockets.delete(sessionId);
	}

	/**
	 * Revoke every Studio session (and event socket) that pairing bound to one
	 * device. Called by the device-revoke route: the access gate already stops
	 * that device's token, so this only has to tear down authority that was
	 * granted earlier — a live cookie session and an upgraded WebSocket.
	 *
	 * Returns how many sessions were dropped, for tests and logs.
	 */
	dropDeviceSessions(deviceId: string): number {
		let dropped = 0;
		for (const [sessionId, session] of this.#sessions) {
			if (session.deviceId !== deviceId) continue;
			this.#sessions.delete(sessionId);
			dropped += 1;
			const sockets = this.#sockets.get(sessionId);
			if (sockets === undefined) continue;
			this.#sockets.delete(sessionId);
			for (const socket of sockets) {
				try {
					socket.close?.();
				} catch {
					// A socket that already failed to close must not block revocation.
				}
			}
		}
		return dropped;
	}

	/** Deliver one event to every live socket of one session. */
	#emit(sessionId: string, event: StudioEventBody): void {
		const sockets = this.#sockets.get(sessionId);
		if (!sockets || sockets.size === 0) return;
		const bootstrap = buildBootstrap(this.#operations);
		this.#cursor += 1;
		const envelope = {
			...event,
			authorityEpoch: bootstrap.authority.authorityEpoch,
			stateVersion: (bootstrap.stateVersion ?? 1) as ClientEvent["stateVersion"],
			cursor: String(this.#cursor) as EventCursor,
			occurredAt: new Date().toISOString(),
		} as ClientEvent;
		const payload = JSON.stringify(envelope);
		for (const socket of sockets) socket.send(payload);
	}

	/** First event after subscribe: the runtime it is now connected to. */
	openEvent(scope: SubscriptionScope): ClientEvent[] {
		const bootstrap = buildBootstrap(this.#operations);
		const base = {
			authorityEpoch: bootstrap.authority.authorityEpoch,
			stateVersion: (bootstrap.stateVersion ?? 1) as ClientEvent["stateVersion"],
			occurredAt: new Date().toISOString(),
		};
		this.#cursor += 1;
		const events: ClientEvent[] = [
			{
				...base,
				kind: "runtime.changed",
				connection: bootstrap.runtime,
				cursor: String(this.#cursor) as EventCursor,
			},
		];
		// The host has no cross-process event feed yet: tell the client to
		// re-read state instead of letting it wait on a stream that cannot
		// deliver transitions. Emitting nothing would look like "quiet".
		this.#cursor += 1;
		events.push({
			...base,
			kind: "resync.required",
			reason: `subscribed:${scope.scope}`,
			cursor: String(this.#cursor) as EventCursor,
		});
		return events;
	}
}

let host: StudioHost | undefined;

/** The process-wide Studio host, created on first use. */
export function studioHost(): StudioHost {
	if (!host) {
		host = new StudioHost();
		logger.info("Studio host ready", { pairingCode: host.pairingCode });
	}
	return host;
}

/** Test hook: replace the process-wide host (or clear it with `undefined`). */
export function setStudioHostForTest(next: StudioHost | undefined): void {
	host = next;
}
