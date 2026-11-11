/**
 * HTTP + WebSocket client for one tunnelled Studio host.
 *
 * The tunnel makes the remote host look loopback, so the first bootstrap may
 * establish its implicit session: we keep the `studio_session` cookie and the
 * `x-studio-csrf` token in memory only. Nothing here talks to the local
 * service; a caller without a tunnel has no base URL and fails closed.
 */

import * as crypto from "node:crypto";
import * as net from "node:net";

export const STUDIO_CSRF_HEADER = "x-studio-csrf";

export class StudioHttpError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
		this.name = "StudioHttpError";
	}
}

function cookieFrom(response: Response): string | undefined {
	// Bootstrap sets exactly one session cookie; a combined header keeps this
	// independent of `getSetCookie`, which DOM/undici typings disagree on.
	const raw = response.headers.get("set-cookie") ?? "";
	const match = raw.match(/(?:^|;\s*)studio_session=([^;]+)/);
	return match ? `studio_session=${match[1]}` : undefined;
}

export function freeLoopbackPort(): Promise<number> {
	const { promise, resolve, reject } = Promise.withResolvers<number>();
	const server = net.createServer();
	server.once("error", reject);
	server.listen(0, "127.0.0.1", () => {
		const address = server.address();
		if (!address || typeof address === "string") {
			server.close();
			reject(new Error("Could not reserve a loopback port"));
			return;
		}
		server.close(error => (error ? reject(error) : resolve(address.port)));
	});
	return promise;
}

export class StudioHttp {
	readonly base: string;
	#cookie: string | undefined;
	#csrf: string | undefined;

	constructor(base: string) {
		this.base = base.replace(/\/$/, "");
	}

	async health(timeoutMs = 2_500): Promise<boolean> {
		try {
			const response = await fetch(`${this.base}/health`, { signal: AbortSignal.timeout(timeoutMs) });
			return response.ok;
		} catch {
			return false;
		}
	}

	/**
	 * Bootstrap, then use the host's final pairing contract when remote mode
	 * makes implicit loopback pairing unavailable. `GET /api/remote/pairing`
	 * returns a live 60s single-use `code` (never a token); the code is fetched
	 * immediately before each POST, and an expired-code 401 gets one fresh
	 * fetch+retry. SSH loopback is genuinely local, so no 2FA is involved.
	 */
	async ensureSession(): Promise<void> {
		try {
			await this.bootstrap();
			return;
		} catch (error) {
			if (!(error instanceof StudioHttpError) || error.status !== 401) throw error;
		}
		for (let attempt = 0; attempt < 2; attempt += 1) {
			const pairing = await this.gateway<{ code?: string }>("/api/remote/pairing");
			if (typeof pairing.code !== "string" || pairing.code.length === 0) {
				throw new Error("远端 Studio 要求配对，但 host 没有返回配对码；请检查 serve 的配对配置。");
			}
			try {
				await this.pair(pairing.code);
				await this.bootstrap();
				return;
			} catch (error) {
				// A single-use code can expire between GET and POST; refetch once.
				if (attempt === 0 && error instanceof StudioHttpError && error.status === 401) continue;
				throw error;
			}
		}
		throw new Error("远端 Studio 配对码重复失效；请检查 host 时间或重新连接。");
	}

	/** `POST /api/v1/pair` with the code the host already issued. */
	async pair(code: string): Promise<void> {
		const response = await fetch(`${this.base}/api/v1/pair`, {
			method: "POST",
			headers: { accept: "application/json", "content-type": "application/json" },
			body: JSON.stringify({ code, device: { label: "Zeta Desktop", platform: process.platform } }),
			signal: AbortSignal.timeout(15_000),
		});
		this.#remember(response);
		if (!response.ok) {
			const payload = (await response.json().catch(() => null)) as { error?: string } | null;
			throw new StudioHttpError(payload?.error || `Studio pairing failed (${response.status})`, response.status);
		}
		// Cookie is the primary credential; do not request or retain `device.token`.
		await response.json().catch(() => null);
	}

	async bootstrap<T = unknown>(): Promise<T> {
		const response = await fetch(`${this.base}/api/v1/bootstrap`, {
			headers: this.#headers(),
			signal: AbortSignal.timeout(15_000),
		});
		this.#remember(response);
		if (!response.ok) throw new StudioHttpError(`Studio bootstrap failed (${response.status})`, response.status);
		return (await response.json()) as T;
	}

	/** Read an arbitrary loopback gateway route through the tunnel. */
	async gateway<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
		const response = await fetch(`${this.base}${path}`, {
			...init,
			headers: { ...this.#headers(), ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) },
			signal: AbortSignal.timeout(20_000),
		});
		if (!response.ok) {
			const text = await response.text().catch(() => "");
			throw new StudioHttpError(text || `Gateway request failed (${response.status})`, response.status);
		}
		return (await response.json()) as T;
	}

	async query<T = unknown>(request: unknown): Promise<T> {
		return this.#studio<T>("/api/v1/query", request, false);
	}

	async command<T = unknown>(request: unknown): Promise<T> {
		return this.#studio<T>("/api/v1/command", request, true);
	}

	async #studio<T>(path: string, body: unknown, mutate: boolean): Promise<T> {
		const response = await fetch(`${this.base}${path}`, {
			method: "POST",
			headers: this.#headers(mutate),
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(30_000),
		});
		this.#remember(response);
		if (!response.ok) {
			const payload = (await response.json().catch(() => null)) as { error?: string } | null;
			throw new StudioHttpError(payload?.error || `Studio request failed (${response.status})`, response.status);
		}
		return (await response.json()) as T;
	}

	#headers(mutate = false): Record<string, string> {
		return {
			accept: "application/json",
			...(this.#cookie ? { cookie: this.#cookie } : {}),
			...(mutate && this.#csrf ? { [STUDIO_CSRF_HEADER]: this.#csrf } : {}),
		};
	}

	#remember(response: Response): void {
		this.#cookie = cookieFrom(response) ?? this.#cookie;
		this.#csrf = response.headers.get(STUDIO_CSRF_HEADER) ?? this.#csrf;
	}

	events(): StudioEventSocket {
		return new StudioEventSocket(`${this.base.replace(/^http/, "ws")}/api/v1/events`, this.#cookie);
	}
}

/**
 * Minimal RFC 6455 client. Node's global WebSocket cannot set the session
 * cookie header, and the Studio event socket requires it; this client owns the
 * handshake, text frames, ping/pong, and close without a dependency.
 */
export class StudioEventSocket {
	#socket: net.Socket | undefined;
	#buffer = Buffer.alloc(0);
	#closed = false;
	#handshakeDone = false;
	#ready = false;
	#rejectOpened: ((error: Error) => void) | undefined;
	#fragments: Buffer[] = [];
	#fragmentOpcode = 0;
	readonly #pending: string[] = [];
	readonly opened: Promise<void>;
	onMessage: (text: string) => void = () => {};
	onBinary: (data: Buffer) => void = () => {};
	onClose: (reason: string) => void = () => {};

	constructor(
		readonly url: string,
		readonly cookie: string | undefined,
	) {
		const { promise, resolve, reject } = Promise.withResolvers<void>();
		this.opened = promise;
		this.#rejectOpened = reject;
		const parsed = new URL(url);
		const socket = net.connect({ host: parsed.hostname.replace(/^\[|\]$/g, ""), port: Number(parsed.port || 80) });
		this.#socket = socket;
		const key = crypto.randomBytes(16).toString("base64");
		const expectedAccept = crypto
			.createHash("sha1")
			.update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
			.digest("base64");
		let handshake = "";
		socket.once("connect", () => {
			socket.write(
				`GET ${parsed.pathname}${parsed.search} HTTP/1.1\r\n` +
					`Host: ${parsed.host}\r\n` +
					"Upgrade: websocket\r\nConnection: Upgrade\r\n" +
					"Sec-WebSocket-Version: 13\r\n" +
					`Sec-WebSocket-Key: ${key}\r\n` +
					`${cookie ? `Cookie: ${cookie}\r\n` : ""}\r\n`,
			);
		});
		socket.on("data", chunk => {
			this.#buffer = Buffer.concat([this.#buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
			if (!this.#handshakeDone) {
				const end = this.#buffer.indexOf("\r\n\r\n");
				if (end < 0) return;
				handshake = this.#buffer.subarray(0, end).toString("latin1");
				this.#buffer = this.#buffer.subarray(end + 4);
				const accept = /^sec-websocket-accept:\s*(\S+)/im.exec(handshake)?.[1];
				if (!/^HTTP\/1\.1 101/.test(handshake) || accept !== expectedAccept) {
					const reason = !/^HTTP\/1\.1 101/.test(handshake)
						? handshake.split("\r\n")[0]
						: "Sec-WebSocket-Accept mismatch";
					reject(new Error(`Studio event socket rejected: ${reason}`));
					socket.destroy();
					return;
				}
				this.#handshakeDone = true;
				this.#ready = true;
				this.#rejectOpened = undefined;
				for (const text of this.#pending.splice(0)) this.#send(0x1, Buffer.from(text, "utf8"));
				resolve();
			}
			this.#readFrames();
		});
		socket.once("error", error => {
			if (!this.#closed) reject(error);
			this.#finish(error.message);
		});
		socket.once("close", () => this.#finish("socket closed"));
	}

	#finish(reason: string): void {
		if (this.#closed) return;
		this.#closed = true;
		if (!this.#handshakeDone) this.#rejectOpened?.(new Error(`Studio event socket closed before handshake: ${reason}`));
		this.#rejectOpened = undefined;
		this.onClose(reason);
	}

	#readFrames(): void {
		for (;;) {
			const buffer = this.#buffer;
			if (buffer.length < 2) return;
			const fin = (buffer[0] & 0x80) !== 0;
			const opcode = buffer[0] & 0x0f;
			const masked = (buffer[1] & 0x80) !== 0;
			let length = buffer[1] & 0x7f;
			let offset = 2;
			if (length === 126) {
				if (buffer.length < 4) return;
				length = buffer.readUInt16BE(2);
				offset = 4;
			} else if (length === 127) {
				if (buffer.length < 10) return;
				const big = buffer.readBigUInt64BE(2);
				if (big > 8n * 1024n * 1024n) {
					this.close("frame too large");
					return;
				}
				length = Number(big);
				offset = 10;
			}
			const maskOffset = masked ? 4 : 0;
			if (buffer.length < offset + maskOffset + length) return;
			const mask = masked ? buffer.subarray(offset, offset + 4) : undefined;
			const payload = Buffer.from(buffer.subarray(offset + maskOffset, offset + maskOffset + length));
			if (mask) for (let index = 0; index < payload.length; index++) payload[index]! ^= mask[index % 4]!;
			this.#buffer = buffer.subarray(offset + maskOffset + length);
			if (opcode === 0x0) {
				if (this.#fragmentOpcode === 0) continue;
				this.#fragments.push(payload);
				if (!fin) continue;
				const complete = Buffer.concat(this.#fragments);
				const kind = this.#fragmentOpcode;
				this.#fragments = [];
				this.#fragmentOpcode = 0;
				this.#emit(kind, complete);
			} else if (opcode === 0x1 || opcode === 0x2) {
				if (fin) this.#emit(opcode, payload);
				else {
					this.#fragmentOpcode = opcode;
					this.#fragments = [payload];
				}
			} else if (opcode === 0x8) {
				this.close("server closed");
				return;
			} else if (opcode === 0x9) this.#send(0xa, payload);
		}
	}

	#emit(opcode: number, payload: Buffer): void {
		if (opcode === 0x1) this.onMessage(payload.toString("utf8"));
		else if (opcode === 0x2) this.onBinary(payload);
	}

	#send(opcode: number, payload: Buffer): void {
		const socket = this.#socket;
		if (!socket || socket.destroyed) return;
		const mask = crypto.randomBytes(4);
		const header = payload.length < 126
			? Buffer.from([0x80 | opcode, 0x80 | payload.length])
			: Buffer.from([0x80 | opcode, 0x80 | 126, payload.length >> 8, payload.length & 0xff]);
		for (let index = 0; index < payload.length; index++) payload[index]! ^= mask[index % 4]!;
		socket.write(Buffer.concat([header, mask, payload]));
	}

	sendText(text: string): void {
		if (!this.#ready) {
			if (this.#pending.join("").length < 64 * 1024) this.#pending.push(text);
			return;
		}
		this.#send(0x1, Buffer.from(text, "utf8"));
	}

	close(reason = "client closed"): void {
		if (this.#closed) return;
		this.#send(0x8, Buffer.from(reason.slice(0, 120)));
		this.#socket?.destroy();
		this.#finish(reason);
	}
}
