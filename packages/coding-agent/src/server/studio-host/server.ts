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
import { isAllowedRequestOrigin } from "../web-gateway/origin";
import {
	checkBrowserAccess,
	credentialAllows,
	getRemoteAuthLimiter,
	isGenuinelyLocalRequest,
	isRemoteModeActive,
	rateLimitedRemoteResponse,
	readCookie,
	type RemoteCredential,
} from "../web-gateway/remote-access";
import { bindingAllows, parseBinding, type DeviceBinding, type RequestTarget } from "../auth/binding";
import { workspaceOfSessionResolver } from "../web-gateway/binding-guard";
import { classifyOperation, scopeSatisfies } from "../web-gateway/scope";
import { sessionStore, type LiveSession } from "../auth/session-store";
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

/**
 * Per-request view of an authenticated caller.
 *
 * `deviceId` is absent only for the implicit local session, which is trusted by
 * socket rather than by a device record. `stateless` marks a request
 * authenticated by a token header: it has no cookie to revoke, but it is still
 * subject to scope and binding.
 */
interface StudioSession {
	csrf: string;
	expiresAt: number;
	scope: SubscriptionScope;
	outstanding: number;
	deviceId?: string;
	binding?: DeviceBinding;
	stateless?: boolean;
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
	/** In-flight command counters and forced subscription scopes, per session id. */
	readonly #counters = new Map<string, { outstanding: number; scope: SubscriptionScope }>();
	/** sessionId → deviceId, so a revocation can close the right sockets. */
	readonly #sessionDevices = new Map<string, string>();
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

	/** When the current code stops working (`null` for a pinned dev code). */
	get pairingExpiresAt(): number | null {
		return Number.isFinite(this.#pairing.expiresAt) ? this.#pairing.expiresAt : null;
	}

	#now(): number {
		return Date.now();
	}

	/**
	 * Resolve the caller.
	 *
	 * A cookie is authoritative when present: the persisted session is looked up
	 * and bound to its device, and an invalid cookie fails rather than falling
	 * back to a token header (a revoked session must not be resurrected by a
	 * machine token the browser also carries). Without a cookie, a device or
	 * machine token authenticated by the gateway is accepted as a stateless
	 * caller — scope and binding still apply, CSRF does not (no ambient
	 * authority).
	 */
	async #authorize(
		req: Request,
		remoteAddr: string | undefined,
		mutate = false,
	): Promise<[string, StudioSession] | undefined> {
		const cookie = readCookie(req, STUDIO_SESSION_COOKIE);
		if (cookie !== undefined) {
			const live = await sessionStore().get(cookie);
			if (live === undefined) return undefined;
			const counters = this.#counters.get(cookie) ?? { outstanding: 0, scope: { scope: "all" } };
			if (mutate && req.headers.get(STUDIO_CSRF_HEADER) !== live.csrf) return undefined;
			this.#sessionDevices.set(cookie, live.deviceId);
			return [
				cookie,
				{
					csrf: live.csrf,
					expiresAt: live.expiresAt,
					scope: counters.scope,
					outstanding: counters.outstanding,
					deviceId: live.deviceId,
					...(live.binding !== undefined ? { binding: live.binding } : {}),
				},
			];
		}
		const local = isGenuinelyLocalRequest(req, remoteAddr);
		const access = local
			? ({ denial: null, credential: { kind: "local" } } as const)
			: await checkBrowserAccess(req, remoteAddr);
		if (access.denial !== null || access.credential === null) return undefined;
		const credential: RemoteCredential = access.credential;
		if (credential.kind === "local") {
			// Implicit local caller: trusted by socket, no device record.
			return ["", { csrf: "", expiresAt: this.#now(), scope: { scope: "all" }, outstanding: 0, stateless: true }];
		}
		if (credential.kind === "machine") {
			return ["", { csrf: "", expiresAt: this.#now(), scope: { scope: "all" }, outstanding: 0, stateless: true }];
		}
		if (!credentialAllows(credential, "write") && mutate) return undefined;
		return [
			"",
			{
				csrf: "",
				expiresAt: this.#now(),
				scope: { scope: "all" },
				outstanding: 0,
				deviceId: credential.device.id,
				...(credential.device.binding !== undefined ? { binding: credential.device.binding } : {}),
				stateless: true,
			},
		];
	}

	/**
	 * Whether the payload's target lies inside a bound credential's scope.
	 *
	 * Uses the same semantics as the REST dispatch: a target may carry an extra
	 * id, but every field the binding fixes must match, and a workspace binding
	 * resolves the session through the Host registry.
	 */
	async #bindingAllows(session: StudioSession, target: RequestTarget | undefined): Promise<boolean> {
		return bindingAllows(session.binding, target, workspaceOfSessionResolver());
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
		const local = isGenuinelyLocalRequest(req, remoteAddr);
		const isPair = url.pathname === "/api/v1/pair" && req.method === "POST";
		// Pairing is the one route reachable with a pairing code alone: the code is
		// a single-use, 60-second, rate-limited presence credential, and the code
		// path cannot mint anything wider than a normal device. Every other route
		// goes through the credential gate.
		if (isPair) {
			if (!isAllowedRequestOrigin(req.headers.get("origin"), req.url, local)) {
				return json({ error: "forbidden" }, 403);
			}
		} else {
			const access = await checkBrowserAccess(req, remoteAddr);
			if (access.denial !== null) return access.denial;
			if (!isAllowedRequestOrigin(req.headers.get("origin"), req.url, access.genuinelyLocal)) {
				return json({ error: "forbidden" }, 403);
			}
			const credential = access.credential;
			if (credential !== null) {
				const operation = classifyOperation(url.pathname, req.method);
				const scopes = credential.kind === "local" || credential.kind === "machine"
					? ["read", "write"]
					: credential.device.scopes;
				if (!scopeSatisfies(scopes, operation)) return json({ error: "insufficient_scope" }, 403);
			}
		}
		// 2FA gates `/api/v1/command` (the twelve-hour write window). Pairing is
		// deliberately not gated here: the code is the presence proof, and a fresh
		// device still has to pass 2FA for every write afterwards.
		const twoFactorDenial = await guardStudioTwoFactor(req, remoteAddr, url.pathname);
		if (twoFactorDenial) return twoFactorDenial;
		const context: StudioHostContext = {
			origin: req.headers.get("origin") ?? undefined,
			capabilities: this.#operations.capabilities().manifest,
		};
		try {
			if (isPair) return await this.#pair(req, remoteAddr);
			if (url.pathname === "/api/v1/session/revoke" && req.method === "POST") return await this.#revoke(req, remoteAddr);
			if (url.pathname === "/api/v1/bootstrap" && req.method === "GET")
				return await this.#bootstrap(req, remoteAddr, local);
			if (url.pathname === "/api/v1/query" && req.method === "POST") return await this.#query(req, remoteAddr, context);
			if (url.pathname === "/api/v1/command" && req.method === "POST") return await this.#command(req, remoteAddr, context);
			return json({ error: "not_found" }, 404);
		} catch (error) {
			if (error instanceof PairingInputError) return json({ error: error.message }, 400);
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
		// A pairing code is required. A token header alone must never mint a
		// device: the machine token is a bootstrap secret, and an empty-code pair
		// would let a read-only holder upgrade itself.
		const matches =
			code !== "" &&
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
		const deviceRequest = this.#deviceRequest(body, req);
		let issued: { device: PublicDevice; token: string };
		try {
			issued = await deviceRegistry().issue(deviceRequest);
		} catch (error) {
			logger.warn("Device registration failed during pairing", {
				error: error instanceof Error ? error.message : String(error),
			});
			return json({ error: "device_registry_unavailable" }, 500);
		}
		const [sessionId, session] = await this.#createSession(issued.device.id, deviceRequest.binding);
		// The device token is for native clients only (Keystore / header auth).
		// A browser keeps the HttpOnly cookie and never sees the token, so an XSS
		// cannot lift a long-lived bearer credential out of page JS.
		const wantsToken = wantsDeviceToken(body);
		return json(
			{
				csrf: session.csrf,
				expiresAt: new Date(session.expiresAt).toISOString(),
				device: { ...issued.device, ...(wantsToken ? { token: issued.token } : {}) },
			},
			200,
			{ "set-cookie": this.#sessionCookie(req, sessionId) },
		);
	}

	/**
	 * Read the optional `device` block a client sends with its pairing code.
	 * The label is a display string; the platform is normalized by the registry
	 * and defaults to what the User-Agent implies.
	 */
	#deviceRequest(body: unknown, req: Request): {
		label?: string;
		platform?: string;
		machineId?: string;
		binding?: DeviceBinding;
	} {
		const empty: { label?: string; platform?: string; machineId?: string; binding?: DeviceBinding } = {
			platform: inferPlatform(req.headers.get("user-agent")),
		};
		if (body === null || typeof body !== "object" || !("device" in body)) return empty;
		const raw = body.device;
		if (raw === null || typeof raw !== "object") return empty;
		const label = "label" in raw && typeof raw.label === "string" ? raw.label : undefined;
		const platform = "platform" in raw && typeof raw.platform === "string" ? raw.platform : undefined;
		const machineId = "machineId" in raw && typeof raw.machineId === "string" ? raw.machineId : undefined;
		// A client may ask for a narrower device: applying a binding to a fresh
		// device can only restrict what it reaches, never widen it. A malformed
		// value is rejected rather than ignored, so an operator cannot think a
		// restriction applied when it did not.
		let binding: DeviceBinding | undefined;
		if ("binding" in raw) {
			const parsed = parseBinding(raw.binding);
			if (!parsed.ok) throw new PairingInputError("binding_invalid");
			binding = parsed.binding;
		}
		return {
			...(label !== undefined ? { label } : {}),
			platform: platform ?? empty.platform,
			...(machineId !== undefined ? { machineId } : {}),
			...(binding !== undefined ? { binding } : {}),
		};
	}

	async #createSession(deviceId?: string, binding?: DeviceBinding): Promise<[string, LiveSession]> {
		const live = await sessionStore().create({
			...(deviceId !== undefined ? { deviceId } : { deviceId: "local" }),
			...(binding !== undefined ? { binding } : {}),
		});
		this.#counters.set(live.id, { outstanding: 0, scope: { scope: "all" } });
		if (deviceId !== undefined) this.#sessionDevices.set(live.id, deviceId);
		return [live.id, live];
	}

	#sessionCookie(req: Request, sessionId: string): string {
		const secure = isSecureRequest(req) ? "; Secure" : "";
		return `${STUDIO_SESSION_COOKIE}=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Strict; Path=/${secure}`;
	}

	async #revoke(req: Request, remoteAddr?: string): Promise<Response> {
		const authorized = await this.#authorize(req, remoteAddr, true);
		if (authorized === undefined) return json({ error: "unauthenticated" }, 401);
		const [sessionId] = authorized;
		if (sessionId !== "") {
			await sessionStore().delete(sessionId);
			this.#counters.delete(sessionId);
			this.#sessionDevices.delete(sessionId);
			this.#closeSockets(sessionId);
		}
		return json({ ok: true });
	}

	async #bootstrap(req: Request, remoteAddr: string | undefined, genuinelyLocal: boolean): Promise<Response> {
		const bootstrap: ClientBootstrap = buildBootstrap(this.#operations);
		const hasCookie = readCookie(req, STUDIO_SESSION_COOKIE) !== undefined;
		const authorized = await this.#authorize(req, remoteAddr);
		// A cookie already proves a live session; a stateless token caller is
		// authorized for reads but gets no cookie here (it pairs explicitly).
		if (authorized !== undefined && hasCookie) {
			// A cookie session needs the CSRF token for mutations; hand it over on
			// bootstrap as well as on pair so a WebView never needs a JS bridge.
			return json(bootstrap, 200, { [STUDIO_CSRF_HEADER]: authorized[1].csrf });
		}
		// The same-origin renderer is served on a direct loopback socket by
		// `zeta serve` and the desktop shell, so it may establish its own session
		// on the bootstrap read. A proxied peer was already rejected by the
		// remote-access gate; a local peer of an install with remote access turned
		// on must pair with the code instead of pairing implicitly.
		if (genuinelyLocal) {
			const config = await WebConfig.load();
			if (!isRemoteModeActive(config.getData().remote)) {
				const [sessionId, session] = await this.#createSession();
				return json(bootstrap, 200, {
					"set-cookie": this.#sessionCookie(req, sessionId),
					[STUDIO_CSRF_HEADER]: session.csrf,
				});
			}
			// Remote access is configured: even a local peer pairs with the code so
			// its authority is device-bound and revocable. A token-authenticated
			// caller is handled below (the desktop shell never pairs for reads).
			if (authorized === undefined || isGenuinelyLocalRequest(req, remoteAddr) && !hasCookie) {
				return json({ error: "unauthenticated" }, 401);
			}
		}
		if (authorized !== undefined) return json(bootstrap);
		return json({ error: "unauthenticated" }, 401);
	}

	async #query(req: Request, remoteAddr: string | undefined, context: StudioHostContext): Promise<Response> {
		const authorized = await this.#authorize(req, remoteAddr);
		if (authorized === undefined) return json({ error: "unauthenticated" }, 401);
		const body = (await this.#body(req)) as ClientQueryRequest;
		if (body === null || typeof body !== "object" || typeof body.queryName !== "string") {
			return json({ error: "bad_request" }, 400);
		}
		if (!(await this.#bindingAllows(authorized[1], payloadTarget(body)))) {
			return json({ error: "binding_scope" }, 403);
		}
		return json(await this.#operations.query(body, context));
	}

	async #command(req: Request, remoteAddr: string | undefined, context: StudioHostContext): Promise<Response> {
		const authorized = await this.#authorize(req, remoteAddr, true);
		if (authorized === undefined) return json({ error: "unauthenticated" }, 401);
		const [sessionId, session] = authorized;
		const body = (await this.#body(req)) as ClientCommandRequest;
		if (body === null || typeof body !== "object" || typeof body.commandName !== "string") {
			return json({ error: "bad_request" }, 400);
		}
		if (!(await this.#bindingAllows(session, payloadTarget(body)))) {
			return json({ error: "binding_scope" }, 403);
		}
		const counter = sessionId === "" ? undefined : this.#counters.get(sessionId);
		const outstanding = counter?.outstanding ?? 0;
		if (outstanding >= MAX_OUTSTANDING_COMMANDS) return json({ error: "rate_limited" }, 429);
		if (counter !== undefined) counter.outstanding += 1;
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
			if (counter !== undefined) counter.outstanding -= 1;
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
		// and credential rules as the REST routes; the cookie is the only
		// credential a browser can attach to a WebSocket.
		const access = await checkBrowserAccess(req, remoteAddr);
		if (access.denial !== null) return access.denial;
		if (!isAllowedRequestOrigin(req.headers.get("origin"), req.url, access.genuinelyLocal)) {
			return json({ error: "forbidden" }, 403);
		}
		const credential = access.credential;
		if (credential !== null) {
			const scopes = credential.kind === "local" || credential.kind === "machine"
				? ["read", "write"]
				: credential.device.scopes;
			// A socket carries events; it is a read surface, but a terminal-class
			// write scope is not needed here. Read is the honest requirement.
			if (!scopeSatisfies(scopes, "read")) return json({ error: "insufficient_scope" }, 403);
		}
		const authorized = await this.#authorize(req, remoteAddr);
		if (authorized === undefined) return json({ error: "unauthenticated" }, 401);
		const [sessionId] = authorized;
		// Event delivery is keyed by the *authenticated* session id (`#emit`), not
		// by a conversation, so a bound device only ever receives its own receipts
		// and runtime notices; no extra binding filter applies here.
		const upgraded = server.upgrade(req, { data: { kind: "studio", sessionId } });
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
		for (const [sessionId, boundDeviceId] of this.#sessionDevices) {
			if (boundDeviceId !== deviceId) continue;
			this.#sessionDevices.delete(sessionId);
			this.#counters.delete(sessionId);
			this.#closeSockets(sessionId);
			dropped += 1;
		}
		return dropped;
	}

	/** Close every live event socket of one session. */
	#closeSockets(sessionId: string): void {
		const sockets = this.#sockets.get(sessionId);
		if (sockets === undefined) return;
		this.#sockets.delete(sessionId);
		for (const socket of sockets) {
			try {
				socket.close?.();
			} catch {
				// A socket that already failed to close must not block revocation.
			}
		}
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

/** Pairing input the client got wrong (answered 400, never a silent default). */
class PairingInputError extends Error {}

/** Whether the request arrived over TLS (cookie `Secure` scoping only, not identity). */
function isSecureRequest(req: Request): boolean {
	try {
		if (new URL(req.url).protocol === "https:") return true;
	} catch {
		// A malformed URL cannot claim TLS.
	}
	const origin = req.headers.get("origin");
	return origin !== null && origin.startsWith("https:");
}

/** Whether the pairing client asked for a native device token. */
function wantsDeviceToken(body: unknown): boolean {
	if (body === null || typeof body !== "object" || !("device" in body)) return false;
	const device = body.device;
	return device !== null && typeof device === "object" && "issueToken" in device && device.issueToken === true;
}

/**
 * Resource a Studio payload targets for binding purposes.
 *
 * Only string ids are read; a payload that names nothing is treated as global,
 * which a bound credential cannot reach.
 */
function payloadTarget(body: unknown): RequestTarget | undefined {
	if (body === null || typeof body !== "object" || !("input" in body)) return undefined;
	const input = body.input;
	if (input === null || typeof input !== "object") return undefined;
	const sessionId = "sessionId" in input && typeof input.sessionId === "string" ? input.sessionId : undefined;
	const workspaceId = "workspaceId" in input && typeof input.workspaceId === "string" ? input.workspaceId : undefined;
	if (sessionId === undefined && workspaceId === undefined) return undefined;
	return {
		...(sessionId !== undefined ? { sessionId } : {}),
		...(workspaceId !== undefined ? { workspaceId } : {}),
	};
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
