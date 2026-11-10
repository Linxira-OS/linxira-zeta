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

import * as path from "node:path";
import { getAgentDir, logger } from "@linxiraos/pi-utils";
import { CHANNEL_PEER_REFUSED_TEXT, isAllowlistEmpty, isPeerAllowedFor, type ChannelAllowlists } from "./auth";
import type {
	ChannelHealthState,
	ChannelId,
	ChannelSendOptions,
	ChatChannel,
	ChatImage,
	InboundMessage,
} from "./channel";
import { DiscordChannel } from "./discord";
import { FeishuChannel } from "./feishu";
import { ChannelHost } from "./host";
import { OneBotChannel } from "./onebot";
import { ChannelSeenStore, channelSeenStatePath } from "./seen-store";
import { TelegramChannel } from "./telegram";
import type { ChannelSession, ChannelsWebConfig } from "./types";
import { WeChatChannel, type WeChatQrStatus } from "./wechat";

export {
	CHANNEL_PEER_REFUSED_TEXT,
	isAllowlistEmpty,
	isPeerAllowed,
	isPeerAllowedFor,
	type ChannelAllowRule,
	type ChannelAllowlists,
	type PeerIdentity,
} from "./auth";
export {
	DENY_BY_DEFAULT_CHANNELS,
	type AttachmentKind,
	type ChannelCapabilities,
	type ChannelHealth,
	type ChannelHealthState,
	type ChannelId,
	type ChannelSendOptions,
	type ChatChannel,
	type ChatImage,
	type InboundAttachment,
	type InboundMessage,
} from "./channel";
export { DiscordChannel, type DiscordChannelOptions, type DiscordInboundHandler } from "./discord";
export {
	OneBotChannel,
	parseOneBotMessage,
	parseOneBotPeer,
	probeOneBotEndpoint,
	probeOneBotReversePort,
	type OneBotChannelOptions,
	type OneBotInboundHandler,
	type OneBotMode,
	type OneBotProbeResult,
	type ParsedOneBotMessage,
} from "./onebot";
export {
	bunReverseServerFactory,
	bunSocketFactory,
	socketOpen,
	type ReverseConnection,
	type ReverseServerFactory,
	type ReverseServerLike,
	type ReverseServerOptions,
	type SocketFactory,
	type SocketLike,
} from "./socket";
export { splitText } from "./text";
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
	/** Adapter health; absent for adapters that do not report one. */
	state?: ChannelHealthState;
	detail?: string;
	lastError?: string;
	since?: number;
	lastInboundAt?: number;
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
	/** Live status of every configured channel, including refused ones. */
	status(): ChannelStatus[];
	/** Send a text message through one channel. */
	sendText(channelId: ChannelId, to: string, text: string, options?: ChannelSendOptions): Promise<void>;
	/** Send an image through one channel (falls back to caller on error). */
	sendImage(channelId: ChannelId, to: string, image: ChatImage, caption?: string): Promise<void>;
	/** Send a generic file through one channel, when the platform supports it. */
	sendFile(
		channelId: ChannelId,
		to: string,
		file: { data: Uint8Array; name: string; mime?: string },
		caption?: string,
	): Promise<void>;
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
	/** Test seam: build an adapter around the runtime's inbound handler. */
	createAdapter?: (channelId: ChannelId, onMessage: (message: InboundMessage) => void) => ChatChannel | undefined;
}

/** Every channel the runtime knows, in a stable status order. */
const CHANNEL_ORDER: readonly ChannelId[] = ["wechat", "feishu", "telegram", "discord", "qq"];

/**
 * Flatten an inbound platform message into the text the agent sees. Attachment
 * paths go on their own lines so the agent can read them with ordinary file
 * tools; a download failure stays visible instead of silently dropping media.
 */
export function inboundBody(message: InboundMessage): string {
	const lines: string[] = [];
	if (message.body.trim() !== "") lines.push(message.body.trim());
	const attachments = message.attachments ?? [];
	if (attachments.length > 0) {
		lines.push("", "[attachments]");
		for (const attachment of attachments) {
			const label = attachment.name ?? attachment.kind;
			const size = attachment.size === undefined ? "" : ` (${attachment.size} bytes)`;
			if (attachment.path) lines.push(`- ${attachment.kind}: ${attachment.path}${size} — ${label}`);
			else if (attachment.url) lines.push(`- ${attachment.kind}: ${attachment.url}${size} — ${label}`);
			else
				lines.push(
					`- ${attachment.kind}: ${label}${attachment.error ? ` (unavailable: ${attachment.error})` : ""}`,
				);
		}
	}
	return lines.join("\n").trim();
}

/** Resolve the configured allowlists into the runtime policy. */
function channelAllowlists(data: ReturnType<ChannelsWebConfig["getData"]>): ChannelAllowlists {
	const perChannel: NonNullable<ChannelAllowlists["perChannel"]> = {};
	const allow: ChannelAllowlists = { legacy: data.channels.allowedPeers ?? [], perChannel };
	const discord = data.channels.discord;
	if (discord) {
		perChannel.discord = {
			peers: discord.allowedChannels ?? [],
			users: discord.allowedUsers ?? [],
			denyWhenEmpty: true,
		};
	}
	const qq = data.channels.qq;
	if (qq) {
		perChannel.qq = {
			peers: [
				...(qq.allowedGroups ?? []).map(group => (group.startsWith("group:") ? group : `group:${group}`)),
				...(qq.allowedUsers ?? []).map(user => (user.startsWith("user:") ? user : `user:${user}`)),
			],
			denyWhenEmpty: true,
		};
	}
	return allow;
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
	const allow = channelAllowlists(data);
	const inboxDir = options?.stateDir
		? path.join(options.stateDir, "channels-inbox")
		: path.join(getAgentDir(), "run", "channels-inbox");
	// Loaded before any adapter starts, so a retried update from before the
	// restart is recognized by the very first poll.
	const seen =
		options?.seenStore ??
		(await ChannelSeenStore.open(options?.stateDir ? { filePath: channelSeenStatePath(options.stateDir) } : {}));
	const channels = new Map<ChannelId, ChatChannel>();
	const refused: ChannelStatus[] = [];

	const sendText = async (
		channelId: ChannelId,
		to: string,
		text: string,
		sendOptions?: ChannelSendOptions,
	): Promise<void> => {
		const channel = channels.get(channelId);
		if (!channel) throw new Error(`Channel not enabled: ${channelId}`);
		await channel.sendText(to, text, sendOptions);
	};

	const host = new ChannelHost(
		session,
		(channelId, to, text, sendOptions) => sendText(channelId, to, text, sendOptions),
		allow,
	);
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
	const routeInbound = (channelId: ChannelId, message: InboundMessage): void => {
		const identity = {
			peer: message.peer,
			...(message.senderId ? { senderId: message.senderId } : {}),
			...(message.allowKeys ? { allowKeys: message.allowKeys } : {}),
		};
		if (!isPeerAllowedFor(channelId, identity, allow)) {
			logger.warn("Channel message refused: peer not in the allowlist", { channel: channelId, peer: message.peer });
			refusePeer(channelId, message.peer);
			return;
		}
		if (message.messageId) {
			if (seen.has(channelId, message.messageId)) {
				logger.debug("Duplicate channel message ignored", { channel: channelId, messageId: message.messageId });
				return;
			}
			// Recorded before dispatch: a platform retry that lands while the
			// first copy is still being routed must not start a second turn.
			seen.record(channelId, message.messageId);
		}
		const body = inboundBody(message);
		if (body === "") return;
		if (onInbound) {
			onInbound(channelId, message.peer, body, message.messageId);
			return;
		}
		void host.deliver(channelId, message.peer, body, message.messageId, identity).catch(error => {
			logger.warn("Channel message injection failed", {
				channel: channelId,
				error: error instanceof Error ? error.message : String(error),
			});
		});
	};

	/** Record a channel that is enabled but cannot start; status must say why. */
	const refuseStart = (channelId: ChannelId, detail: string): void => {
		logger.error("Channel not started", { channel: channelId, detail });
		refused.push({ id: channelId, running: false, state: "auth-failed", detail, since: Date.now() });
	};

	// Telegram
	if (data.channels.telegram.enabled) {
		const botToken = data.channels.telegram.botToken;
		if (botToken) {
			channels.set(
				"telegram",
				new TelegramChannel({
					botToken,
					onMessage: message => routeInbound("telegram", message),
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
				onMessage: message => routeInbound("wechat", message),
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
					onMessage: message => routeInbound("feishu", message),
				}),
			);
		} else {
			logger.warn("Feishu channel is enabled but missing appId/appSecret; skipping");
		}
	}

	// Discord (official Bot API). Deny-by-default: without an allowlist a
	// public guild could drive the agent, so the channel refuses to start.
	if (data.channels.discord.enabled) {
		const discord = data.channels.discord;
		if (!discord.botToken) {
			logger.warn("Discord channel is enabled but missing botToken; skipping");
		} else if (isAllowlistEmpty("discord", allow)) {
			refuseStart("discord", "channels.discord.allowedChannels is empty (deny-by-default)");
		} else {
			const onMessage = (message: InboundMessage): void => routeInbound("discord", message);
			channels.set(
				"discord",
				options?.createAdapter?.("discord", onMessage) ??
					new DiscordChannel({
						botToken: discord.botToken,
						onMessage,
						attachmentDir: inboxDir,
					}),
			);
		}
	}

	// QQ over a user-supplied OneBot v11 bridge (BYO; nothing is bundled).
	if (data.channels.qq.enabled) {
		const qq = data.channels.qq;
		const mode = qq.mode ?? "forward";
		if (mode === "forward" && !qq.endpoint) {
			logger.warn("QQ channel is enabled but missing endpoint (forward mode); skipping");
		} else if (mode === "reverse" && !qq.token) {
			refuseStart("qq", "channels.qq.token is required for reverse mode");
		} else if (isAllowlistEmpty("qq", allow)) {
			refuseStart("qq", "channels.qq.allowedGroups/allowedUsers are empty (deny-by-default)");
		} else {
			const onMessage = (message: InboundMessage): void => routeInbound("qq", message);
			channels.set(
				"qq",
				options?.createAdapter?.("qq", onMessage) ??
					new OneBotChannel({
						mode,
						...(qq.endpoint ? { endpoint: qq.endpoint } : {}),
						...(qq.token ? { token: qq.token } : {}),
						...(qq.port === undefined ? {} : { reversePort: qq.port }),
						...(qq.selfId ? { selfId: qq.selfId } : {}),
						onMessage,
						attachmentDir: inboxDir,
					}),
			);
		}
	}

	host.start();

	for (const channel of channels.values()) {
		try {
			await channel.start();
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			logger.warn(`Channel ${channel.id} failed to start`, { error: detail });
			channels.delete(channel.id);
			refused.push({ id: channel.id, running: false, state: "degraded", lastError: detail, since: Date.now() });
		}
	}

	const status = (): ChannelStatus[] => {
		const live = [...channels.entries()].map(([id, channel]): ChannelStatus => {
			const health = channel.getHealth?.();
			return {
				id,
				running: true,
				...(health
					? {
							state: health.state,
							...(health.detail ? { detail: health.detail } : {}),
							...(health.lastError ? { lastError: health.lastError } : {}),
							since: health.since,
							...(health.lastInboundAt ? { lastInboundAt: health.lastInboundAt } : {}),
						}
					: {}),
			};
		});
		const all = [...live, ...refused];
		return CHANNEL_ORDER.flatMap(id => all.filter(entry => entry.id === id));
	};

	return {
		channels,
		host,
		seen,
		status,
		sendText,
		sendImage: async (channelId, to, image, caption) => {
			const channel = channels.get(channelId);
			if (!channel) throw new Error(`Channel not enabled: ${channelId}`);
			await channel.sendImage(to, image, caption);
		},
		sendFile: async (channelId, to, file, caption) => {
			const channel = channels.get(channelId);
			if (!channel) throw new Error(`Channel not enabled: ${channelId}`);
			if (!channel.sendFile) throw new Error(`Channel ${channelId} does not support files`);
			await channel.sendFile(to, file, caption);
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
