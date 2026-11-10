import type { SocketLike } from "../../src/socket";

/** In-memory WebSocket used to drive the gateway/OneBot protocol in tests. */
export class FakeSocket implements SocketLike {
	readyState = 0;
	readonly sent: string[] = [];
	readonly #openHandlers: Array<() => void> = [];
	readonly #messageHandlers: Array<(data: string) => void> = [];
	readonly #closeHandlers: Array<(code: number, reason: string) => void> = [];
	readonly #errorHandlers: Array<(error: unknown) => void> = [];

	open(): void {
		this.readyState = 1;
		for (const handler of this.#openHandlers) handler();
	}

	receive(payload: unknown): void {
		const raw = typeof payload === "string" ? payload : JSON.stringify(payload);
		for (const handler of this.#messageHandlers) handler(raw);
	}

	/** Parsed JSON frames the adapter sent. */
	jsonSent(): Array<Record<string, unknown>> {
		return this.sent.flatMap(frame => {
			try {
				const parsed: unknown = JSON.parse(frame);
				return typeof parsed === "object" && parsed !== null ? [parsed as Record<string, unknown>] : [];
			} catch {
				return [];
			}
		});
	}

	send(data: string): void {
		this.sent.push(data);
	}

	close(code = 1000, reason = ""): void {
		if (this.readyState === 3) return;
		this.readyState = 3;
		for (const handler of this.#closeHandlers) handler(code, reason);
	}

	terminate(): void {
		this.close(1006, "terminated");
	}

	ping(): void {}

	onOpen(handler: () => void): void {
		this.#openHandlers.push(handler);
	}

	onMessage(handler: (data: string) => void): void {
		this.#messageHandlers.push(handler);
	}

	onClose(handler: (code: number, reason: string) => void): void {
		this.#closeHandlers.push(handler);
	}

	onError(handler: (error: unknown) => void): void {
		this.#errorHandlers.push(handler);
	}

	fail(error: unknown): void {
		for (const handler of this.#errorHandlers) handler(error);
	}
}

/** Let queued microtasks and one macrotask run. */
export function tick(ms = 0): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/** JSON response helper for injected fetch implementations. */
export function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}
