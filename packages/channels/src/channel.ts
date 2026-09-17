/**
 * Minimal IM channel abstraction for `zeta serve` (web/desktop mode only).
 *
 * A `ChatChannel` owns one platform connection: start/stop lifecycle plus
 * outbound text/image delivery. Inbound messages are pushed through the
 * channel's `onMessage` callback (registered at construction) into the
 * coordinator session via `ChannelHost.deliver`.
 */

export type ChannelId = "wechat" | "feishu" | "telegram";

export interface ChatImage {
	data: Uint8Array;
	mime: "image/png" | "image/jpeg";
}

export interface ChatChannel {
	readonly id: ChannelId;
	start(): Promise<void>;
	stop(): Promise<void>;
	sendText(to: string, text: string): Promise<void>;
	sendImage(to: string, image: ChatImage, caption?: string): Promise<void>;
}
