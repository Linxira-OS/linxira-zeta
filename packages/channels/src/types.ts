/**
 * Structural contracts for the IM channel adapters.
 *
 * pi-channels intentionally depends on zeta only through these shapes: the
 * real `AgentSession` and `WebConfig` satisfy them without importing this
 * package's types. Fields below mirror exactly what host.ts / index.ts /
 * wechat.ts read off the zeta objects.
 */

/** Message shape carried over from zeta's src/irc/bus.ts IrcMessage. */
export interface IrcMessage {
	id: string;
	/** Sender agent id. */
	from: string;
	/** Recipient agent id. */
	to: string;
	body: string;
	ts: number;
	/** Message id being answered. */
	replyTo?: string;
}

/**
 * host.ts/index.ts structured consumption surface of the coordinator session
 * (zeta's `AgentSession` satisfies this structurally). `getAgentId` matches
 * the real return type (`string | undefined`), and `subscribe`'s listener is
 * a supertype of zeta's `AgentSessionEvent` so method bivariance lets the
 * real session satisfy it.
 */
export interface ChannelSession {
	getAgentId(): string | undefined;
	deliverIrcMessage(msg: IrcMessage, opts?: { expectsReply?: boolean }): Promise<unknown>;
	subscribe(handler: (event: ChannelSessionEvent) => void): () => void;
	setIrcAutoReplyListener(listener: ((msg: IrcMessage, replyText: string) => void) | null): void;
}

/**
 * host.ts #onSessionEvent only reads `event.type` and then casts
 * `event.message` to `AssistantMessage`; every zeta `AgentSessionEvent`
 * variant is assignable to this loose shape.
 */
export interface ChannelSessionEvent {
	type: string;
	message?: unknown;
}

/**
 * index.ts/wechat.ts consumption surface of the web config. Fields match the
 * `data.channels.*` reads in `startChannels` plus the `set` calls WeChat uses
 * to persist credentials.
 */
export interface ChannelsWebConfig {
	getData(): {
		channels: {
			wechat: {
				enabled: boolean;
				botToken?: string;
				ilinkBotId?: string;
				ilinkUserId?: string;
				baseUrl?: string;
				endpoint?: string;
				peerTokens?: Record<string, string>;
			};
			feishu: {
				enabled: boolean;
				appId?: string;
				appSecret?: string;
				domain?: "feishu" | "lark";
			};
			telegram: { enabled: boolean; botToken?: string };
			allowedPeers?: string[];
		};
	};
	set(path: string, value: unknown): Promise<void>;
}
