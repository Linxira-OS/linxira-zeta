/**
 * Browser transport and the small StudioClient adapter the Team/Rooms pages
 * need: query, command, and `command.receipt` waiting.
 *
 * The Host answers a command with HTTP 202 (accepted); the terminal result
 * arrives as a WebSocket `command.receipt`. This adapter keeps a receipt cache
 * keyed by `requestId` and exposes `getState()`/`subscribe()` so
 * `hostError.waitReceipt` can settle from either the cache or a live event.
 *
 * It deliberately implements only that subset instead of the web-app
 * `StudioClientImpl` reducer. The copied `browser-transport.ts` owns HTTP,
 * CSRF and the event socket.
 */
import type {
	ClientBootstrap,
	ClientCommandAccepted,
	ClientCommandRequest,
	ClientError,
	ClientEvent,
	ClientQueryRequest,
	ClientQueryResponse,
	ClientContextScope,
	ClientTransport,
	CommandHandle,
	CommandInput,
	CommandName,
	CommandOptions,
	CommandReceipt,
	CommandState,
	IdempotencyKey,
	QueryInput,
	QueryName,
	QueryResult,
	StudioClient,
	SubscriptionScope,
	Unsubscribe,
} from "@linxiraos/studio-contract";
import {
	BrowserWebClientTransport,
	StudioHttpError,
	type BrowserWebClientOptions,
	type FetchLike,
	type WebSocketLike,
} from "./browser-transport";

export interface ClientState {
	readonly commands: Readonly<Record<string, CommandState>>;
}

export interface StudioWebClientOptions extends BrowserWebClientOptions {
	readonly webSocketFactory?: (url: string) => WebSocketLike;
}

/** Same-origin fetch that always carries the browser's session cookie. */
export function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	return fetch(input, { ...init, credentials: init?.credentials ?? "include" });
}

export type StepUpPrompt = () => Promise<string | null>;

let stepUpPrompt: StepUpPrompt | null = null;

/** Installed once by the React entry; resolves `null` when no UI is mounted. */
export function installStepUpPrompt(prompt: StepUpPrompt): Unsubscribe {
	stepUpPrompt = prompt;
	return () => {
		if (stepUpPrompt === prompt) stepUpPrompt = null;
	};
}

function twoFactorCredential(input: string): { code: string } | { recoveryCode: string } {
	const value = input.trim();
	const digits = value.replace(/\s/gu, "");
	return /^\d{6}$/u.test(digits) ? { code: digits } : { recoveryCode: value };
}

async function readTotpChallenge(response: Response): Promise<boolean> {
	if (response.status !== 403) return false;
	try {
		const body: unknown = await response.clone().json();
		return body !== null && typeof body === "object" && "error" in body && body.error === "totp_required";
	} catch {
		return false;
	}
}

/**
 * Wrap a fetcher with the challenge → verify → replay-once protocol. The Host
 * refuses before executing, so replaying once cannot duplicate a write.
 */
export function createStepUpFetch(inner: FetchLike = authFetch): FetchLike {
	let verification: Promise<boolean> | null = null;
	const verify = async (): Promise<boolean> => {
		if (stepUpPrompt === null) return false;
		try {
			const code = await stepUpPrompt();
			if (code === null) return false;
			const response = await inner("/api/auth/2fa/verify", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(twoFactorCredential(code)),
			});
			return response.ok;
		} catch {
			return false;
		}
	};
	return async (input, init) => {
		const primary: RequestInfo | URL = input instanceof Request ? input.clone() : input;
		const response = await inner(primary, init);
		if (!(await readTotpChallenge(response))) return response;
		const body = init?.body;
		const replayable =
			body === undefined ||
			body === null ||
			typeof body === "string" ||
			body instanceof URLSearchParams ||
			body instanceof Blob ||
			body instanceof ArrayBuffer ||
			ArrayBuffer.isView(body) ||
			body instanceof FormData;
		if (!replayable) return response;
		verification ??= verify().finally(() => {
			verification = null;
		});
		if (!(await verification)) return response;
		return inner(input, init);
	};
}

let sequence = 0;

function newRequestId(): string {
	sequence += 1;
	const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${sequence}`;
	return `cmd-${random}`;
}

function newIdempotencyKey(): IdempotencyKey {
	sequence += 1;
	const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${sequence}`;
	return `idem-${random}` as IdempotencyKey;
}

function asClientError(error: unknown): ClientError {
	if (error instanceof StudioHttpError) {
		return { code: error.code ?? `http_${error.status}`, message: error.code ?? error.message };
	}
	if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
		const code = "code" in error && typeof error.code === "string" ? error.code : "TRANSPORT_ERROR";
		return { code, message: error.message };
	}
	return { code: "TRANSPORT_ERROR", message: String(error) };
}

function eventMatchesScope(scope: SubscriptionScope, event: ClientEvent): boolean {
	if (scope.scope === "all") return true;
	if (scope.scope === "command") {
		if (event.kind === "command.receipt") return event.receipt.requestId === scope.requestId;
		if (event.kind === "command.accepted") return event.accepted.requestId === scope.requestId;
		return false;
	}
	return event.kind !== "command.receipt" && event.kind !== "command.accepted";
}

export class StudioWebClient implements StudioClient {
	#transport: BrowserWebClientTransport;
	readonly #options: StudioWebClientOptions;
	readonly #commands = new Map<string, CommandState>();
	readonly #listeners = new Set<{ readonly scope: SubscriptionScope; readonly listener: (event: ClientEvent) => void }>();
	readonly #authLostListeners = new Set<() => void>();
	#transportUnsubscribe: Unsubscribe | undefined;
	#bootstrapPromise: Promise<ClientBootstrap> | undefined;
	#bootstrapped = false;
	#authLostNotified = false;
	#transportEpoch = 0;
	#closed = false;

	constructor(options: StudioWebClientOptions) {
		this.#options = options;
		this.#transport = new BrowserWebClientTransport(options);
	}

	get transport(): ClientTransport {
		return this.#transport;
	}

	/**
	 * Exchange a one-time `#zeta-pair` code for the device cookie and CSRF.
	 * Pairing while already bootstrapped changes the device identity: drop the
	 * old cookie-bound event socket first so its events cannot shadow the new
	 * session.
	 */
	async pair(code: string): Promise<void> {
		if (this.#bootstrapped) await this.reset();
		await this.#transport.pair(code);
	}

	/**
	 * The paired session was revoked or expired (a 401 from query/command).
	 * The page must pair again; the caller replaces the transport so a new
	 * device cookie is not shadowed by the old event socket.
	 */
	onAuthLost(listener: () => void): Unsubscribe {
		this.#authLostListeners.add(listener);
		return () => this.#authLostListeners.delete(listener);
	}

	/** Drop the current session's transport; the next pair/bootstrap starts clean. */
	async reset(): Promise<void> {
		this.#transportEpoch += 1;
		this.#bootstrapped = false;
		this.#bootstrapPromise = undefined;
		this.#authLostNotified = false;
		this.#commands.clear();
		this.#transportUnsubscribe?.();
		this.#transportUnsubscribe = undefined;
		const previous = this.#transport;
		this.#transport = new BrowserWebClientTransport(this.#options);
		await previous.close().catch(() => {});
	}

	#reportAuthLost(error: unknown): void {
		if (!(error instanceof StudioHttpError) || error.status !== 401 || this.#authLostNotified) return;
		this.#authLostNotified = true;
		for (const listener of this.#authLostListeners) {
			try {
				listener();
			} catch {
				// One page handler failing must not leave the others unnotified.
			}
		}
	}

	async bootstrap(): Promise<ClientBootstrap> {
		if (this.#closed) throw { code: "TRANSPORT_ERROR", message: "client_closed" } satisfies ClientError;
		if (this.#bootstrapPromise !== undefined) return this.#bootstrapPromise;
		this.#ensureSubscribed();
		const epoch = this.#transportEpoch;
		const pending = this.#transport.bootstrap().then(bootstrap => {
			if (epoch !== this.#transportEpoch) throw { code: "TRANSPORT_ERROR", message: "transport_reset" } satisfies ClientError;
			this.#bootstrapped = true;
			this.#authLostNotified = false;
			return bootstrap;
		}).catch(error => {
			this.#reportAuthLost(error);
			throw error;
		});
		this.#bootstrapPromise = pending;
		try {
			return await pending;
		} finally {
			if (this.#bootstrapPromise === pending) this.#bootstrapPromise = undefined;
		}
	}

	async query<TName extends QueryName>(name: TName, input: QueryInput<TName>): Promise<QueryResult<TName>> {
		if (!this.#bootstrapped) await this.bootstrap();
		let response: ClientQueryResponse<TName>;
		try {
			response = await this.#transport.query({ queryName: name, input } as ClientQueryRequest<TName>);
		} catch (error) {
			this.#reportAuthLost(error);
			throw asClientError(error);
		}
		if (!response.ok) throw response.error;
		return response.result;
	}

	async command<TName extends CommandName>(
		name: TName,
		input: CommandInput<TName>,
		options?: CommandOptions,
	): Promise<CommandHandle<TName>> {
		if (!this.#bootstrapped) await this.bootstrap();
		const requestId = newRequestId();
		const idempotencyKey = options?.idempotencyKey ?? newIdempotencyKey();
		const issuedAt = new Date().toISOString();
		const handle: CommandHandle<TName> = {
			requestId,
			commandName: name,
			status: "local_pending",
			idempotencyKey,
			issuedAt,
		} as CommandHandle<TName>;
		this.#commands.set(requestId, handle);
		const request: ClientCommandRequest<TName> = { commandName: name, input, idempotencyKey, requestId: requestId as CommandHandle<TName>["requestId"] };
		let accepted: ClientCommandAccepted<TName>;
		try {
			accepted = await this.#transport.command(request);
		} catch (error) {
			this.#reportAuthLost(error);
			const clientError = asClientError(error);
			this.#commands.set(requestId, {
				requestId: request.requestId,
				commandName: name,
				status: "failed",
				error: clientError,
				observedAt: new Date().toISOString(),
			} as CommandReceipt<TName>);
			throw clientError;
		}
		if (accepted.requestId !== request.requestId) {
			const clientError: ClientError = {
				code: "TRANSPORT_ERROR",
				message: `acknowledgement requestId mismatch: expected ${request.requestId}, received ${accepted.requestId}`,
			};
			this.#commands.set(requestId, {
				requestId: request.requestId,
				commandName: name,
				status: "failed",
				error: clientError,
				observedAt: new Date().toISOString(),
			} as CommandReceipt<TName>);
			throw clientError;
		}
		this.#commands.set(requestId, {
			requestId: accepted.requestId,
			commandName: name,
			status: "accepted",
			acceptedAt: accepted.acceptedAt,
		});
		return handle;
	}

	subscribe(scope: SubscriptionScope, listener: (event: ClientEvent) => void): Unsubscribe {
		if (this.#closed) return () => {};
		const entry = { scope, listener };
		this.#listeners.add(entry);
		return () => this.#listeners.delete(entry);
	}

	/** Client-side convenience used by `hostError.waitReceipt`. */
	getState(): ClientState {
		return { commands: Object.fromEntries(this.#commands) };
	}

	async close(): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		this.#transportUnsubscribe?.();
		this.#transportUnsubscribe = undefined;
		this.#listeners.clear();
		await this.#transport.close();
	}

	#ensureSubscribed(): void {
		if (this.#transportUnsubscribe !== undefined) return;
		this.#transportUnsubscribe = this.#transport.subscribe({ scope: "all" }, event => {
			if (event.kind === "command.receipt") {
				this.#commands.set(event.receipt.requestId, event.receipt);
			} else if (event.kind === "command.accepted") {
				const accepted = event.accepted;
				const existing = this.#commands.get(accepted.requestId);
				if (existing === undefined || existing.status === "local_pending") {
					this.#commands.set(accepted.requestId, {
						requestId: accepted.requestId,
						commandName: accepted.commandName,
						status: "accepted",
						acceptedAt: accepted.acceptedAt,
					});
				}
			}
			for (const entry of this.#listeners) {
				if (eventMatchesScope(entry.scope, event)) entry.listener(event);
			}
		});
	}
}

/** Create the client the pages receive; `main.tsx` owns lifecycle. */
export function createStudioWebClient(options: StudioWebClientOptions): StudioWebClient {
	return new StudioWebClient(options);
}

export { BrowserWebClientTransport, StudioHttpError };
export type { ClientContextScope, FetchLike, WebSocketLike };
