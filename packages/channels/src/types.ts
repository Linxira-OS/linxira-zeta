/**
 * Structural contracts for the IM channel adapters.
 *
 * pi-channels intentionally depends on zeta only through these shapes: the
 * real `AgentSession` and `WebConfig` satisfy them without importing this
 * package's types.
 */

import type { ChannelInstanceId, ChannelPlatform } from "./channel";

/** Message shape carried over from zeta's src/irc/bus.ts IrcMessage. */
export interface IrcMessage {
	id: string;
	from: string;
	to: string;
	body: string;
	ts: number;
	replyTo?: string;
}

export interface ChannelSession {
	getAgentId(): string | undefined;
	deliverIrcMessage(msg: IrcMessage, opts?: { expectsReply?: boolean }): Promise<unknown>;
	subscribe(handler: (event: ChannelSessionEvent) => void): () => void;
	setIrcAutoReplyListener(listener: ((msg: IrcMessage, replyText: string) => void) | null): void;
	setIrcWakeTurnObserver?(
		observer: ((records: readonly unknown[]) => ((error?: unknown) => void | Promise<void>) | undefined) | undefined,
	): void;
}

export interface ChannelSessionEvent {
	type: string;
	message?: unknown;
}

/** One platform account. `credentials` is a platform-shaped object. */
export interface ChannelInstanceConfig {
	id: ChannelInstanceId;
	platform: ChannelPlatform;
	label: string;
	note?: string;
	enabled: boolean;
	agentProfile: string;
	allow: {
		peers: string[];
		users?: string[];
	};
	credentials: Record<string, unknown>;
	options?: {
		peerTokens?: Record<string, string>;
	};
}

export interface ChannelsWebConfig {
	getData(): {
		channels: { instances: ChannelInstanceConfig[] };
		imAgents?: readonly unknown[];
		remote?: { imBindings?: readonly unknown[] };
	};
	set(path: string, value: unknown): Promise<void>;
	/** Persist one instance's credentials/options without rewriting the array. */
	setInstance?(instanceId: ChannelInstanceId, patch: Partial<ChannelInstanceConfig>): Promise<unknown>;
}
