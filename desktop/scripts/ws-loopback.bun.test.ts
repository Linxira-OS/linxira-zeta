import { expect, test } from "bun:test";
import { StudioEventSocket } from "../src/remote/http.ts";

/** Real Bun WebSocket server: no handcrafted handshake/frame echo. */
test("StudioEventSocket opens against a real Bun WS server, reads text+binary, and closes", async () => {
	const server = Bun.serve({
		port: 0,
		fetch(req, srv) {
			if (srv.upgrade(req)) return undefined;
			return new Response("upgrade required", { status: 400 });
		},
		websocket: {
			open(ws) {
				ws.send("first");
				ws.send(new Uint8Array([1, 2, 3]));
				ws.send("x".repeat(140_000));
			},
			message() {},
		},
	});
	const socket = new StudioEventSocket(`ws://127.0.0.1:${server.port}/api/v1/events`, undefined);
	const text: string[] = [];
	const binary: number[] = [];
	const complete = Promise.withResolvers<void>();
	const check = (): void => {
		if (text.length === 2 && binary.length === 3) complete.resolve();
	};
	socket.onMessage = value => {
		text.push(value);
		check();
	};
	socket.onBinary = value => {
		binary.push(...value);
		check();
	};
	await socket.opened;
	await complete.promise;
	expect(text[0]).toBe("first");
	expect(text[1]?.length).toBe(140_000);
	expect(binary).toEqual([1, 2, 3]);
	socket.close("test done");
	server.stop(true);
});

test("a rejected upgrade rejects opened instead of hanging", async () => {
	const server = Bun.serve({
		port: 0,
		fetch() {
			return new Response("no", { status: 401 });
		},
	});
	const socket = new StudioEventSocket(`ws://127.0.0.1:${server.port}/api/v1/events`, "studio_session=x");
	await expect(socket.opened).rejects.toThrow(/401|rejected/i);
	server.stop(true);
});
