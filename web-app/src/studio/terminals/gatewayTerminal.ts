/**
 * Browser client for the gateway's embedded terminal (Work Studio).
 *
 * The Electron preload exposes the same shape as `window.zetaStudioTerminal`;
 * this module is the browser implementation of that surface, talking to the
 * routes in `packages/coding-agent/src/server/web-gateway/terminal.ts`:
 *
 *   GET    /api/terminal/profiles
 *   POST   /api/terminal/ensure   (reattach-or-spawn by cwd + instanceId)
 *   POST   /api/terminal/:id/resize
 *   POST   /api/terminal/:id/ticket
 *   DELETE /api/terminal/:id
 *   WS     /api/terminal/:id/ws   (binary PTY bytes + NUL-prefixed control JSON)
 *
 * Nothing here spawns a process itself; a profile id is the only client input
 * that reaches executable selection, and the server validates it against its
 * own catalog.
 */

export interface TerminalProfile {
	readonly id: string;
	readonly label: string;
	readonly kind: string;
	readonly command: string;
	readonly args: readonly string[];
	readonly source: "detected" | "custom";
	readonly icon: string;
	readonly detail?: string;
}

export interface TerminalProfileCatalog {
	readonly profiles: readonly TerminalProfile[];
	readonly defaultProfileId: string | null;
	readonly platform: string;
	readonly warnings: readonly string[];
}

export interface GatewayTerminalInfo {
	readonly id: string;
	readonly shell: string;
	readonly cwd: string;
	readonly instance: string;
	readonly program: string;
	readonly profile: string | null;
	readonly fallbackReason: string | null;
	readonly ticket: string;
	readonly reused?: boolean;
}

export interface EnsureTerminalInput {
	readonly cols: number;
	readonly rows: number;
	readonly cwd?: string;
	readonly instanceId?: string;
	readonly profileId?: string;
	/** End the slot's live session and spawn the requested one (shell change). */
	readonly replace?: boolean;
}

export type TerminalConnectionState = "connecting" | "open" | "reconnecting" | "closed";

export interface TerminalControlFrame {
	readonly event?: string;
	readonly replayedBytes?: number;
	readonly exitCode?: number | null;
	readonly reason?: string;
}

export interface TerminalConnectionHandlers {
	onData(text: string): void;
	onControl?(frame: TerminalControlFrame): void;
	onState?(state: TerminalConnectionState): void;
	onError?(message: string): void;
}

/** A gateway failure with its machine-readable code (never a bare "failed"). */
export class TerminalGatewayError extends Error {
	constructor(
		message: string,
		readonly code: string,
		readonly status: number,
	) {
		super(message);
		this.name = "TerminalGatewayError";
	}
}

const REQUEST_TIMEOUT_MS = 10_000;
const RECONNECT_BASE_MS = 250;
const RECONNECT_MAX_MS = 4_000;

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
	let response: Response;
	try {
		response = await fetch(path, {
			...init,
			credentials: "same-origin",
			headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
	} catch (cause) {
		throw new TerminalGatewayError(
			`terminal gateway unreachable: ${cause instanceof Error ? cause.message : String(cause)}`,
			"gateway_unreachable",
			0,
		);
	}
	let body: unknown = null;
	try {
		body = await response.json();
	} catch {
		body = null;
	}
	if (!response.ok) {
		const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
		const message = typeof record.error === "string" ? record.error : `terminal request failed (${response.status})`;
		const code = typeof record.code === "string" ? record.code : `http_${response.status}`;
		throw new TerminalGatewayError(message, code, response.status);
	}
	return body as T;
}

/** WebSocket origin for the current page: same-origin, ws/wss by scheme. */
export function terminalWebSocketUrl(id: string, ticket: string): string {
	const scheme = location.protocol === "https:" ? "wss:" : "ws:";
	const query = ticket ? `?ticket=${encodeURIComponent(ticket)}` : "";
	return `${scheme}//${location.host}/api/terminal/${encodeURIComponent(id)}/ws${query}`;
}

/** One attached socket; reconnects with a fresh one-time ticket after a drop. */
export class TerminalConnection {
	#socket: WebSocket | null = null;
	#decoder = new TextDecoder("utf-8");
	#ended = false;
	#disposed = false;
	#attempt = 0;
	#reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	#pendingInput: string[] = [];

	constructor(
		public info: GatewayTerminalInfo,
		readonly handlers: TerminalConnectionHandlers,
	) {}

	get state(): TerminalConnectionState {
		if (this.#disposed) return "closed";
		if (!this.#socket) return this.#attempt > 0 ? "reconnecting" : "connecting";
		return this.#socket.readyState === WebSocket.OPEN ? "open" : "connecting";
	}

	open(): void {
		if (this.#disposed || this.#socket) return;
		this.handlers.onState?.(this.#attempt > 0 ? "reconnecting" : "connecting");
		let socket: WebSocket;
		try {
			socket = new WebSocket(terminalWebSocketUrl(this.info.id, this.info.ticket));
		} catch (cause) {
			this.handlers.onError?.(`terminal socket failed: ${cause instanceof Error ? cause.message : String(cause)}`);
			this.#scheduleReconnect();
			return;
		}
		socket.binaryType = "arraybuffer";
		this.#socket = socket;
		socket.addEventListener("open", () => {
			this.#attempt = 0;
			this.handlers.onState?.("open");
			for (const chunk of this.#pendingInput.splice(0)) socket.send(chunk);
		});
		socket.addEventListener("message", event => this.#onMessage(event.data));
		socket.addEventListener("error", () => {
			this.handlers.onError?.("terminal socket error");
		});
		socket.addEventListener("close", () => {
			if (this.#socket !== socket) return;
			this.#socket = null;
			if (this.#disposed) return;
			if (this.#ended) {
				this.handlers.onState?.("closed");
				return;
			}
			this.handlers.onState?.("reconnecting");
			this.#scheduleReconnect();
		});
	}

	send(data: string): void {
		if (this.#ended) return;
		const socket = this.#socket;
		if (socket && socket.readyState === WebSocket.OPEN) {
			socket.send(data);
			return;
		}
		// Small keystroke bursts typed before the socket opens. Cap so a dead
		// gateway cannot grow this queue without bound.
		if (this.#pendingInput.join("").length < 64 * 1024) this.#pendingInput.push(data);
	}

	/** Reconnect immediately (used after an explicit wake/resize, not a loop). */
	reconnect(): void {
		if (this.#disposed || this.#ended) return;
		this.#socket?.close(1000, "client reconnect");
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
		this.#reconnectTimer = null;
		this.#socket?.close(1000, "client closed");
		this.#socket = null;
		this.#pendingInput.length = 0;
		this.handlers.onState?.("closed");
	}

	#onMessage(data: unknown): void {
		const bytes =
			data instanceof ArrayBuffer
				? new Uint8Array(data)
				: ArrayBuffer.isView(data)
					? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
					: null;
		if (!bytes) {
			if (typeof data === "string") this.handlers.onData(data);
			return;
		}
		if (bytes.length > 0 && bytes[0] === 0) {
			let frame: TerminalControlFrame = {};
			try {
				frame = JSON.parse(new TextDecoder().decode(bytes.subarray(1))) as TerminalControlFrame;
			} catch {
				return;
			}
			if (frame.event === "exit" || frame.event === "session_ended") {
				this.#ended = true;
				this.handlers.onState?.("closed");
			}
			this.handlers.onControl?.(frame);
			return;
		}
		this.handlers.onData(this.#decoder.decode(bytes, { stream: true }));
	}

	#scheduleReconnect(): void {
		if (this.#disposed || this.#ended || this.#reconnectTimer) return;
		const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.min(this.#attempt, 4));
		this.#attempt++;
		this.#reconnectTimer = setTimeout(() => {
			this.#reconnectTimer = null;
			// A dropped socket may mean the session is gone; ask for a fresh
			// ticket first so a 404 ends the loop instead of spinning.
			void clientForReconnect(this.info.id)
				.then(ticket => {
					this.info = { ...this.info, ticket };
					this.open();
				})
				.catch(error => {
					this.handlers.onError?.(error instanceof Error ? error.message : String(error));
					this.#scheduleReconnect();
				});
		}, delay);
	}
}

/**
 * Ticket lookup for reconnect. Kept as a module function so `TerminalConnection`
 * does not need a back-reference to the full client.
 */
async function clientForReconnect(id: string): Promise<string> {
	const body = await requestJson<{ ticket?: string }>(`/api/terminal/${encodeURIComponent(id)}/ticket`, {
		method: "POST",
	});
	if (!body.ticket) throw new TerminalGatewayError("terminal session no longer exists", "terminal_gone", 404);
	return body.ticket;
}

/** REST surface shared by the React store and the benchmark harness. */
export const gatewayTerminal = {
	listProfiles(): Promise<TerminalProfileCatalog> {
		return requestJson<TerminalProfileCatalog>("/api/terminal/profiles");
	},
	list(): Promise<{ terminals: GatewayTerminalInfo[] }> {
		return requestJson<{ terminals: GatewayTerminalInfo[] }>("/api/terminal");
	},
	ensure(input: EnsureTerminalInput): Promise<GatewayTerminalInfo> {
		return requestJson<GatewayTerminalInfo>("/api/terminal/ensure", {
			method: "POST",
			body: JSON.stringify(input),
		});
	},
	async create(input: EnsureTerminalInput): Promise<GatewayTerminalInfo> {
		return requestJson<GatewayTerminalInfo>("/api/terminal", { method: "POST", body: JSON.stringify(input) });
	},
	resize(id: string, cols: number, rows: number): Promise<unknown> {
		return requestJson(`/api/terminal/${encodeURIComponent(id)}/resize`, {
			method: "POST",
			body: JSON.stringify({ cols, rows }),
		});
	},
	remove(id: string): Promise<unknown> {
		return requestJson(`/api/terminal/${encodeURIComponent(id)}`, { method: "DELETE" });
	},
	connect(
		info: GatewayTerminalInfo,
		handlers: TerminalConnectionHandlers,
	): TerminalConnection {
		const connection = new TerminalConnection(info, handlers);
		connection.open();
		return connection;
	},
};
