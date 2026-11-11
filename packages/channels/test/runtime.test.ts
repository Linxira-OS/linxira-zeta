import { describe, expect, test } from "bun:test";
import { CHANNEL_PEER_REFUSED_TEXT } from "../src/auth";
import type {
	ChannelCapabilities,
	ChannelHealth,
	ChannelInstanceId,
	ChannelPlatform,
	ChannelSendOptions,
	ChatChannel,
	ChatImage,
	InboundMessage,
} from "../src/channel";
import { startChannels, type ChannelInboundHandler } from "../src/index";
import type { ChannelInstanceConfig, ChannelSession, ChannelsWebConfig, IrcMessage } from "../src/types";

class FakeChannel implements ChatChannel {
	readonly sent: Array<{ to: string; text: string; options?: ChannelSendOptions }> = [];
	started = false;
	readonly capabilities: ChannelCapabilities = {
		maxTextLength: 2_000,
		supportsImages: false,
		supportsFiles: false,
		supportsTyping: false,
	};
	constructor(
		readonly id: ChannelInstanceId,
		readonly platform: ChannelPlatform,
		private readonly emit: (message: InboundMessage) => void,
	) {}
	async start(): Promise<void> {
		this.started = true;
	}
	async stop(): Promise<void> {
		this.started = false;
	}
	async sendText(to: string, text: string, options?: ChannelSendOptions): Promise<void> {
		this.sent.push({ to, text, ...(options ? { options } : {}) });
	}
	async sendImage(_to: string, _image: ChatImage): Promise<void> {}
	publish(message: InboundMessage): void {
		this.emit(message);
	}
	getHealth(): ChannelHealth {
		return { state: "ready", since: 1 };
	}
}

function session(): ChannelSession {
	return {
		getAgentId: () => "agent-1",
		deliverIrcMessage: async (_message: IrcMessage) => {},
		subscribe: () => () => {},
		setIrcAutoReplyListener: () => {},
	};
}

function instance(platform: ChannelPlatform, overrides: Record<string, unknown> = {}): ChannelInstanceConfig {
	const { enabled = false, allowedChannels, allowedGroups, allowedUsers, ...rest } = overrides;
	const peers = Array.isArray(allowedChannels)
		? allowedChannels
		: Array.isArray(allowedGroups)
			? allowedGroups.map(group => `group:${String(group)}`)
			: [];
	return {
		id: platform,
		platform,
		label: platform,
		enabled: Boolean(enabled),
		agentProfile: `legacy-${platform}`,
		allow: { peers: peers as string[], ...(Array.isArray(allowedUsers) ? { users: allowedUsers as string[] } : {}) },
		credentials: rest as Record<string, unknown>,
	};
}

function config(
	overrides: { discord?: Record<string, unknown>; qq?: Record<string, unknown> } = {},
): ChannelsWebConfig {
	const data = {
		channels: {
			instances: [
				instance("discord", {
					enabled: false,
					botToken: "token",
					allowedChannels: ["c1"],
					allowedUsers: [],
					...overrides.discord,
				}),
				instance("qq", {
					enabled: false,
					mode: "forward" as const,
					endpoint: "ws://127.0.0.1:3001",
					token: "t",
					allowedGroups: ["42"],
					allowedUsers: ["900"],
					...overrides.qq,
				}),
			],
		},
	};
	return {
		getData: () => structuredClone(data),
		set: async () => {},
	};
}

/** Build adapters with the runtime's handler so tests can drive inbound. */
function createAdapters(created: Map<ChannelInstanceId, FakeChannel>) {
	return (instance: ChannelInstanceConfig, onMessage: (message: InboundMessage) => void): ChatChannel | undefined => {
		if (instance.platform === "discord" || instance.platform === "qq") {
			const channel = new FakeChannel(instance.id, instance.platform, onMessage);
			created.set(instance.id, channel);
			return channel;
		}
		return undefined;
	};
}

describe("channel runtime — new platforms", () => {
	test("refuses to start Discord without an allowlist and reports why", async () => {
		const runtime = await startChannels(
			session(),
			config({ discord: { enabled: true, allowedChannels: [] } }),
			() => {},
		);
		expect(runtime.channels.has("discord")).toBe(false);
		expect(runtime.status()).toContainEqual(
			expect.objectContaining({
				id: "discord",
				running: false,
				state: "auth-failed",
				detail: expect.stringContaining("allow.peers"),
			}),
		);
		await runtime.stop();
	});

	test("routes an allowed Discord message, folds attachments into the body, and drops duplicates", async () => {
		const received: Array<{ channelId: ChannelInstanceId; peer: string; body: string; messageId?: string }> = [];
		const onInbound: ChannelInboundHandler = (channelId, peer, body, messageId) => {
			received.push({ channelId, peer, body, ...(messageId ? { messageId } : {}) });
		};
		const created = new Map<ChannelInstanceId, FakeChannel>();
		const runtime = await startChannels(session(), config({ discord: { enabled: true } }), onInbound, undefined, {
			createAdapter: createAdapters(created),
		});

		const discord = created.get("discord");
		expect(discord?.started).toBe(true);
		discord!.publish({
			peer: "c1",
			chatType: "channel",
			senderId: "u1",
			body: "hello",
			messageId: "m1",
			attachments: [{ kind: "image", path: "/tmp/inbox/pic.png", name: "pic.png", size: 3 }],
		});
		discord!.publish({ peer: "c1", chatType: "channel", senderId: "u1", body: "hello again", messageId: "m1" });

		expect(received).toHaveLength(1);
		expect(received[0]!.body).toContain("hello");
		expect(received[0]!.body).toContain("[attachments]");
		expect(received[0]!.body).toContain("/tmp/inbox/pic.png");
		await runtime.stop();
	});

	test("refuses a peer outside the Discord allowlist and sends the refusal once", async () => {
		const received: string[] = [];
		const created = new Map<ChannelInstanceId, FakeChannel>();
		const runtime = await startChannels(
			session(),
			config({ discord: { enabled: true } }),
			(_channelId, peer) => received.push(peer),
			undefined,
			{ createAdapter: createAdapters(created) },
		);
		const discord = created.get("discord")!;
		discord.publish({ peer: "c2", chatType: "channel", body: "stranger", messageId: "x1" });
		discord.publish({ peer: "c2", chatType: "channel", body: "stranger again", messageId: "x2" });
		expect(received).toHaveLength(0);
		expect(discord.sent.filter(entry => entry.text === CHANNEL_PEER_REFUSED_TEXT)).toHaveLength(1);
		await runtime.stop();
	});

	test("QQ allowlists hold bare numbers and match group:/user: peers", async () => {
		const received: string[] = [];
		const created = new Map<ChannelInstanceId, FakeChannel>();
		const runtime = await startChannels(
			session(),
			config({ qq: { enabled: true } }),
			(_channelId, peer) => received.push(peer),
			undefined,
			{ createAdapter: createAdapters(created) },
		);
		const qq = created.get("qq")!;
		qq.publish({ peer: "group:42", chatType: "group", body: "in group", messageId: "g1" });
		qq.publish({ peer: "user:900", chatType: "dm", body: "in dm", messageId: "u1" });
		qq.publish({ peer: "group:43", chatType: "group", body: "not allowed", messageId: "g2" });
		qq.publish({ peer: "user:901", chatType: "dm", body: "not allowed", messageId: "u2" });
		expect(received).toEqual(["group:42", "user:900"]);
		await runtime.stop();
	});

	test("QQ reverse mode requires a token", async () => {
		const runtime = await startChannels(
			session(),
			config({ qq: { enabled: true, mode: "reverse", endpoint: undefined, token: "" } }),
			() => {},
		);
		expect(runtime.channels.has("qq")).toBe(false);
		expect(runtime.status()).toContainEqual(expect.objectContaining({ id: "qq", state: "auth-failed" }));
		await runtime.stop();
	});
});
