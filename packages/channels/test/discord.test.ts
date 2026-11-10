import { afterEach, describe, expect, test, vi } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InboundMessage } from "../src/channel";
import { DiscordChannel } from "../src/discord";
import { FakeSocket, jsonResponse, tick } from "./helpers/fake-socket";

const intents = (1 << 0) | (1 << 9) | (1 << 12) | (1 << 15);

function socketFactory(sockets: FakeSocket[]) {
	return () => {
		const socket = new FakeSocket();
		sockets.push(socket);
		queueMicrotask(() => socket.open());
		return socket;
	};
}

function ready(socket: FakeSocket, botId = "bot-1"): void {
	socket.receive({ op: 10, d: { heartbeat_interval: 45_000 } });
	socket.receive({
		op: 0,
		t: "READY",
		s: 1,
		d: { session_id: "session-1", user: { id: botId }, resume_gateway_url: "wss://resume.example" },
	});
}

describe("DiscordChannel", () => {
	afterEach(() => vi.restoreAllMocks());

	test("IDENTIFYs with the message-content intent and forwards a mentioned guild message", async () => {
		const sockets: FakeSocket[] = [];
		const seen: InboundMessage[] = [];
		const channel = new DiscordChannel({
			botToken: "token",
			gatewayUrl: "wss://gateway.test",
			onMessage: message => seen.push(message),
			createSocket: socketFactory(sockets),
			heartbeat: false,
		});
		await channel.start();
		const socket = sockets[0]!;
		ready(socket);

		const identify = socket.jsonSent().find(frame => frame.op === 2);
		expect(identify?.d).toMatchObject({ token: "token", intents });

		socket.receive({
			op: 0,
			t: "MESSAGE_CREATE",
			s: 2,
			d: {
				id: "m1",
				channel_id: "c1",
				guild_id: "g1",
				content: "<@bot-1> hello there",
				author: { id: "u1", username: "alice" },
				mentions: [{ id: "bot-1" }],
			},
		});
		await tick();

		expect(seen).toHaveLength(1);
		expect(seen[0]).toMatchObject({
			peer: "c1",
			chatType: "channel",
			senderId: "u1",
			senderName: "alice",
			body: "hello there",
			messageId: "m1",
		});
		expect(seen[0]!.allowKeys).toEqual(["c1", "guild:g1"]);
		expect(channel.getHealth().state).toBe("ready");
		await channel.stop();
	});

	test("ignores guild messages without a mention or reply, and messages from bots", async () => {
		const sockets: FakeSocket[] = [];
		const seen: InboundMessage[] = [];
		const channel = new DiscordChannel({
			botToken: "token",
			onMessage: message => seen.push(message),
			createSocket: socketFactory(sockets),
			heartbeat: false,
		});
		await channel.start();
		ready(sockets[0]!);

		const base = { channel_id: "c1", guild_id: "g1", content: "nothing to see" };
		sockets[0]!.receive({
			op: 0,
			t: "MESSAGE_CREATE",
			d: { ...base, id: "m1", author: { id: "u1" } },
		});
		sockets[0]!.receive({
			op: 0,
			t: "MESSAGE_CREATE",
			d: { ...base, id: "m2", author: { id: "b1", bot: true } },
		});
		await tick();
		expect(seen).toHaveLength(0);

		sockets[0]!.receive({
			op: 0,
			t: "MESSAGE_CREATE",
			d: {
				...base,
				id: "m3",
				content: "a reply",
				author: { id: "u1" },
				referenced_message: { author: { id: "bot-1" } },
			},
		});
		await tick();
		expect(seen.map(message => message.messageId)).toEqual(["m3"]);
		await channel.stop();
	});

	test("accepts DMs without a mention and downloads attachments with a size cap", async () => {
		const dir = await mkdtemp(join(tmpdir(), "zeta-discord-"));
		const sockets: FakeSocket[] = [];
		const seen: InboundMessage[] = [];
		const fetchImpl = async (): Promise<Response> =>
			new Response(new Uint8Array([1, 2, 3]), {
				status: 200,
				headers: { "content-length": "3", "content-type": "image/png" },
			});
		const channel = new DiscordChannel({
			botToken: "token",
			onMessage: message => seen.push(message),
			createSocket: socketFactory(sockets),
			heartbeat: false,
			attachmentDir: dir,
			maxAttachmentBytes: 100,
			customFetch: fetchImpl as unknown as typeof globalThis.fetch,
		});
		await channel.start();
		ready(sockets[0]!);

		sockets[0]!.receive({
			op: 0,
			t: "MESSAGE_CREATE",
			d: {
				id: "dm1",
				channel_id: "dm-channel",
				content: "",
				author: { id: "u2", username: "bob" },
				attachments: [{ filename: "pic.png", content_type: "image/png", url: "https://cdn.test/pic.png" }],
			},
		});
		await tick(20);

		expect(seen).toHaveLength(1);
		expect(seen[0]!.chatType).toBe("dm");
		expect(seen[0]!.body).toBe("");
		const attachment = seen[0]!.attachments?.[0];
		expect(attachment?.kind).toBe("image");
		expect(attachment?.size).toBe(3);
		expect(await readFile(attachment!.path!)).toEqual(Buffer.from([1, 2, 3]));
		await channel.stop();
		await rm(dir, { recursive: true, force: true });
	});

	test("sendText splits at 2000 chars and references the replied-to message", async () => {
		const sockets: FakeSocket[] = [];
		const calls: Array<{ url: string; body: unknown }> = [];
		const fetchImpl = async (input: unknown, init?: unknown): Promise<Response> => {
			const request = init as RequestInit | undefined;
			calls.push({
				url: String(input),
				body: typeof request?.body === "string" ? JSON.parse(request.body) : undefined,
			});
			return jsonResponse({ id: "sent" });
		};
		const channel = new DiscordChannel({
			botToken: "token",
			apiBase: "https://api.test/v10",
			onMessage: () => {},
			createSocket: socketFactory(sockets),
			heartbeat: false,
			customFetch: fetchImpl as unknown as typeof globalThis.fetch,
		});
		await channel.start();
		await channel.sendText("c1", "x".repeat(2_100), { replyToMessageId: "orig" });
		await channel.stop();

		expect(calls).toHaveLength(2);
		expect(calls[0]!.url).toBe("https://api.test/v10/channels/c1/messages");
		expect(calls[0]!.body).toMatchObject({ message_reference: { message_id: "orig" } });
		expect((calls[0]!.body as { content: string }).content).toHaveLength(2_000);
		expect(calls[1]!.body).not.toHaveProperty("message_reference");
	});

	test("reconnects with backoff after a non-fatal close", async () => {
		const sockets: FakeSocket[] = [];
		const channel = new DiscordChannel({
			botToken: "token",
			onMessage: () => {},
			createSocket: socketFactory(sockets),
			heartbeat: false,
			sleep: async () => {},
			random: () => 0.5,
			maxReconnectAttempts: 2,
		});
		await channel.start();
		ready(sockets[0]!);
		sockets[0]!.close(4000, "test");

		for (let i = 0; i < 20 && sockets.length < 2; i++) await tick(1);
		expect(sockets.length).toBe(2);
		await channel.stop();
	});

	test("stops reconnecting on a fatal auth close", async () => {
		const sockets: FakeSocket[] = [];
		const channel = new DiscordChannel({
			botToken: "bad",
			onMessage: () => {},
			createSocket: socketFactory(sockets),
			heartbeat: false,
			sleep: async () => {},
			maxReconnectAttempts: 2,
		});
		await channel.start();
		sockets[0]!.close(4004, "bad token");
		await tick(5);
		expect(sockets).toHaveLength(1);
		expect(channel.getHealth()).toMatchObject({ state: "auth-failed" });
		await channel.stop();
	});
});
