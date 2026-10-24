/**
 * The RPC data plane over WebSocket: one protocol host per attached client.
 *
 * The wire protocol is the one the SDKs are generated from (`modes/rpc/wire`),
 * so a client here is indistinguishable from `zetacode --mode rpc` over stdio:
 * same frames, same responses, same events. What differs is ownership — the
 * session belongs to the backend and **outlives the connection**, so the host
 * runs with `disposeSession: false` and a close only detaches.
 *
 * Two producers write to the socket: the protocol host (responses and session
 * events) and the gateway wrapper (dialog requests, which every surface on the
 * session sees). Both go through one sink, so frames stay ordered.
 *
 * Dialog replies are intercepted: a request fanned out by the wrapper is not in
 * the host's own pending map, so `extension_ui_response` goes to the wrapper's
 * resolver first. Unknown ids fall through to the host (host-tool and login
 * requests it owns).
 *
 * Auth mirrors the terminal data plane: a loopback connection may attach when
 * its Origin is allowed, and remote clients need the one-time ticket the
 * authorized control plane issues. There is no anonymous remote path.
 */

import { Writable } from "node:stream";
import { runRpcMode } from "../../modes/rpc/rpc-mode";
import { getRpcSession, type AgentSessionWrapper } from "./agents";
import { hostIsLoopback, isAllowedOrigin } from "../web-gateway";

/** WebSocket `data` for this plane. Structurally the terminal plane's shape:
 *  one listener serves both and `kind` routes the socket. */
export interface RpcWsData {
	kind?: "terminal" | "rpc";
	sessionId: string;
}

/** `/api/rpc/ws?sessionId=…` */
export const RPC_WS_RE = /^\/api\/rpc\/ws$/;

/** Structural stand-in for `Bun.Server`, same shape the terminal plane uses. */
export interface RpcWsUpgradeServer {
	upgrade(req: Request, options: { data: RpcWsData }): boolean;
}

export function isRpcWsUpgradeRequest(req: Request): boolean {
	return req.headers.get("upgrade")?.toLowerCase() === "websocket";
}

/** Same shape the gateway's REST routes answer with. */
function refuse(error: string, status: number): Response {
	return new Response(JSON.stringify({ error }), {
		status,
		headers: { "content-type": "application/json" },
	});
}

/** One attached protocol client. */
interface HostedRpc {
	receive(text: string): void;
	close(): void;
}

const hosts = new WeakMap<object, HostedRpc>();

/**
 * Start the protocol host for one socket. Returns the receive/close bridge the
 * WebSocket handler drives.
 */
export function startHostedRpc(wrapper: AgentSessionWrapper, ws: WebSocket): HostedRpc {
	const sink = new Writable({
		write(chunk: Buffer | string, _encoding, done) {
			try {
				ws.send(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
				done();
			} catch (error) {
				done(error as Error);
			}
		},
	});

	// The protocol host reads whole lines; a tiny queue keeps the stream alive
	// without backpressure machinery (frames are already size-capped by the host).
	const encoder = new TextEncoder();
	let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
	let closed = false;
	const input = new ReadableStream<Uint8Array>({
		start(c) {
			controller = c;
		},
	});

	const unsubscribe = wrapper.subscribeProtocolUi(frame => {
		if (closed) return;
		sink.write(`${JSON.stringify(frame)}\n`);
	});

	const host = runRpcMode(wrapper.getSession(), {
		sink,
		input,
		loopController: wrapper.getLoopController(),
		goalController: wrapper.getGoalController(),
		liveBridge: wrapper.getLiveBridge(),
		// The backend owns the session: detaching a client must not end it.
		disposeSession: false,
		onClosed: () => {
			if (closed) return;
			closed = true;
			unsubscribe();
			try {
				ws.close(1000, "rpc host closed");
			} catch {
				// Socket already gone.
			}
		},
	}).catch(() => {
		// A host that fails after the socket closed has nowhere to report.
	});

	void host;

	const entry: HostedRpc = {
		receive(text: string) {
			if (closed || !controller) return;
			let parsed: unknown;
			try {
				parsed = JSON.parse(text);
			} catch {
				return;
			}
			if (isUiResponse(parsed) && wrapper.resolveUiRequest(parsed.id, toUiResponse(parsed))) {
				return;
			}
			controller.enqueue(encoder.encode(`${text}\n`));
		},
		close() {
			if (closed) return;
			closed = true;
			unsubscribe();
			controller?.close();
			controller = null;
		},
	};
	hosts.set(ws, entry);
	return entry;
}

interface UiResponseFrame {
	type: "extension_ui_response";
	id: string;
	value?: string;
	confirmed?: boolean;
	cancelled?: boolean;
	timedOut?: boolean;
	answers?: unknown;
	decision?: string;
}

function isUiResponse(value: unknown): value is UiResponseFrame {
	if (typeof value !== "object" || value === null) return false;
	if (!("type" in value) || value.type !== "extension_ui_response") return false;
	return "id" in value && typeof value.id === "string";
}

/** Mirror of the gateway command path's response shape. */
function toUiResponse(frame: {
	value?: string;
	confirmed?: boolean;
	cancelled?: boolean;
	timedOut?: boolean;
	answers?: unknown;
	decision?: string;
}): Parameters<AgentSessionWrapper["resolveUiRequest"]>[1] {
	if (frame.cancelled) return { cancelled: true, timedOut: frame.timedOut };
	if (frame.confirmed !== undefined) return { confirmed: frame.confirmed };
	if (frame.answers !== undefined) return { answers: frame.answers as never };
	if (frame.decision !== undefined) return { decision: frame.decision };
	return { value: frame.value ?? "" };
}

/** The WebSocket handler for the RPC plane. */
export const rpcWebSocketHandler = {
	open(ws: { data: RpcWsData; close: (code?: number, reason?: string) => void }) {
		const wrapper = getRpcSession(ws.data.sessionId);
		if (!wrapper) {
			ws.close(4004, "session not found");
			return;
		}
		startHostedRpc(wrapper, ws as unknown as WebSocket);
	},
	message(ws: object, message: string | Buffer | ArrayBuffer | Uint8Array) {
		const entry = hosts.get(ws);
		if (!entry) return;
		const text =
			typeof message === "string"
				? message
				: message instanceof ArrayBuffer
					? new TextDecoder().decode(message)
					: Buffer.from(message as Uint8Array).toString("utf8");
		entry.receive(text);
	},
	close(ws: object) {
		hosts.get(ws)?.close();
		hosts.delete(ws);
	},
};

/** Upgrade `/api/rpc/ws`; null means the request was not this plane. */
export async function handleRpcWsUpgrade(
	req: Request,
	srv: RpcWsUpgradeServer,
	remoteAddr?: string,
): Promise<Response | null> {
	const url = new URL(req.url);
	if (!RPC_WS_RE.test(url.pathname)) return null;
	if (!isRpcWsUpgradeRequest(req)) return refuse("expected websocket upgrade", 400);

	const loopback = hostIsLoopback(req, remoteAddr);
	if (!loopback) {
		return refuse("Forbidden: rpc WS requires a loopback connection", 403);
	}
	if (!isAllowedOrigin(req.headers.get("origin"))) {
		return refuse("Forbidden: cross-origin rpc WS", 403);
	}

	const sessionId = url.searchParams.get("sessionId") ?? "";
	if (!sessionId) return refuse("sessionId is required", 400);
	if (!getRpcSession(sessionId)) return refuse("session not found", 404);

	const upgraded = srv.upgrade(req, { data: { kind: "rpc", sessionId } });
	return upgraded ? null : refuse("websocket upgrade failed", 500);
}
