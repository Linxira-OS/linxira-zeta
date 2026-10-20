/**
 * Loopback-only mesh transport.
 *
 * POSIX: a Unix socket at `<run>/mesh-<workspaceId>.sock`, chmod 0600.
 * Windows: a named pipe `\\.\pipe\zeta-mesh-<scope>-<workspaceId>` (named
 * pipes have no filesystem mode; the handshake token is the access control).
 *
 * Every connection starts with a `hello` frame carrying the per-workspace
 * token from `run/mesh/<workspaceId>.token` (written 0600). Frames after the
 * handshake are newline-delimited envelopes; each envelope gets one `ack`
 * whose `replyTo` is its id. Anything oversized, malformed, wrong-version, or
 * unauthenticated closes the connection.
 */

import { randomUUID, timingSafeEqual } from "node:crypto";
import * as fs from "node:fs/promises";
import * as net from "node:net";
import * as path from "node:path";
import { Snowflake } from "@linxiraos/pi-utils";
import { serializedSize, validateEnvelope } from "./envelope";
import { MESH_MAX_ENVELOPE_BYTES, MESH_PROTOCOL_VERSION, type MeshEnvelope, type MeshSendOutcome } from "./types";

/** Slack for the JSON envelope wrapper around the 1 MiB body budget. */
const FRAME_OVERHEAD = 64 * 1024;
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 5_000;
const DEFAULT_IDLE_TIMEOUT_MS = 30_000;

export interface MeshAckPayload {
	ok: boolean;
	outcome?: MeshSendOutcome;
	error?: string;
}

interface HelloFrame {
	t: "hello";
	v: number;
	token: string;
	from: string;
}

interface AckFrame {
	t: "ack";
	envelope: string;
}

type ClientFrame = HelloFrame | AckFrame;

export interface MeshTransportServer {
	endpoint: string;
	close(): Promise<void>;
}

export interface MeshTransportOptions {
	endpoint: string;
	/** Address this process answers as (the ack's `from`). */
	selfAddress: string;
	/** Shared secret required in the hello frame. */
	token: string;
	onEnvelope(envelope: MeshEnvelope): Promise<MeshAckPayload>;
	handshakeTimeoutMs?: number;
	idleTimeoutMs?: number;
}

/** Best-effort unlink of a POSIX socket left behind by a crashed process. */
async function removeStaleSocket(endpoint: string): Promise<void> {
	if (process.platform === "win32") return;
	await fs.rm(endpoint, { force: true }).catch(() => {});
}

/** Constant-time token comparison that never throws on length mismatch. */
function tokensMatch(expected: string, actual: unknown): boolean {
	if (typeof actual !== "string") return false;
	const a = Buffer.from(expected, "utf8");
	const b = Buffer.from(actual, "utf8");
	return a.length === b.length && timingSafeEqual(a, b);
}

/** Start the per-workspace listener. Rejects when another live process owns it. */
export async function listenMeshEndpoint(options: MeshTransportOptions): Promise<MeshTransportServer> {
	await removeStaleSocket(options.endpoint);
	const maxFrameBytes = MESH_MAX_ENVELOPE_BYTES + FRAME_OVERHEAD;
	const handshakeTimeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
	const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;

	const server = net.createServer(socket => {
		socket.setNoDelay(true);
		let buffer = "";
		let authenticated = false;
		let closed = false;

		const destroy = (reason?: string): void => {
			if (closed) return;
			closed = true;
			clearTimeout(handshakeTimer);
			clearTimeout(idleTimer);
			if (reason) socket.destroy();
			else socket.end();
		};
		const send = (frame: unknown): void => {
			if (closed || socket.destroyed) return;
			socket.write(`${JSON.stringify(frame)}\n`);
		};
		const handshakeTimer = setTimeout(() => destroy("handshake timeout"), handshakeTimeoutMs);
		let idleTimer = setTimeout(() => destroy("idle timeout"), idleTimeoutMs);
		const refreshIdle = (): void => {
			clearTimeout(idleTimer);
			idleTimer = setTimeout(() => destroy("idle timeout"), idleTimeoutMs);
		};

		const handleFrame = async (line: string): Promise<void> => {
			let parsed: unknown;
			try {
				parsed = JSON.parse(line);
			} catch {
				destroy("malformed frame");
				return;
			}
			if (!authenticated) {
				const frame = parsed as Partial<HelloFrame>;
				if (frame?.t !== "hello" || frame.v !== MESH_PROTOCOL_VERSION || !tokensMatch(options.token, frame.token)) {
					send({ t: "error", v: MESH_PROTOCOL_VERSION, error: "unauthorized" });
					destroy("unauthorized");
					return;
				}
				authenticated = true;
				clearTimeout(handshakeTimer);
				send({ t: "hello-ack", v: MESH_PROTOCOL_VERSION });
				return;
			}
			let envelope: MeshEnvelope;
			try {
				envelope = validateEnvelope(parsed);
			} catch (error) {
				destroy(error instanceof Error ? error.message : String(error));
				return;
			}
			let payload: MeshAckPayload;
			try {
				payload = await options.onEnvelope(envelope);
			} catch (error) {
				payload = { ok: false, error: error instanceof Error ? error.message : String(error) };
			}
			const ack: MeshEnvelope = {
				v: MESH_PROTOCOL_VERSION,
				id: Snowflake.next(),
				from: options.selfAddress,
				to: envelope.from,
				kind: "ack",
				body: JSON.stringify(payload),
				sentAt: Date.now(),
				replyTo: envelope.id,
			};
			send({ t: "ack", envelope: JSON.stringify(ack) });
		};

		socket.on("data", chunk => {
			if (closed) return;
			refreshIdle();
			buffer += chunk.toString("utf8");
			if (buffer.length > maxFrameBytes && !buffer.includes("\n")) {
				destroy("frame too large");
				return;
			}
			let newline = buffer.indexOf("\n");
			while (newline !== -1) {
				const line = buffer.slice(0, newline);
				buffer = buffer.slice(newline + 1);
				if (line.length > maxFrameBytes) {
					destroy("frame too large");
					return;
				}
				if (line.trim().length > 0) void handleFrame(line);
				newline = buffer.indexOf("\n");
			}
		});
		socket.on("error", () => {
			closed = true;
			clearTimeout(handshakeTimer);
			clearTimeout(idleTimer);
			socket.destroy();
		});
		socket.on("close", () => {
			closed = true;
			clearTimeout(handshakeTimer);
			clearTimeout(idleTimer);
		});
	});

	await new Promise<void>((resolve, reject) => {
		const onError = (error: Error): void => {
			server.off("listening", onListening);
			reject(error);
		};
		const onListening = (): void => {
			server.off("error", onError);
			resolve();
		};
		server.once("error", onError);
		server.once("listening", onListening);
		server.listen(options.endpoint);
	});

	if (process.platform !== "win32") {
		await fs.chmod(options.endpoint, 0o600).catch(() => {});
	}

	return {
		endpoint: options.endpoint,
		close: () =>
			new Promise<void>(resolve => {
				server.close(() => resolve());
			}),
	};
}

export interface SendMeshEnvelopeOptions {
	endpoint: string;
	token: string;
	envelope: MeshEnvelope;
	timeoutMs: number;
}

export interface SendMeshEnvelopeResult {
	/** Whether the peer completed the handshake and read the envelope. */
	delivered: boolean;
	payload?: MeshAckPayload;
	error?: string;
}

/**
 * Connect, authenticate, send ONE envelope, and wait for its ack. One
 * connection per envelope keeps crash/timeout handling trivial; the ack is
 * the only synchronous delivery signal the mesh exposes.
 */
export async function sendMeshEnvelope(options: SendMeshEnvelopeOptions): Promise<SendMeshEnvelopeResult> {
	const { endpoint, token, envelope, timeoutMs } = options;
	return await new Promise<SendMeshEnvelopeResult>(resolve => {
		let settled = false;
		let buffer = "";
		let authenticated = false;
		const socket = net.createConnection(endpoint);
		const finish = (result: SendMeshEnvelopeResult): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			socket.destroy();
			resolve(result);
		};
		const timer = setTimeout(() => finish({ delivered: authenticated, error: "ack timeout" }), timeoutMs);

		const writeFrame = (frame: unknown): void => {
			socket.write(`${JSON.stringify(frame)}\n`);
		};

		socket.on("connect", () => {
			writeFrame({ t: "hello", v: MESH_PROTOCOL_VERSION, token, from: envelope.from });
		});
		socket.on("data", chunk => {
			buffer += chunk.toString("utf8");
			if (buffer.length > MESH_MAX_ENVELOPE_BYTES + FRAME_OVERHEAD) {
				finish({ delivered: authenticated, error: "frame too large" });
				return;
			}
			let newline = buffer.indexOf("\n");
			while (newline !== -1) {
				const line = buffer.slice(0, newline);
				buffer = buffer.slice(newline + 1);
				newline = buffer.indexOf("\n");
				if (line.trim().length === 0) continue;
				let frame: { t?: string; v?: number; error?: string; envelope?: string };
				try {
					frame = JSON.parse(line) as typeof frame;
				} catch {
					finish({ delivered: authenticated, error: "malformed reply" });
					return;
				}
				if (frame.t === "hello-ack") {
					authenticated = true;
					writeFrame(envelope);
					continue;
				}
				if (frame.t === "error") {
					finish({ delivered: false, error: frame.error ?? "peer rejected the handshake" });
					return;
				}
				if (frame.t === "ack" && typeof frame.envelope === "string") {
					let ack: MeshEnvelope;
					try {
						ack = validateEnvelope(JSON.parse(frame.envelope));
					} catch (error) {
						finish({ delivered: true, error: error instanceof Error ? error.message : String(error) });
						return;
					}
					if (ack.replyTo !== envelope.id) continue;
					let payload: MeshAckPayload;
					try {
						payload = JSON.parse(ack.body) as MeshAckPayload;
					} catch {
						finish({ delivered: true, error: "malformed ack body" });
						return;
					}
					finish({ delivered: true, payload });
					return;
				}
			}
		});
		socket.on("error", error => {
			finish({ delivered: false, error: (error as NodeJS.ErrnoException).code ?? error.message });
		});
		socket.on("close", () => {
			finish({ delivered: authenticated, error: authenticated ? "peer closed before ack" : "connection closed" });
		});
	});
}

/** Generate and persist the endpoint token (0600) at start. */
export async function writeMeshToken(file: string): Promise<string> {
	const token = randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");
	await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
	await fs.writeFile(file, `${token}\n`, { mode: 0o600 });
	await fs.chmod(file, 0o600).catch(() => {});
	return token;
}

/** Read a peer's endpoint token; undefined when the file is missing. */
export async function readMeshToken(file: string): Promise<string | undefined> {
	try {
		const value = (await fs.readFile(file, "utf8")).trim();
		return value.length > 0 ? value : undefined;
	} catch {
		return undefined;
	}
}

/** Frame size of one envelope; exported for the security test's limit check. */
export function envelopeFrameBytes(envelope: MeshEnvelope): number {
	return serializedSize(envelope);
}
