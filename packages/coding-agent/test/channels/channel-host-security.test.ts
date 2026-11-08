/**
 * ChannelHost inbound authorization + reply correlation.
 *
 * The host is the relay/coordinator bridge: one session can receive messages
 * from several IM chats, and the session also runs Studio/attach turns. These
 * tests pin that (a) the allowlist refuses an unauthorized peer before the
 * session is touched, (b) duplicate platform message ids never reach the
 * session twice, and (c) each turn's reply goes to the chat whose message the
 * turn actually answers — never to another chat, and never to a Studio turn.
 */

import { describe, expect, test } from "bun:test";
import {
	CHANNEL_PEER_REFUSED_TEXT,
	ChannelHost,
	type ChannelSession,
	type ChannelSessionEvent,
	type IrcMessage,
} from "@linxiraos/pi-channels";

interface StubCoordinator {
	session: ChannelSession;
	deliveries: IrcMessage[];
	/** Open the session's wake-turn observer for these record ids (a wake turn starts). */
	wake(recordIds: string[]): void;
	/** Emit the observed turn's final text. */
	reply(text: string): void;
	/** Emit a turn that answers no delivered record (Studio/attach prompt). */
	studioTurn(text: string): void;
	/** Invoke the registered IRC auto-reply hook for one delivered message. */
	autoReply(recordId: string, text: string): void;
}

function makeStubCoordinator(): StubCoordinator {
	const listeners = new Set<(event: ChannelSessionEvent) => void>();
	const deliveries: IrcMessage[] = [];
	let observer: ((records: readonly unknown[]) => ((error?: unknown) => void) | undefined) | null = null;
	let autoReply: ((msg: IrcMessage, text: string) => void) | null = null;
	let finishWave: (() => void) | undefined;

	const emitTurn = (text: string): void => {
		const event = {
			type: "turn_end",
			turnIndex: 1,
			message: { role: "assistant", content: [{ type: "text", text }] },
			toolResults: [],
		} as unknown as ChannelSessionEvent;
		for (const listener of listeners) listener(event);
	};

	const session: ChannelSession = {
		getAgentId: () => "coordinator",
		deliverIrcMessage: async (msg: IrcMessage) => {
			deliveries.push(msg);
			return "woken" as const;
		},
		subscribe: handler => {
			listeners.add(handler);
			return () => {
				listeners.delete(handler);
			};
		},
		setIrcAutoReplyListener: listener => {
			autoReply = listener;
		},
		setIrcWakeTurnObserver: next => {
			observer = next ?? null;
		},
	};

	return {
		session,
		deliveries,
		wake(recordIds) {
			finishWave = observer?.(
				recordIds.map(id => ({ role: "custom", customType: "irc:incoming", details: { id } })),
			);
		},
		reply(text) {
			emitTurn(text);
			finishWave?.();
			finishWave = undefined;
		},
		studioTurn(text) {
			emitTurn(text);
		},
		autoReply(recordId, text) {
			autoReply?.(
				deliveries.find(msg => msg.id === recordId) ?? { id: recordId, from: "", to: "", body: "", ts: 0 },
				text,
			);
		},
	};
}

function sentCollector(): {
	sent: Array<{ channel: string; to: string; text: string }>;
	send: (channel: string, to: string, text: string) => Promise<void>;
} {
	const sent: Array<{ channel: string; to: string; text: string }> = [];
	return {
		sent,
		send: async (channel, to, text) => {
			sent.push({ channel, to, text });
		},
	};
}

describe("ChannelHost inbound authorization", () => {
	test("an unauthorized peer is refused before the session sees the message", async () => {
		const stub = makeStubCoordinator();
		const { sent, send } = sentCollector();
		const host = new ChannelHost(stub.session, send, ["owner"]);
		host.start();

		const result = await host.deliver("telegram", "intruder", "@workspace open /etc");

		expect(result).toEqual({ ok: false, reason: "peer-not-allowed" });
		expect(stub.deliveries).toEqual([]);
		expect(sent).toEqual([{ channel: "telegram", to: "intruder", text: CHANNEL_PEER_REFUSED_TEXT }]);
		host.stop();
	});

	test("an allowed peer reaches the session", async () => {
		const stub = makeStubCoordinator();
		const { sent, send } = sentCollector();
		const host = new ChannelHost(stub.session, send, ["owner"]);
		host.start();

		const result = await host.deliver("telegram", "owner", "hello");

		expect(result).toEqual({ ok: true });
		expect(stub.deliveries).toHaveLength(1);
		expect(sent).toEqual([]);
		host.stop();
	});

	test("an empty allowlist keeps the historical open behavior", async () => {
		const stub = makeStubCoordinator();
		const { send } = sentCollector();
		const host = new ChannelHost(stub.session, send, []);
		host.start();

		expect(await host.deliver("telegram", "anyone", "hi")).toEqual({ ok: true });
		expect(stub.deliveries).toHaveLength(1);
		host.stop();
	});
});

describe("ChannelHost dedupe", () => {
	test("a retried platform message id is injected once", async () => {
		const stub = makeStubCoordinator();
		const { sent, send } = sentCollector();
		const host = new ChannelHost(stub.session, send);
		host.start();

		expect(await host.deliver("telegram", "1001", "hello", "42")).toEqual({ ok: true });
		expect(await host.deliver("telegram", "1001", "hello", "42")).toEqual({ ok: false, reason: "duplicate" });
		expect(stub.deliveries).toHaveLength(1);

		// One delivered message → one reply, never two.
		stub.wake([stub.deliveries[0]!.id]);
		stub.reply("answer");
		expect(sent).toEqual([{ channel: "telegram", to: "1001", text: "answer" }]);
		host.stop();
	});

	test("different message ids on the same chat are both delivered", async () => {
		const stub = makeStubCoordinator();
		const { send } = sentCollector();
		const host = new ChannelHost(stub.session, send);
		host.start();

		expect(await host.deliver("telegram", "1001", "one", "1")).toEqual({ ok: true });
		expect(await host.deliver("telegram", "1001", "two", "2")).toEqual({ ok: true });
		expect(stub.deliveries).toHaveLength(2);
		host.stop();
	});
});

describe("ChannelHost reply correlation", () => {
	test("two chats on one session each receive their own answer", async () => {
		const stub = makeStubCoordinator();
		const { sent, send } = sentCollector();
		const host = new ChannelHost(stub.session, send);
		host.start();

		await host.deliver("telegram", "peer-a", "question a");
		await host.deliver("telegram", "peer-b", "question b");
		const [first, second] = stub.deliveries;
		expect(stub.deliveries).toHaveLength(2);

		stub.wake([first!.id]);
		stub.reply("answer a");
		expect(sent).toEqual([{ channel: "telegram", to: "peer-a", text: "answer a" }]);

		stub.wake([second!.id]);
		stub.reply("answer b");
		expect(sent).toEqual([
			{ channel: "telegram", to: "peer-a", text: "answer a" },
			{ channel: "telegram", to: "peer-b", text: "answer b" },
		]);
		host.stop();
	});

	test("a Studio/attach turn consumes no IM reply slot", async () => {
		const stub = makeStubCoordinator();
		const { sent, send } = sentCollector();
		const host = new ChannelHost(stub.session, send);
		host.start();

		await host.deliver("telegram", "peer-a", "question");
		// A prompt typed into Studio on the same session ends a turn too.
		stub.studioTurn("studio answer");
		expect(sent).toEqual([]);

		// The IM wake turn still answers the waiting chat.
		stub.wake([stub.deliveries[0]!.id]);
		stub.reply("real answer");
		expect(sent).toEqual([{ channel: "telegram", to: "peer-a", text: "real answer" }]);
		host.stop();
	});

	test("the auto-reply hook answers the exact delivered message", async () => {
		const stub = makeStubCoordinator();
		const { sent, send } = sentCollector();
		const host = new ChannelHost(stub.session, send);
		host.start();

		await host.deliver("telegram", "peer-a", "question a");
		await host.deliver("telegram", "peer-b", "question b");
		const [first] = stub.deliveries;

		stub.autoReply(first!.id, "auto answer a");
		expect(sent).toEqual([{ channel: "telegram", to: "peer-a", text: "auto answer a" }]);
		host.stop();
	});
});
