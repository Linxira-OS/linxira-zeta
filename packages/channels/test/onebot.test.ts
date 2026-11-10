import { afterEach, describe, expect, test, vi } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InboundMessage } from "../src/channel";
import { OneBotChannel, parseOneBotMessage, parseOneBotPeer, probeOneBotReversePort } from "../src/onebot";
import type { ReverseServerFactory, ReverseServerOptions } from "../src/socket";
import { FakeSocket, tick } from "./helpers/fake-socket";

function autoOpenFactory(sockets: FakeSocket[], headersSeen: Array<Record<string, string>> = []) {
	return (_url: string, headers: Record<string, string>) => {
		headersSeen.push(headers);
		const socket = new FakeSocket();
		sockets.push(socket);
		queueMicrotask(() => socket.open());
		return socket;
	};
}

function answerLogin(socket: FakeSocket, selfId = 10001): void {
	const call = socket.jsonSent().find(frame => frame.action === "get_login_info");
	if (!call) return;
	socket.receive({
		status: "ok",
		retcode: 0,
		data: { user_id: selfId, nickname: "zeta-bot" },
		echo: call.echo,
	});
}

describe("OneBot message parsing", () => {
	test("parses segment arrays, CQ strings and reply targets", () => {
		const segments = parseOneBotMessage([
			{ type: "at", data: { qq: "10001", name: "bot" } },
			{ type: "text", data: { text: " hello" } },
			{ type: "image", data: { file: "a.png", url: "https://img.test/a.png" } },
			{ type: "reply", data: { id: "77" } },
		]);
		expect(segments.mentionedIds).toEqual(["10001"]);
		expect(segments.text).toBe("@bot hello");
		expect(segments.replyTo).toBe("77");
		expect(segments.attachments[0]).toMatchObject({ kind: "image", url: "https://img.test/a.png" });

		const cq = parseOneBotMessage("[CQ:at,qq=10001] hi [CQ:image,file=x.png,url=https://img.test/x.png]");
		expect(cq.mentionedIds).toEqual(["10001"]);
		expect(cq.text).toBe("@10001 hi");
		expect(cq.attachments).toHaveLength(1);
	});

	test("maps peers to group:/user: and tolerates a bare id", () => {
		expect(parseOneBotPeer("group:123")).toEqual({ kind: "group", id: "123" });
		expect(parseOneBotPeer("user:456")).toEqual({ kind: "user", id: "456" });
		expect(parseOneBotPeer("789")).toEqual({ kind: "user", id: "789" });
	});
});

describe("OneBotChannel", () => {
	afterEach(() => vi.restoreAllMocks());

	test("forward mode sends the Bearer token and forwards a group @mention", async () => {
		const sockets: FakeSocket[] = [];
		const headers: Array<Record<string, string>> = [];
		const seen: InboundMessage[] = [];
		const channel = new OneBotChannel({
			endpoint: "ws://127.0.0.1:3001",
			token: "secret",
			selfId: "10001",
			onMessage: message => seen.push(message),
			createSocket: autoOpenFactory(sockets, headers),
			probeIntervalMs: 0,
			pingIntervalMs: 0,
		});
		await channel.start();
		expect(headers[0]).toEqual({ authorization: "Bearer secret" });
		answerLogin(sockets[0]!);

		sockets[0]!.receive({
			post_type: "message",
			message_type: "group",
			self_id: 10001,
			group_id: 42,
			user_id: 900,
			message_id: 7,
			sender: { nickname: "alice" },
			message: [
				{ type: "at", data: { qq: "10001" } },
				{ type: "text", data: { text: " ping" } },
			],
		});
		await tick(5);

		expect(seen).toHaveLength(1);
		expect(seen[0]).toMatchObject({
			peer: "group:42",
			chatType: "group",
			senderId: "900",
			senderName: "alice",
			body: "@10001 ping",
			messageId: "10001:7",
		});
		await channel.stop();
	});

	test("ignores group messages that do not mention this bot", async () => {
		const sockets: FakeSocket[] = [];
		const seen: InboundMessage[] = [];
		const channel = new OneBotChannel({
			endpoint: "ws://127.0.0.1:3001",
			selfId: "10001",
			onMessage: message => seen.push(message),
			createSocket: autoOpenFactory(sockets),
			probeIntervalMs: 0,
			pingIntervalMs: 0,
		});
		await channel.start();
		sockets[0]!.receive({
			post_type: "message",
			message_type: "group",
			self_id: 10001,
			group_id: 42,
			user_id: 900,
			message_id: 8,
			message: [{ type: "text", data: { text: "no mention" } }],
		});
		await tick(5);
		expect(seen).toHaveLength(0);
		await channel.stop();
	});

	test("sendText targets group:/user: peers with an optional reply segment", async () => {
		const sockets: FakeSocket[] = [];
		const channel = new OneBotChannel({
			endpoint: "ws://127.0.0.1:3001",
			selfId: "10001",
			onMessage: () => {},
			createSocket: autoOpenFactory(sockets),
			probeIntervalMs: 0,
			pingIntervalMs: 0,
			sleep: async () => {},
		});
		await channel.start();
		const socket = sockets[0]!;
		const answer = async (promise: Promise<void>): Promise<void> => {
			await tick(1);
			const call = [...socket.jsonSent()]
				.reverse()
				.find(frame => frame.action === "send_group_msg" || frame.action === "send_private_msg");
			if (call) socket.receive({ status: "ok", retcode: 0, data: { message_id: 1 }, echo: call.echo });
			await promise;
		};
		await answer(channel.sendText("group:42", "hello", { replyToMessageId: "7" }));
		await answer(channel.sendText("user:900", "dm"));

		const calls = sockets[0]!.jsonSent().filter(frame => typeof frame.action === "string");
		const group = calls.find(frame => frame.action === "send_group_msg");
		expect(group?.params).toMatchObject({ group_id: 42 });
		const groupParams = group?.params as { message: unknown[] } | undefined;
		expect(groupParams?.message).toEqual([
			{ type: "reply", data: { id: 7 } },
			{ type: "text", data: { text: "hello" } },
		]);
		const direct = calls.find(frame => frame.action === "send_private_msg");
		expect(direct?.params).toMatchObject({ user_id: 900 });
		await channel.stop();
	});

	test("downloads image attachments and reports the local path", async () => {
		const dir = await mkdtemp(join(tmpdir(), "zeta-onebot-"));
		const sockets: FakeSocket[] = [];
		const seen: InboundMessage[] = [];
		const fetchImpl = async (): Promise<Response> =>
			new Response(new Uint8Array([9, 8, 7]), {
				status: 200,
				headers: { "content-length": "3", "content-type": "image/jpeg" },
			});
		const channel = new OneBotChannel({
			endpoint: "ws://127.0.0.1:3001",
			selfId: "10001",
			onMessage: message => seen.push(message),
			createSocket: autoOpenFactory(sockets),
			probeIntervalMs: 0,
			pingIntervalMs: 0,
			attachmentDir: dir,
			customFetch: fetchImpl as unknown as typeof globalThis.fetch,
		});
		await channel.start();
		sockets[0]!.receive({
			post_type: "message",
			message_type: "private",
			self_id: 10001,
			user_id: 900,
			message_id: 9,
			message: [{ type: "image", data: { file: "x.jpg", url: "https://img.test/x.jpg" } }],
		});
		await tick(20);
		expect(seen).toHaveLength(1);
		const attachment = seen[0]!.attachments?.[0];
		expect(attachment?.size).toBe(3);
		expect(await readFile(attachment!.path!)).toEqual(Buffer.from([9, 8, 7]));
		await channel.stop();
		await rm(dir, { recursive: true, force: true });
	});

	test("reverse mode binds loopback with the token and adopts a bridge connection", async () => {
		const seen: InboundMessage[] = [];
		let captured: ReverseServerOptions | undefined;
		const factory: ReverseServerFactory = options => {
			captured = options;
			return { port: options.port, stop: () => {} };
		};
		const channel = new OneBotChannel({
			mode: "reverse",
			token: "reverse-secret",
			reversePort: 18082,
			onMessage: message => seen.push(message),
			createServer: factory,
			probeIntervalMs: 0,
			pingIntervalMs: 0,
		});
		await channel.start();
		expect(captured).toMatchObject({ hostname: "127.0.0.1", port: 18082, token: "reverse-secret" });

		const socket = new FakeSocket();
		socket.readyState = 1;
		captured!.onConnection({ socket, headers: { authorization: "Bearer reverse-secret" } });
		answerLogin(socket);
		socket.receive({
			post_type: "message",
			message_type: "private",
			self_id: 10001,
			user_id: 900,
			message_id: 10,
			message: "[CQ:at,qq=10001] hi from reverse",
		});
		await tick(5);
		expect(seen).toHaveLength(1);
		expect(seen[0]!.peer).toBe("user:900");
		await channel.stop();
	});

	test("reconnects forward mode with the same authorization header", async () => {
		const sockets: FakeSocket[] = [];
		const headers: Array<Record<string, string>> = [];
		const channel = new OneBotChannel({
			endpoint: "ws://127.0.0.1:3001",
			token: "secret",
			onMessage: () => {},
			createSocket: autoOpenFactory(sockets, headers),
			sleep: async () => {},
			random: () => 0.5,
			maxReconnectAttempts: 2,
			probeIntervalMs: 0,
			pingIntervalMs: 0,
		});
		await channel.start();
		sockets[0]!.close(1006, "network");
		for (let i = 0; i < 20 && sockets.length < 2; i++) await tick(1);
		expect(sockets.length).toBe(2);
		expect(headers[1]).toEqual({ authorization: "Bearer secret" });
		await channel.stop();
	});

	test("validates a reverse port without leaving a listener behind", () => {
		let stopped = false;
		const port = probeOneBotReversePort({
			port: 18083,
			token: "t",
			createServer: options => ({
				port: options.port,
				stop: () => {
					stopped = true;
				},
			}),
		});
		expect(port).toBe(18083);
		expect(stopped).toBe(true);
	});
});
