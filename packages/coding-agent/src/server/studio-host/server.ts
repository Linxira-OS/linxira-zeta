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
 * - every other route requires an allowed `Origin` (loopback pages only, the
 *   same allowlist the gateway uses) — a hostile page cannot drive this host;
 * - pairing mints a `studio_session` cookie plus the CSRF token the page must
 *   echo on mutations; the pairing code is printed by `zeta serve` and is
 *   single-use and time-boxed;
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
import { logger } from "@linxiraos/pi-utils";
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
}

/** Per-connection state for the event socket. */
export interface StudioWsData {
	kind: "studio";
	sessionId: string;
}

/** The slice of a Bun socket the host needs (kept structural for testability). */
export interface StudioSocket {
	send(data: string): unknown;
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

/** Loopback peers may pair implicitly: the same-origin renderer is served there. */
function isLoopbackAddress(address: string | undefined): boolean {
	if (address === undefined) return false;
	const value = address.toLowerCase();
	return value === "::1" || value === "::ffff:127.0.0.1" || value.startsWith("127.");
}

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
		if (!isAllowedOrigin(req.headers.get("origin"))) return json({ error: "forbidden" }, 403);
		const context: StudioHostContext = {
			origin: req.headers.get("origin") ?? undefined,
			capabilities: this.#operations.capabilities().manifest,
		};
		try {
			if (url.pathname === "/api/v1/pair" && req.method === "POST") return await this.#pair(req);
			if (url.pathname === "/api/v1/session/revoke" && req.method === "POST") return this.#revoke(req);
			if (url.pathname === "/api/v1/bootstrap" && req.method === "GET") return this.#bootstrap(req, remoteAddr);
			if (url.pathname === "/api/v1/query" && req.method === "POST") return await this.#query(req, context);
			if (url.pathname === "/api/v1/command" && req.method === "POST") return await this.#command(req, context);
			return json({ error: "not_found" }, 404);
		} catch (error) {
			const tooLarge = error instanceof Error && error.message === "body_too_large";
			return json({ error: tooLarge ? "body_too_large" : "bad_request" }, 400);
		}
	}

	async #pair(req: Request): Promise<Response> {
		const body = await this.#body(req);
		const code = body !== null && typeof body === "object" ? String((body as { code?: unknown }).code ?? "") : "";
		const expected = this.#pairing.code;
		const matches =
			!this.#pairing.used &&
			this.#pairing.expiresAt > this.#now() &&
			code.length === expected.length &&
			timingSafeEqual(Buffer.from(code), Buffer.from(expected));
		if (!matches) return json({ error: "unauthenticated" }, 401);
		if (!this.#pairingReusable) this.#pairing.used = true;
		const [sessionId, session] = this.#createSession();
		return json({ csrf: session.csrf, expiresAt: session.expiresAt }, 200, {
			"set-cookie": this.#sessionCookie(sessionId),
		});
	}

	#createSession(): [string, StudioSession] {
		const sessionId = token(32);
		const session: StudioSession = {
			csrf: token(24),
			expiresAt: this.#now() + SESSION_TTL_MS,
			scope: { scope: "all" },
			outstanding: 0,
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

	#bootstrap(req: Request, remoteAddr?: string): Response {
		const bootstrap: ClientBootstrap = buildBootstrap(this.#operations);
		if (this.#authorize(req)) return json(bootstrap);
		// The same-origin renderer is served on loopback by `zeta serve` and the
		// desktop shell. Let a loopback peer establish its own session on the
		// bootstrap read; requests from any other peer still need the pairing code.
		if (isLoopbackAddress(remoteAddr)) {
			const [sessionId, session] = this.#createSession();
			return json(bootstrap, 200, {
				"set-cookie": this.#sessionCookie(sessionId),
				[STUDIO_CSRF_HEADER]: session.csrf,
			});
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
	upgrade(req: Request, server: StudioWsServer): Response | null {
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
