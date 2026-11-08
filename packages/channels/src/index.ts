/**
 * Channel bootstrapping shared by `zetacode serve` and normal CLI/TUI
 * sessions.
 *
 * Enables every channel marked `enabled` in the web config and routes its
 * inbound messages into the host session through `ChannelHost`. Channels
 * missing required credentials are skipped with a warning — a misconfigured
 * channel must never prevent the host from starting.
 *
 * The runtime is transport-agnostic: it needs only the `ChannelSession`
 * contract, so `zetacode` (interactive or `--print`) hosts it directly when a
 * channel is enabled, and `channel_send` becomes available there too.
 */

import { logger } from "@linxiraos/pi-utils";
import { CHANNEL_PEER_REFUSED_TEXT, isPeerAllowed } from "./auth";
import type { ChannelId, ChatChannel, ChatImage } from "./channel";
import { FeishuChannel } from "./feishu";
import { ChannelHost } from "./host";
import { ChannelSeenStore, channelSeenStatePath } from "./seen-store";
import { TelegramChannel } from "./telegram";
import type { ChannelSession, ChannelsWebConfig } from "./types";
import { WeChatChannel, type WeChatQrStatus } from "./wechat";

export { CHANNEL_PEER_REFUSED_TEXT, isPeerAllowed } from "./auth";
export type { ChannelId, ChatChannel, ChatImage } from "./channel";
export { FeishuChannel, type FeishuChannelOptions, type FeishuInboundHandler } from "./feishu";
export { ChannelHost, type ChannelDeliveryResult, type ChannelSendFn } from "./host";
export {
	ReplyCorrelator,
	type ChatReplyTarget,
	type ReplyCorrelatorOptions,
	type ReplyTarget,
	type SinkReplyTarget,
} from "./reply-correlator";
export {
	CHANNEL_SEEN_FILENAME,
	ChannelSeenStore,
	channelSeenStatePath,
	type ChannelSeenStoreOptions,
} from "./seen-store";
export { TelegramChannel, type TelegramChannelOptions, type TelegramInboundHandler } from "./telegram";
export type { ChannelSession, ChannelSessionEvent, ChannelsWebConfig, IrcMessage } from "./types";
export { WeChatChannel, type WeChatChannelOptions, type WeChatInboundHandler, type WeChatQrStatus } from "./wechat";

/** Minimum spacing between two refusals to the same unauthorized peer. */
const PEER_REFUSAL_COOLDOWN_MS = 60_000;

/**
 * Module-level QR-login state bridge between the running channel and the web
 * gateway (the gateway dispatches in-process, so a plain module variable is
 * the shared seam — mirroring `running-sessions.ts`).
 */
let pendingWechatQr: WeChatQrStatus | null = null;
let reconnectWechat: (() => Promise<void>) | null = null;
let unbindWechat: (() => Promise<void>) | null = null;
let restartChannels: (() => Promise<void>) | null = null;
let mainSessionId: string | null = null;
let channelStatus: (() => ChannelStatus[]) | null = null;

/** One channel's runtime state, surfaced to the gateway (`/api/channels/status`). */
export interface ChannelStatus {
	id: ChannelId;
	running: boolean;
}

export function registerChannelStatus(fn: (() => ChannelStatus[]) | null): void {
	channelStatus = fn;
}

export function getChannelStatus(): ChannelStatus[] {
	return channelStatus?.() ?? [];
}

export function setPendingWechatQr(payload: WeChatQrStatus | null): void {
	pendingWechatQr = payload;
}

export function getPendingWechatQr(): WeChatQrStatus | null {
	return pendingWechatQr;
}

/**
 * Register the serve process's shared coordinator session id (zeta-server
 * wires this). External clients (web-ui default chat, `zetacode attach`) resolve
 * the shared session through `GET /api/agent/current`, which reads this.
 */
export function registerMainSessionId(id: string | null): void {
	mainSessionId = id;
}

/** The persistent id of the serve process's shared coordinator session, if any. */
export function getMainSessionId(): string | null {
	return mainSessionId;
}

/** Register the running WeChat channel's reconnect hook (zeta-server wires this). */
export function registerWechatReconnect(fn: (() => Promise<void>) | null): void {
	reconnectWechat = fn;
}

/** Trigger a fresh QR login on the running WeChat channel, if any. */
export function triggerWechatReconnect(): Promise<void> | null {
	return reconnectWechat?.() ?? null;
}

/** Register the running WeChat channel's unbind hook (zeta-server wires this). */
export function registerWechatUnbind(fn: (() => Promise<void>) | null): void {
	unbindWechat = fn;
}

/** Unbind the running WeChat channel (clears credentials + peer bindings). */
export function triggerWechatUnbind(): Promise<void> | null {
	return unbindWechat?.() ?? null;
}

/** Register the live channel (re)start hook (zeta-server wires this). */
export function registerRestartChannels(fn: (() => Promise<void>) | null): void {
	restartChannels = fn;
}

/**
 * Re-apply the channel config against the running serve process: stop the
 * current runtime and start whichever channels web.yml now enables. The web
 * gateway calls this after a `channels.*` PUT so toggling a channel in the UI
 * takes effect immediately (QR login included) without a serve restart.
 */
export function triggerRestartChannels(): Promise<void> | null {
	return restartChannels?.() ?? null;
}

export interface ChannelRuntime {
	/** Started channels keyed by id (enabled + configured only). */
	readonly channels: ReadonlyMap<ChannelId, ChatChannel>;
	/** Host binding the coordinator session to the channels. */
	readonly host: ChannelHost;
	/** Durable per-channel message-id dedupe (flushed by `stop`). */
	readonly seen: ChannelSeenStore;
	/** Send a text message through one channel. */
	sendText(channelId: ChannelId, to: string, text: string): Promise<void>;
	/** Send an image through one channel (falls back to caller on error). */
	sendImage(channelId: ChannelId, to: string, image: ChatImage, caption?: string): Promise<void>;
	/** Stop every channel, detach the host, and flush the seen state. */
	stop(): Promise<void>;
}

/** Handle one inbound channel message (the Phase-3 routing seam lives here). */
export type ChannelInboundHandler = (channelId: ChannelId, peer: string, body: string, messageId?: string) => void;

export interface StartChannelsOptions {
	/** Agent/config dir; the durable seen state lands in `run/channels-seen.json`. */
	stateDir?: string;
	/** Test seam: a pre-built store (defaults to one loaded from `stateDir`). */
	seenStore?: ChannelSeenStore;
}

/**
 * Start all enabled channels for the given coordinator session.
 * `onInbound` receives every inbound message after the authorization gate and
 * duplicate filter; default wiring injects into the session via the host.
 */
export async function startChannels(
	session: ChannelSession,
	webConfig: ChannelsWebConfig,
	onInbound?: ChannelInboundHandler,
	wechatQrHandler?: (payload: WeChatQrStatus) => void,
	options?: StartChannelsOptions,
): Promise<ChannelRuntime> {
	const data = webConfig.getData();
	const allowedPeers = data.channels.allowedPeers ?? [];
	// Loaded before any adapter starts, so a retried update from before the
	// restart is recognized by the very first poll.
	const seen =
		options?.seenStore ??
		(await ChannelSeenStore.open(options?.stateDir ? { filePath: channelSeenStatePath(options.stateDir) } : {}));
	const channels = new Map<ChannelId, ChatChannel>();

	const sendText = async (channelId: ChannelId, to: string, text: string): Promise<void> => {
		const channel = channels.get(channelId);
		if (!channel) throw new Error(`Channel not enabled: ${channelId}`);
		await channel.sendText(to, text);
	};

	const host = new ChannelHost(session, (channelId, to, text) => sendText(channelId, to, text), allowedPeers);
	const refusedAt = new Map<string, number>();

	/** Explicit, rate-limited refusal for a sender outside the allowlist. */
	const refusePeer = (channelId: ChannelId, peer: string): void => {
		const key = `${channelId}\u0000${peer}`;
		const now = Date.now();
		if (now - (refusedAt.get(key) ?? 0) < PEER_REFUSAL_COOLDOWN_MS) return;
		refusedAt.set(key, now);
		void sendText(channelId, peer, CHANNEL_PEER_REFUSED_TEXT).catch(error => {
			logger.warn("Channel refusal delivery failed", {
				channel: channelId,
				error: error instanceof Error ? error.message : String(error),
			});
		});
	};

	/**
	 * Inbound gate. MUST stay first: `onInbound` (zeta-server) dispatches to the
	 * command router, workspace/direct sessions, bot sessions and the relay, and
	 * every one of those can open an arbitrary workspace or start a turn.
	 */
	const routeInbound: ChannelInboundHandler = (channelId, peer, body, messageId) => {
		if (!isPeerAllowed(peer, allowedPeers)) {
			logger.warn("Channel message refused: peer not in allowedPeers", { channel: channelId, peer });
			refusePeer(channelId, peer);
			return;
		}
		if (messageId) {
			if (seen.has(channelId, messageId)) {
				logger.debug("Duplicate channel message ignored", { channel: channelId, messageId });
				return;
			}
			// Recorded before dispatch: a platform retry that lands while the
			// first copy is still being routed must not start a second turn.
			seen.record(channelId, messageId);
		}
		if (onInbound) {
			onInbound(channelId, peer, body, messageId);
			return;
		}
		void host.deliver(channelId, peer, body, messageId).catch(error => {
			logger.warn("Channel message injection failed", {
				channel: channelId,
				error: error instanceof Error ? error.message : String(error),
			});
		});
	};

	// Telegram
	if (data.channels.telegram.enabled) {
		const botToken = data.channels.telegram.botToken;
		if (botToken) {
			channels.set(
				"telegram",
				new TelegramChannel({
					botToken,
					onMessage: (peer, body, messageId) => routeInbound("telegram", peer, body, messageId),
				}),
			);
		} else {
			logger.warn("Telegram channel is enabled but missing botToken; skipping");
		}
	}

	// WeChat (ClawBot / iLink)
	if (data.channels.wechat.enabled) {
		channels.set(
			"wechat",
			new WeChatChannel({
				config: {
					botToken: data.channels.wechat.botToken,
					ilinkBotId: data.channels.wechat.ilinkBotId,
					ilinkUserId: data.channels.wechat.ilinkUserId,
					baseUrl: data.channels.wechat.baseUrl,
					endpoint: data.channels.wechat.endpoint,
					peerTokens: data.channels.wechat.peerTokens,
				},
				webConfig,
				onMessage: (peer, body, messageId) => routeInbound("wechat", peer, body, messageId),
				onQrCode: wechatQrHandler,
			}),
		);
	}

	// Feishu / Lark
	if (data.channels.feishu.enabled) {
		const appId = data.channels.feishu.appId;
		const appSecret = data.channels.feishu.appSecret;
		if (appId && appSecret) {
			channels.set(
				"feishu",
				new FeishuChannel({
					appId,
					appSecret,
					domain: data.channels.feishu.domain,
					onMessage: (peer, body, messageId) => routeInbound("feishu", peer, body, messageId),
				}),
			);
		} else {
			logger.warn("Feishu channel is enabled but missing appId/appSecret; skipping");
		}
	}

	host.start();

	for (const channel of channels.values()) {
		try {
			await channel.start();
		} catch (error) {
			logger.warn(`Channel ${channel.id} failed to start`, {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return {
		channels,
		host,
		seen,
		sendText,
		sendImage: async (channelId, to, image, caption) => {
			const channel = channels.get(channelId);
			if (!channel) throw new Error(`Channel not enabled: ${channelId}`);
			await channel.sendImage(to, image, caption);
		},
		stop: async () => {
			host.stop();
			await Promise.allSettled([...channels.values()].map(channel => channel.stop()));
			channels.clear();
			// Persist the ids accepted before shutdown so a restart dedupes them.
			await seen.close().catch(error => {
				logger.warn("Channel seen-state flush failed", {
					error: error instanceof Error ? error.message : String(error),
				});
			});
		},
	};
}
