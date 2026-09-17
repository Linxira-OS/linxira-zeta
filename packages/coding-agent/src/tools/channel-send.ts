/**
 * channel_send — agent-initiated push to an IM channel.
 *
 * The agent decides which information is worth forwarding; working tool
 * output (read/write/bash/…) is NOT automatically sent. Only available
 * in web/desktop mode (serve --channels or a channel enabled in web.yml).
 * CLI-only sessions have no channel runtime so isToolAllowed rejects it.
 */

import type { AgentTool, AgentToolResult } from "@linxiraos/pi-agent-core";
import { type } from "@linxiraos/pi-omptype";
import channelSendDescription from "../prompts/tools/channel-send.md" with { type: "text" };
import type { ToolSession } from "./index";

const channelSendSchema = type({
	text: type("string > 0").describe("Text to send to the IM channel."),
	"to?": type("string").describe("Target peer identifier (user/group id). Defaults to the session-bound peer."),
	"channel?": type("'wechat' | 'feishu' | 'telegram'").describe(
		"Channel to use. Defaults to the session-bound channel.",
	),
});

export type ChannelSendParams = typeof channelSendSchema.infer;

export class ChannelSendTool implements AgentTool<typeof channelSendSchema> {
	readonly name = "channel_send";
	readonly approval = "write" as const;
	readonly label = "Channel Send";
	readonly summary = "Send a message to the remote user through the IM channel (WeChat/Feishu/Telegram)";
	readonly description = channelSendDescription;
	readonly parameters = channelSendSchema;
	readonly strict = true;
	readonly loadMode = "discoverable";

	constructor(private readonly session: ToolSession) {}

	async execute(_id: string, params: ChannelSendParams): Promise<AgentToolResult> {
		const send = this.session.channelSend;
		if (!send) {
			return {
				content: [
					{
						type: "text",
						text: "channel_send is not available in this session (CLI mode or no channel runtime).",
					},
				],
				isError: true,
			};
		}
		try {
			await send({ text: params.text, to: params.to, channel: params.channel });
			return { content: [{ type: "text", text: "Sent." }] };
		} catch (error: unknown) {
			const msg = error instanceof Error ? error.message : String(error);
			return { content: [{ type: "text", text: `channel_send failed: ${msg}` }], isError: true };
		}
	}
}
