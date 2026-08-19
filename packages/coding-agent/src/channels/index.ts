/**
 * Channel bootstrapping for `zeta serve` (web/desktop mode only).
 *
 * Enables every channel marked `enabled` in the web config and routes its
 * inbound messages into the coordinator session through `ChannelHost`.
 * Channels missing required credentials are skipped with a warning — a
 * misconfigured channel must never prevent the server from starting.
 *
 * The CLI never imports this module: `zeta`/`zeta --interactive` sessions
 * don't create a ZetaServer, so no channel listeners exist there and
 * `channel_send`/`workspace_run` stay unavailable.
 */

import { logger } from "@linxiraos/pi-utils";
import type { WebConfig } from "../config/web-config";
import type { AgentSession } from "../session/agent-session";
import type { ChatChannel, ChannelId, ChatImage } from "./channel";
import { FeishuChannel } from "./feishu";
import { ChannelHost } from "./host";
import { TelegramChannel } from "./telegram";
import { WeChatChannel, type WeChatQrStatus } from "./wechat";

export type { ChatChannel, ChannelId, ChatImage } from "./channel";
export { ChannelHost } from "./host";
export type { WeChatQrStatus } from "./wechat";

/**
 * Module-level QR-login state bridge between the running channel and the web
 * gateway (the gateway dispatches in-process, so a plain module variable is
 * the shared seam — mirroring `running-sessions.ts`).
 */
let pendingWechatQr: WeChatQrStatus | null = null;
let reconnectWechat: (() => Promise<void>) | null = null;

export function setPendingWechatQr(payload: WeChatQrStatus | null): void {
	pendingWechatQr = payload;
}

export function getPendingWechatQr(): WeChatQrStatus | null {
	return pendingWechatQr;
}

/** Register the running WeChat channel's reconnect hook (zeta-server wires this). */
export function registerWechatReconnect(fn: (() => Promise<void>) | null): void {
	reconnectWechat = fn;
}

/** Trigger a fresh QR login on the running WeChat channel, if any. */
export function triggerWechatReconnect(): Promise<void> | null {
	return reconnectWechat?.() ?? null;
}

export interface ChannelRuntime {
	/** Started channels keyed by id (enabled + configured only). */
	readonly channels: ReadonlyMap<ChannelId, ChatChannel>;
	/** Host binding the coordinator session to the channels. */
	readonly host: ChannelHost;
	/** Send a text message through one channel. */
	sendText(channelId: ChannelId, to: string, text: string): Promise<void>;
	/** Send an image through one channel (falls back to caller on error). */
	sendImage(channelId: ChannelId, to: string, image: ChatImage, caption?: string): Promise<void>;
	/** Stop every channel and detach the host. */
	stop(): Promise<void>;
}

/** Handle one inbound channel message (the Phase-3 routing seam lives here). */
export type ChannelInboundHandler = (channelId: ChannelId, peer: string, body: string, messageId?: string) => void;

/**
 * Start all enabled channels for the given coordinator session.
 * `onInbound` receives every inbound message after channel-level filtering;
 * default wiring injects into the session via the host.
 */
export async function startChannels(
	session: AgentSession,
	webConfig: WebConfig,
	onInbound?: ChannelInboundHandler,
	wechatQrHandler?: (payload: WeChatQrStatus) => void,
): Promise<ChannelRuntime> {
	const data = webConfig.getData();
	const host = new ChannelHost(session, (channelId, to, text) => sendText(channelId, to, text));
	const channels = new Map<ChannelId, ChatChannel>();

	const routeInbound: ChannelInboundHandler =
		onInbound ??
		((channelId, peer, body) => {
			void host.deliver(channelId, peer, body).catch(error => {
				logger.warn("Channel message injection failed", {
					channel: channelId,
					error: error instanceof Error ? error.message : String(error),
				});
			});
		});

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

	const sendText = async (channelId: ChannelId, to: string, text: string): Promise<void> => {
		const channel = channels.get(channelId);
		if (!channel) throw new Error(`Channel not enabled: ${channelId}`);
		await channel.sendText(to, text);
	};

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
		},
	};
}
