/**
 * Minimal IM channel abstraction for `zetacode serve` (web/desktop mode only).
 *
 * A `ChatChannel` owns one platform connection: start/stop lifecycle plus
 * outbound text/image delivery. Inbound messages are pushed through the
 * channel's `onMessage` callback (registered at construction) into the
 * coordinator session via `ChannelHost.deliver`.
 *
 * Inbound messages are structured rather than `(peer, body, messageId)` so a
 * platform can report the sender, the chat type, reply targets, and
 * attachments without inventing a second callback. The runtime flattens that
 * shape into the IRC body the agent sees (see `inboundBody` in `index.ts`).
 */

/** A platform. Not unique in a runtime: several instances may share one. */
export type ChannelPlatform = "wechat" | "feishu" | "telegram" | "discord" | "qq";

/** Compatibility name for the platform type (no runtime authority of its own). */
export type ChannelId = ChannelPlatform;

/** Stable, immutable instance id; the namespace for every runtime key. */
export type ChannelInstanceId = string;

/** Every instance is deny-by-default; the allowlist must be non-empty. */
export const DENY_BY_DEFAULT_CHANNELS: readonly ChannelPlatform[] = ["wechat", "feishu", "telegram", "discord", "qq"];

export interface ChatImage {
	data: Uint8Array;
	mime: "image/png" | "image/jpeg";
}

export type AttachmentKind = "image" | "file" | "audio" | "video";

/** One inbound file. `path` is set when the adapter stored a local copy. */
export interface InboundAttachment {
	kind: AttachmentKind;
	/** Absolute local path of the stored copy. */
	path?: string;
	/** Remote URL when no local copy exists (download failed or disabled). */
	url?: string;
	name?: string;
	mime?: string;
	size?: number;
	/** Download failure reason (the message text still reaches the agent). */
	error?: string;
}

export interface InboundMessage {
	/** Conversation id: platform chat id; QQ uses `group:<id>` / `user:<id>`. */
	peer: string;
	chatType: "dm" | "group" | "channel" | "thread";
	/** Platform user id of the sender, when known. */
	senderId?: string;
	/** Thread/topic id when the platform separates one chat into threads. */
	threadId?: string;
	/** Display name, when the platform provides one. */
	senderName?: string;
	/** Text the user sent, with mentions and reply markers removed. */
	body: string;
	/** Stable platform message id used for dedupe and reply correlation. */
	messageId?: string;
	/** Platform message id this message replies to, when it is a reply. */
	replyToMessageId?: string;
	attachments?: readonly InboundAttachment[];
	/**
	 * Extra identities an allowlist may match against, e.g. Discord's
	 * `guild:<id>` alongside the channel id in `peer`.
	 */
	allowKeys?: readonly string[];
	ts?: number;
}

export interface InboundContext {
	threadId?: string;
	userId?: string;
}
export type ChannelInboundHandler = (message: InboundMessage) => void;

export interface ChannelCapabilities {
	/** Longest text the platform accepts in one message; `Infinity` = no split. */
	maxTextLength: number;
	supportsImages: boolean;
	supportsFiles: boolean;
	supportsTyping: boolean;
}

export type ChannelHealthState = "connecting" | "ready" | "degraded" | "auth-failed" | "stopped";

/** Live connection health surfaced by `/api/channels/status` and the CLI. */
export interface ChannelHealth {
	state: ChannelHealthState;
	/** Epoch ms the state was entered. */
	since: number;
	/** Human-readable detail (never a secret). */
	detail?: string;
	lastError?: string;
	lastInboundAt?: number;
}

export interface ChannelSendOptions {
	/** Platform message id to reply to, when the channel supports reply refs. */
	replyToMessageId?: string;
}

export interface ChatChannel {
	/** Instance id (unique), not the platform. */
	readonly id: ChannelInstanceId;
	readonly platform: ChannelPlatform;
	readonly capabilities: ChannelCapabilities;
	start(): Promise<void>;
	stop(): Promise<void>;
	sendText(to: string, text: string, options?: ChannelSendOptions): Promise<void>;
	sendImage(to: string, image: ChatImage, caption?: string): Promise<void>;
	/** Optional generic file delivery (Discord multipart, OneBot base64 URL). */
	sendFile?(to: string, file: { data: Uint8Array; name: string; mime?: string }, caption?: string): Promise<void>;
	/** Optional typing indicator (best effort; failures are ignored). */
	sendTyping?(to: string): Promise<void>;
	/** Live health; adapters that do not implement it report as running. */
	getHealth?(): ChannelHealth;
}
