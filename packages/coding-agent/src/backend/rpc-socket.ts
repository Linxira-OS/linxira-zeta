/**
 * Protocol client for a session owned by a running backend.
 *
 * The stdio `RpcClient` spawns the agent itself and owns its lifetime; this
 * client attaches to a session that is already live (`zeta serve`, the gateway
 * listener at `/api/rpc/ws`). Same frames, same correlation, same v2 chunking —
 * the transport is one WebSocket message per JSON frame instead of stdout
 * lines, and closing the socket detaches rather than ending the session.
 *
 * Used by surfaces that are clients of the backend rather than owners of it;
 * `docs/rpc.md` ("WebSocket Transport") is the contract this implements.
 */

import { RpcFrameDecoder } from "../modes/rpc/rpc-frame";
import type { RpcReadyFrame } from "../modes/rpc/rpc-types";
import type { RpcResponse } from "../modes/rpc/wire/rpc-wire.generated";

export class RpcSocketError extends Error {
	readonly code: string | undefined;
	constructor(message: string, code?: string) {
		super(message);
		this.name = "RpcSocketError";
		this.code = code;
	}
}

export interface RpcSocketOptions {
	/** Full socket URL, including the session id query (`/api/rpc/ws?sessionId=…`). */
	url: string;
	/** Ready handshake budget; the gateway answers immediately on loopback. */
	readyTimeoutMs?: number;
	/** Per-command budget when the caller does not pass one. */
	callTimeoutMs?: number;
}

interface PendingCall {
	resolve: (response: RpcResponse) => void;
	reject: (error: Error) => void;
	timer: NodeJS.Timeout;
}

const DEFAULT_READY_TIMEOUT_MS = 10_000;
const DEFAULT_CALL_TIMEOUT_MS = 60_000;

function isResponse(value: object): value is RpcResponse {
	return "type" in value && value.type === "response";
}

function isReady(value: object): value is RpcReadyFrame {
	return "type" in value && value.type === "ready";
}

export class RpcSocketClient {
	#socket: WebSocket;
	#decoder = new RpcFrameDecoder();
	#ready: RpcReadyFrame;
	#pending = new Map<string, PendingCall>();
	#events = new Set<(frame: Record<string, unknown>) => void>();
	#closeListeners = new Set<(reason: string) => void>();
	#requestId = 0;
	#closed = false;
	#callTimeoutMs: number;

	private constructor(socket: WebSocket, ready: RpcReadyFrame, callTimeoutMs: number) {
		this.#socket = socket;
		this.#ready = ready;
		this.#callTimeoutMs = callTimeoutMs;
	}

	/** The ready frame the backend sent (protocol limits included). */
	get ready(): RpcReadyFrame {
		return this.#ready;
	}

	get closed(): boolean {
		return this.#closed;
	}

	static async connect(options: RpcSocketOptions): Promise<RpcSocketClient> {
		const socket = new WebSocket(options.url);
		socket.binaryType = "arraybuffer";
		const callTimeoutMs = options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
		const readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;

		const opened = Promise.withResolvers<RpcReadyFrame>();
		const timer = setTimeout(
			() => opened.reject(new RpcSocketError(`connection to ${options.url} timed out`)),
			readyTimeoutMs,
		);
		const decoder = new RpcFrameDecoder();

		socket.addEventListener("message", event => {
			let frame: object | undefined;
			try {
				const parsed: unknown = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
				frame = decoder.push(parsed);
			} catch (error) {
				opened.reject(error instanceof Error ? error : new Error(String(error)));
				return;
			}
			if (frame && isReady(frame)) opened.resolve(frame);
		});
		socket.addEventListener("error", () => opened.reject(new RpcSocketError(`could not connect to ${options.url}`)), {
			once: true,
		});
		socket.addEventListener("close", () => opened.reject(new RpcSocketError("connection closed before ready")), {
			once: true,
		});

		const ready = await opened.promise.finally(() => clearTimeout(timer));
		const client = new RpcSocketClient(socket, ready, callTimeoutMs);
		// The handshake had temporary listeners; from here the client owns the socket.
		socket.onmessage = event => client.#receive(event.data);
		socket.onclose = event => client.#shutdown(event.reason || "connection closed");
		socket.onerror = () => client.#shutdown("socket error");

		if (ready.supportedProtocolVersions.includes(2)) {
			try {
				await client.call("negotiate_protocol", { protocolVersion: 2 }, readyTimeoutMs);
			} catch {
				// v1 still works; oversized frames arrive elided instead of chunked.
			}
		}
		return client;
	}

	/** Send a command and resolve with its `data`; reject on `success: false`. */
	async call<T = unknown>(
		command: string,
		params: Record<string, unknown> = {},
		timeoutMs = this.#callTimeoutMs,
	): Promise<T> {
		if (this.#closed) throw new RpcSocketError("rpc socket is closed");
		const id = `client-${++this.#requestId}`;
		const { promise, resolve, reject } = Promise.withResolvers<RpcResponse>();
		const timer = setTimeout(() => {
			if (!this.#pending.delete(id)) return;
			reject(new RpcSocketError(`${command} timed out after ${timeoutMs}ms`));
		}, timeoutMs);
		this.#pending.set(id, { resolve, reject, timer });
		this.#socket.send(JSON.stringify({ id, type: command, ...params }));
		const response = await promise;
		if (!response.success) throw new RpcSocketError(response.error ?? `${command} failed`, response.code);
		return response.data as T;
	}

	/** Unc correlated frames (commands, events, dialog requests), in arrival order. */
	onEvent(listener: (frame: Record<string, unknown>) => void): () => void {
		this.#events.add(listener);
		return () => {
			this.#events.delete(listener);
		};
	}

	onClose(listener: (reason: string) => void): () => void {
		this.#closeListeners.add(listener);
		return () => {
			this.#closeListeners.delete(listener);
		};
	}

	/** Send an uncorrelated frame (`extension_ui_response`, host-tool updates). */
	notify(frame: Record<string, unknown>): void {
		if (this.#closed) return;
		this.#socket.send(JSON.stringify(frame));
	}

	/** Detach. The backend session keeps running; pending calls reject. */
	close(): void {
		if (this.#closed) return;
		this.#closed = true;
		for (const pending of this.#pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(new RpcSocketError("rpc socket closed"));
		}
		this.#pending.clear();
		try {
			this.#socket.close(1000, "client closed");
		} catch {
			// Already closing.
		}
	}

	#receive(data: unknown): void {
		if (this.#closed) return;
		let frame: object | undefined;
		try {
			const parsed: unknown = JSON.parse(typeof data === "string" ? data : String(data));
			frame = this.#decoder.push(parsed);
		} catch (error) {
			// A corrupt frame ends the stream's usefulness; surface it as a close.
			this.#shutdown(error instanceof Error ? error.message : String(error));
			return;
		}
		if (!frame) return;
		if (isResponse(frame) && frame.id) {
			const pending = this.#pending.get(frame.id);
			if (pending) {
				this.#pending.delete(frame.id);
				clearTimeout(pending.timer);
				pending.resolve(frame);
				return;
			}
		}
		for (const listener of this.#events) listener(frame as Record<string, unknown>);
	}

	#shutdown(reason: string): void {
		if (this.#closed) return;
		this.#closed = true;
		for (const pending of this.#pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(new RpcSocketError(reason));
		}
		this.#pending.clear();
		for (const listener of this.#closeListeners) listener(reason);
	}
}
