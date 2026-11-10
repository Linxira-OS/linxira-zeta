/**
 * Socket seams for the Gateway/OneBot adapters.
 *
 * The adapters speak JSON over a WebSocket. Tests drive the protocol with an
 * in-memory `SocketLike`, so nothing in the test suite opens a real socket.
 * The default implementations wrap Bun's WebSocket client and `Bun.serve`.
 */

export interface SocketLike {
	send(data: string): void;
	close(code?: number, reason?: string): void;
	terminate?(): void;
	ping?(): void;
	readonly readyState: number;
	onOpen(handler: () => void): void;
	onMessage(handler: (data: string) => void): void;
	onClose(handler: (code: number, reason: string) => void): void;
	onError(handler: (error: unknown) => void): void;
}

export type SocketFactory = (url: string, headers: Record<string, string>) => SocketLike;

export function socketOpen(socket: SocketLike | null | undefined): boolean {
	return socket?.readyState === 1;
}

/** Bun's client WebSocket; headers carry `Authorization` for OneBot forward WS. */
export const bunSocketFactory: SocketFactory = (url, headers) => {
	const socket = new WebSocket(url, { headers });
	return {
		send: data => socket.send(data),
		close: (code, reason) => socket.close(code, reason),
		terminate: () => socket.terminate(),
		ping: () => socket.ping(),
		get readyState() {
			return socket.readyState;
		},
		onOpen: handler => socket.addEventListener("open", () => handler()),
		onMessage: handler =>
			socket.addEventListener("message", event => {
				const data: unknown = event.data;
				if (typeof data === "string") handler(data);
				else if (data instanceof ArrayBuffer) handler(new TextDecoder().decode(data));
				else if (ArrayBuffer.isView(data))
					handler(new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)));
				else if (typeof data === "object" && data !== null) handler(String(data));
			}),
		onClose: handler => socket.addEventListener("close", event => handler(event.code, event.reason)),
		onError: handler => socket.addEventListener("error", event => handler(event)),
	};
};

export interface ReverseConnection {
	socket: SocketLike;
	/** Request headers of the upgrade (used for the Bearer check). */
	headers: Record<string, string>;
}

export interface ReverseServerOptions {
	hostname: string;
	port: number;
	/** Required in reverse mode; a connection without it is rejected with 401. */
	token?: string;
	onConnection(connection: ReverseConnection): void;
}

export interface ReverseServerLike {
	readonly port: number;
	stop(): void;
}

export type ReverseServerFactory = (options: ReverseServerOptions) => ReverseServerLike;

/**
 * Loopback-only WebSocket server for OneBot reverse mode. Every accepted
 * socket gets its own handler slots; `Bun.serve` callbacks route by socket.
 */
export const bunReverseServerFactory: ReverseServerFactory = options => {
	interface State {
		handlers: {
			message?: (data: string) => void;
			close?: (code: number, reason: string) => void;
		};
	}
	const states = new WeakMap<object, State>();
	const live = new Set<Bun.ServerWebSocket<{ authorization: string }>>();
	const server = Bun.serve<{ authorization: string }>({
		hostname: options.hostname,
		port: options.port,
		fetch(request, bunServer) {
			const authorization = request.headers.get("authorization") ?? "";
			if (options.token && authorization !== `Bearer ${options.token}`) {
				return new Response("Unauthorized", { status: 401 });
			}
			if (bunServer.upgrade(request, { data: { authorization } })) return undefined;
			return new Response("Expected a WebSocket upgrade", { status: 426 });
		},
		websocket: {
			open(ws) {
				const state: State = { handlers: {} };
				states.set(ws, state);
				live.add(ws);
				const socket: SocketLike = {
					send: data => ws.send(data),
					close: (code, reason) => ws.close(code, reason),
					terminate: () => ws.terminate(),
					get readyState() {
						return ws.readyState;
					},
					onOpen: handler => queueMicrotask(handler),
					onMessage: handler => {
						state.handlers.message = handler;
					},
					onClose: handler => {
						state.handlers.close = handler;
					},
					onError: () => {},
				};
				options.onConnection({ socket, headers: { authorization: ws.data.authorization } });
			},
			message(ws, message) {
				states.get(ws)?.handlers.message?.(typeof message === "string" ? message : message.toString());
			},
			close(ws, code, reason) {
				live.delete(ws);
				states.get(ws)?.handlers.close?.(code, reason);
			},
		},
	});
	return {
		port: server.port ?? options.port,
		stop: () => {
			for (const ws of live) ws.close(1000, "channel stopped");
			live.clear();
			server.stop(true);
		},
	};
};
