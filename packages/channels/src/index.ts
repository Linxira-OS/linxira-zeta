/**
 * Channel bootstrapping shared by `zetacode serve` and normal CLI/TUI
 * sessions.
 *
 * One `channels.instances[]` entry = one platform account = one adapter
 * connection. Instance ids are the namespace for status, dedupe, allowlists,
 * QR state, inbox paths and outbound sends; the platform is not unique.
 */

import * as path from "node:path";
import { getAgentDir, logger } from "@linxiraos/pi-utils";
import { CHANNEL_PEER_REFUSED_TEXT, isAllowlistEmpty, isPeerAllowedFor, type ChannelAllowlists } from "./auth";
import type {
	ChannelHealthState,
	ChannelInstanceId,
	ChannelPlatform,
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
import type { ChannelInstanceConfig, ChannelSession, ChannelsWebConfig } from "./types";
import { WeChatChannel, type WeChatQrStatus } from "./wechat";

export {
	CHANNEL_PEER_REFUSED_TEXT,
	isAllowlistEmpty,
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
	type ChannelInstanceId,
	type ChannelPlatform,
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
export type {
	ChannelInstanceConfig,
	ChannelSession,
	ChannelSessionEvent,
	ChannelsWebConfig,
	IrcMessage,
} from "./types";
export {
	WeChatChannel,
	type WeChatChannelOptions,
	type WeChatCredentialSink,
	type WeChatInboundHandler,
	type WeChatQrStatus,
} from "./wechat";

const PEER_REFUSAL_COOLDOWN_MS = 60_000;

/** Per-instance QR login state (the gateway dispatches in-process). */
const pendingWechatQr = new Map<ChannelInstanceId, WeChatQrStatus>();
const reconnectWechat = new Map<ChannelInstanceId, () => Promise<void>>();
const unbindWechat = new Map<ChannelInstanceId, () => Promise<void>>();
let restartChannels: (() => Promise<void>) | null = null;
let mainSessionId: string | null = null;
let channelStatus: (() => ChannelStatus[]) | null = null;

export interface ChannelStatus {
	id: ChannelInstanceId;
	platform: ChannelPlatform;
	label: string;
	running: boolean;
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

export function setPendingWechatQr(instanceId: ChannelInstanceId, payload: WeChatQrStatus | null): void {
	if (payload === null) pendingWechatQr.delete(instanceId);
	else pendingWechatQr.set(instanceId, payload);
}

export function getPendingWechatQr(instanceId: ChannelInstanceId): WeChatQrStatus | null {
	return pendingWechatQr.get(instanceId) ?? null;
}

export function clearPendingWechatQr(): void {
	pendingWechatQr.clear();
}

export function registerMainSessionId(id: string | null): void {
	mainSessionId = id;
}

export function getMainSessionId(): string | null {
	return mainSessionId;
}

export function registerWechatReconnect(instanceId: ChannelInstanceId, fn: (() => Promise<void>) | null): void {
	if (fn === null) reconnectWechat.delete(instanceId);
	else reconnectWechat.set(instanceId, fn);
}

export function triggerWechatReconnect(instanceId: ChannelInstanceId): Promise<void> | null {
	return reconnectWechat.get(instanceId)?.() ?? null;
}

export function registerWechatUnbind(instanceId: ChannelInstanceId, fn: (() => Promise<void>) | null): void {
	if (fn === null) unbindWechat.delete(instanceId);
	else unbindWechat.set(instanceId, fn);
}

export function triggerWechatUnbind(instanceId: ChannelInstanceId): Promise<void> | null {
	return unbindWechat.get(instanceId)?.() ?? null;
}

export function registerRestartChannels(fn: (() => Promise<void>) | null): void {
	restartChannels = fn;
}

export function triggerRestartChannels(): Promise<void> | null {
	return restartChannels?.() ?? null;
}

export interface ChannelRuntime {
	/** Started instances keyed by instance id. */
	readonly channels: ReadonlyMap<ChannelInstanceId, ChatChannel>;
	readonly host: ChannelHost;
	readonly seen: ChannelSeenStore;
	status(): ChannelStatus[];
	sendText(instanceId: ChannelInstanceId, to: string, text: string, options?: ChannelSendOptions): Promise<void>;
	sendImage(instanceId: ChannelInstanceId, to: string, image: ChatImage, caption?: string): Promise<void>;
	sendFile(
		instanceId: ChannelInstanceId,
		to: string,
		file: { data: Uint8Array; name: string; mime?: string },
		caption?: string,
	): Promise<void>;
	stop(): Promise<void>;
}

export type ChannelInboundHandler = (
	instanceId: ChannelInstanceId,
	peer: string,
	body: string,
	messageId?: string,
) => void;

export interface StartChannelsOptions {
	stateDir?: string;
	seenStore?: ChannelSeenStore;
	/** Test seam: build an adapter around the runtime's inbound handler. */
	createAdapter?: (instance: ChannelInstanceConfig, onMessage: (message: InboundMessage) => void) => ChatChannel | undefined;
}

/** Flatten an inbound platform message into the text the agent sees. */
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
			else lines.push(`- ${attachment.kind}: ${label}${attachment.error ? ` (unavailable: ${attachment.error})` : ""}`);
		}
	}
	return lines.join("\n").trim();
}

function channelAllowlists(instances: readonly ChannelInstanceConfig[]): ChannelAllowlists {
	const perInstance: ChannelAllowlists["perInstance"] = {};
	for (const instance of instances) {
		perInstance[instance.id] = {
			peers: instance.allow.peers ?? [],
			users: instance.allow.users ?? [],
		};
	}
	return { perInstance };
}

function instanceCredentialString(instance: ChannelInstanceConfig, key: string): string | undefined {
	const value = instance.credentials[key];
	return typeof value === "string" && value !== "" ? value : undefined;
}

function instanceCredentialStrings(instance: ChannelInstanceConfig, key: string): string[] {
	const value = instance.credentials[key];
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** Build the adapter for one instance; `undefined` means "not startable". */
function buildAdapter(
	instance: ChannelInstanceConfig,
	onMessage: (message: InboundMessage) => void,
	options: StartChannelsOptions | undefined,
	webConfig: ChannelsWebConfig,
	inboxRoot: string,
	qrHandler: ((instanceId: ChannelInstanceId, payload: WeChatQrStatus) => void) | undefined,
): ChatChannel | undefined {
	const custom = options?.createAdapter?.(instance, onMessage);
	if (custom) return custom;
	const attachmentDir = path.join(inboxRoot, instance.id);
	switch (instance.platform) {
		case "telegram": {
			const botToken = instanceCredentialString(instance, "botToken");
			if (!botToken) return undefined;
			return new TelegramChannel({ instanceId: instance.id, botToken, onMessage });
		}
		case "wechat": {
			const credentialSink = webConfig.setInstance
				? {
						setField: (field: string, value: string) =>
							webConfig.setInstance?.(instance.id, {
								credentials: { ...instance.credentials, [field]: value },
							}) ?? Promise.resolve(),
						setPeerTokens: (peerTokens: Record<string, string>) =>
							webConfig.setInstance?.(instance.id, {
								options: { ...instance.options, peerTokens },
							}) ?? Promise.resolve(),
						clear: () =>
							webConfig.setInstance?.(instance.id, {
								credentials: {},
								options: { ...instance.options, peerTokens: {} },
							}) ?? Promise.resolve(),
					}
				: undefined;
			return new WeChatChannel({
				instanceId: instance.id,
				config: {
					botToken: instanceCredentialString(instance, "botToken"),
					ilinkBotId: instanceCredentialString(instance, "ilinkBotId"),
					ilinkUserId: instanceCredentialString(instance, "ilinkUserId"),
					baseUrl: instanceCredentialString(instance, "baseUrl"),
					endpoint: instanceCredentialString(instance, "endpoint"),
					peerTokens: instance.options?.peerTokens,
				},
				...(credentialSink ? { credentialSink } : {}),
				onMessage,
				onQrCode: payload => qrHandler?.(instance.id, payload),
			});
		}
		case "feishu": {
			const appId = instanceCredentialString(instance, "appId");
			const appSecret = instanceCredentialString(instance, "appSecret");
			if (!appId || !appSecret) return undefined;
			const domain = instance.credentials.domain === "lark" ? "lark" : "feishu";
			return new FeishuChannel({ instanceId: instance.id, appId, appSecret, domain, onMessage });
		}
		case "discord": {
			const botToken = instanceCredentialString(instance, "botToken");
			if (!botToken) return undefined;
			return new DiscordChannel({ instanceId: instance.id, botToken, onMessage, attachmentDir });
		}
		case "qq": {
			const mode = instance.credentials.mode === "reverse" ? "reverse" : "forward";
			const endpoint = instanceCredentialString(instance, "endpoint");
			const token = instanceCredentialString(instance, "token");
			if (mode === "forward" && !endpoint) return undefined;
			if (mode === "reverse" && !token) return undefined;
			const port = typeof instance.credentials.port === "number" ? instance.credentials.port : undefined;
			return new OneBotChannel({
				instanceId: instance.id,
				mode,
				...(endpoint ? { endpoint } : {}),
				...(token ? { token } : {}),
				...(port === undefined ? {} : { reversePort: port }),
				...(instanceCredentialString(instance, "selfId")
					? { selfId: instanceCredentialString(instance, "selfId") }
					: {}),
				onMessage,
				attachmentDir,
			});
		}
	}
}

/**
 * Start every enabled instance. A misconfigured instance is skipped with a
 * status reason; it never prevents the host from starting.
 */
export async function startChannels(
	session: ChannelSession,
	webConfig: ChannelsWebConfig,
	onInbound?: ChannelInboundHandler,
	wechatQrHandler?: (instanceId: ChannelInstanceId, payload: WeChatQrStatus) => void,
	options?: StartChannelsOptions,
): Promise<ChannelRuntime> {
	const data = webConfig.getData();
	const instances = data.channels.instances ?? [];
	const allow = channelAllowlists(instances);
	const inboxRoot = options?.stateDir
		? path.join(options.stateDir, "channels-inbox")
		: path.join(getAgentDir(), "run", "channels-inbox");
	const seen =
		options?.seenStore ??
		(await ChannelSeenStore.open(options?.stateDir ? { filePath: channelSeenStatePath(options.stateDir) } : {}));
	const channels = new Map<ChannelInstanceId, ChatChannel>();
	const refused: ChannelStatus[] = [];

	const sendText = async (
		instanceId: ChannelInstanceId,
		to: string,
		text: string,
		sendOptions?: ChannelSendOptions,
	): Promise<void> => {
		const channel = channels.get(instanceId);
		if (!channel) throw new Error(`Channel instance not enabled: ${instanceId}`);
		await channel.sendText(to, text, sendOptions);
	};

	const host = new ChannelHost(
		session,
		(instanceId, to, text, sendOptions) => sendText(instanceId, to, text, sendOptions),
		allow,
	);
	const refusedAt = new Map<string, number>();

	const refusePeer = (instanceId: ChannelInstanceId, peer: string): void => {
		const key = `${instanceId}\u0000${peer}`;
		const now = Date.now();
		if (now - (refusedAt.get(key) ?? 0) < PEER_REFUSAL_COOLDOWN_MS) return;
		refusedAt.set(key, now);
		void sendText(instanceId, peer, CHANNEL_PEER_REFUSED_TEXT).catch(error => {
			logger.warn("Channel refusal delivery failed", {
				instance: instanceId,
				error: error instanceof Error ? error.message : String(error),
			});
		});
	};

	const routeInbound = (instanceId: ChannelInstanceId, message: InboundMessage): void => {
		const identity = {
			peer: message.peer,
			...(message.senderId ? { senderId: message.senderId } : {}),
			...(message.allowKeys ? { allowKeys: message.allowKeys } : {}),
		};
		if (!isPeerAllowedFor(instanceId, identity, allow)) {
			logger.warn("Channel message refused: peer not in instance allowlist", {
				instance: instanceId,
				peer: message.peer,
			});
			refusePeer(instanceId, message.peer);
			return;
		}
		if (message.messageId) {
			if (seen.has(instanceId, message.messageId)) {
				logger.debug("Duplicate channel message ignored", { instance: instanceId, messageId: message.messageId });
				return;
			}
			seen.record(instanceId, message.messageId);
		}
		const body = inboundBody(message);
		if (body === "") return;
		if (onInbound) {
			onInbound(instanceId, message.peer, body, message.messageId);
			return;
		}
		void host.deliver(instanceId, message.peer, body, message.messageId, identity).catch(error => {
			logger.warn("Channel message injection failed", {
				instance: instanceId,
				error: error instanceof Error ? error.message : String(error),
			});
		});
	};

	const refuseStart = (instance: ChannelInstanceConfig, detail: string): void => {
		logger.error("Channel instance not started", { instance: instance.id, platform: instance.platform, detail });
		refused.push({
			id: instance.id,
			platform: instance.platform,
			label: instance.label,
			running: false,
			state: "auth-failed",
			detail,
			since: Date.now(),
		});
	};

	for (const instance of instances) {
		if (!instance.enabled) continue;
		if (isAllowlistEmpty(instance.id, allow)) {
			refuseStart(instance, "allow.peers is empty (deny-by-default)");
			continue;
		}
		const channel = buildAdapter(
			instance,
			message => routeInbound(instance.id, message),
			options,
			webConfig,
			inboxRoot,
			wechatQrHandler,
		);
		if (!channel) {
			refuseStart(instance, "required credentials are missing");
			continue;
		}
		channels.set(instance.id, channel);
	}

	host.start();

	for (const [instanceId, channel] of [...channels]) {
		try {
			await channel.start();
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			logger.warn(`Channel instance ${instanceId} failed to start`, { error: detail });
			channels.delete(instanceId);
			const instance = instances.find(candidate => candidate.id === instanceId);
			refused.push({
				id: instanceId,
				platform: channel.platform,
				label: instance?.label ?? instanceId,
				running: false,
				state: "degraded",
				lastError: detail,
				since: Date.now(),
			});
		}
	}

	const status = (): ChannelStatus[] => {
		const live = [...channels.entries()].map(([id, channel]): ChannelStatus => {
			const health = channel.getHealth?.();
			const instance = instances.find(candidate => candidate.id === id);
			return {
				id,
				platform: channel.platform,
				label: instance?.label ?? id,
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
		return [...live, ...refused].sort((a, b) => a.id.localeCompare(b.id));
	};

	return {
		channels,
		host,
		seen,
		status,
		sendText,
		sendImage: async (instanceId, to, image, caption) => {
			const channel = channels.get(instanceId);
			if (!channel) throw new Error(`Channel instance not enabled: ${instanceId}`);
			await channel.sendImage(to, image, caption);
		},
		sendFile: async (instanceId, to, file, caption) => {
			const channel = channels.get(instanceId);
			if (!channel) throw new Error(`Channel instance not enabled: ${instanceId}`);
			if (!channel.sendFile) throw new Error(`Channel instance ${instanceId} does not support files`);
			await channel.sendFile(to, file, caption);
		},
		stop: async () => {
			host.stop();
			await Promise.allSettled([...channels.values()].map(channel => channel.stop()));
			channels.clear();
			await seen.close().catch(error => {
				logger.warn("Channel seen-state flush failed", {
					error: error instanceof Error ? error.message : String(error),
				});
			});
		},
	};
}
