/**
 * Browser transport recovery without a live server.
 *
 * A revoked session must return the page to pairing, and a dropped event
 * socket must reopen so later command receipts are not lost forever.
 */
import { describe, expect, test } from "vitest";
import { BrowserWebClientTransport } from "../browser-transport";
import { StudioWebClient } from "../client";

function json(payload: unknown, status = 200, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});
}

class FakeSocket {
	sent: string[] = [];
	closed = false;
	onopen?: () => void;
	onmessage?: (event: { data: string }) => void;
	onclose?: () => void;

	constructor() {
		queueMicrotask(() => {
			if (!this.closed) this.onopen?.();
		});
	}

	send(data: string): void {
		this.sent.push(data);
	}

	close(): void {
		this.drop();
	}

	drop(): void {
		if (this.closed) return;
		this.closed = true;
		this.onclose?.();
	}
}

const BASE = "http://127.0.0.1:43143";

describe("StudioWebClient session loss", () => {
	test("a 401 reports auth loss once and pairing uses a fresh transport", async () => {
		let bootstrapCalls = 0;
		let failNextQuery = false;
		const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
			const url = String(input);
			if (url.endsWith("/api/v1/bootstrap")) {
				bootstrapCalls += 1;
				return json({ contractVersion: 2 }, 200, { "x-studio-csrf": `csrf-${bootstrapCalls}` });
			}
			if (url.endsWith("/api/v1/query")) {
				if (failNextQuery) {
					failNextQuery = false;
					return json({ error: "unauthenticated" }, 401);
				}
				return json({ ok: true, result: { rooms: [] } });
			}
			throw new Error(`unexpected request ${url}`);
		};
		const sockets: FakeSocket[] = [];
		const client = new StudioWebClient({
			baseUrl: BASE,
			fetcher,
			webSocketFactory: () => {
				const socket = new FakeSocket();
				sockets.push(socket);
				return socket;
			},
		});
		await client.bootstrap();
		expect(bootstrapCalls).toBe(1);

		let lost = 0;
		let resetting: Promise<void> | undefined;
		const off = client.onAuthLost(() => {
			lost += 1;
			resetting = client.reset();
		});
		failNextQuery = true;
		await expect(client.query("rooms.list", {})).rejects.toMatchObject({ code: "unauthenticated" });
		expect(lost).toBe(1);
		await resetting;

		await client.bootstrap();
		expect(bootstrapCalls).toBe(2);
		await expect(client.query("rooms.list", {})).resolves.toEqual({ rooms: [] });
		expect(sockets.length).toBe(2);
		off();
		await client.close();
	});

	test("a step-up 403 is not treated as a lost session", async () => {
		const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
			const url = String(input);
			if (url.endsWith("/api/v1/bootstrap")) return json({ contractVersion: 2 }, 200, { "x-studio-csrf": "csrf" });
			if (url.endsWith("/api/v1/query")) return json({ error: "totp_required" }, 403);
			throw new Error(`unexpected request ${url}`);
		};
		const client = new StudioWebClient({ baseUrl: BASE, fetcher, webSocketFactory: () => new FakeSocket() });
		await client.bootstrap();
		let lost = 0;
		const off = client.onAuthLost(() => {
			lost += 1;
		});
		await expect(client.query("rooms.list", {})).rejects.toMatchObject({ code: "totp_required" });
		expect(lost).toBe(0);
		off();
		await client.close();
	});
});

describe("BrowserWebClientTransport event socket", () => {
	test("reopens after the host drops the socket", async () => {
		const fetcher = async (): Promise<Response> => json({ contractVersion: 2 }, 200, { "x-studio-csrf": "csrf" });
		const sockets: FakeSocket[] = [];
		const second = Promise.withResolvers<void>();
		const transport = new BrowserWebClientTransport({
			baseUrl: BASE,
			fetcher,
			// Deterministic reconnect: the retry still goes through the timer
			// path, but the test awaits the second socket instead of wall time.
			reconnectBaseMs: 0,
			webSocketFactory: () => {
				const socket = new FakeSocket();
				sockets.push(socket);
				if (sockets.length === 2) second.resolve();
				return socket;
			},
		});
		const unsubscribe = transport.subscribe({ scope: "all" }, () => {});
		await transport.bootstrap();
		expect(sockets.length).toBe(1);
		expect(sockets[0]?.sent).toEqual([JSON.stringify({ scope: { scope: "all" } })]);

		sockets[0]!.drop();
		await second.promise;
		expect(sockets.length).toBeGreaterThanOrEqual(2);
		expect(sockets.at(-1)?.sent).toEqual([JSON.stringify({ scope: { scope: "all" } })]);

		unsubscribe();
		await transport.close();
	});
});
