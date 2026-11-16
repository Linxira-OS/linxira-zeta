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
import { ConversationContexts, type ConversationContext } from "./conversation-contexts.js";
import { resolveWorkspacePath } from "./ops/workspace.js";
import { getRpcSession } from "../web-gateway/agents.js";
import { conversationFeed } from "./conversation-feed.js";
import { currentSessionId, snapshotFor } from "./ops/session.js";
import type { OperatorStateSnapshot } from "./protocol/contracts/state.js";
import { releaseStudioPrivateOwner } from "./services/browser-runtime.js";
import { releaseStudioEvaluationOwner } from "./services/evaluation-runtime.js";
import { releasePredictionPrivateOwner } from "./services/prediction-runtime";
import { releaseMemoryCredentials, replaceMemoryCredentials } from "../../hindsight/private-credentials";
import { subscribeComputerWorkspace } from "./services/computer-runtime.js";
import { validateComputerWorkspaceChange } from "./protocol/computer-workspace-validation.js";
import { ARTIFACT_KINDS, type ArtifactKind } from "./protocol/contracts/artifacts.js";
import {
	artifactSessionIdFor,
	readArtifactFile,
	SESSION_ARTIFACT_MAX_BYTES,
	tryArtifactSessionIdFor,
	writeSessionArtifact,
} from "./ops/files.js";
import { readArtifactBody } from "./services/artifact-body.js";

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
	| { readonly kind: "state.changed" }
	| { readonly kind: "snapshot"; readonly snapshot: OperatorStateSnapshot }
	| {
			readonly kind: "computer.changed";
			readonly change: import("./protocol/contracts/computer-workspace.js").ComputerWorkspaceChange;
	  }
	| Pick<
			Extract<ClientEvent, { kind: "conversation.changed" }>,
			"kind" | "sessionId" | "streamSeq" | "eventSeq" | "update"
	  >;

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
	readonly #contexts = new ConversationContexts((id, owner) => {
		this.#closeSockets(`context:${id}`);
		if (!this.#memoryOwnerConnected(owner)) releaseMemoryCredentials(owner);
	});
	#pairing: { code: string; expiresAt: number; used: boolean };
	/**
	 * A pinned pairing code (`ZETA_STUDIO_PAIRING_CODE` or the constructor
	 * option) is a local-testing affordance: it stays valid for its TTL instead
	 * of being consumed by the first pairing, so a script can pair again after a
	 * reload. A generated code is always single-use.
	 */
	readonly #pairingReusable: boolean;
	readonly #cursors = new Map<string, number>();
	readonly #feeds = new Map<string, { sessionId: string; dispose: () => void }>();

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
			if (live === undefined) {
				this.#closeSockets(cookie);
				this.#contexts.closeOwner(cookie);
			}
			if (live === undefined) return undefined;
			const counters = this.#counters.get(cookie) ?? { outstanding: 0, scope: { scope: "all" } };
			this.#counters.set(cookie, counters);
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
				const scopes =
					credential.kind === "local" || credential.kind === "machine"
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
			if (url.pathname === "/api/v1/context/open" && req.method === "POST")
				return await this.#openContext(req, remoteAddr);
			if (url.pathname === "/api/v1/context/close" && req.method === "POST")
				return await this.#closeContext(req, remoteAddr);
			if (url.pathname === "/api/v1/session/revoke" && req.method === "POST")
				return await this.#revoke(req, remoteAddr);
			if (url.pathname === "/api/v1/bootstrap" && req.method === "GET")
				return await this.#bootstrap(req, remoteAddr, local);
			if (url.pathname === "/api/v1/memory/credentials" && ["GET", "POST"].includes(req.method))
				return await this.#memoryCredentials(req, remoteAddr);
			if (
				(url.pathname === "/api/v1/artifacts" && req.method === "POST") ||
				(url.pathname.startsWith("/api/v1/artifacts/") && ["GET", "HEAD"].includes(req.method))
			)
				return await this.#artifact(req, remoteAddr);
			if (url.pathname === "/api/v1/query" && req.method === "POST")
				return await this.#query(req, remoteAddr, context);
			if (url.pathname === "/api/v1/command" && req.method === "POST")
				return await this.#command(req, remoteAddr, context);
			return json({ error: "not_found" }, 404);
		} catch (error) {
			if (error instanceof ConversationContextError) return json({ error: error.message }, 404);
			if (error instanceof Error && error.message === "context_limit") return json({ error: "context_limit" }, 429);
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
		// Parse the device block **before** the code is reserved: a malformed
		// binding must be a 400 that leaves the one-time code usable, not a
		// silent burn of the operator's code.
		const deviceRequest = this.#deviceRequest(body, req);
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
	#deviceRequest(
		body: unknown,
		req: Request,
	): {
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

	#memoryOwnerConnected(owner: string): boolean {
		for (const id of this.#sockets.keys()) {
			if (id === owner || (id.startsWith("context:") && this.#contexts.peek(id.slice(8))?.owner === owner))
				return true;
		}
		return false;
	}

	async #memoryCredentials(req: Request, remoteAddr?: string): Promise<Response> {
		const authorized = await this.#authorize(req, remoteAddr, req.method === "POST");
		if (!authorized || !readCookie(req, STUDIO_SESSION_COOKIE)) return json({ error: "unauthenticated" }, 401);
		const [owner, session] = authorized;
		if (session.binding) return json({ error: "binding_scope" }, 403);
		if (req.method === "POST" && !this.#memoryOwnerConnected(owner))
			return json({ error: "owner_disconnected" }, 409);
		if (req.method === "POST") {
			const denied = await guardStudioTwoFactor(req, remoteAddr, "/api/v1/command");
			if (denied) return denied;
			const entries = await this.#body(req);
			const current = await this.#authorize(req, remoteAddr, true);
			if (!current || current[0] !== owner || !this.#memoryOwnerConnected(owner))
				return json({ error: "unauthenticated" }, 401);
			replaceMemoryCredentials(owner, current[1].expiresAt, entries);
		}
		return json({ supported: true });
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
			this.#contexts.closeOwner(sessionId);
		}
		return json({ ok: true });
	}

	async #openContext(req: Request, remoteAddr?: string): Promise<Response> {
		const authorized = await this.#authorize(req, remoteAddr, true);
		if (authorized === undefined || !readCookie(req, STUDIO_SESSION_COOKIE))
			return json({ error: "unauthenticated" }, 401);
		const [owner, session] = authorized;
		const admission = this.#counters.get(owner);
		const body = await this.#body(req);
		if (body === null || typeof body !== "object" || !("workspaceId" in body) || typeof body.workspaceId !== "string")
			return json({ error: "bad_request" }, 400);
		const sessionId = "sessionId" in body ? body.sessionId : undefined;
		if (sessionId !== undefined && (typeof sessionId !== "string" || sessionId === ""))
			return json({ error: "bad_request" }, 400);
		await resolveWorkspacePath(body.workspaceId);
		if (typeof sessionId === "string" && (await workspaceOfSessionResolver()?.(sessionId)) !== body.workspaceId)
			return json({ error: "context_scope" }, 403);
		if (
			!(await this.#bindingAllows(session, {
				workspaceId: body.workspaceId,
				...(typeof sessionId === "string" ? { sessionId } : {}),
			}))
		)
			return json({ error: "binding_scope" }, 403);
		const live = await sessionStore().get(owner);
		if (live === undefined || admission === undefined || this.#counters.get(owner) !== admission)
			return json({ error: "unauthenticated" }, 401);
		const context = this.#contexts.create(
			owner,
			live.expiresAt,
			body.workspaceId,
			typeof sessionId === "string" ? sessionId : undefined,
		);
		return json({ contextId: context.id });
	}

	async #closeContext(req: Request, remoteAddr?: string): Promise<Response> {
		const authorized = await this.#authorize(req, remoteAddr, true);
		if (authorized === undefined) return json({ error: "unauthenticated" }, 401);
		const id = req.headers.get("x-studio-context");
		if (!id || !this.#contexts.close(authorized[0], id)) return json({ error: "context_closed" }, 404);
		return json({ closed: true });
	}

	#requestContext(req: Request, owner: string): ConversationContext | undefined {
		const id = req.headers.get("x-studio-context") ?? new URL(req.url).searchParams.get("contextId");
		if (id === null) return undefined;
		const context = this.#contexts.get(owner, id);
		if (context === undefined) throw new ConversationContextError("context_closed");
		return context;
	}

	async #contextAllows(context: ConversationContext, target: RequestTarget | undefined): Promise<boolean> {
		if (target === undefined) return true;
		if (target.workspaceId !== undefined && target.workspaceId !== context.workspaceId) return false;
		if (target.sessionId === undefined) return true;
		if (context.sessionId !== undefined && target.sessionId !== context.sessionId) return false;
		return (await workspaceOfSessionResolver()?.(target.sessionId)) === context.workspaceId;
	}

	async #bootstrap(req: Request, remoteAddr: string | undefined, genuinelyLocal: boolean): Promise<Response> {
		let bootstrap: ClientBootstrap = buildBootstrap(this.#operations);
		const hasCookie = readCookie(req, STUDIO_SESSION_COOKIE) !== undefined;
		const authorized = await this.#authorize(req, remoteAddr);
		if (
			authorized === undefined &&
			(req.headers.has("x-studio-context") || new URL(req.url).searchParams.has("contextId"))
		)
			return json({ error: "unauthenticated" }, 401);
		const selection = authorized === undefined ? undefined : this.#requestContext(req, authorized[0]);
		if (selection !== undefined)
			bootstrap = {
				...bootstrap,
				selected: {
					workspaceId: selection.workspaceId as NonNullable<ClientBootstrap["selected"]["workspaceId"]>,
					...(selection.sessionId === undefined
						? {}
						: { sessionId: selection.sessionId as NonNullable<ClientBootstrap["selected"]["sessionId"]> }),
				},
			};
		if (this.#operations.queries.includes("commands.getManifest")) {
			const manifest = await this.#operations.query(
				{ queryName: "commands.getManifest", input: {} },
				{
					capabilities: bootstrap.capabilityManifest,
					...(selection === undefined ? {} : { selection }),
				},
			);
			if (!manifest.ok) return json({ error: manifest.error }, 503);
			bootstrap = { ...bootstrap, commandManifestHash: manifest.result.hash };
		}
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
			if (authorized === undefined || (isGenuinelyLocalRequest(req, remoteAddr) && !hasCookie)) {
				return json({ error: "unauthenticated" }, 401);
			}
		}
		if (authorized !== undefined) return json(bootstrap);
		return json({ error: "unauthenticated" }, 401);
	}

	async #artifact(req: Request, remoteAddr?: string): Promise<Response> {
		const write = req.method === "POST";
		const authorized = await this.#authorize(req, remoteAddr, write);
		if (!authorized) return json({ error: "unauthenticated" }, 401);
		if (write) {
			const denied = await guardStudioTwoFactor(req, remoteAddr, "/api/v1/command");
			if (denied) return denied;
		}
		const url = new URL(req.url);
		const artifactId = write ? undefined : decodeURIComponent(url.pathname.slice("/api/v1/artifacts/".length));
		const sessionId = write ? url.searchParams.get("sessionId") : artifactSessionIdFor(artifactId!);
		if (!sessionId || sessionId.length > 512 || sessionId.includes("\0")) return json({ error: "bad_request" }, 400);
		const selection = this.#requestContext(req, authorized[0]);
		if (!selection || selection.sessionId !== sessionId) return json({ error: "context_scope" }, 403);
		const target = { sessionId };
		if (!(await this.#contextAllows(selection, target))) return json({ error: "context_scope" }, 403);
		if (!(await this.#bindingAllows(authorized[1], target))) return json({ error: "binding_scope" }, 403);
		const assertContext = () => {
			if (
				req.signal.aborted ||
				selection.closed ||
				selection.sessionId !== sessionId ||
				this.#contexts.peek(selection.id) !== selection
			)
				throw new ConversationContextError("context_closed");
		};
		// A write needs the live event socket (the owner is present); a read only
		// needs the still-open context so a preview cannot race socket attach.
		const assertView = () => {
			assertContext();
			if (!this.#sockets.has(`context:${selection.id}`)) throw new ConversationContextError("context_closed");
		};
		const guard = write ? assertView : assertContext;
		guard();
		const reauthorize = async () => {
			const current = await this.#authorize(req, remoteAddr, write);
			if (
				!current ||
				current[0] !== authorized[0] ||
				!(await this.#bindingAllows(current[1], target)) ||
				!(await this.#contextAllows(selection, target))
			)
				throw new ConversationContextError("context_closed");
			guard();
		};
		if (write) {
			const kind = url.searchParams.get("kind"),
				name = url.searchParams.get("name"),
				mimeType = url.searchParams.get("mimeType");
			if (!kind || !(ARTIFACT_KINDS as readonly string[]).includes(kind) || !name || !mimeType || kind === "audio")
				return json({ error: "bad_request" }, 400);
			const session = getRpcSession(sessionId)?.getSession();
			if (!session || session.isDisposed || session.sessionId !== sessionId)
				return json({ error: "session_unavailable" }, 409);
			const assert = () => {
				assertView();
				if (
					session.isDisposed ||
					session.sessionId !== sessionId ||
					getRpcSession(sessionId)?.getSession() !== session
				)
					throw new ConversationContextError("context_closed");
			};
			const bytes = await readArtifactBody(req, SESSION_ARTIFACT_MAX_BYTES);
			await reauthorize();
			assert();
			const artifact = await writeSessionArtifact(
				sessionId,
				{ kind: kind as ArtifactKind, name, mimeType },
				bytes,
				assert,
			);
			await reauthorize();
			assert();
			return json({ artifact }, 201);
		}
		const { artifact, response } = await readArtifactFile(artifactId!);
		try {
			await reauthorize();
			const headers = new Headers({
				"content-type": artifact.mimeType,
				"content-length": String(artifact.bytes),
				"cache-control": "no-store",
				"x-content-type-options": "nosniff",
				"content-security-policy": "default-src 'none'; sandbox",
				"accept-ranges": "bytes",
			});
			const range = req.headers.get("range");
			if (range) {
				const match = /^bytes=(\d*)-(\d*)$/u.exec(range);
				const start = match?.[1] ? Number(match[1]) : Math.max(0, artifact.bytes - Number(match?.[2]));
				const end = match?.[1] && match[2] ? Number(match[2]) : artifact.bytes - 1;
				if (
					!match ||
					(!match[1] && !match[2]) ||
					!Number.isSafeInteger(start) ||
					!Number.isSafeInteger(end) ||
					start < 0 ||
					end < start ||
					start >= artifact.bytes
				)
					return new Response(null, { status: 416, headers: { "content-range": `bytes */${artifact.bytes}` } });
				const last = Math.min(end, artifact.bytes - 1);
				headers.set("content-range", `bytes ${start}-${last}/${artifact.bytes}`);
				headers.set("content-length", String(last - start + 1));
				if (req.method === "HEAD") return new Response(null, { status: 206, headers });
				const bytes = new Uint8Array(await response.arrayBuffer());
				await reauthorize();
				return new Response(bytes.subarray(start, last + 1), { status: 206, headers });
			}
			return new Response(req.method === "HEAD" ? null : response.body, { headers });
		} finally {
			if (req.method === "HEAD" || (response.body?.locked === false && req.headers.has("range")))
				await response.body?.cancel().catch(() => {});
		}
	}

	async #query(req: Request, remoteAddr: string | undefined, context: StudioHostContext): Promise<Response> {
		const authorized = await this.#authorize(req, remoteAddr);
		if (authorized === undefined) return json({ error: "unauthenticated" }, 401);
		const body = (await this.#body(req)) as ClientQueryRequest;
		if (body === null || typeof body !== "object" || typeof body.queryName !== "string") {
			return json({ error: "bad_request" }, 400);
		}
		const selection = this.#requestContext(req, authorized[0]);
		const explicitTarget = payloadTarget(body);
		const queryTarget =
			selection !== undefined && body.queryName.startsWith("evaluations.")
				? selection
				: (explicitTarget ??
					(selection !== undefined && SESSION_SELECTION_OPERATIONS.has(body.queryName) ? selection : undefined));
		if (selection !== undefined && !(await this.#contextAllows(selection, payloadTarget(body))))
			return json({ error: "context_scope" }, 403);
		if (authorized[1].binding !== undefined) {
			// A bound device may read only its own conversation. The few ambient
			// queries that carry no session content (boot facts) stay readable so
			// the client can render; anything else must name the bound resource.
			if (queryTarget === undefined && !AMBIENT_QUERY_NAMES[body.queryName]) {
				return json({ error: "binding_scope" }, 403);
			}
		}
		if (!(await this.#bindingAllows(authorized[1], queryTarget))) {
			return json({ error: "binding_scope" }, 403);
		}
		if (
			(body.queryName === "shell.view.read" || body.queryName === "shell.view.release") &&
			body.input &&
			typeof body.input === "object" &&
			"sourceSessionId" in body.input &&
			typeof body.input.sourceSessionId === "string" &&
			!(await this.#bindingAllows(authorized[1], { sessionId: body.input.sourceSessionId }))
		)
			return json({ error: "binding_scope" }, 403);
		const eventOwner = selection === undefined ? authorized[0] : `context:${selection.id}`;
		const response = await this.#operations.query(body, {
			...context,
			...(selection === undefined ? {} : { selection, contextId: selection.id }),
			privateOwner: {
				id: eventOwner,
				expiresAt: authorized[1].expiresAt,
				isLive: () =>
					this.#sockets.has(eventOwner) &&
					authorized[1].expiresAt > Date.now() &&
					(selection === undefined || this.#contexts.peek(selection.id) === selection),
			},
		});
		await this.#syncRuntime(selection === undefined ? authorized[0] : `context:${selection.id}`);
		return json(response);
	}

	async #command(req: Request, remoteAddr: string | undefined, context: StudioHostContext): Promise<Response> {
		const authorized = await this.#authorize(req, remoteAddr, true);
		if (authorized === undefined) return json({ error: "unauthenticated" }, 401);
		const [sessionId, session] = authorized;
		const body = (await this.#body(req)) as ClientCommandRequest;
		if (body === null || typeof body !== "object" || typeof body.commandName !== "string") {
			return json({ error: "bad_request" }, 400);
		}
		if (session.binding !== undefined && body.input && typeof body.input === "object") {
			const input = body.input;
			if (
				(body.commandName === "prediction.configure" && "scope" in input && input.scope === "global") ||
				(body.commandName === "prediction.control" && "action" in input && input.action !== "status")
			)
				return json({ error: "binding_scope" }, 403);
		}
		const selection = this.#requestContext(req, sessionId);
		if (selection !== undefined && !(await this.#contextAllows(selection, payloadTarget(body))))
			return json({ error: "context_scope" }, 403);
		const eventOwner = selection === undefined ? sessionId : `context:${selection.id}`;
		const operationContext: StudioHostContext = {
			...context,
			...(selection === undefined ? {} : { selection, contextId: selection.id }),
			privateOwner: {
				id: eventOwner,
				expiresAt: session.expiresAt,
				isLive: () =>
					this.#sockets.has(eventOwner) &&
					session.expiresAt > Date.now() &&
					(selection === undefined || this.#contexts.peek(selection.id) === selection),
			},
		};
		const target =
			selection !== undefined && body.commandName.startsWith("evaluations.")
				? selection
				: (payloadTarget(body) ??
					(selection !== undefined && SESSION_SELECTION_OPERATIONS.has(body.commandName) ? selection : undefined));
		if (!(await this.#bindingAllows(session, target))) {
			return json({ error: "binding_scope" }, 403);
		}
		if (
			(body.commandName === "session.history.rename" ||
				body.commandName === "session.history.pin" ||
				body.commandName.startsWith("session.portability.")) &&
			body.input &&
			typeof body.input === "object"
		) {
			if (
				"targetSessionId" in body.input &&
				typeof body.input.targetSessionId === "string" &&
				!(await this.#bindingAllows(session, { sessionId: body.input.targetSessionId }))
			)
				return json({ error: "binding_scope" }, 403);
			if (
				"targetWorkspaceId" in body.input &&
				typeof body.input.targetWorkspaceId === "string" &&
				!(await this.#bindingAllows(session, { workspaceId: body.input.targetWorkspaceId }))
			)
				return json({ error: "binding_scope" }, 403);
			if (
				session.binding?.sessionId !== undefined &&
				(body.commandName === "session.portability.prepare" || body.commandName === "session.portability.import")
			)
				return json({ error: "binding_scope" }, 403);
		}
		const counter = sessionId === "" ? undefined : this.#counters.get(sessionId);
		const outstanding = counter?.outstanding ?? 0;
		if (outstanding >= MAX_OUTSTANDING_COMMANDS) return json({ error: "rate_limited" }, 429);
		if (counter !== undefined) counter.outstanding += 1;
		try {
			await this.#syncRuntime(eventOwner);
			const { accepted, result } = await this.#operations.command(body, operationContext);
			await this.#syncRuntime(eventOwner);
			// Runtime transitions arrive independently on the selected session's feed.
			if (result === undefined) {
				this.#emit(eventOwner, { kind: "state.changed" });
			} else {
				this.#emit(eventOwner, {
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
			this.#emit(eventOwner, {
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
			const scopes =
				credential.kind === "local" || credential.kind === "machine" ? ["read", "write"] : credential.device.scopes;
			// A socket carries events; it is a read surface, but a terminal-class
			// write scope is not needed here. Read is the honest requirement.
			if (!scopeSatisfies(scopes, "read")) return json({ error: "insufficient_scope" }, 403);
		}
		const authorized = await this.#authorize(req, remoteAddr);
		if (authorized === undefined) return json({ error: "unauthenticated" }, 401);
		const [sessionId] = authorized;
		let selection: ConversationContext | undefined;
		try {
			selection = this.#requestContext(req, sessionId);
		} catch {
			return json({ error: "context_closed" }, 404);
		}
		const upgraded = server.upgrade(req, {
			data: { kind: "studio", sessionId: selection === undefined ? sessionId : `context:${selection.id}` },
		});
		return upgraded ? null : json({ error: "websocket_upgrade_failed" }, 500);
	}

	/** Track a live event socket for a paired session (called on socket open). */
	attachSocket(sessionId: string, socket: StudioSocket): void {
		if (sessionId.startsWith("context:") && !this.#contexts.isLive(sessionId.slice(8))) {
			socket.close?.();
			return;
		}
		const set = this.#sockets.get(sessionId) ?? new Set<StudioSocket>();
		set.add(socket);
		this.#sockets.set(sessionId, set);
		void this.#syncRuntime(sessionId).catch(error =>
			logger.warn("Studio runtime subscription failed", { error: String(error) }),
		);
	}

	/** Drop a closed socket. */
	detachSocket(sessionId: string, socket: StudioSocket): void {
		const cookieOwner = sessionId.startsWith("context:") ? this.#contexts.peek(sessionId.slice(8))?.owner : sessionId;
		const set = this.#sockets.get(sessionId);
		if (!set) return;
		set.delete(socket);
		if (set.size === 0) {
			this.#sockets.delete(sessionId);
			this.#stopRuntime(sessionId);
		}
		if (set.size === 0) {
			releaseStudioPrivateOwner(sessionId);
			releaseStudioEvaluationOwner(sessionId);
			releasePredictionPrivateOwner(sessionId);
		}
		if (cookieOwner && !this.#memoryOwnerConnected(cookieOwner)) releaseMemoryCredentials(cookieOwner);
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
			this.#contexts.closeOwner(sessionId);
			dropped += 1;
		}
		return dropped;
	}

	/** Close every live event socket of one session. */
	#closeSockets(sessionId: string): void {
		releaseStudioPrivateOwner(sessionId);
		releaseStudioEvaluationOwner(sessionId);
		releasePredictionPrivateOwner(sessionId);
		releaseMemoryCredentials(sessionId);
		this.#stopRuntime(sessionId);
		this.#cursors.delete(sessionId);
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

	#stopRuntime(owner: string): void {
		this.#feeds.get(owner)?.dispose();
		this.#feeds.delete(owner);
	}

	/** Rebind only the namespace that changed; empty contexts never use root. */
	async #syncRuntime(owner: string): Promise<void> {
		if (!this.#sockets.has(owner)) return;
		const context = owner.startsWith("context:") ? this.#contexts.peek(owner.slice(8)) : undefined;
		if (owner.startsWith("context:") && context === undefined) {
			this.#stopRuntime(owner);
			return;
		}
		let sessionId = context?.sessionId;
		if (context === undefined) {
			try {
				sessionId = await currentSessionId();
			} catch {
				this.#stopRuntime(owner);
				return;
			}
			if (!this.#sockets.has(owner)) return;
			const liveSession = owner === "" ? undefined : await sessionStore().get(owner);
			if (
				owner !== "" &&
				(liveSession === undefined ||
					!(await bindingAllows(liveSession.binding, { sessionId }, workspaceOfSessionResolver())))
			) {
				this.#stopRuntime(owner);
				return;
			}
		}
		if (sessionId === undefined) {
			this.#stopRuntime(owner);
			return;
		}
		const wrapper = getRpcSession(sessionId);
		if (!wrapper?.isAlive()) {
			this.#stopRuntime(owner);
			return;
		}
		if (this.#feeds.get(owner)?.sessionId === sessionId) return;
		this.#stopRuntime(owner);
		let disposed = false;
		const live = () =>
			!disposed &&
			this.#sockets.has(owner) &&
			(!owner.startsWith("context:") || this.#contexts.peek(owner.slice(8))?.sessionId === sessionId);
		const feed = conversationFeed(wrapper);
		const detachConversation = feed.subscribe(event => {
			if (live())
				this.#emit(
					owner,
					{
						kind: "conversation.changed",
						sessionId: sessionId as Extract<ClientEvent, { kind: "conversation.changed" }>["sessionId"],
						streamSeq: event.streamSeq,
						eventSeq: event.eventSeq,
						update: event.update,
					},
					event.stateVersion,
				);
		});
		const detachComputer = subscribeComputerWorkspace(owner, change => {
			if (!live() || wrapper.getSession().isDisposed || wrapper.getSession().sessionId !== sessionId) return;
			try {
				validateComputerWorkspaceChange(change);
			} catch {
				this.#emit(owner, { kind: "resync.required", reason: "Computer workspace metadata changed" });
				return;
			}
			this.#emit(owner, { kind: "computer.changed", change }, wrapper.getSession().getStateVersion());
		});
		let refreshPending = false;
		const refresh = () => {
			if (refreshPending) return;
			refreshPending = true;
			void snapshotFor(sessionId)
				.then(snapshot => {
					if (live()) this.#emit(owner, { kind: "snapshot", snapshot }, snapshot.stateVersion);
				})
				.catch(error => {
					if (live()) this.#emit(owner, { kind: "resync.required", reason: String(error) });
				})
				.finally(() => {
					refreshPending = false;
				});
		};
		const detachState = wrapper.onEvent(event => {
			if (
				["running", "not-running", "state_changed", "model_changed", "queue_update", "agent_end"].includes(
					event.type,
				)
			)
				refresh();
		});
		this.#feeds.set(owner, {
			sessionId,
			dispose: () => {
				disposed = true;
				detachConversation();
				detachComputer();
				detachState();
			},
		});
		refresh();
	}

	/** Contiguous cursor within the authenticated delivery namespace. */
	#emit(sessionId: string, event: StudioEventBody, stateVersion = 0): void {
		const sockets = this.#sockets.get(sessionId);
		if (!sockets || sockets.size === 0) return;
		const cursor = (this.#cursors.get(sessionId) ?? 0) + 1;
		this.#cursors.set(sessionId, cursor);
		const envelope = {
			...event,
			authorityEpoch: 1,
			stateVersion,
			cursor: String(cursor) as EventCursor,
			occurredAt: new Date().toISOString(),
			...(event.kind === "snapshot" || event.kind === "conversation.changed" || event.kind === "computer.changed"
				? { runtimeEpoch: 1 }
				: {}),
		} as ClientEvent;
		const payload = JSON.stringify(envelope);
		for (const socket of sockets) socket.send(payload);
	}
}

/** Queries that carry no conversation content and are readable to a bound device. */
const AMBIENT_QUERY_NAMES: Readonly<Record<string, true>> = {
	"environment.get": true,
};

/** These handlers address the session selected by the authenticated context. */
const SESSION_SELECTION_OPERATIONS = new Set<string>([
	"accounts.status",
	"accounts.status.details",
	"annotations.capture",
	"annotations.prepare",
	"artifacts.context",
	"artifacts.resource",
	"session.lease.read",
	"session.lease.inspect",
	"btw.ask",
	"btw.abort",
	"btw.branch",
	"btw.history.list",
	"btw.history.read",
	"btw.followUp",
	"btw.images.resolve",
	"evaluations.context",
	"evaluations.list",
	"evaluations.read",
	"evaluations.rows",
	"evaluations.retrySpec",
	"evaluations.patch",
	"evaluations.exportChunk",
	"evaluations.prepare",
	"evaluations.start",
	"evaluations.control",
	"evaluations.export",
	"evaluations.respond",
	"evaluations.openWorkspace",
	"session.state",
	"session.transcript.read",
	"agent.transcript.read",
	"agent.conversation.read",
	"session.fork",
	"session.tree.get",
	"session.tree.navigate",
	"session.tree.branch",
	"session.model.set",
	"session.thinking.set",
	"core.prompt",
	"core.steer",
	"core.followUp",
	"core.abort",
	"core.continue",
	"queue.enqueue",
	"mode.plan.enter",
	"mode.plan.exit",
	"mode.plan.review.open",
	"mode.plan.review.respond",
	"operator.invoke",
	"interaction.respond",
]);

/** Pairing input the client got wrong (answered 400, never a silent default). */
class PairingInputError extends Error {}

class ConversationContextError extends Error {}

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
	if ("artifactId" in input && typeof input.artifactId === "string") {
		// Only a session-artifact handle names a conversation; evaluation and
		// other opaque artifact ids carry their own operation scope.
		const sessionId = tryArtifactSessionIdFor(input.artifactId);
		if (sessionId !== undefined) return { sessionId };
	}
	const nested = "target" in input && input.target !== null && typeof input.target === "object" ? input.target : input;
	const sessionId =
		"sessionId" in nested && typeof nested.sessionId === "string"
			? nested.sessionId
			: "parentSessionId" in nested && typeof nested.parentSessionId === "string"
				? nested.parentSessionId
				: "threadId" in input && typeof input.threadId === "string"
					? input.threadId
					: undefined;
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
